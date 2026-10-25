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
    assert.equal(p.sensitive, true);
    assert.equal(p.subtitle, null, 'no confusing "Ubuntu" under "Boot to Windows"');
    assert.equal(p.header, 'ubuntu (as usual)');
    assert.equal(p.canDisarm, false);
});

test('presentation: armed is checked and can be undone', () => {
    const p = show(dualBoot({next: 0}));
    assert.equal(p, {checked: true, sensitive: true, subtitle: 'Next restart',
        header: 'Windows, once', canDisarm: true});
});

test('presentation: another tool set BootNext → say so, allow undo', () => {
    const p = show(dualBoot({next: 3}));
    assert.equal(p.checked, false);
    assert.equal(p.subtitle, `Next: ${DVD.description}`);
    assert.equal(p.canDisarm, true);
    const unknown = show(dualBoot({next: 0x99}));
    assert.equal(unknown.subtitle, 'Next: another entry');
});

test('presentation: nothing to toggle → greyed out with a reason', () => {
    const noWin = show(firmwareFiles({entries: {2: UBUNTU}, order: [2]}));
    assert.equal([noWin.sensitive, noWin.subtitle], [false, 'No Windows found']);
    const winDefault = show(firmwareFiles({entries: {0: WINDOWS, 2: UBUNTU}, order: [0, 2]}));
    assert.equal([winDefault.sensitive, winDefault.subtitle], [false, 'Already the default']);
    const bios = presentation(deriveState(snapshotFromFiles(false, new Map())));
    assert.equal([bios.sensitive, bios.subtitle], [false, 'Needs UEFI']);
});
