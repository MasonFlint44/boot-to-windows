// SPDX-License-Identifier: GPL-2.0-or-later
//
// Logic of the optional root helper, kept apart from its entry point so it can
// be unit-tested with fake firmware and a fake efibootmgr.
//
// The helper only ever does one of two things: point BootNext at the Windows
// Boot Manager, or at the normal default entry. It works out the entry numbers
// itself from the firmware, so a caller can't steer it at anything else.

import {HELPER_VERBS} from './constants.js';
import {formatEntry} from './efivars.js';
import {deriveState, reached, targetEntry} from './state.js';

export const EXIT_OK = 0;
export const EXIT_USAGE = 2;
export const EXIT_FAILED = 1;

/**
 * @param {object} p
 * @param {string[]} p.args             command-line arguments (no argv[0])
 * @param {() => object} p.readSnapshot firmware reader
 * @param {(argv: string[]) => {status: number, stderr: string}} p.run
 * @param {string|null} p.efibootmgr    trusted efibootmgr path
 * @returns {{code: number, out: string, err: string}}
 */
export function helperMain({args, readSnapshot, run, efibootmgr}) {
    if (args.length !== 1 || !HELPER_VERBS.includes(args[0]))
        return {code: EXIT_USAGE, out: '', err: `usage: boot-to-windows-helper {${HELPER_VERBS.join('|')}}`};
    const target = args[0];

    if (!efibootmgr)
        return {code: EXIT_FAILED, out: '', err: 'efibootmgr not found'};

    let state = deriveState(readSnapshot());
    if (!reached(state, target)) {
        let num;
        try {
            num = targetEntry(state, target);
        } catch (e) {
            return {code: EXIT_FAILED, out: '', err: e.message};
        }
        const res = run([efibootmgr, '--bootnext', formatEntry(num)]);
        state = deriveState(readSnapshot());
        if (!reached(state, target)) {
            const detail = res.status !== 0 ? `: ${res.stderr.trim()}` : '';
            return {code: EXIT_FAILED, out: '', err: `failed to set next boot (state: ${state.status})${detail}`};
        }
    }
    return {code: EXIT_OK, out: state.status, err: ''};
}
