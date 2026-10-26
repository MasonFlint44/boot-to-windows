#!/usr/bin/gjs -m
// SPDX-License-Identifier: GPL-2.0-or-later
//
// Installs or removes the one-click helper:
//
//   sudo gjs -m <extension dir>/helper/install.js          install or update
//   sudo gjs -m <extension dir>/helper/install.js remove   remove
//
// Runs the same steps as the settings page buttons (lib/install.js).

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import System from 'system';

import {IMAGE_BASED_MARKER} from '../lib/constants.js';
import {installSteps, uninstallSteps} from '../lib/install.js';

function die(message, code = 1) {
    printerr(`install.js: ${message}`);
    System.exit(code);
}

const extPath = GLib.path_get_dirname(GLib.path_get_dirname(
    GLib.filename_from_uri(import.meta.url)[0]));

const verb = ARGV[0] ?? 'install';
if (ARGV.length > 1 || !['install', 'remove'].includes(verb))
    die('usage: sudo gjs -m install.js [install|remove]', 2);
if (verb === 'install' && GLib.file_test(IMAGE_BASED_MARKER, GLib.FileTest.EXISTS))
    die("one-click mode isn't available on image-based systems (/usr is read-only)");
if (new Gio.Credentials().get_unix_user() !== 0)
    die('run this with sudo');

for (const step of verb === 'remove' ? uninstallSteps() : installSteps(extPath)) {
    print(step);
    const proc = Gio.Subprocess.new(['/bin/sh', '-c', step], Gio.SubprocessFlags.STDERR_PIPE);
    const [, , stderr] = proc.communicate_utf8(null, null);
    // Pass the step's own error through; the settings page shows its last line.
    if (stderr?.trim())
        printerr(stderr.trimEnd());
    if (proc.get_exit_status() !== 0) {
        if (stderr?.trim())
            System.exit(1);
        die(`failed with status ${proc.get_exit_status()}: ${step}`);
    }
}
print(verb === 'remove' ? 'One-click mode removed.' : 'One-click mode installed.');
