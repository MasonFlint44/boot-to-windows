// SPDX-License-Identifier: GPL-2.0-or-later

import {assert, test} from './harness.js';
import {DVD, UBUNTU, WINDOWS, dualBoot, firmwareFiles} from './fixtures.js';
import {snapshotFromFiles} from '../../extension/lib/efivars.js';
import {presentation} from '../../extension/lib/presentation.js';
import {deriveState} from '../../extension/lib/state.js';

const show = files => presentation(deriveState(snapshotFromFiles(true, files)));

test('presentation: ready is unchecked with no subtitle', () => {
    const p = show(dualBoot());
    assert.equal(p.checked, false);
    assert.equal(p.visible, true);
    assert.equal(p.subtitle, null, 'no confusing "Ubuntu" under "Boot to Windows"');
    assert.equal(p.header, 'ubuntu (as usual)');
    assert.equal(p.canDisarm, false);
});

test('presentation: armed is checked and can be undone', () => {
    const p = show(dualBoot({next: 0}));
    assert.equal(p, {visible: true, checked: true, subtitle: 'Next restart',
        header: 'Windows, once', canDisarm: true});
});

test('presentation: another tool set BootNext → say so, allow undo', () => {
    const p = show(dualBoot({next: 3}));
    assert.equal(p.header, 'UEFI:CD/DVD Drive, once');
    assert.equal(p.checked, false);
    assert.equal(p.subtitle, `Next: ${DVD.description}`);
    assert.equal(p.canDisarm, true);
    const unknown = show(dualBoot({next: 0x99}));
    assert.equal(unknown.subtitle, 'Next: another entry');
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
