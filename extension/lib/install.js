// SPDX-License-Identifier: GPL-2.0-or-later
//
// Commands the preferences page offers for installing the one-click helper,
// and how it judges an existing install. Pure: no GI imports.

import {HELPER_DIR, HELPER_LIBS, HELPER_PATH, POLICY_PATH} from './constants.js';

/** Quote for a POSIX shell. */
export function shellQuote(s) {
    return /^[\w@%+=:,./-]+$/.test(s) ? s : `'${s.replaceAll("'", "'\\''")}'`;
}

const OWNER = '-o root -g root';

/** Copies the bundled helper to its root-owned home. Safe to re-run. */
export function installCommand(extPath) {
    const q = p => shellQuote(`${extPath}/${p}`);
    const policyName = POLICY_PATH.split('/').pop();
    return [
        `sudo install -d ${OWNER} -m 0755 ${HELPER_DIR} ${HELPER_DIR}/lib`,
        `sudo install ${OWNER} -m 0644 ${HELPER_LIBS.map(f => q(`lib/${f}`)).join(' ')} ${HELPER_DIR}/lib/`,
        `sudo install ${OWNER} -m 0755 ${q('helper/boot-to-windows-helper')} ${HELPER_PATH}`,
        `sudo install ${OWNER} -m 0644 ${q(`helper/${policyName}`)} ${POLICY_PATH}`,
    ].join(' && ');
}

export function uninstallCommand() {
    return `sudo rm -rf ${HELPER_DIR} && sudo rm -f ${POLICY_PATH}`;
}

/**
 * @param {{info: object|null, type: string, same: boolean}[]} files
 *   each installed helper file: its trust info (null = missing), expected
 *   type, and whether its contents match the copy bundled with the extension
 * @param {(info: object|null, type: string) => boolean} isTrusted
 * @returns {'missing'|'untrusted'|'outdated'|'installed'}
 */
export function helperStatus(files, isTrusted) {
    if (files.every(f => f.info === null))
        return 'missing';
    if (!files.every(f => isTrusted(f.info, f.type)))
        return 'untrusted';
    if (!files.every(f => f.same))
        return 'outdated';
    return 'installed';
}
