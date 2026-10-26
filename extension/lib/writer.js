// SPDX-License-Identifier: GPL-2.0-or-later
//
// Changes BootNext. Two routes, both through pkexec:
//
//   - the optional one-click helper, if it is installed root-owned (its polkit
//     action lets the active local session run it without a password);
//   - otherwise efibootmgr directly, which polkit's stock policy guards with
//     an admin password prompt.
//
// Success is never inferred from an exit code: the firmware is re-read after
// every write and the result is what it reports.

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

/** pkexec exit codes (pkexec(1)). */
const PKEXEC_DISMISSED = 126;
const PKEXEC_NOT_AUTHORIZED = 127;

/** The user closed the password dialog. Not an error worth reporting. */
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

/** Is the one-click helper installed and safe to hand to pkexec? */
export async function helperInstalled(cancellable = null) {
    // Every file it runs or loads, its policy and rule, and the directories
    // above it must be root-owned and writable by no one else.
    return helperUsable(await Promise.all(
        HELPER_MANIFEST.map(f => fileInfo(f.installed, cancellable))));
}

/** First root-owned efibootmgr, or null. */
export async function findEfibootmgr(cancellable = null) {
    for (const path of EFIBOOTMGR_CANDIDATES) {
        // eslint-disable-next-line no-await-in-loop
        if (isTrustedInfo(await fileInfo(path, cancellable)))
            return path;
    }
    return null;
}

/**
 * The privileged command for a write. Pure, so the choice is unit-testable.
 *
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

/** Map a finished pkexec run to an outcome. Pure. */
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

/**
 * Run a pkexec command. Resolves when it succeeded; rejects with
 * DismissedError or WriteError otherwise. Cancelling kills pkexec while it
 * is still waiting for a password.
 */
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
 * Point the next boot at Windows ('windows') or the normal default
 * ('default'). Resolves to the state the firmware actually reports, and the
 * route taken: 'none' (already there), 'helper' (one-click) or 'password'.
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
            ? 'The firmware did not accept Windows as the next boot'
            : 'The firmware did not accept the default as the next boot');
    }
    return {state: after, route: helper ? 'helper' : 'password'};
}
