// SPDX-License-Identifier: GPL-2.0-or-later

import {assert, test} from './harness.js';
import {
    WINDOWS, bootNextBytes, bootOrderBytes, dualBoot, loadOptionBytes,
} from './fixtures.js';
import {
    bootEntryNumber, formatEntry, isRelevantVar, isWindowsEntry,
    parseBootOrder, parseLoadOption, parseU16Var, snapshotFromFiles,
    varFileName,
} from '../../extension/lib/efivars.js';

const GUID = '8be4df61-93ca-11d2-aa0d-00e098032b8c';

// A real firmware's "ubuntu" entry, with the partition GUID zeroed out.
const REAL_UBUNTU = new Uint8Array([
    0x07, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x62, 0x00, 0x55, 0x00, 0x62, 0x00, 0x75, 0x00,
    0x6e, 0x00, 0x74, 0x00, 0x75, 0x00, 0x00, 0x00, 0x04, 0x01, 0x2a, 0x00, 0x01, 0x00, 0x00, 0x00,
    0x00, 0x08, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x98, 0x21, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x02, 0x02, 0x04, 0x04, 0x34, 0x00, 0x5c, 0x00, 0x45, 0x00, 0x46, 0x00, 0x49, 0x00, 0x5c, 0x00,
    0x75, 0x00, 0x62, 0x00, 0x75, 0x00, 0x6e, 0x00, 0x74, 0x00, 0x75, 0x00, 0x5c, 0x00, 0x73, 0x00,
    0x68, 0x00, 0x69, 0x00, 0x6d, 0x00, 0x78, 0x00, 0x36, 0x00, 0x34, 0x00, 0x2e, 0x00, 0x65, 0x00,
    0x66, 0x00, 0x69, 0x00, 0x00, 0x00, 0x7f, 0xff, 0x04, 0x00,
]);

test('efivars: formatEntry pads and uppercases', () => {
    assert.equal(formatEntry(0), '0000');
    assert.equal(formatEntry(0x1a), '001A');
    assert.equal(formatEntry(0xffff), 'FFFF');
    assert.throws(() => formatEntry(0x10000), /not a boot entry/);
    assert.throws(() => formatEntry(-1), /not a boot entry/);
    assert.throws(() => formatEntry(1.5), /not a boot entry/);
});

test('efivars: bootEntryNumber accepts only global Boot#### names', () => {
    assert.equal(bootEntryNumber(`Boot0000-${GUID}`), 0);
    assert.equal(bootEntryNumber(`Boot001a-${GUID}`), 0x1a);
    assert.equal(bootEntryNumber(`Boot001A-${GUID.toUpperCase()}`), 0x1a);
    assert.equal(bootEntryNumber(`BootNext-${GUID}`), null);
    assert.equal(bootEntryNumber(`BootOrder-${GUID}`), null);
    assert.equal(bootEntryNumber(`Boot00000-${GUID}`), null);
    assert.equal(bootEntryNumber('Boot0000-45cf35f6-0d6e-4d04-856a-0370a5b16f53'), null,
        'vendor GUIDs are not boot entries');
    assert.equal(bootEntryNumber(`Driver0000-${GUID}`), null);
});

test('efivars: isRelevantVar picks BootNext, BootOrder and entries only', () => {
    assert.ok(isRelevantVar(varFileName('BootNext')));
    assert.ok(isRelevantVar(varFileName('BootOrder')));
    assert.ok(isRelevantVar(varFileName('Boot0003')));
    assert.ok(!isRelevantVar(varFileName('BootCurrent')));
    assert.ok(!isRelevantVar(varFileName('Timeout')));
    assert.ok(!isRelevantVar(`DefaultBootOrder-45cf35f6-0d6e-4d04-856a-0370a5b16f53`));
});

test('efivars: parseU16Var reads BootNext and rejects bad sizes', () => {
    assert.equal(parseU16Var(bootNextBytes(0)), 0);
    assert.equal(parseU16Var(bootNextBytes(0x1234)), 0x1234);
    assert.throws(() => parseU16Var(new Uint8Array([7, 0, 0, 0, 1])), /expected 6 bytes/);
    assert.throws(() => parseU16Var(new Uint8Array([])), /expected 6 bytes/);
});

test('efivars: parseBootOrder reads the real layout', () => {
    // Bytes from a real machine: 0002,0000,0003,0004,0005
    const real = new Uint8Array([7, 0, 0, 0, 2, 0, 0, 0, 3, 0, 4, 0, 5, 0]);
    assert.equal(parseBootOrder(real), [2, 0, 3, 4, 5]);
    assert.equal(parseBootOrder(bootOrderBytes([])), []);
    assert.throws(() => parseBootOrder(new Uint8Array([7, 0, 0, 0, 1])), /bad BootOrder/);
    assert.throws(() => parseBootOrder(new Uint8Array([7, 0])), /bad BootOrder/);
});

test('efivars: parseLoadOption reads a real firmware entry', () => {
    const opt = parseLoadOption(REAL_UBUNTU);
    assert.equal(opt, {active: true, description: 'Ubuntu', filePaths: ['\\EFI\\ubuntu\\shimx64.efi']});
});

test('efivars: parseLoadOption handles generated entries', () => {
    const win = parseLoadOption(loadOptionBytes({...WINDOWS, optional: [0x57, 0x49, 0x4e, 0x44]}));
    assert.equal(win.description, 'Windows Boot Manager');
    assert.equal(win.filePaths, ['\\EFI\\Microsoft\\Boot\\bootmgfw.efi']);
    assert.ok(win.active);

    const inactive = parseLoadOption(loadOptionBytes({...WINDOWS, active: false}));
    assert.ok(!inactive.active);

    const pxe = parseLoadOption(loadOptionBytes({description: 'UEFI:Network Device', path: null}));
    assert.equal(pxe.filePaths, []);
});

test('efivars: parseLoadOption rejects corrupt entries', () => {
    assert.throws(() => parseLoadOption(new Uint8Array([7, 0, 0, 0, 1, 0])), /too short/);
    // Description never terminated.
    assert.throws(() => parseLoadOption(new Uint8Array([7, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0x41, 0])),
        /unterminated/);
    // Path list length runs past the end of the variable.
    const bytes = loadOptionBytes(WINDOWS);
    bytes[8] = 0xff;
    bytes[9] = 0x7f;
    assert.throws(() => parseLoadOption(bytes), /overruns/);
    // A node claims a length shorter than its own header.
    const zeroNode = loadOptionBytes(WINDOWS);
    const descEnd = 10 + ('Windows Boot Manager'.length + 1) * 2;
    zeroNode[descEnd + 2] = 0;
    zeroNode[descEnd + 3] = 0;
    assert.throws(() => parseLoadOption(zeroNode), /node length/);
});

test('efivars: isWindowsEntry matches description or loader path', () => {
    const mk = (description, filePaths = []) => ({description, filePaths, active: true});
    assert.ok(isWindowsEntry(mk('Windows Boot Manager')));
    assert.ok(isWindowsEntry(mk('Windows Boot Manager ')));
    assert.ok(isWindowsEntry(mk('My Windows', ['\\EFI\\Microsoft\\Boot\\bootmgfw.efi'])));
    assert.ok(isWindowsEntry(mk('x', ['\\efi\\microsoft\\boot\\BOOTMGFW.EFI'])));
    assert.ok(!isWindowsEntry(mk('ubuntu', ['\\EFI\\ubuntu\\shimx64.efi'])));
    assert.ok(!isWindowsEntry(mk('Windows 11 recovery USB', ['\\EFI\\Boot\\bootx64.efi'])));
});

test('efivars: snapshotFromFiles builds the dual-boot snapshot', () => {
    const snap = snapshotFromFiles(true, dualBoot({next: 0}));
    assert.equal(snap.efi, true);
    assert.equal(snap.bootNext, 0);
    assert.equal(snap.bootOrder, [2, 0, 3]);
    assert.equal([...snap.entries.keys()].sort(), [0, 2, 3]);
    assert.ok(snap.entries.get(0).windows);
    assert.ok(!snap.entries.get(2).windows);
    assert.equal(snap.problems, []);
});

test('efivars: snapshotFromFiles skips bad variables and reports them', () => {
    const files = dualBoot({next: 0});
    files.set(varFileName('Boot0007'), new Uint8Array([7, 0, 0, 0]));
    files.set(varFileName('BootNext'), new Uint8Array([7, 0, 0, 0, 1]));
    const snap = snapshotFromFiles(true, files);
    assert.equal(snap.bootNext, null, 'unreadable BootNext treated as unset');
    assert.ok(!snap.entries.has(7));
    assert.equal(snap.problems.length, 2);
});

test('efivars: snapshotFromFiles with no EFI', () => {
    const snap = snapshotFromFiles(false, new Map());
    assert.equal(snap.efi, false);
    assert.equal(snap.entries.size, 0);
});
