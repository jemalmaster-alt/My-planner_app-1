document.addEventListener('DOMContentLoaded', () => {
    // DOM Elements
    const daySelector = document.getElementById('day-selector');
    const currentDayTitle = document.getElementById('current-day-title');
    const taskList = document.getElementById('task-list');
    const addTaskForm = document.getElementById('add-task-form');
    const taskTextInput = document.getElementById('task-text-input');
    const taskTimeInput = document.getElementById('task-time-input');

    const settingsBtn = document.getElementById('settings-btn');
    const settingsPanel = document.getElementById('settings-panel');
    const closeSettingsBtn = document.getElementById('close-settings-btn');
    const selectSoundBtn = document.getElementById('select-sound-btn');
    const alarmSoundPicker = document.getElementById('alarm-sound-picker');
    const currentAlarmSoundEl = document.getElementById('current-alarm-sound');

    const alarmModalOverlay = document.getElementById('alarm-modal-overlay');
    const alarmModal = document.getElementById('alarm-modal');
    const alarmTaskText = document.getElementById('alarm-task-text');
    const dismissAlarmBtn = document.getElementById('dismiss-alarm-btn');

    // App State
    const daysOfWeek = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    let currentDay;
    let tasks = {};
    let customAlarmSound = null;
    let audioContext = new (window.AudioContext || window.webkitAudioContext)();
    let currentAlarmSource = null;

    // --- Service Worker & Notifications ---
    async function setupServiceWorker() {
        if ('serviceWorker' in navigator && 'Notification' in window && 'TimestampTrigger' in window) {
            try {
                await navigator.serviceWorker.register('sw.js');
                console.log('Service Worker registered successfully.');
                const permission = await Notification.requestPermission();
                if (permission !== 'granted') {
                    console.warn('Notification permission was not granted.');
                }
            } catch (error) {
                console.error('Service Worker registration failed:', error);
            }
        } else {
            console.warn('Offline notifications are not supported in this browser.');
        }
    }

    async function scheduleNotification(task) {
        if (!('serviceWorker' in navigator) || !('Notification' in window) || !('TimestampTrigger' in window) || Notification.permission !== 'granted') {
            return;
        }

        const [hours, minutes] = task.time.split(':');
        const now = new Date();
        const alarmTime = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hours, minutes, 0, 0);
        
        const dayIndex = daysOfWeek.indexOf(task.day);
        while (alarmTime.getDay() !== dayIndex || alarmTime <= now) {
            alarmTime.setDate(alarmTime.getDate() + 1);
        }

        const timestamp = alarmTime.getTime();

        try {
            const registration = await navigator.serviceWorker.ready;
            const existingNotifications = await registration.getNotifications({ tag: task.id.toString() });
            existingNotifications.forEach(notification => notification.close());

            await registration.showNotification('Task Reminder!', {
                tag: task.id.toString(),
                body: task.text,
                showTrigger: new TimestampTrigger(timestamp),
            });
            console.log(`Notification scheduled for: ${task.text} at ${alarmTime}`);
        } catch (e) {
            console.error('Failed to schedule notification:', e);
        }
    }
    
    async function cancelNotification(taskId) {
        if (!('serviceWorker' in navigator)) return;
        try {
            const registration = await navigator.serviceWorker.ready;
            const notifications = await registration.getNotifications({ tag: taskId.toString() });
            notifications.forEach(notification => notification.close());
            console.log(`Cancelled notification for task ID: ${taskId}`);
        } catch(e) {
            console.error('Failed to cancel notification:', e);
        }
    }

    // --- Core Functions ---
    function init() {
        setupServiceWorker();
        const todayIndex = new Date().getDay();
        currentDay = daysOfWeek[todayIndex];
        loadData();
        renderDayTabs();
        renderTasks(true);
        setupEventListeners();
        lucide.createIcons();
    }

    // --- Event Handlers & Actions ---
    function setupEventListeners() {
        addTaskForm.addEventListener('submit', (e) => { e.preventDefault(); addTask(); });
        settingsBtn.onclick = () => settingsPanel.classList.remove('translate-x-full');
        closeSettingsBtn.onclick = () => settingsPanel.classList.add('translate-x-full');
        selectSoundBtn.onclick = () => alarmSoundPicker.click();
        alarmSoundPicker.onchange = handleSoundFile;
        dismissAlarmBtn.onclick = hideAlarmModal;
        alarmModalOverlay.onclick = (e) => { if (e.target === alarmModalOverlay) hideAlarmModal(); };
    }

    async function addTask() {
        const text = taskTextInput.value.trim();
        const time = taskTimeInput.value;
        if (!text || !time) return;

        const newTask = { id: Date.now(), day: currentDay, text, time, isComplete: false, alarmSet: true };
        if (!tasks[currentDay]) tasks[currentDay] = [];
        tasks[currentDay].push(newTask);
        
        await scheduleNotification(newTask);
        saveData();
        renderTasks();
        addTaskForm.reset();
    }
    
    // Globally expose functions needed by inline onclick handlers
    window.toggleComplete = async (day, taskId) => {
        const task = tasks[day]?.find(t => t.id === taskId);
        if (task) {
            task.isComplete = !task.isComplete;
            if (task.isComplete) {
                await cancelNotification(taskId);
            } else if (task.alarmSet) {
                await scheduleNotification(task);
            }
            saveData();
            renderTasks();
        }
    };

    window.toggleAlarm = async (day, taskId) => {
        const task = tasks[day]?.find(t => t.id === taskId);
        if (task) {
            task.alarmSet = !task.alarmSet;
            if (task.alarmSet && !task.isComplete) {
                await scheduleNotification(task);
            } else {
                await cancelNotification(taskId);
            }
            saveData();
            renderTasks();
        }
    };
    
    window.deleteTask = async (day, taskId) => {
        const taskEl = event.target.closest('.task-item');
        taskEl.classList.add('task-exit');
        await cancelNotification(taskId);
        await new Promise(resolve => setTimeout(resolve, 400));
        tasks[day] = tasks[day].filter(t => t.id !== taskId);
        saveData();
        renderTasks();
    };

    function handleSoundFile(event) {
        const file = event.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (e) => {
            customAlarmSound = { name: file.name, data: e.target.result };
            currentAlarmSoundEl.textContent = file.name;
            saveData();
        };
        reader.readAsDataURL(file);
    }
    
    // --- Alarm Modal Logic (for in-app alerts) ---
    async function triggerInAppAlarm(task) {
        if (document.hidden) return;

        if (currentAlarmSource) {
            currentAlarmSource.stop();
        }
        
        if (customAlarmSound) {
            try {
                const response = await fetch(customAlarmSound.data);
                const arrayBuffer = await response.arrayBuffer();
                const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
                currentAlarmSource = audioContext.createBufferSource();
                currentAlarmSource.buffer = audioBuffer;
                currentAlarmSource.connect(audioContext.destination);
                currentAlarmSource.start(0);
            } catch (e) { console.error("Error playing custom sound:", e); }
        } else {
            const oscillator = audioContext.createOscillator();
            const gainNode = audioContext.createGain();
            oscillator.connect(gainNode);
            gainNode.connect(audioContext.destination);
            oscillator.start();
            oscillator.stop(audioContext.currentTime + 0.5);
            currentAlarmSource = oscillator;
        }
        showAlarmModal(task.text);
    }

    function showAlarmModal(taskText) {
        alarmTaskText.textContent = taskText;
        alarmModalOverlay.classList.remove('pointer-events-none', 'opacity-0');
        alarmModal.classList.remove('scale-95');
    }
    
    function hideAlarmModal() {
        if (currentAlarmSource) {
            try { currentAlarmSource.stop(); } catch(e) {}
            currentAlarmSource = null;
        }
        alarmModalOverlay.classList.add('pointer-events-none', 'opacity-0');
        alarmModal.classList.add('scale-95');
    }

    // Interval to check for IN-APP alarms
    setInterval(() => {
        const now = new Date();
        const currentDayName = daysOfWeek[now.getDay()];
        const currentTime = now.toTimeString().substring(0, 5);
        (tasks[currentDayName] || []).forEach(task => {
            if (task.alarmSet && !task.isComplete && task.time === currentTime) {
                triggerInAppAlarm(task);
            }
        });
    }, 20000); // Check every 20 seconds
    
    // --- Data, Rendering, and Utility Functions ---
    async function changeDay(day) {
        if (day === currentDay) return;
        const mainContent = document.getElementById('main-content');
        mainContent.classList.add('content-exit');
        await new Promise(resolve => setTimeout(resolve, 300));
        currentDay = day;
        renderDayTabs();
        renderTasks();
        mainContent.classList.remove('content-exit');
    }

    function renderDayTabs() {
        daySelector.innerHTML = '';
        daysOfWeek.forEach(day => {
            const isActive = day === currentDay;
            const button = document.createElement('button');
            button.textContent = day.substring(0, 3);
            button.className = `px-4 py-2 rounded-lg font-bold text-sm transition-all duration-300 transform hover:scale-105 ${
                isActive 
                ? 'bg-indigo-600 text-white shadow-lg' 
                : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
            }`;
            button.onclick = () => changeDay(day);
            daySelector.appendChild(button);
        });
    }

    function renderTasks(isInitial = false) {
        const mainContent = document.getElementById('main-content');
        if(!isInitial) mainContent.classList.add('content-enter');
        
        currentDayTitle.textContent = `${currentDay}'s Plan`;
        taskList.innerHTML = '';
        const dayTasks = tasks[currentDay] || [];

        if (dayTasks.length === 0) {
            taskList.innerHTML = `<div class="text-center py-16 px-4 task-enter"><i data-lucide="sunrise" class="mx-auto h-16 w-16 text-slate-500"></i><p class="mt-4 text-slate-400">A fresh start. Add a task to begin.</p></div>`;
        } else {
            dayTasks.sort((a, b) => a.time.localeCompare(b.time));
            dayTasks.forEach((task, index) => {
                const taskEl = document.createElement('div');
                taskEl.className = `task-item bg-slate-800/50 p-4 rounded-lg flex items-center gap-4 border-l-4 transition-all duration-300 ${task.isComplete ? 'border-green-500 opacity-50' : 'border-slate-700'}`;
                if (!isInitial) {
                    taskEl.classList.add('task-enter');
                    taskEl.style.animationDelay = `${index * 50}ms`;
                }

                taskEl.innerHTML = `
                    <div class="flex-grow cursor-pointer" onclick="toggleComplete('${currentDay}', ${task.id})">
                        <p class="font-semibold text-slate-100 ${task.isComplete ? 'line-through' : ''}">${task.text}</p>
                        <p class="text-sm text-slate-400">${formatTime(task.time)}</p>
                    </div>
                    <div class="flex items-center gap-2">
                        <button onclick="toggleAlarm('${currentDay}', ${task.id})" class="${task.alarmSet ? 'text-indigo-400' : 'text-slate-500'} hover:text-indigo-400 p-2 rounded-full hover:bg-slate-700 transition-colors">
                            <i data-lucide="bell" class="${task.alarmSet ? 'fill-current' : ''}"></i>
                        </button>
                        <button onclick="deleteTask('${currentDay}', ${task.id})" class="text-slate-500 hover:text-red-400 p-2 rounded-full hover:bg-slate-700 transition-colors">
                            <i data-lucide="trash-2"></i>
                        </button>
                    </div>`;
                taskList.appendChild(taskEl);
            });
        }
        lucide.createIcons();
        if(!isInitial) setTimeout(() => mainContent.classList.remove('content-enter'), 500);
    }
    
    function saveData() {
        localStorage.setItem('plannerTasks', JSON.stringify(tasks));
        if (customAlarmSound) {
            localStorage.setItem('plannerAlarmSound', JSON.stringify({ name: customAlarmSound.name, data: customAlarmSound.data }));
        } else {
             localStorage.removeItem('plannerAlarmSound');
        }
    }

    function loadData() {
        const savedTasks = localStorage.getItem('plannerTasks');
        tasks = savedTasks ? JSON.parse(savedTasks) : daysOfWeek.reduce((acc, day) => ({ ...acc, [day]: [] }), {});

        const savedSound = localStorage.getItem('plannerAlarmSound');
        if (savedSound) {
            customAlarmSound = JSON.parse(savedSound);
            currentAlarmSoundEl.textContent = customAlarmSound.name;
        }
    }
    
    function formatTime(timeString) {
        const [hourString, minute] = timeString.split(":");
        const hour = +hourString % 24;
        return `${hour % 12 || 12}:${minute} ${hour < 12 ? "AM" : "PM"}`;
    }

    init();
});
