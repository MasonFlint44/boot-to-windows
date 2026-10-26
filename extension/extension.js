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
import {ICON_FILE, NAME, presentation} from './lib/presentation.js';
import {deriveState} from './lib/state.js';
import {DismissedError, setNextBoot} from './lib/writer.js';

const HIDDEN = {visible: false, checked: false, subtitle: null, header: '', canDisarm: false};

const BootToWindowsToggle = GObject.registerClass({
    Signals: {'state-changed': {}},
}, class BootToWindowsToggle extends QuickMenuToggle {
    _init(extension, gicon) {
        super._init({
            title: NAME,
            gicon,
            // `checked` only ever shows what the firmware reports.
            toggleMode: false,
        });

        this._extension = extension;
        this._gicon = gicon;
        this._cancellable = new Gio.Cancellable();
        this._seq = 0;
        this._busy = false;
        this._state = null;
        this._suggestion = null;

        this._restartItem = this.menu.addAction('Restart to Windows…',
            () => this._restartToWindows());
        this._disarmItem = this.menu.addAction('Start as usual next time',
            () => this._write('default'));
        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        this.menu.addAction(`${NAME} Settings`,
            () => this._extension.openPreferences());

        this._clickedId = this.connect('clicked', () => this._onClicked());
        this._menuOpenId = this.menu.connect('open-state-changed', (_m, open) => {
            if (open)
                this.refresh();
        });

        this._render();
        this.refresh();
    }

    destroy() {
        this._cancellable.cancel();
        this.disconnect(this._clickedId);
        this.menu.disconnect(this._menuOpenId);
        if (this._suggestion) {
            this._suggestion.disconnect(this._suggestionId);
            this._suggestion.destroy();
            this._suggestion = null;
        }
        super.destroy();
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
            if (seq === this._seq && !this._cancellable.is_cancelled())
                this._setState(state);
        } catch (e) {
            if (!this._cancellable.is_cancelled())
                console.error(`${NAME}: reading firmware failed: ${e.message}`);
        }
    }

    _setState(state) {
        this._state = state;
        this._render();
    }

    _render() {
        // Hidden until the first firmware read lands.
        const p = this._state ? presentation(this._state) : HIDDEN;
        this.visible = p.visible;
        this.checked = p.checked;
        // This also disables the menu arrow while a write runs.
        this.reactive = !this._busy;
        this.subtitle = this._busy ? 'Waiting…' : p.subtitle;
        this.menu.setHeader(this._gicon, 'Next Boot', p.header);

        this._restartItem.setSensitive(!this._busy && SystemActions.getDefault().canRestart);
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
        this._seq++; // drop a refresh in flight: it would show the old state
        this._render();
        try {
            const {state, route} = await setNextBoot(target, this._cancellable);
            if (this._cancellable.is_cancelled())
                return false;
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

    /** After the first change that needed a password, suggest one-click mode, once. */
    _offerOneClick() {
        const settings = this._extension.getSettings();
        if (settings.get_boolean('one-click-offered'))
            return;
        try {
            this._suggestion = notifyClickable('Skip the password next time?',
                'Boot to Windows can switch with one click. Click here to set it up in its settings.',
                () => this._extension.openPreferences());
        } catch (e) {
            // Not shown, so not marked as offered.
            console.error(`${NAME}: showing the one-click suggestion failed: ${e.message}`);
            return;
        }
        this._suggestionId = this._suggestion.connect('destroy', () => (this._suggestion = null));
        settings.set_boolean('one-click-offered', true);
    }

    async _restartToWindows() {
        if (!await this._write('windows'))
            return;
        // GNOME's own restart dialog, which can still be cancelled; Windows
        // then stays armed and the top-bar icon shows it.
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

        const gicon = Gio.FileIcon.new(Gio.File.new_for_path(`${extension.path}/icons/${ICON_FILE}`));

        // Top-bar icon, only while Windows is armed.
        this._icon = this._addIndicator();
        this._icon.gicon = gicon;
        this._icon.visible = false;

        this._toggle = new BootToWindowsToggle(extension, gicon);
        this._stateId = this._toggle.connect('state-changed',
            () => (this._icon.visible = this._toggle.state?.status === 'armed'));
        this.quickSettingsItems.push(this._toggle);

        // Re-read when Quick Settings opens: another tool may have changed BootNext.
        this._qsMenu = Main.panel.statusArea.quickSettings.menu;
        this._qsMenuId = this._qsMenu.connect('open-state-changed', (_m, open) => {
            if (open)
                this._toggle.refresh();
        });
    }

    destroy() {
        this._qsMenu.disconnect(this._qsMenuId);
        this._toggle.disconnect(this._stateId);
        this.quickSettingsItems.forEach(item => item.destroy());
        this.quickSettingsItems = [];
        super.destroy();
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
