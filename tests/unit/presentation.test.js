// SPDX-License-Identifier: GPL-2.0-or-later

import {assert, test} from './harness.js';
import {DVD, UBUNTU, WINDOWS, dualBoot, firmwareFiles} from './fixtures.js';
import {snapshotFromFiles} from '../../extension/lib/efivars.js';
import {defaultName, displayName, presentation} from '../../extension/lib/presentation.js';
import {deriveState} from '../../extension/lib/state.js';

const show = files => presentation(deriveState(snapshotFromFiles(true, files)));

test('presentation: ready shows the default, unchecked', () => {
    const p = show(dualBoot());
    assert.equal(p, {visible: true, checked: false, subtitle: 'Ubuntu',
        header: 'Ubuntu', canDisarm: false, disarmLabel: 'Start Ubuntu next time'});
});

test('presentation: armed shows Windows, checked, can be undone', () => {
    const p = show(dualBoot({next: 0}));
    assert.equal(p, {visible: true, checked: true, subtitle: 'Windows',
        header: 'Windows, once', canDisarm: true, disarmLabel: 'Start Ubuntu next time'});
});

test('presentation: another tool set BootNext → show it, allow undo', () => {
    const p = show(dualBoot({next: 3}));
    assert.equal(p, {visible: true, checked: false, subtitle: DVD.description,
        header: `${DVD.description}, once`, canDisarm: true, disarmLabel: 'Start Ubuntu next time'});
    const unknown = show(dualBoot({next: 0x99}));
    assert.equal(unknown.subtitle, 'Another entry');
});

test('presentation: displayName', () => {
    assert.equal(displayName('ubuntu'), 'Ubuntu');
    assert.equal(displayName(' debian '), 'Debian');
    assert.equal(displayName('openSUSE'), 'openSUSE');
    assert.equal(displayName('Linux Boot Manager'), 'Linux Boot Manager');
    assert.equal(displayName('UEFI:CD/DVD Drive'), 'UEFI:CD/DVD Drive');
    assert.equal(displayName(''), null);
    assert.equal(displayName(undefined), null);
});

test('presentation: a default with no name says "Default"', () => {
    const p = show(firmwareFiles({entries: {0: WINDOWS, 2: {...UBUNTU, description: ''}}, order: [2, 0]}));
    assert.equal(p.subtitle, 'Default');
    assert.equal(p.header, 'Default');
    assert.equal(p.disarmLabel, 'Start the default next time');
});

test('presentation: defaultName says Windows when Windows is the default', () => {
    const s = deriveState(snapshotFromFiles(true, firmwareFiles({entries: {0: WINDOWS, 2: UBUNTU}, order: [0, 2]})));
    assert.equal(defaultName(s), 'Windows');
    assert.equal(defaultName(deriveState(snapshotFromFiles(true, dualBoot()))), 'Ubuntu');
});

test('presentation: nothing to switch to → hidden', () => {
    const states = [
        show(firmwareFiles({entries: {2: UBUNTU}, order: [2]})),
        show(firmwareFiles({entries: {0: WINDOWS, 2: UBUNTU}, order: [0, 2]})),
        presentation(deriveState(snapshotFromFiles(false, new Map()))),
    ];
    for (const p of states)
        assert.equal(p.visible, false);
});
