// SPDX-License-Identifier: GPL-2.0-or-later

import {assert, test} from './harness.js';
import {DVD, UBUNTU, WINDOWS, dualBoot, firmwareFiles} from './fixtures.js';
import {parseU16Var, snapshotFromFiles, varFileName} from '../../extension/lib/efivars.js';
import {EXIT_FAILED, EXIT_OK, EXIT_USAGE, helperMain} from '../../extension/lib/helperCore.js';
import {bootNextBytes} from './fixtures.js';

/** Fake machine: a mutable efivars map plus an efibootmgr that edits it. */
function machine(files, {efibootmgrWorks = true} = {}) {
    const calls = [];
    return {
        calls,
        files,
        readSnapshot: async () => snapshotFromFiles(true, files),
        run(argv) {
            calls.push(argv);
            if (!efibootmgrWorks)
                return {status: 5, stderr: 'Could not set BootNext: Input/output error\n'};
            files.set(varFileName('BootNext'), bootNextBytes(parseInt(argv[2], 16)));
            return {status: 0, stderr: ''};
        },
        efibootmgr: '/usr/bin/efibootmgr',
    };
}

const bootNext = m => {
    const b = m.files.get(varFileName('BootNext'));
    return b ? parseU16Var(b) : null;
};

test('helper: windows arms the Windows entry', async () => {
    const m = machine(dualBoot());
    const r = await helperMain({args: ['windows'], ...m});
    assert.equal(r, {code: EXIT_OK, out: 'armed', err: ''});
    assert.equal(m.calls, [['/usr/bin/efibootmgr', '--bootnext', '0000']]);
    assert.equal(bootNext(m), 0);
});

test('helper: default disarms by pointing at the default entry', async () => {
    const m = machine(dualBoot({next: 0}));
    const r = await helperMain({args: ['default'], ...m});
    assert.equal(r, {code: EXIT_OK, out: 'ready', err: ''});
    assert.equal(m.calls, [['/usr/bin/efibootmgr', '--bootnext', '0002']]);
});

test('helper: no write when already in the requested state', async () => {
    const armed = machine(dualBoot({next: 0}));
    assert.equal((await helperMain({args: ['windows'], ...armed})).code, EXIT_OK);
    const ready = machine(dualBoot());
    assert.equal((await helperMain({args: ['default'], ...ready})).code, EXIT_OK);
    assert.equal(armed.calls.length + ready.calls.length, 0);
});

test('helper: default from "other" overwrites it', async () => {
    const m = machine(dualBoot({next: 3}));
    assert.equal((await helperMain({args: ['default'], ...m})).out, 'ready');
    assert.equal(bootNext(m), 2);
});

test('helper: rejects anything but exactly one known verb', async () => {
    for (const args of [[], ['clear'], ['windows', '0003'], ['--bootnext', '0003'], ['WINDOWS']]) {
        const m = machine(dualBoot());
        // eslint-disable-next-line no-await-in-loop
        const r = await helperMain({args, ...m});
        assert.equal(r.code, EXIT_USAGE, JSON.stringify(args));
        assert.equal(m.calls, [], 'never runs efibootmgr');
    }
});

test('helper: fails cleanly without efibootmgr or a Windows entry', async () => {
    const noTool = machine(dualBoot());
    noTool.efibootmgr = null;
    assert.equal((await helperMain({args: ['windows'], ...noTool})).err, 'efibootmgr not found');

    const noWin = machine(firmwareFiles({entries: {2: UBUNTU, 3: DVD}, order: [2, 3]}));
    const r = await helperMain({args: ['windows'], ...noWin});
    assert.equal(r.code, EXIT_FAILED);
    assert.ok(/No Windows/.test(r.err));
    assert.equal(noWin.calls, []);
});

test('helper: reports failure from re-read, not exit code', async () => {
    const broken = machine(dualBoot(), {efibootmgrWorks: false});
    const r = await helperMain({args: ['windows'], ...broken});
    assert.equal(r.code, EXIT_FAILED);
    assert.ok(/state: ready/.test(r.err) && /Input\/output error/.test(r.err), r.err);

    // efibootmgr "succeeds" but the firmware didn't take it.
    const liar = machine(dualBoot());
    liar.run = argv => {
        liar.calls.push(argv);
        return {status: 0, stderr: ''};
    };
    const r2 = await helperMain({args: ['windows'], ...liar});
    assert.equal(r2.code, EXIT_FAILED);
    assert.ok(!/: $/.test(r2.err));
});

test('helper: Windows already default leaves nothing to arm', async () => {
    const m = machine(firmwareFiles({entries: {0: WINDOWS, 2: UBUNTU}, order: [0, 2]}));
    const r = await helperMain({args: ['windows'], ...m});
    assert.equal(r, {code: EXIT_OK, out: 'windows-is-default', err: ''});
    assert.equal(m.calls, []);
});

test('helper: default undoes another BootNext even when Windows is the default', async () => {
    const m = machine(firmwareFiles({entries: {0: WINDOWS, 2: UBUNTU, 3: DVD}, order: [0, 2], next: 3}));
    const r = await helperMain({args: ['default'], ...m});
    assert.equal(r.code, EXIT_OK, r.err);
    assert.equal(m.calls, [['/usr/bin/efibootmgr', '--bootnext', '0000']]);
    assert.equal(bootNext(m), 0);
});
