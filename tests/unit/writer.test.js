// SPDX-License-Identifier: GPL-2.0-or-later

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import {assert, test} from './harness.js';
import {dualBoot, firmwareFiles, UBUNTU} from './fixtures.js';
import {HELPER_PATH} from '../../extension/lib/constants.js';
import {snapshotFromFiles} from '../../extension/lib/efivars.js';
import {deriveState} from '../../extension/lib/state.js';
import {MISSING, infoFromError, isTrustedInfo, queryTrustInfo} from '../../extension/lib/trust.js';
import {
    DismissedError, WriteError, interpretExit, planCommand,
} from '../../extension/lib/writer.js';

const ready = deriveState(snapshotFromFiles(true, dualBoot()));
const armed = deriveState(snapshotFromFiles(true, dualBoot({next: 0})));

test('writer: helper route passes only the verb', () => {
    assert.equal(planCommand({target: 'windows', state: ready, helper: true, efibootmgr: '/usr/bin/efibootmgr'}),
        ['pkexec', HELPER_PATH, 'windows']);
    assert.equal(planCommand({target: 'default', state: armed, helper: true, efibootmgr: null}),
        ['pkexec', HELPER_PATH, 'default']);
});

test('writer: password route sets BootNext through efibootmgr', () => {
    assert.equal(planCommand({target: 'windows', state: ready, helper: false, efibootmgr: '/usr/sbin/efibootmgr'}),
        ['pkexec', '/usr/sbin/efibootmgr', '--bootnext', '0000']);
    assert.equal(planCommand({target: 'default', state: armed, helper: false, efibootmgr: '/usr/bin/efibootmgr'}),
        ['pkexec', '/usr/bin/efibootmgr', '--bootnext', '0002'],
        'disarm points at the default rather than deleting BootNext');
});

test('writer: password route needs efibootmgr and a target', () => {
    assert.throws(() => planCommand({target: 'windows', state: ready, helper: false, efibootmgr: null}),
        /efibootmgr is not installed/);
    const noWin = deriveState(snapshotFromFiles(true, firmwareFiles({entries: {2: UBUNTU}, order: [2]})));
    assert.throws(() => planCommand({target: 'windows', state: noWin, helper: false, efibootmgr: '/usr/bin/efibootmgr'}),
        /No Windows/);
});

test('writer: interpretExit maps pkexec outcomes', () => {
    assert.equal(interpretExit(0, ''), null);
    assert.ok(interpretExit(126, '') instanceof DismissedError);
    const denied = interpretExit(127, 'Error executing command as another user: Not authorized');
    assert.ok(denied instanceof WriteError);
    assert.ok(/Not authorized/.test(denied.message));
    const failed = interpretExit(1, 'warning: x\nboot-to-windows-helper: failed to set next boot\n');
    assert.equal(failed.message, 'boot-to-windows-helper: failed to set next boot', 'last stderr line');
    assert.equal(interpretExit(3, '').message, 'command failed with status 3');
});

test('trust: only root-owned files nobody else can write', () => {
    assert.ok(isTrustedInfo({uid: 0, mode: 0o100755, type: 'regular'}));
    assert.ok(isTrustedInfo({uid: 0, mode: 0o100644, type: 'regular'}));
    assert.ok(isTrustedInfo({uid: 0, mode: 0o40755, type: 'directory'}, 'directory'));
    assert.ok(!isTrustedInfo({uid: 1000, mode: 0o100755, type: 'regular'}), 'user-owned');
    assert.ok(!isTrustedInfo({uid: 0, mode: 0o100775, type: 'regular'}), 'group-writable');
    assert.ok(!isTrustedInfo({uid: 0, mode: 0o100757, type: 'regular'}), 'world-writable');
    assert.ok(!isTrustedInfo({uid: 0, mode: 0o120777, type: 'symlink'}), 'symlink');
    assert.ok(!isTrustedInfo({uid: 0, mode: 0o40755, type: 'directory'}), 'wrong type');
    assert.ok(!isTrustedInfo(null), 'unknown');
    assert.ok(!isTrustedInfo(MISSING), 'missing');
    assert.ok(!isTrustedInfo(MISSING, 'directory'), 'missing directory');
});

test('trust: missing files are told apart from ones that cannot be checked', () => {
    const err = code => new GLib.Error(Gio.IOErrorEnum, code, 'x');
    assert.equal(infoFromError(Gio, err(Gio.IOErrorEnum.NOT_FOUND)), MISSING);
    assert.equal(infoFromError(Gio, err(Gio.IOErrorEnum.NOT_DIRECTORY)), MISSING);
    assert.equal(infoFromError(Gio, err(Gio.IOErrorEnum.PERMISSION_DENIED)), null);
    assert.equal(infoFromError(Gio, err(Gio.IOErrorEnum.CANCELLED)), null);
    assert.equal(infoFromError(Gio, new Error('plain')), null);

    assert.equal(queryTrustInfo(Gio, '/nonexistent/boot-to-windows'), MISSING);
    assert.equal(queryTrustInfo(Gio, '/etc/hostname/not-a-dir'), MISSING);
    assert.equal(queryTrustInfo(Gio, '/').type, 'directory');

    const dir = GLib.dir_make_tmp('btw-trust-XXXXXX');
    const chmod = mode => Gio.File.new_for_path(dir).set_attribute_uint32(
        'unix::mode', mode, Gio.FileQueryInfoFlags.NONE, null);
    try {
        GLib.file_set_contents(`${dir}/f`, 'x');
        const link = Gio.File.new_for_path(`${dir}/l`);
        link.make_symbolic_link('/usr/bin/env', null);
        assert.equal(queryTrustInfo(Gio, `${dir}/l`).type, 'symlink', 'links are not followed');
        assert.equal(queryTrustInfo(Gio, `${dir}/f`).type, 'regular');
        if (new Gio.Credentials().get_unix_user() !== 0) {
            chmod(0o000);
            const hidden = queryTrustInfo(Gio, `${dir}/f`);
            chmod(0o700);
            assert.equal(hidden, null, 'in an unreadable directory: unknown, not missing');
        }
    } finally {
        chmod(0o700);
        for (const n of ['f', 'l'])
            Gio.File.new_for_path(`${dir}/${n}`).delete(null);
        Gio.File.new_for_path(dir).delete(null);
    }
});
