// SPDX-License-Identifier: GPL-2.0-or-later
//
// The root helper's logic, split out from helper/boot-to-windows-helper so
// the unit tests can run it against fake firmware and a fake efibootmgr.
//
// It can only point BootNext at Windows or at the default entry. It looks up
// the entry numbers itself, so callers can't point it anywhere else.

import {HELPER_VERBS} from './constants.js';
import {formatEntry} from './efivars.js';
import {deriveState, reached, targetEntry} from './state.js';

export const EXIT_OK = 0;
export const EXIT_USAGE = 2;
export const EXIT_FAILED = 1;

/**
 * @param {object} p
 * @param {string[]} p.args             command-line arguments (no argv[0])
 * @param {() => Promise<object>} p.readSnapshot firmware reader
 * @param {(argv: string[]) => {status: number, stderr: string}} p.run
 * @param {string|null} p.efibootmgr    trusted efibootmgr path
 * @returns {Promise<{code: number, out: string, err: string}>}
 */
export async function helperMain({args, readSnapshot, run, efibootmgr}) {
    if (args.length !== 1 || !HELPER_VERBS.includes(args[0]))
        return {code: EXIT_USAGE, out: '', err: `usage: boot-to-windows-helper {${HELPER_VERBS.join('|')}}`};
    const target = args[0];

    if (!efibootmgr)
        return {code: EXIT_FAILED, out: '', err: 'efibootmgr not found'};

    let state = deriveState(await readSnapshot());
    if (!reached(state, target)) {
        let num;
        try {
            num = targetEntry(state, target);
        } catch (e) {
            return {code: EXIT_FAILED, out: '', err: e.message};
        }
        const res = run([efibootmgr, '--bootnext', formatEntry(num)]);
        state = deriveState(await readSnapshot());
        if (!reached(state, target)) {
            const detail = res.status !== 0 ? `: ${res.stderr.trim()}` : '';
            return {code: EXIT_FAILED, out: '', err: `failed to set next boot (state: ${state.status})${detail}`};
        }
    }
    return {code: EXIT_OK, out: state.status, err: ''};
}
