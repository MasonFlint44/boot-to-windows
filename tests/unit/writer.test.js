// SPDX-License-Identifier: GPL-2.0-or-later

import {assert, test} from './harness.js';
import {dualBoot, firmwareFiles, UBUNTU} from './fixtures.js';
import {HELPER_PATH} from '../../extension/lib/constants.js';
import {snapshotFromFiles} from '../../extension/lib/efivars.js';
import {deriveState} from '../../extension/lib/state.js';
import {isTrustedInfo} from '../../extension/lib/trust.js';
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
    assert.ok(!isTrustedInfo({uid: 0, mode: 0o120777, type: 'other'}), 'symlink');
    assert.ok(!isTrustedInfo({uid: 0, mode: 0o40755, type: 'directory'}), 'wrong type');
    assert.ok(!isTrustedInfo(null), 'missing');
});
