// SPDX-License-Identifier: GPL-2.0-or-later
//
// Preferences: what the firmware looks like, and the optional one-click
// helper. Setting the helper up is always the user's explicit choice: a
// button that runs the bundled installer through one pkexec prompt, or the
// same installer typed into a terminal.

import Adw from 'gi://Adw';
import Gdk from 'gi://Gdk';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Gtk from 'gi://Gtk';

import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import {EFIBOOTMGR_CANDIDATES, HELPER_DIR, IMAGE_BASED_MARKER} from './lib/constants.js';
import {formatEntry} from './lib/efivars.js';
import {readSnapshotSync} from './lib/firmware.js';
import {HELPER_MANIFEST, helperStatus, pkexecCommand, terminalCommand} from './lib/install.js';
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

/** HELPER_MANIFEST with what's on disk now. */
function helperFiles(extPath) {
    return HELPER_MANIFEST.map(f => ({
        ...f,
        info: queryTrustInfo(Gio, f.installed),
        same: f.source === null ||
            sameBytes(contents(f.installed), contents(`${extPath}/${f.source}`)),
    }));
}

const STATUS_TEXT = {
    'installed': 'On. Administrators at this computer switch without a password.',
    'outdated': 'On, but older than this extension. Update it.',
    'partial': 'Partly installed, so it is not used. Reinstall it.',
    'untrusted': 'Found, but not safely installed (not root-owned), so it is not used. Reinstall it.',
    'unsafe-parent': `Installed, but not used: a folder above ${HELPER_DIR} is a link, or writable by non-root users.`,
    'missing': 'Off. Each change asks for an administrator password.',
    'image-based': 'Not available: this system’s /usr is read-only (an image-based system such as ' +
        'Fedora Silverblue). Each change asks for an administrator password.',
};

/**
 * A row whose text is shown literally (firmware strings and commands are
 * arbitrary). Markup goes off before any text is set: construct properties
 * have no order, and text parsed as markup first logs warnings (and renders
 * empty on GNOME 45-47 when it contains '&').
 */
function plainRow(title, subtitle) {
    const row = new Adw.ActionRow({use_markup: false});
    row.title = title;
    row.subtitle = subtitle;
    return row;
}

/** A toast whose text is shown literally (error messages are arbitrary). */
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
        toastTarget.add_toast(plainToast('Copied. Paste it into a terminal.'));
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
        this._render();
    }

    /** (Re)build the page from what's on disk now. */
    _render() {
        for (const g of this._groups)
            this._page.remove(g);
        this._groups = [this._firmwareGroup(), this._helperGroup()];
        for (const g of this._groups)
            this._page.add(g);
    }

    /** Run a button's job; whatever happens, show the outcome and re-render. */
    async _run(b, job) {
        b.sensitive = false;
        b.label = 'Waiting…';
        try {
            await job();
        } catch (e) {
            if (!(e instanceof DismissedError))
                this._window.add_toast(plainToast(e.message, 0));
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

    _firmwareGroup() {
        const group = new Adw.PreferencesGroup({title: 'Firmware'});
        let snapshot;
        try {
            snapshot = readSnapshotSync();
        } catch (e) {
            group.add(plainRow('Status', `Couldn’t read the firmware’s boot settings: ${e.message}`));
            return group;
        }
        const state = deriveState(snapshot);
        const entry = e => (e ? `${e.description} (Boot${formatEntry(e.num)})` : 'None');
        const statusText = {
            'unsupported': 'This computer did not start in UEFI mode',
            'no-windows': 'No Windows Boot Manager entry found',
            'windows-is-default': 'Windows already starts by default',
            'ready': 'Next restart starts as usual',
            'armed': 'Next restart starts Windows',
            'other': `Next restart starts ${entry(state.bootNext)}`,
        }[state.status];

        // A one-time boot that isn't the usual one can always be undone
        // here, even in states where the toggle is hidden.
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
            efibootmgr ?? 'Not installed. Install the "efibootmgr" package.'));
        return group;
    }

    _helperGroup() {
        const imageBased = GLib.file_test(IMAGE_BASED_MARKER, GLib.FileTest.EXISTS);
        const status = imageBased ? 'image-based' : helperStatus(helperFiles(this.path));
        const group = new Adw.PreferencesGroup({
            title: 'One-click mode',
            description: 'Lets administrators logged in at this computer switch ' +
                'without typing a password. It installs a small helper that can ' +
                'only point the next boot at Windows or back at the default. ' +
                'Setting it up asks for an administrator password once. ' +
                'Turn it off here before removing the extension: removing the ' +
                'extension leaves the helper installed.',
        });
        group.add(plainRow('One-click status', STATUS_TEXT[status]));
        if (imageBased)
            return group;

        const action = (title, subtitle, label, verb, style) => group.add(this._withButton(
            plainRow(title, subtitle), label, style,
            () => runPrivileged(pkexecCommand(this.path, verb))));
        if (status === 'missing') {
            action('Enable one-click switching', 'Asks for an administrator password once',
                'Enable', 'install', 'suggested-action');
        } else if (status !== 'installed') {
            action('Update the helper', 'Reinstalls it from this version of the extension',
                'Update', 'install', 'suggested-action');
        }
        if (status !== 'missing') {
            action('Turn off one-click switching', 'Removes the helper; changes ask for a password again',
                'Remove', 'remove', 'destructive-action');
        }

        const terminal = new Adw.ExpanderRow({
            title: 'Use a terminal instead',
            subtitle: 'The same installer, run with sudo',
        });
        const home = GLib.get_home_dir();
        terminal.add_row(commandRow('Install or update', terminalCommand(this.path, 'install', home), this._window));
        terminal.add_row(commandRow('Remove', terminalCommand(this.path, 'remove', home), this._window));
        group.add(terminal);
        return group;
    }
}
