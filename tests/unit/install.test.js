// SPDX-License-Identifier: GPL-2.0-or-later

import {assert, test} from './harness.js';
import {HELPER_LIBS} from '../../extension/lib/constants.js';
import {helperStatus, installCommand, shellQuote, uninstallCommand} from '../../extension/lib/install.js';
import {isTrustedInfo} from '../../extension/lib/trust.js';

const root = {uid: 0, mode: 0o100644, type: 'regular'};
const rootDir = {uid: 0, mode: 0o40755, type: 'directory'};
const file = (info, same = true, type = 'regular') => ({info, same, type});

test('install: shellQuote', () => {
    assert.equal(shellQuote('/home/a/.local/share/x@y.com'), '/home/a/.local/share/x@y.com');
    assert.equal(shellQuote('/home/a b'), "'/home/a b'");
    assert.equal(shellQuote("/it's"), "'/it'\\''s'");
    assert.equal(shellQuote('$(rm -rf ~)'), "'$(rm -rf ~)'");
});

test('install: command copies every helper module, root-owned', () => {
    const cmd = installCommand('/home/u/.local/share/gnome-shell/extensions/boot-to-windows@masonflint.com');
    for (const lib of HELPER_LIBS)
        assert.ok(cmd.includes(`/lib/${lib}`), lib);
    assert.ok(cmd.includes('-m 0755 /home/u/.local/share/gnome-shell/extensions/boot-to-windows@masonflint.com/helper/boot-to-windows-helper /usr/local/libexec/boot-to-windows/boot-to-windows-helper'));
    assert.ok(cmd.includes('/usr/share/polkit-1/actions/com.masonflint.BootToWindows.set-next-boot.policy'));
    assert.equal(cmd.split(' && ').filter(c => !c.includes('-o root -g root')).length, 0);
});

test('install: odd extension paths stay quoted', () => {
    const cmd = installCommand("/home/o'neil/ext");
    assert.ok(cmd.includes("'/home/o'\\''neil/ext/helper/boot-to-windows-helper'"));
});

test('install: uninstall removes helper dir and policy', () => {
    assert.equal(uninstallCommand(),
        'sudo rm -rf /usr/local/libexec/boot-to-windows && sudo rm -f /usr/share/polkit-1/actions/com.masonflint.BootToWindows.set-next-boot.policy');
});

test('install: helperStatus', () => {
    assert.equal(helperStatus([file(null), file(null)], isTrustedInfo), 'missing');
    assert.equal(helperStatus([file(rootDir, true, 'directory'), file(root)], isTrustedInfo), 'installed');
    assert.equal(helperStatus([file(rootDir, true, 'directory'), file(root, false)], isTrustedInfo), 'outdated');
    assert.equal(helperStatus([file(root), file(null)], isTrustedInfo), 'untrusted', 'partial install');
    assert.equal(helperStatus([file(root), file({...root, uid: 1000})], isTrustedInfo), 'untrusted');
});
