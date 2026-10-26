// SPDX-License-Identifier: GPL-2.0-or-later
//
// Settings page: the current firmware state, and setting up the one-click
// helper (with a button or a sudo command).

import Adw from 'gi://Adw';
import Gdk from 'gi://Gdk';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Gtk from 'gi://Gtk';

import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import {EFIBOOTMGR_CANDIDATES, HELPER_DIR, IMAGE_BASED_MARKER} from './lib/constants.js';
import {formatEntry} from './lib/efivars.js';
import {readSnapshot} from './lib/firmware.js';
import {
    HELPER_MANIFEST, asPkexecArgv, helperStatus, installSteps, terminalCommand,
    uninstallSteps,
} from './lib/install.js';
import {deriveState, reached} from './lib/state.js';
import {isTrustedInfo, queryTrustInfo} from './lib/trust.js';
import {DismissedError, runPrivileged, setNextBoot} from './lib/writer.js';

function contents(path) {
    try {
        return GLib.file_get_contents(path)[1];
    } catch {
        return null;
    }
}

function sameBytes(a, b) {
    return a !== null && b !== null && a.length === b.length && a.every((x, i) => x === b[i]);
}

// HELPER_MANIFEST plus what's on disk now.
function helperFiles(extPath) {
    return HELPER_MANIFEST.map(f => ({
        ...f,
        info: queryTrustInfo(Gio, f.installed),
        same: f.source === null ||
            sameBytes(contents(f.installed), contents(`${extPath}/${f.source}`)),
    }));
}

const STATUS_TEXT = {
    'installed': 'On. Administrators at this computer can switch without a password.',
    'outdated': 'On, but older than this version of the extension.',
    'partial': 'Partial install. Not in use.',
    'untrusted': 'Unsafe permissions. Not in use.',
    'unsafe-parent': `Installed, but not used because a folder above ${HELPER_DIR} is a symlink or writable by other users.`,
    'missing': 'Off. Every change asks for an administrator password.',
    'image-based': 'Not available on systems with a read-only /usr, like Fedora Silverblue.',
};

// Row with plain-text title and subtitle. use_markup has to be off before the
// text is set, or GNOME 45-47 shows an empty row for text containing '&'.
function plainRow(title, subtitle) {
    const row = new Adw.ActionRow({use_markup: false});
    row.title = title;
    row.subtitle = subtitle;
    return row;
}

function plainToast(title, timeout = 5) {
    const toast = new Adw.Toast({timeout, use_markup: false});
    toast.title = title;
    return toast;
}

function button(label, style) {
    return new Gtk.Button({label, valign: Gtk.Align.CENTER, css_classes: style ? [style] : []});
}

function copyButton(text, toastTarget) {
    const b = new Gtk.Button({
        icon_name: 'edit-copy-symbolic',
        valign: Gtk.Align.CENTER,
        tooltip_text: 'Copy command',
        css_classes: ['flat'],
    });
    b.connect('clicked', () => {
        Gdk.Display.get_default().get_clipboard().set(text);
        toastTarget.add_toast(plainToast('Copied'));
    });
    return b;
}

function commandRow(title, command, toastTarget) {
    const row = plainRow(title, command);
    row.subtitle_selectable = true;
    row.add_css_class('property');
    row.add_suffix(copyButton(command, toastTarget));
    return row;
}

export default class BootToWindowsPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        this._window = window;
        this._page = new Adw.PreferencesPage();
        this._groups = [];
        window.add(this._page);
        window.connect('close-request', () => {
            this._window = null;
            this._page = null;
            this._groups = [];
            return false;
        });
        return this._render();
    }

    async _render() {
        let snapshot = null, error = null;
        try {
            snapshot = await readSnapshot();
        } catch (e) {
            error = e;
        }
        if (!this._page)
            return; // window closed while we were reading
        for (const g of this._groups)
            this._page.remove(g);
        this._groups = [this._firmwareGroup(snapshot, error), this._helperGroup()];
        for (const g of this._groups)
            this._page.add(g);
    }

    async _run(b, job) {
        b.sensitive = false;
        b.label = 'Waiting…';
        try {
            await job();
        } catch (e) {
            if (!(e instanceof DismissedError))
                this._window?.add_toast(plainToast(e.message, 0));
        } finally {
            this._render();
        }
    }

    _withButton(row, label, style, job) {
        const b = button(label, style);
        b.connect('clicked', () => this._run(b, job));
        row.add_suffix(b);
        row.activatable_widget = b;
        return row;
    }

    _firmwareGroup(snapshot, error) {
        const group = new Adw.PreferencesGroup({title: 'Firmware'});
        if (error) {
            group.add(plainRow('Status', `Couldn't read the boot variables: ${error.message}`));
            return group;
        }
        const state = deriveState(snapshot);
        const entry = e => (e ? `${e.description} (Boot${formatEntry(e.num)})` : 'None');
        const statusText = {
            'unsupported': 'Not booted in UEFI mode',
            'no-windows': 'No Windows Boot Manager entry found',
            'windows-is-default': 'Windows already starts by default',
            'ready': 'Next restart starts as usual',
            'armed': 'Next restart starts Windows',
            'other': `Next restart starts ${entry(state.bootNext)}`,
        }[state.status];

        // Any one-time boot can be undone from here, even when the toggle is
        // hidden.
        const undo = row => this._withButton(row, 'Start as usual', null,
            () => setNextBoot('default'));
        const pending = state.status !== 'unsupported' && state.defaultEntry !== null &&
            !reached(state, 'default');
        const status = plainRow('Status', statusText);
        group.add(pending && ['armed', 'other'].includes(state.status) ? undo(status) : status);
        if (state.status === 'unsupported')
            return group;
        if (pending && !['armed', 'other'].includes(state.status))
            group.add(undo(plainRow('Next restart', `${entry(state.bootNext)}, once`)));

        group.add(plainRow('Windows entry', entry(state.windows)));
        group.add(plainRow('Default entry', entry(state.defaultEntry)));
        if (snapshot.problems.length > 0)
            group.add(plainRow('Skipped (unreadable)', snapshot.problems.join('\n')));
        const efibootmgr = EFIBOOTMGR_CANDIDATES.find(p => isTrustedInfo(queryTrustInfo(Gio, p)));
        group.add(plainRow('efibootmgr',
            efibootmgr ?? 'Not found. Install the efibootmgr package.'));
        return group;
    }

    _helperGroup() {
        const imageBased = GLib.file_test(IMAGE_BASED_MARKER, GLib.FileTest.EXISTS);
        const status = imageBased ? 'image-based' : helperStatus(helperFiles(this.path));
        const group = new Adw.PreferencesGroup({
            title: 'One-click mode',
            description: 'Lets administrators at this computer switch without a ' +
                'password. It installs a small helper that can only set the next ' +
                'boot to Windows or the default. Turn this off before you remove ' +
                'the extension, or the helper stays installed.',
        });
        group.add(plainRow('One-click status', STATUS_TEXT[status]));
        if (imageBased)
            return group;

        const action = (title, subtitle, label, steps, style) => group.add(this._withButton(
            plainRow(title, subtitle), label, style,
            () => runPrivileged(asPkexecArgv(steps))));
        if (status === 'missing') {
            action('Enable one-click switching', 'Asks for an administrator password once',
                'Enable', installSteps(this.path), 'suggested-action');
        } else if (status !== 'installed') {
            action('Update the helper', 'Installs the copy that comes with this version',
                'Update', installSteps(this.path), 'suggested-action');
        }
        if (status !== 'missing') {
            action('Turn off one-click switching', 'Changes will ask for a password again',
                'Remove', uninstallSteps(), 'destructive-action');
        }

        const terminal = new Adw.ExpanderRow({
            title: 'Use a terminal instead',
            subtitle: 'Run the same steps with sudo',
        });
        const home = GLib.get_home_dir();
        terminal.add_row(commandRow('Install or update', terminalCommand(this.path, 'install', home), this._window));
        terminal.add_row(commandRow('Remove', terminalCommand(this.path, 'remove', home), this._window));
        group.add(terminal);
        return group;
    }
}
