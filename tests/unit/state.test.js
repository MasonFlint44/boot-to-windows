// SPDX-License-Identifier: GPL-2.0-or-later

import {assert, test} from './harness.js';
import {DVD, UBUNTU, WINDOWS, dualBoot, firmwareFiles} from './fixtures.js';
import {snapshotFromFiles} from '../../extension/lib/efivars.js';
import {deriveState, reached, targetEntry} from '../../extension/lib/state.js';

const stateOf = files => deriveState(snapshotFromFiles(true, files));

test('state: no EFI → unsupported', () => {
    const s = deriveState(snapshotFromFiles(false, new Map()));
    assert.equal(s, {status: 'unsupported', windows: null, defaultEntry: null, bootNext: null});
});

test('state: BootNext unset → ready', () => {
    const s = stateOf(dualBoot());
    assert.equal(s.status, 'ready');
    assert.equal(s.windows, {num: 0, description: 'Windows Boot Manager'});
    assert.equal(s.defaultEntry, {num: 2, description: 'ubuntu'});
    assert.equal(s.bootNext, null);
});

test('state: BootNext = Windows → armed', () => {
    assert.equal(stateOf(dualBoot({next: 0})).status, 'armed');
});

test('state: BootNext = default (our disarm) → ready', () => {
    const s = stateOf(dualBoot({next: 2}));
    assert.equal(s.status, 'ready');
    assert.equal(s.bootNext, {num: 2, description: 'ubuntu'});
});

test('state: BootNext = some other entry → other', () => {
    const s = stateOf(dualBoot({next: 3}));
    assert.equal(s.status, 'other');
    assert.equal(s.bootNext, {num: 3, description: 'UEFI:CD/DVD Drive'});
});

test('state: BootNext points at a missing entry → other, empty description', () => {
    const s = stateOf(dualBoot({next: 0x42}));
    assert.equal(s.status, 'other');
    assert.equal(s.bootNext, {num: 0x42, description: ''});
});

test('state: no Windows entry → no-windows', () => {
    const s = stateOf(firmwareFiles({entries: {2: UBUNTU, 3: DVD}, order: [2, 3]}));
    assert.equal(s.status, 'no-windows');
    assert.equal(s.windows, null);
});

test('state: inactive Windows entry is not bootable → no-windows', () => {
    const s = stateOf(firmwareFiles({entries: {0: {...WINDOWS, active: false}, 2: UBUNTU}, order: [2, 0]}));
    assert.equal(s.status, 'no-windows');
});

test('state: Windows first in BootOrder → windows-is-default', () => {
    const s = stateOf(firmwareFiles({entries: {0: WINDOWS, 2: UBUNTU}, order: [0, 2]}));
    assert.equal(s.status, 'windows-is-default');
});

test('state: default skips inactive and missing BootOrder entries', () => {
    const s = stateOf(firmwareFiles({
        entries: {0: WINDOWS, 1: {...UBUNTU, active: false}, 2: UBUNTU},
        order: [9, 1, 2, 0],
    }));
    assert.equal(s.defaultEntry.num, 2);
    assert.equal(s.status, 'ready');
});

test('state: Windows entry outside BootOrder is still found', () => {
    const s = stateOf(firmwareFiles({entries: {2: UBUNTU, 5: WINDOWS}, order: [2]}));
    assert.equal(s.windows.num, 5);
    assert.equal(s.status, 'ready');
});

test('state: two Windows entries → the one the firmware tries first', () => {
    const s = stateOf(firmwareFiles({entries: {1: WINDOWS, 2: UBUNTU, 4: WINDOWS}, order: [2, 4, 1]}));
    assert.equal(s.windows.num, 4);
});

test('state: empty BootOrder → no default to disarm to', () => {
    const s = stateOf(firmwareFiles({entries: {0: WINDOWS}, order: []}));
    assert.equal(s.defaultEntry, null);
    assert.throws(() => targetEntry(s, 'default'), /No default/);
    assert.equal(targetEntry(s, 'windows'), 0);
});

test('state: targetEntry and reached', () => {
    const ready = stateOf(dualBoot());
    assert.equal(targetEntry(ready, 'windows'), 0);
    assert.equal(targetEntry(ready, 'default'), 2);
    assert.throws(() => targetEntry(ready, 'linux'), /unknown target/);
    assert.ok(reached(ready, 'default'));
    assert.ok(!reached(ready, 'windows'));

    const armed = stateOf(dualBoot({next: 0}));
    assert.ok(reached(armed, 'windows'));
    assert.ok(!reached(armed, 'default'));

    const other = stateOf(dualBoot({next: 3}));
    assert.ok(!reached(other, 'windows'));
    assert.ok(!reached(other, 'default'), 'disarming from "other" still writes');

    const none = stateOf(firmwareFiles({entries: {2: UBUNTU}, order: [2]}));
    assert.throws(() => targetEntry(none, 'windows'), /No Windows/);
    assert.ok(reached(none, 'default'));
});

test('state: "as usual" is reachable from states the toggle hides', () => {
    // Someone else pointed BootNext at the DVD; the toggle is hidden in
    // these states, but the settings page can still undo it.
    const winDefault = stateOf(firmwareFiles({entries: {0: WINDOWS, 2: UBUNTU, 3: DVD}, order: [0, 2], next: 3}));
    assert.equal(winDefault.status, 'windows-is-default');
    assert.ok(!reached(winDefault, 'default'));
    assert.equal(targetEntry(winDefault, 'default'), 0);
    assert.ok(reached(stateOf(firmwareFiles({entries: {0: WINDOWS, 2: UBUNTU}, order: [0, 2]})), 'default'));

    const noWin = stateOf(firmwareFiles({entries: {2: UBUNTU, 3: DVD}, order: [2], next: 3}));
    assert.equal(noWin.status, 'no-windows');
    assert.ok(!reached(noWin, 'default'));
    assert.equal(targetEntry(noWin, 'default'), 2);

    assert.ok(!reached(deriveState(snapshotFromFiles(false, new Map())), 'default'), 'no EFI: nothing reached');
    const noDefault = stateOf(firmwareFiles({entries: {0: WINDOWS}, order: [], next: 0}));
    assert.ok(!reached(noDefault, 'default'));
    assert.throws(() => targetEntry(noDefault, 'default'), /No default/);
});
