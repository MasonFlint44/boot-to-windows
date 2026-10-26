// SPDX-License-Identifier: GPL-2.0-or-later
//
// Preferences: what the firmware looks like, and the optional one-click
// helper. Setting the helper up is always the user's explicit choice: a
// button that runs one approved pkexec command, or the same steps typed into
// a terminal.

import Adw from 'gi://Adw';
import Gdk from 'gi://Gdk';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Gtk from 'gi://Gtk';

import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import {EFIBOOTMGR_CANDIDATES, HELPER_DIR} from './lib/constants.js';
import {formatEntry} from './lib/efivars.js';
import {readSnapshotSync} from './lib/firmware.js';
import {
    HELPER_MANIFEST, asPkexecArgv, helperStatus, installCommand, installSteps,
    uninstallCommand, uninstallSteps,
} from './lib/install.js';
import {deriveState} from './lib/state.js';
import {TRUST_ATTRIBUTES, infoFromGio, isTrustedInfo} from './lib/trust.js';
import {DismissedError, interpretExit} from './lib/writer.js';

Gio._promisify(Gio.Subprocess.prototype, 'communicate_utf8_async');

function info(path) {
    try {
        return infoFromGio(Gio, Gio.File.new_for_path(path).query_info(
            TRUST_ATTRIBUTES, Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS, null));
    } catch {
        return null;
    }
}

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
        info: info(f.installed),
        same: f.source === null ||
            sameBytes(contents(f.installed), contents(`${extPath}/${f.source}`)),
    }));
}

const STATUS_TEXT = {
    'installed': 'On. Administrators at this computer switch without a password.',
    'outdated': 'On, but older than this extension. Update it.',
    'untrusted': 'Found, but not safely installed (not root-owned), so it is not used. Reinstall it.',
    'unsafe-parent': `Installed, but not used: a folder above ${HELPER_DIR} is writable by non-root users.`,
    'missing': 'Off. Each change asks for an administrator password.',
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

function copyButton(text, toastTarget) {
    const button = new Gtk.Button({
        icon_name: 'edit-copy-symbolic',
        valign: Gtk.Align.CENTER,
        tooltip_text: 'Copy command',
        css_classes: ['flat'],
    });
    button.connect('clicked', () => {
        Gdk.Display.get_default().get_clipboard().set(text);
        toastTarget.add_toast(new Adw.Toast({title: 'Copied. Paste it into a terminal.'}));
    });
    return button;
}

function commandRow(title, command, toastTarget) {
    const row = plainRow(title, command);
    row.subtitle_selectable = true;
    row.add_css_class('property');
    row.add_suffix(copyButton(command, toastTarget));
    return row;
}

/** Run a root job through one pkexec prompt. Resolves null or an Error. */
async function runAsRoot(steps) {
    const proc = Gio.Subprocess.new(asPkexecArgv(steps),
        Gio.SubprocessFlags.STDOUT_SILENCE | Gio.SubprocessFlags.STDERR_PIPE);
    const [, stderr] = await proc.communicate_utf8_async(null, null);
    return interpretExit(proc.get_exit_status(), stderr);
}

export default class BootToWindowsPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const page = new Adw.PreferencesPage();
        window.add(page);
        page.add(this._firmwareGroup());
        this._page = page;
        this._window = window;
        this._helperGroupWidget = null;
        this._renderHelperGroup();
    }

    _firmwareGroup() {
        const state = deriveState(readSnapshotSync());
        const group = new Adw.PreferencesGroup({title: 'Firmware'});
        const entry = e => (e ? `${e.description} (Boot${formatEntry(e.num)})` : 'None');
        const statusText = {
            'unsupported': 'This computer did not start in UEFI mode',
            'no-windows': 'No Windows Boot Manager entry found',
            'windows-is-default': 'Windows already starts by default',
            'ready': 'Next restart starts as usual',
            'armed': 'Next restart starts Windows',
            'other': `Next restart starts ${entry(state.bootNext)}`,
        }[state.status];
        group.add(plainRow('Status', statusText));
        if (state.status !== 'unsupported') {
            group.add(plainRow('Windows entry', entry(state.windows)));
            group.add(plainRow('Default entry', entry(state.defaultEntry)));
        }
        const efibootmgr = EFIBOOTMGR_CANDIDATES.find(p => isTrustedInfo(info(p)));
        group.add(plainRow('efibootmgr',
            efibootmgr ?? 'Not installed. Install the "efibootmgr" package.'));
        return group;
    }

    /** (Re)build the one-click group from what's on disk now. */
    _renderHelperGroup() {
        if (this._helperGroupWidget)
            this._page.remove(this._helperGroupWidget);

        const status = helperStatus(helperFiles(this.path), isTrustedInfo);
        const group = new Adw.PreferencesGroup({
            title: 'One-click mode',
            description: 'Lets administrators logged in at this computer switch ' +
                'without typing a password. It installs a small helper that can ' +
                'only point the next boot at Windows or back at the default. ' +
                'Setting it up asks for an administrator password once.',
        });
        group.add(plainRow('One-click status', STATUS_TEXT[status]));

        const action = (title, subtitle, label, steps, style) => {
            const row = plainRow(title, subtitle);
            const button = new Gtk.Button({label, valign: Gtk.Align.CENTER, css_classes: [style]});
            button.connect('clicked', () => this._run(button, steps));
            row.add_suffix(button);
            row.activatable_widget = button;
            group.add(row);
        };
        if (status === 'missing') {
            action('Enable one-click switching', 'Asks for an administrator password once',
                'Enable', installSteps(this.path), 'suggested-action');
        } else if (status !== 'installed') {
            action('Update the helper', 'Reinstalls it from this version of the extension',
                'Update', installSteps(this.path), 'suggested-action');
        }
        if (status !== 'missing') {
            action('Turn off one-click switching', 'Removes the helper; changes ask for a password again',
                'Remove', uninstallSteps(), 'destructive-action');
        }

        const terminal = new Adw.ExpanderRow({
            title: 'Use a terminal instead',
            subtitle: 'The same steps, to run with sudo',
        });
        terminal.add_row(commandRow('Install or update', installCommand(this.path), this._window));
        terminal.add_row(commandRow('Remove', uninstallCommand(), this._window));
        group.add(terminal);

        this._page.add(group);
        this._helperGroupWidget = group;
    }

    async _run(button, steps) {
        button.sensitive = false;
        button.label = 'Waiting…';
        const err = await runAsRoot(steps);
        if (err && !(err instanceof DismissedError))
            this._window.add_toast(new Adw.Toast({title: err.message, timeout: 0}));
        this._renderHelperGroup();
    }
}
