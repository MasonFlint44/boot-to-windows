// SPDX-License-Identifier: GPL-2.0-or-later

import GLib from 'gi://GLib';

import {assert, test} from './harness.js';
import {HELPER_LIBS, POLKIT_ACTION_ID, RULES_PATH} from '../../extension/lib/constants.js';
import {
    HELPER_MANIFEST, asPkexecArgv, helperStatus, installSteps, mustTrust,
    shellQuote, terminalCommand, uninstallSteps,
} from '../../extension/lib/install.js';
import {isTrustedInfo} from '../../extension/lib/trust.js';

const EXT = '/home/u/.local/share/gnome-shell/extensions/boot-to-windows@masonflint.com';
const root = {uid: 0, mode: 0o100644, type: 'regular'};
const rootDir = {uid: 0, mode: 0o40755, type: 'directory'};
const file = (info, same = true, type = 'regular') => ({info, same, type});
const repo = GLib.path_get_dirname(GLib.path_get_dirname(GLib.path_get_dirname(
    GLib.filename_from_uri(import.meta.url)[0])));

test('install: shellQuote', () => {
    assert.equal(shellQuote('/home/a/.local/share/x@y.com'), '/home/a/.local/share/x@y.com');
    assert.equal(shellQuote('/home/a b'), "'/home/a b'");
    assert.equal(shellQuote("/it's"), "'/it'\\''s'");
    assert.equal(shellQuote('$(rm -rf ~)'), "'$(rm -rf ~)'");
});

test('install: steps copy every manifest file, root-owned', () => {
    const steps = installSteps(EXT);
    const all = steps.join('\n');
    for (const f of HELPER_MANIFEST.filter(m => m.source))
        assert.ok(all.includes(`${EXT}/${f.source}`), f.source);
    for (const lib of HELPER_LIBS)
        assert.ok(all.includes(`/lib/${lib}`), lib);
    assert.ok(all.includes(`-m 0755 ${EXT}/helper/boot-to-windows-helper /usr/local/libexec/boot-to-windows/boot-to-windows-helper`));
    assert.ok(all.includes(RULES_PATH));
    assert.equal(steps.filter(s => !s.includes('-o root -g root')).length, 0, 'every step sets owner');
});

test('install: every bundled source file exists in the extension', () => {
    for (const f of HELPER_MANIFEST.filter(m => m.source))
        assert.ok(GLib.file_test(`${repo}/extension/${f.source}`, GLib.FileTest.EXISTS), f.source);
});

test('install: the button runs the steps through one root shell', () => {
    const argv = asPkexecArgv(installSteps(EXT));
    assert.equal(argv.slice(0, 3), ['pkexec', '/bin/sh', '-c'], 'root-owned shell, one prompt');
    assert.equal(argv.length, 4);
    assert.equal(argv[3], installSteps(EXT).join(' && '));
});

test('install: odd extension paths stay quoted in the steps', () => {
    const steps = installSteps("/home/o'neil/ext").join(' ');
    assert.ok(steps.includes("'/home/o'\\''neil/ext/helper/boot-to-windows-helper'"));
});

test('install: terminal command is short and runs the bundled installer', () => {
    assert.equal(terminalCommand(EXT, 'install', '/home/u'),
        'sudo gjs -m ~/.local/share/gnome-shell/extensions/boot-to-windows@masonflint.com/helper/install.js');
    assert.equal(terminalCommand(EXT, 'remove', '/home/u'),
        'sudo gjs -m ~/.local/share/gnome-shell/extensions/boot-to-windows@masonflint.com/helper/install.js remove');
    assert.equal(terminalCommand(EXT), `sudo gjs -m ${EXT}/helper/install.js`, 'no home given');
    assert.equal(terminalCommand('/opt/x y/ext', 'install', '/home/u'), "sudo gjs -m '/opt/x y/ext/helper/install.js'");
    assert.equal(terminalCommand('/home/u/my ext', 'install', '/home/u'), "sudo gjs -m '/home/u/my ext/helper/install.js'",
        'no ~ inside quotes');
    assert.ok(terminalCommand(EXT, 'install', '/home/u').length < 110);
});

test('install: uninstall removes helper dir, policy and rule', () => {
    assert.equal(uninstallSteps(), [
        'rm -rf /usr/local/libexec/boot-to-windows',
        `rm -f /usr/share/polkit-1/actions/com.masonflint.BootToWindows.set-next-boot.policy ${RULES_PATH}`,
    ]);
});

test('install: helperStatus', () => {
    assert.equal(helperStatus([file(null), file(null)], isTrustedInfo), 'missing');
    assert.equal(helperStatus([file(rootDir, true, 'directory'), file(root)], isTrustedInfo), 'installed');
    assert.equal(helperStatus([file(rootDir, true, 'directory'), file(root, false)], isTrustedInfo), 'outdated');
    assert.equal(helperStatus([file(root), file(null)], isTrustedInfo), 'untrusted', 'partial install');
    assert.equal(helperStatus([file(root), file({...root, uid: 1000})], isTrustedInfo), 'untrusted');

    const parent = (mode = 0o40755) => ({info: {uid: 0, mode, type: 'directory'}, same: true, type: 'directory', ancestor: true});
    assert.equal(helperStatus([parent(), file(null)], isTrustedInfo), 'missing', 'parents exist without a helper');
    assert.equal(helperStatus([parent(), file(root)], isTrustedInfo), 'installed');
    assert.equal(helperStatus([parent(0o42775), file(root)], isTrustedInfo), 'unsafe-parent', 'staff-writable /usr/local');

    // The polkit rule may sit in a directory users can't read (Fedora 39/40).
    const rule = (info, same = true) => ({info, same, type: 'regular', bestEffort: true});
    assert.equal(helperStatus([file(root), rule(null, false)], isTrustedInfo), 'installed', 'unreadable rule ignored');
    assert.equal(helperStatus([file(root), rule(root, false)], isTrustedInfo), 'outdated', 'visible stale rule');
    assert.equal(helperStatus([file(root), rule({...root, uid: 1000})], isTrustedInfo), 'untrusted', 'visible user-owned rule');
    assert.equal(helperStatus([file(null), rule(root)], isTrustedInfo), 'missing', 'a stray rule alone is not an install');
});

// The polkit rule is JavaScript that polkitd runs. Run it here against a fake
// polkit object to check its decisions.
function loadRule() {
    const [, bytes] = GLib.file_get_contents(`${repo}/extension/helper/com.masonflint.BootToWindows.rules`);
    const rules = [];
    const polkit = {
        Result: {YES: 'yes', NO: 'no', NOT_HANDLED: null},
        addRule: fn => rules.push(fn),
    };
    new Function('polkit', new TextDecoder().decode(bytes))(polkit);
    assert.equal(rules.length, 1, 'one rule');
    return rules[0];
}

const subject = ({local = true, active = true, groups = []} = {}) =>
    ({local, active, isInGroup: g => groups.includes(g)});
const ours = {id: POLKIT_ACTION_ID};

test('rule: admins at the machine skip the password', () => {
    const rule = loadRule();
    for (const g of ['sudo', 'admin', 'wheel'])
        assert.equal(rule(ours, subject({groups: ['users', g]})), 'yes', g);
});

test('rule: everyone else falls through to auth_admin', () => {
    const rule = loadRule();
    assert.equal(rule(ours, subject({groups: ['users']})), null, 'non-admin');
    assert.equal(rule(ours, subject({groups: ['sudo'], local: false})), null, 'remote admin');
    assert.equal(rule(ours, subject({groups: ['sudo'], active: false})), null, 'inactive admin');
    assert.equal(rule({id: 'org.freedesktop.policykit.exec'}, subject({groups: ['sudo']})), null,
        'never touches other actions');
});

test('install: only the polkit rule is best-effort', () => {
    const best = HELPER_MANIFEST.filter(f => f.bestEffort).map(f => f.installed);
    assert.equal(best, [RULES_PATH]);
    for (const f of HELPER_MANIFEST.filter(m => !m.bestEffort))
        assert.ok(mustTrust(f, null), `${f.installed} must always be verified`);
    assert.ok(!mustTrust({bestEffort: true}, null));
    assert.ok(mustTrust({bestEffort: true}, root));
});
