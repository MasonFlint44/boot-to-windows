// SPDX-License-Identifier: GPL-2.0-or-later
//
// Clickable notifications. GNOME 46 switched Notification to a params object
// and added a shared system source; 45 only has the old constructor.

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as MessageTray from 'resource:///org/gnome/shell/ui/messageTray.js';

/**
 * @param {string} title
 * @param {string} body
 * @param {() => void} onActivate  called when the notification is clicked
 */
export function notifyClickable(title, body, onActivate) {
    let notification;
    if (MessageTray.getSystemSource) {
        const source = MessageTray.getSystemSource();
        notification = new MessageTray.Notification({source, title, body});
        notification.connect('activated', () => onActivate());
        source.addNotification(notification);
    } else {
        const source = new MessageTray.SystemNotificationSource();
        Main.messageTray.add(source);
        notification = new MessageTray.Notification(source, title, body);
        notification.connect('activated', () => onActivate());
        source.showNotification(notification);
    }
    return notification;
}
