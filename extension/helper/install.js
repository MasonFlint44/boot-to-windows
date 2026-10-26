#!/usr/bin/gjs -m
// SPDX-License-Identifier: GPL-2.0-or-later
//
// Installs or removes the one-click helper from a terminal:
//
//   sudo gjs -m <extension dir>/helper/install.js          install or update
//   sudo gjs -m <extension dir>/helper/install.js remove   remove
//
// Runs the same steps as the settings page's buttons (lib/install.js).

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import System from 'system';

import {installSteps, uninstallSteps} from '../lib/install.js';

const extPath = GLib.path_get_dirname(GLib.path_get_dirname(
    GLib.filename_from_uri(import.meta.url)[0]));

const verb = ARGV[0] ?? 'install';
if (ARGV.length > 1 || !['install', 'remove'].includes(verb)) {
    printerr('usage: sudo gjs -m install.js [install|remove]');
    System.exit(2);
}
if (new Gio.Credentials().get_unix_user() !== 0) {
    printerr('install.js: run this with sudo');
    System.exit(1);
}

for (const step of verb === 'remove' ? uninstallSteps() : installSteps(extPath)) {
    print(step);
    const proc = Gio.Subprocess.new(['/bin/sh', '-c', step], Gio.SubprocessFlags.NONE);
    proc.wait(null);
    if (proc.get_exit_status() !== 0) {
        printerr(`install.js: failed (status ${proc.get_exit_status()})`);
        System.exit(1);
    }
}
print(verb === 'remove' ? 'One-click mode removed.' : 'One-click mode installed.');
