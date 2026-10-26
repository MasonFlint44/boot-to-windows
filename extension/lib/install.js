// SPDX-License-Identifier: GPL-2.0-or-later
//
// Installing the optional one-click helper: which files go where, the
// commands that do it (one list of steps, shown as a terminal command or run
// by the settings page's button through a single pkexec prompt), and how an
// existing install is judged. Pure: no GI imports.

import {
    HELPER_ANCESTORS, HELPER_DIR, HELPER_LIBS, HELPER_PATH, POLICY_PATH,
    RULES_PATH,
} from './constants.js';

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

/**
 * For a terminal: one short command that runs the bundled installer, which
 * performs exactly installSteps / uninstallSteps. `home` shortens the path
 * to ~/... when that needs no quoting.
 */
export function terminalCommand(extPath, verb = 'install', home = null) {
    let script = shellQuote(`${extPath}/helper/install.js`);
    if (home && script.startsWith(`${home}/`))
        script = `~${script.slice(home.length)}`;
    return `sudo gjs -m ${script}${verb === 'remove' ? ' remove' : ''}`;
}

/**
 * For the settings page's button: one pkexec prompt for the whole job.
 * /bin/sh is root-owned; the script is built only from fixed paths and the
 * extension's own directory, quoted.
 */
export function asPkexecArgv(steps) {
    return ['pkexec', '/bin/sh', '-c', steps.join(' && ')];
}


/**
 * Must this manifest entry be root-owned before the helper is used? Ancestors
 * and the helper's own files always; the best-effort rule only if visible.
 */
export function mustTrust(entry, info) {
    return !entry.bestEffort || info !== null;
}

/**
 * @param {{info: object|null, type: string, same: boolean, ancestor?: boolean, bestEffort?: boolean}[]} files
 *   each HELPER_MANIFEST entry with its trust info (null = missing or not
 *   visible) and whether its contents match the bundled copy
 * @param {(info: object|null, type: string) => boolean} isTrusted
 * @returns {'missing'|'untrusted'|'unsafe-parent'|'outdated'|'installed'}
 */
export function helperStatus(files, isTrusted) {
    const own = files.filter(f => !f.ancestor && !f.bestEffort);
    const visible = files.filter(f => !f.ancestor && mustTrust(f, f.info));
    if (own.every(f => f.info === null))
        return 'missing';
    if (!visible.every(f => isTrusted(f.info, f.type)))
        return 'untrusted';
    if (!files.filter(f => f.ancestor).every(f => isTrusted(f.info, f.type)))
        return 'unsafe-parent';
    if (!visible.every(f => f.same))
        return 'outdated';
    return 'installed';
}
