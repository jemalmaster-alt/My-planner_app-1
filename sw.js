// This file runs in the background to handle offline notifications

self.addEventListener('notificationclick', (event) => {
    // Closes the notification when the user clicks on it
    event.notification.close();
    
    // This will open your app when the notification is clicked.
    // It focuses on an existing window or opens a new one.
    event.waitUntil(
        clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
            if (clientList.length > 0) {
                let client = clientList[0];
                for (let i = 0; i < clientList.length; i++) {
                    if (clientList[i].focused) {
                        client = clientList[i];
                    }
                }
                return client.focus();
            }
            return clients.openWindow('/');
        })
    );
});
