// SPDX-License-Identifier: GPL-2.0-or-later
//
// Installing the optional one-click helper: which files go where, the
// commands that do it, and how an existing install is judged. The settings
// page runs the steps in a root shell (asPkexecArgv); the terminal command
// runs them through helper/install.js. Pure: no GI imports.

import {
    HELPER_ANCESTORS, HELPER_DIR, HELPER_LIBS, HELPER_PATH, POLICY_PATH,
    RULES_PATH,
} from './constants.js';
import {MISSING, isTrustedInfo} from './trust.js';

const POLICY_FILE = POLICY_PATH.split('/').pop();
const RULES_FILE = 'com.masonflint.BootToWindows.rules';

/**
 * Every path the helper relies on. `source` is the bundled copy, relative to
 * the extension directory (null for directories). `ancestor` marks system
 * directories above the install, which exist with or without the helper.
 *
 * `bestEffort` marks the polkit rule: some distros make its directory
 * unreadable to users, so it can't always be checked. That's acceptable
 * because the rule only decides whether admins are asked for a password; it
 * can't change what the helper does. It's checked whenever it's visible.
 */
export const HELPER_MANIFEST = [
    ...HELPER_ANCESTORS.map(installed => ({installed, source: null, type: 'directory', ancestor: true})),
    {installed: HELPER_DIR, source: null, type: 'directory'},
    {installed: `${HELPER_DIR}/lib`, source: null, type: 'directory'},
    {installed: HELPER_PATH, source: 'helper/boot-to-windows-helper', type: 'regular'},
    ...HELPER_LIBS.map(f => ({installed: `${HELPER_DIR}/lib/${f}`, source: `lib/${f}`, type: 'regular'})),
    {installed: POLICY_PATH, source: `helper/${POLICY_FILE}`, type: 'regular'},
    {installed: RULES_PATH, source: `helper/${RULES_FILE}`, type: 'regular', bestEffort: true},
];

/** Quote for a POSIX shell. */
export function shellQuote(s) {
    return /^[\w@%+=:,./-]+$/.test(s) ? s : `'${s.replaceAll("'", "'\\''")}'`;
}

const OWNER = '-o root -g root';

/** The install, as shell commands to run as root. Safe to re-run (updates). */
export function installSteps(extPath) {
    const q = p => shellQuote(`${extPath}/${p}`);
    return [
        `install -d ${OWNER} -m 0755 ${HELPER_DIR} ${HELPER_DIR}/lib`,
        `install ${OWNER} -m 0644 ${HELPER_LIBS.map(f => q(`lib/${f}`)).join(' ')} ${HELPER_DIR}/lib/`,
        `install ${OWNER} -m 0755 ${q('helper/boot-to-windows-helper')} ${HELPER_PATH}`,
        `install ${OWNER} -m 0644 ${q(`helper/${POLICY_FILE}`)} ${POLICY_PATH}`,
        `install ${OWNER} -m 0644 ${q(`helper/${RULES_FILE}`)} ${RULES_PATH}`,
    ];
}

export function uninstallSteps() {
    return [`rm -rf ${HELPER_DIR}`, `rm -f ${POLICY_PATH} ${RULES_PATH}`];
}

/** Path of the bundled installer, which runs installSteps / uninstallSteps. */
function installerPath(extPath) {
    return `${extPath}/helper/install.js`;
}

/**
 * For a terminal: one short command that runs the bundled installer. `home`
 * shortens the path to ~/... when that needs no quoting.
 */
export function terminalCommand(extPath, verb = 'install', home = null) {
    let script = shellQuote(installerPath(extPath));
    if (home && script.startsWith(`${home}/`))
        script = `~${script.slice(home.length)}`;
    return `sudo gjs -m ${script}${verb === 'remove' ? ' remove' : ''}`;
}

/**
 * For the settings page's buttons: the steps in one root shell, so one
 * password prompt. Root only runs root-owned programs (sh, install, rm); the
 * extension's own files are just copied, and become root-owned as they are.
 */
export function asPkexecArgv(steps) {
    return ['pkexec', '/bin/sh', '-c', steps.join(' && ')];
}

/**
 * Must this manifest entry be root-owned before the helper is used? Ancestors
 * and the helper's own files always. The best-effort rule too, unless it
 * can't be checked (null): a rule that is visibly missing still counts.
 */
export function mustTrust(entry, info) {
    return !entry.bestEffort || info !== null;
}

/**
 * Is the helper safe to hand to pkexec?
 *
 * @param {(object|null)[]} infos  trust info for each HELPER_MANIFEST entry
 */
export function helperUsable(infos) {
    return HELPER_MANIFEST.every((f, i) => !mustTrust(f, infos[i]) || isTrustedInfo(infos[i], f.type));
}

/**
 * @param {{info: object|null, type: string, same: boolean, ancestor?: boolean, bestEffort?: boolean}[]} files
 *   each HELPER_MANIFEST entry with its trust info (see trust.js) and whether
 *   its contents match the bundled copy
 * @returns {'missing'|'partial'|'untrusted'|'unsafe-parent'|'outdated'|'installed'}
 */
export function helperStatus(files) {
    const own = files.filter(f => !f.ancestor && !f.bestEffort);
    const checked = files.filter(f => !f.ancestor && mustTrust(f, f.info));
    if (own.every(f => f.info === MISSING))
        return 'missing';
    if (checked.some(f => f.info === MISSING))
        return 'partial';
    if (!checked.every(f => isTrustedInfo(f.info, f.type)))
        return 'untrusted';
    if (!files.filter(f => f.ancestor).every(f => isTrustedInfo(f.info, f.type)))
        return 'unsafe-parent';
    if (!checked.every(f => f.same))
        return 'outdated';
    return 'installed';
}
