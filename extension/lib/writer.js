// SPDX-License-Identifier: GPL-2.0-or-later
//
// Changes BootNext through pkexec, either with the one-click helper (if it's
// installed and root-owned, polkit can let it run without a password) or by
// running efibootmgr directly, which asks for an admin password.
//
// We don't go by exit codes. After every write we re-read the firmware and
// report what it says.

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import {EFIBOOTMGR_CANDIDATES, HELPER_PATH} from './constants.js';
import {formatEntry} from './efivars.js';
import {HELPER_MANIFEST, helperUsable} from './install.js';
import {readSnapshot} from './firmware.js';
import {deriveState, reached, targetEntry} from './state.js';
import {TRUST_ATTRIBUTES, infoFromError, infoFromGio, isTrustedInfo} from './trust.js';

Gio._promisify(Gio.Subprocess.prototype, 'communicate_utf8_async');
Gio._promisify(Gio.File.prototype, 'query_info_async');

// See pkexec(1).
const PKEXEC_DISMISSED = 126;
const PKEXEC_NOT_AUTHORIZED = 127;

// The user closed the password dialog. Not worth showing an error for.
export class DismissedError extends Error {
    constructor() {
        super('Authentication dismissed');
        this.name = 'DismissedError';
    }
}

export class WriteError extends Error {
    constructor(message) {
        super(message);
        this.name = 'WriteError';
    }
}

async function fileInfo(path, cancellable) {
    try {
        const info = await Gio.File.new_for_path(path).query_info_async(
            TRUST_ATTRIBUTES, Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS,
            GLib.PRIORITY_DEFAULT, cancellable);
        return infoFromGio(Gio, info);
    } catch (e) {
        return infoFromError(Gio, e);
    }
}

// Is the one-click helper installed and safe to run as root?
export async function helperInstalled(cancellable = null) {
    return helperUsable(await Promise.all(
        HELPER_MANIFEST.map(f => fileInfo(f.installed, cancellable))));
}

export async function findEfibootmgr(cancellable = null) {
    for (const path of EFIBOOTMGR_CANDIDATES) {
        // eslint-disable-next-line no-await-in-loop
        if (isTrustedInfo(await fileInfo(path, cancellable)))
            return path;
    }
    return null;
}

/**
 * @param {object} p
 * @param {'windows'|'default'} p.target
 * @param {import('./state.js').BootState} p.state
 * @param {boolean} p.helper      one-click helper is installed
 * @param {string|null} p.efibootmgr
 * @returns {string[]}
 */
export function planCommand({target, state, helper, efibootmgr}) {
    if (helper)
        return ['pkexec', HELPER_PATH, target];
    if (!efibootmgr)
        throw new WriteError('efibootmgr is not installed');
    return ['pkexec', efibootmgr, '--bootnext', formatEntry(targetEntry(state, target))];
}

export function interpretExit(status, stderr) {
    if (status === 0)
        return null;
    if (status === PKEXEC_DISMISSED)
        return new DismissedError();
    if (status === PKEXEC_NOT_AUTHORIZED)
        return new WriteError('Not authorized to change the next boot');
    const detail = (stderr || '').trim().split('\n').pop();
    return new WriteError(detail || `command failed with status ${status}`);
}

// Rejects with DismissedError or WriteError on failure. Cancelling kills
// pkexec, which also closes its password dialog.
export async function runPrivileged(argv, cancellable = null) {
    const proc = Gio.Subprocess.new(argv,
        Gio.SubprocessFlags.STDOUT_SILENCE | Gio.SubprocessFlags.STDERR_PIPE);
    const onCancel = cancellable?.connect(() => proc.force_exit());
    try {
        const [, stderr] = await proc.communicate_utf8_async(null, null);
        const err = interpretExit(proc.get_exit_status(), stderr);
        if (err)
            throw err;
    } finally {
        if (onCancel)
            cancellable.disconnect(onCancel);
    }
}

/**
 * Point the next boot at Windows or at the usual default. Resolves to the
 * state read back from the firmware and the route used: 'none' (nothing to
 * do), 'helper' or 'password'.
 *
 * @param {'windows'|'default'} target
 * @param {Gio.Cancellable|null} cancellable
 */
export async function setNextBoot(target, cancellable = null) {
    const before = deriveState(await readSnapshot(cancellable));
    if (reached(before, target))
        return {state: before, route: 'none'};

    const [helper, efibootmgr] = await Promise.all([
        helperInstalled(cancellable), findEfibootmgr(cancellable),
    ]);
    await runPrivileged(planCommand({target, state: before, helper, efibootmgr}), cancellable);

    const after = deriveState(await readSnapshot(cancellable));
    if (!reached(after, target)) {
        throw new WriteError(target === 'windows'
            ? "Couldn't set Windows as the next boot"
            : "Couldn't reset the next boot");
    }
    return {state: after, route: helper ? 'helper' : 'password'};
}
