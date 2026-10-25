// SPDX-License-Identifier: GPL-2.0-or-later
//
// Preferences: what the firmware looks like, and the optional one-click
// helper. Installing the helper is left to the user (copy a command into a
// terminal); the extension never runs anything as root on its own.

import Adw from 'gi://Adw';
import Gdk from 'gi://Gdk';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Gtk from 'gi://Gtk';

import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import {
    EFIBOOTMGR_CANDIDATES, HELPER_DIR, HELPER_LIBS, HELPER_PATH, POLICY_PATH,
} from './lib/constants.js';
import {formatEntry} from './lib/efivars.js';
import {readSnapshotSync} from './lib/firmware.js';
import {helperStatus, installCommand, uninstallCommand} from './lib/install.js';
import {deriveState} from './lib/state.js';
import {TRUST_ATTRIBUTES, infoFromGio, isTrustedInfo} from './lib/trust.js';

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

/** Installed and bundled helper files, for comparing. */
function helperFiles(extPath) {
    const pairs = [
        [HELPER_DIR, null, 'directory'],
        [`${HELPER_DIR}/lib`, null, 'directory'],
        [HELPER_PATH, `${extPath}/helper/boot-to-windows-helper`, 'regular'],
        [POLICY_PATH, `${extPath}/helper/${POLICY_PATH.split('/').pop()}`, 'regular'],
        ...HELPER_LIBS.map(f => [`${HELPER_DIR}/lib/${f}`, `${extPath}/lib/${f}`, 'regular']),
    ];
    return pairs.map(([installed, bundled, type]) => ({
        installed, type,
        info: info(installed),
        same: bundled === null ||
            String(contents(installed)) === String(contents(bundled)),
    }));
}

/** A row whose text is shown literally (firmware strings are arbitrary). */
function plainRow(title, subtitle) {
    return new Adw.ActionRow({title, subtitle, use_markup: false});
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
    // use_markup off: commands contain '&&', which older libadwaita (GNOME
    // 45-47) parses as broken markup and renders as an empty row.
    const row = new Adw.ActionRow({title, subtitle: command, subtitle_selectable: true, use_markup: false});
    row.add_css_class('property');
    row.add_suffix(copyButton(command, toastTarget));
    return row;
}

export default class BootToWindowsPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const page = new Adw.PreferencesPage();
        window.add(page);

        // Firmware.
        const state = deriveState(readSnapshotSync());
        const firmware = new Adw.PreferencesGroup({title: 'Firmware'});
        const entry = e => (e ? `${e.description} (Boot${formatEntry(e.num)})` : 'None');
        const statusText = {
            'unsupported': 'This computer did not start in UEFI mode',
            'no-windows': 'No Windows Boot Manager entry found',
            'windows-is-default': 'Windows already starts by default',
            'ready': 'Next restart starts as usual',
            'armed': 'Next restart starts Windows',
            'other': `Next restart starts ${entry(state.bootNext)}`,
        }[state.status];
        firmware.add(plainRow('Status', statusText));
        if (state.status !== 'unsupported') {
            firmware.add(plainRow('Windows entry', entry(state.windows)));
            firmware.add(plainRow('Default entry', entry(state.defaultEntry)));
        }
        const efibootmgr = EFIBOOTMGR_CANDIDATES.find(p => isTrustedInfo(info(p)));
        firmware.add(plainRow('efibootmgr',
            efibootmgr ?? 'Not installed. Install the "efibootmgr" package.'));
        page.add(firmware);

        // One-click helper.
        const status = helperStatus(helperFiles(this.path), isTrustedInfo);
        const helper = new Adw.PreferencesGroup({
            title: 'One-click mode',
            description: 'Without the helper, each change asks for an administrator ' +
                'password. The helper lets whoever is logged in at this computer ' +
                'switch without one. It can only point the next boot at Windows ' +
                'or back at the default, and it is installed root-owned so no ' +
                'program can change it.',
        });
        helper.add(plainRow('Helper', {
                'installed': 'Installed',
                'outdated': 'Installed, but older than this extension. Run the install command again.',
                'untrusted': 'Found, but not root-owned. It will not be used. Reinstall it.',
                'missing': 'Not installed',
            }[status]));
        if (status !== 'installed')
            helper.add(commandRow('Install or update', installCommand(this.path), window));
        if (status !== 'missing')
            helper.add(commandRow('Uninstall', uninstallCommand(), window));
        page.add(helper);
    }
}
