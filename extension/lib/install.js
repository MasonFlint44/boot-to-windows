// SPDX-License-Identifier: GPL-2.0-or-later
//
// Installing the one-click helper: which files go where, the shell commands
// that put them there, and checking an existing install. The settings page
// runs the commands through pkexec, the terminal installer through sudo.
// No GI imports.

import {
    HELPER_ANCESTORS, HELPER_DIR, HELPER_LIBS, HELPER_PATH, POLICY_PATH,
    RULES_PATH,
} from './constants.js';
import {MISSING, isTrustedInfo} from './trust.js';

const POLICY_FILE = POLICY_PATH.split('/').pop();
const RULES_FILE = 'com.masonflint.BootToWindows.rules';

// Every path the helper depends on.
//   source      bundled copy, relative to the extension dir (null for dirs)
//   ancestor    system dirs above the install, there with or without us
//   bestEffort  the polkit rule. Some distros don't let users read its
//               directory, so we check it when we can. It only decides
//               whether to ask for a password, not what the helper does.
export const HELPER_MANIFEST = [
    ...HELPER_ANCESTORS.map(installed => ({installed, source: null, type: 'directory', ancestor: true})),
    {installed: HELPER_DIR, source: null, type: 'directory'},
    {installed: `${HELPER_DIR}/lib`, source: null, type: 'directory'},
    {installed: HELPER_PATH, source: 'helper/boot-to-windows-helper', type: 'regular'},
    ...HELPER_LIBS.map(f => ({installed: `${HELPER_DIR}/lib/${f}`, source: `lib/${f}`, type: 'regular'})),
    {installed: POLICY_PATH, source: `helper/${POLICY_FILE}`, type: 'regular'},
    {installed: RULES_PATH, source: `helper/${RULES_FILE}`, type: 'regular', bestEffort: true},
];

export function shellQuote(s) {
    return /^[\w@%+=:,./-]+$/.test(s) ? s : `'${s.replaceAll("'", "'\\''")}'`;
}

const OWNER = '-o root -g root';

// Shell commands to run as root. Re-running them updates the install.
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

function installerPath(extPath) {
    return `${extPath}/helper/install.js`;
}

// The sudo command shown in the settings page. Uses ~/ for `home` when
// the path doesn't need quoting.
export function terminalCommand(extPath, verb = 'install', home = null) {
    let script = shellQuote(installerPath(extPath));
    if (home && script.startsWith(`${home}/`))
        script = `~${script.slice(home.length)}`;
    return `sudo gjs -m ${script}${verb === 'remove' ? ' remove' : ''}`;
}

// For the settings buttons: all the steps in one root shell, so there's only
// one password prompt. Root only runs sh, install and rm; the extension's
// files are copied, never executed.
export function asPkexecArgv(steps) {
    return ['pkexec', '/bin/sh', '-c', steps.join(' && ')];
}

// Everything has to be root-owned, except the rule when we can't check it.
// A rule we can see is missing still counts against the install.
export function mustTrust(entry, info) {
    return !entry.bestEffort || info !== null;
}

/**
 * Is the helper safe to run through pkexec?
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
