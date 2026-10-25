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
 * @param {{info: object|null, type: string, same: boolean, ancestor?: boolean}[]} files
 *   each helper file: its trust info (null = missing), expected type, and
 *   whether its contents match the copy bundled with the extension.
 *   `ancestor` marks system directories above the install (/usr/local, ...),
 *   which exist whether or not the helper does.
 * @param {(info: object|null, type: string) => boolean} isTrusted
 * @returns {'missing'|'untrusted'|'unsafe-parent'|'outdated'|'installed'}
 */
export function helperStatus(files, isTrusted) {
    const own = files.filter(f => !f.ancestor);
    if (own.every(f => f.info === null))
        return 'missing';
    if (!own.every(f => isTrusted(f.info, f.type)))
        return 'untrusted';
    if (!files.filter(f => f.ancestor).every(f => isTrusted(f.info, f.type)))
        return 'unsafe-parent';
    if (!own.every(f => f.same))
        return 'outdated';
    return 'installed';
}
