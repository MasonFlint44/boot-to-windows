// SPDX-License-Identifier: GPL-2.0-or-later
//
// Quick Settings toggle that sends the next restart - and only the next one -
// to Windows, by setting the UEFI BootNext variable.

import GObject from 'gi://GObject';
import Gio from 'gi://Gio';

import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import {QuickMenuToggle, SystemIndicator} from 'resource:///org/gnome/shell/ui/quickSettings.js';
import * as SystemActions from 'resource:///org/gnome/shell/misc/systemActions.js';

import {readSnapshot} from './lib/firmware.js';
import {notifyClickable} from './lib/notify.js';
import {ICON, NAME, presentation} from './lib/presentation.js';
import {deriveState} from './lib/state.js';
import {DismissedError, setNextBoot} from './lib/writer.js';

const BootToWindowsToggle = GObject.registerClass({
    Signals: {'state-changed': {}},
}, class BootToWindowsToggle extends QuickMenuToggle {
    _init(extension) {
        super._init({
            title: NAME,
            iconName: ICON,
            // `checked` always mirrors what the firmware reports; it is never
            // flipped optimistically.
            toggleMode: false,
        });

        this._extension = extension;
        this._cancellable = new Gio.Cancellable();
        this._seq = 0;
        this._busy = false;
        this._state = null;

        this.menu.setHeader(ICON, 'Next Boot');

        this._restartItem = this.menu.addAction('Restart to Windows…',
            () => this._restartToWindows());
        this._disarmItem = this.menu.addAction('Start as usual next time',
            () => this._write('default'));
        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        this.menu.addAction(`${NAME} Settings`,
            () => this._extension.openPreferences());

        this.connect('clicked', () => this._onClicked());
        this.menu.connect('open-state-changed', (_m, open) => {
            if (open)
                this.refresh();
        });
        this.connect('destroy', () => this._cancellable.cancel());

        this._render();
        this.refresh();
    }

    get state() {
        return this._state;
    }

    /**
     * Re-read the firmware. Out-of-order results are dropped, and nothing is
     * read during a write: the write reports its own verified result.
     */
    async refresh() {
        if (this._busy)
            return;
        const seq = ++this._seq;
        try {
            const state = deriveState(await readSnapshot(this._cancellable));
            if (seq === this._seq)
                this._setState(state);
        } catch (e) {
            if (this._cancellable.is_cancelled())
                return;
            console.error(`${NAME}: reading firmware failed: ${e.message}`);
        }
    }

    _setState(state) {
        this._state = state;
        this._render();
    }

    _render() {
        // Hidden until the first firmware read lands (a few milliseconds).
        const p = this._state ? presentation(this._state)
            : {visible: false, checked: false, subtitle: null, header: '', canDisarm: false};
        this.visible = p.visible;
        this.checked = p.checked;
        // Also disables the menu arrow, which is fine for a write's duration.
        this.reactive = !this._busy;
        this.subtitle = this._busy ? 'Waiting…' : p.subtitle;
        this.menu.setHeader(ICON, 'Next Boot', p.header);

        const restart = SystemActions.getDefault().canRestart;
        this._restartItem.setSensitive(!this._busy && restart);
        this._disarmItem.visible = p.canDisarm;
        this._disarmItem.setSensitive(!this._busy);
        this.emit('state-changed');
    }

    _onClicked() {
        if (this._busy || !this._state || !presentation(this._state).visible)
            return;
        this._write(this._state.status === 'armed' ? 'default' : 'windows');
    }

    /** Resolves true if the firmware ended up where we asked. */
    async _write(target) {
        if (this._busy)
            return false;
        this._busy = true;
        // Drop any refresh already in flight: it would report pre-write state.
        this._seq++;
        this._render();
        try {
            const {state, route} = await setNextBoot(target, this._cancellable);
            this._busy = false;
            this._setState(state);
            if (route === 'password')
                this._offerOneClick();
            return true;
        } catch (e) {
            if (this._cancellable.is_cancelled())
                return false;
            this._busy = false;
            if (!(e instanceof DismissedError))
                Main.notify(NAME, e.message);
            this._render();
            this.refresh();
            return false;
        }
    }

    /** After the first change that needed a password, suggest one-click mode. Once, ever. */
    _offerOneClick() {
        const settings = this._extension.getSettings();
        if (settings.get_boolean('one-click-offered'))
            return;
        settings.set_boolean('one-click-offered', true);
        notifyClickable('Skip the password next time?',
            'Boot to Windows can switch with one click. Click here to set it up in its settings.',
            () => this._extension.openPreferences());
    }

    async _restartToWindows() {
        if (!await this._write('windows'))
            return;
        // GNOME's own restart dialog: shows a countdown, warns about unsaved
        // work, and can be cancelled (Windows then stays armed, as the
        // indicator shows).
        try {
            SystemActions.getDefault().activateRestart();
        } catch (e) {
            Main.notify(NAME, `Windows is set for the next restart, but restarting failed: ${e.message}`);
        }
    }
});

const BootToWindowsIndicator = GObject.registerClass(
class BootToWindowsIndicator extends SystemIndicator {
    _init(extension) {
        super._init();

        // Top-bar icon, shown only while Windows is armed, so a pending
        // switch is never invisible.
        this._icon = this._addIndicator();
        this._icon.iconName = ICON;
        this._icon.visible = false;

        this._toggle = new BootToWindowsToggle(extension);
        this._toggle.connect('state-changed',
            () => (this._icon.visible = this._toggle.state?.status === 'armed'));
        this.quickSettingsItems.push(this._toggle);

        // Refresh whenever the user opens Quick Settings, in case something
        // else (efibootmgr, a firmware update) changed BootNext underneath us.
        const qs = Main.panel.statusArea.quickSettings;
        this._qsMenuId = qs.menu.connect('open-state-changed', (_m, open) => {
            if (open)
                this._toggle.refresh();
        });

        this.connect('destroy', () => {
            qs.menu.disconnect(this._qsMenuId);
            this.quickSettingsItems.forEach(item => item.destroy());
            this.quickSettingsItems = [];
        });
    }
});

export default class BootToWindowsExtension extends Extension {
    enable() {
        this._indicator = new BootToWindowsIndicator(this);
        Main.panel.statusArea.quickSettings.addExternalIndicator(this._indicator);
    }

    disable() {
        this._indicator.destroy();
        this._indicator = null;
    }
}
