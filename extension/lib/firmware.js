// SPDX-License-Identifier: GPL-2.0-or-later
//
// Reads the UEFI boot variables from efivarfs. These files are world-readable,
// so checking state never needs privileges or a subprocess.

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import {EFIVARS_DIR} from './constants.js';
import {bootEntryNumber, isRelevantVar, snapshotFromFiles} from './efivars.js';

Gio._promisify(Gio.File.prototype, 'enumerate_children_async');
Gio._promisify(Gio.FileEnumerator.prototype, 'next_files_async');
Gio._promisify(Gio.File.prototype, 'load_contents_async');

function isIOError(e, code) {
    return e instanceof GLib.Error && e.matches(Gio.IOErrorEnum, code);
}

/**
 * A variable couldn't be read. One that vanished between listing and reading
 * (the firmware or another tool deleted it) is simply absent. A Boot####
 * entry that fails otherwise (buggy firmware can answer EIO) is skipped and
 * reported, so one bad entry doesn't hide everything. BootNext and BootOrder
 * can't be guessed, and cancelling must cancel: those errors propagate.
 */
function readFailed(name, e, problems) {
    if (isIOError(e, Gio.IOErrorEnum.NOT_FOUND))
        return;
    if (isIOError(e, Gio.IOErrorEnum.CANCELLED) || bootEntryNumber(name) === null)
        throw e;
    problems.push(`${name.replace(/-.*/, '')}: ${e.message}`);
}

/**
 * Snapshot of the boot variables, read without blocking the shell.
 *
 * @param {Gio.Cancellable|null} cancellable
 * @param {string} dir  efivarfs mount; tests point this at a fixture dir
 */
export async function readSnapshot(cancellable = null, dir = EFIVARS_DIR) {
    const folder = Gio.File.new_for_path(dir);
    let enumerator;
    try {
        enumerator = await folder.enumerate_children_async(
            'standard::name', Gio.FileQueryInfoFlags.NONE,
            GLib.PRIORITY_DEFAULT, cancellable);
    } catch (e) {
        if (isIOError(e, Gio.IOErrorEnum.NOT_FOUND))
            return snapshotFromFiles(false, new Map());
        throw e;
    }

    const names = [];
    try {
        for (;;) {
            // eslint-disable-next-line no-await-in-loop
            const infos = await enumerator.next_files_async(
                64, GLib.PRIORITY_DEFAULT, cancellable);
            if (infos.length === 0)
                break;
            for (const info of infos) {
                if (isRelevantVar(info.get_name()))
                    names.push(info.get_name());
            }
        }
    } finally {
        enumerator.close(null);
    }

    const files = new Map();
    const problems = [];
    await Promise.all(names.map(async name => {
        try {
            const [bytes] = await folder.get_child(name)
                .load_contents_async(cancellable);
            files.set(name, bytes);
        } catch (e) {
            readFailed(name, e, problems);
        }
    }));

    return snapshotFromFiles(true, files, problems);
}
