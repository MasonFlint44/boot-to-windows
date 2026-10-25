// SPDX-License-Identifier: GPL-2.0-or-later
//
// The Gio layer against real files in a temp dir, plus a read-only smoke test
// of this machine's actual firmware when there is one.

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import {assert, test} from './harness.js';
import {dualBoot} from './fixtures.js';
import {EFIVARS_DIR} from '../../extension/lib/constants.js';
import {varFileName} from '../../extension/lib/efivars.js';
import {readSnapshot, readSnapshotSync} from '../../extension/lib/firmware.js';
import {deriveState} from '../../extension/lib/state.js';

function fixtureDir(files) {
    const dir = GLib.dir_make_tmp('btw-efivars-XXXXXX');
    for (const [name, bytes] of files)
        GLib.file_set_contents(`${dir}/${name}`, bytes);
    // Unrelated variables a real efivarfs has; must be ignored.
    GLib.file_set_contents(`${dir}/${varFileName('Timeout')}`, new Uint8Array([7, 0, 0, 0, 1, 0]));
    GLib.file_set_contents(`${dir}/Boot0000-45cf35f6-0d6e-4d04-856a-0370a5b16f53`, new Uint8Array([7, 0, 0, 0]));
    return dir;
}

function rmrf(dir) {
    const d = Gio.File.new_for_path(dir);
    const e = d.enumerate_children('standard::name', Gio.FileQueryInfoFlags.NONE, null);
    let info;
    while ((info = e.next_file(null)) !== null)
        d.get_child(info.get_name()).delete(null);
    d.delete(null);
}

test('firmware: async and sync readers agree on a fixture dir', async () => {
    const dir = fixtureDir(dualBoot({next: 0}));
    try {
        const a = await readSnapshot(null, dir);
        const s = readSnapshotSync(dir);
        assert.equal(deriveState(a).status, 'armed');
        assert.equal(deriveState(s), deriveState(a));
        assert.equal(a.problems, []);
        assert.equal([...a.entries.keys()].sort(), [0, 2, 3]);
    } finally {
        rmrf(dir);
    }
});

test('firmware: many entries are all read (enumerator paging)', async () => {
    const files = dualBoot();
    const ubuntu = files.get(varFileName('Boot0002'));
    for (let n = 0x10; n < 0x10 + 150; n++)
        files.set(varFileName(`Boot${n.toString(16).toUpperCase().padStart(4, '0')}`), ubuntu);
    const dir = fixtureDir(files);
    try {
        const snap = await readSnapshot(null, dir);
        assert.equal(snap.entries.size, 153);
    } finally {
        rmrf(dir);
    }
});

test('firmware: missing efivars dir means not EFI', async () => {
    const snap = await readSnapshot(null, '/nonexistent/efivars');
    assert.equal(snap.efi, false);
    assert.equal(readSnapshotSync('/nonexistent/efivars').efi, false);
});

test('firmware: cancellation rejects', async () => {
    const dir = fixtureDir(dualBoot());
    try {
        const c = new Gio.Cancellable();
        c.cancel();
        await assert.rejects(readSnapshot(c, dir), /cancel/i);
    } finally {
        rmrf(dir);
    }
});

test('firmware: reads this machine without error (read-only, skipped if not EFI)', async () => {
    if (!GLib.file_test(EFIVARS_DIR, GLib.FileTest.IS_DIR)) {
        print('     (skipped: no efivars here)');
        return;
    }
    const snap = await readSnapshot();
    assert.ok(snap.efi);
    assert.equal(snap.problems, [], 'every boot variable parses');
    assert.ok(snap.entries.size > 0);
    print(`     (this machine: ${deriveState(snap).status})`);
});
