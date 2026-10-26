// SPDX-License-Identifier: GPL-2.0-or-later
//
// Turns a firmware snapshot into the state the UI and the helper work from.
// No GI imports.

/**
 * @typedef {object} LoadOption
 * @property {boolean} active
 * @property {string} description
 * @property {string[]} filePaths
 * @property {boolean} windows
 *
 * @typedef {object} Snapshot
 * @property {boolean} efi             false on BIOS/legacy boots
 * @property {number|null} bootNext
 * @property {number[]} bootOrder
 * @property {Map<number, LoadOption>} entries
 *
 * @typedef {'unsupported'|'no-windows'|'windows-is-default'|'ready'|'armed'|'other'} Status
 *
 * @typedef {object} Entry
 * @property {number} num
 * @property {string} description
 *
 * @typedef {object} BootState
 * @property {Status} status
 * @property {Entry|null} windows       the entry "Boot to Windows" targets
 * @property {Entry|null} defaultEntry  what boots when BootNext is unset
 * @property {Entry|null} bootNext      what BootNext currently points at
 */

function entry(snapshot, num) {
    if (num === null || num === undefined)
        return null;
    const opt = snapshot.entries.get(num);
    return {num, description: opt ? opt.description : ''};
}

// Active entries, in the order the firmware would try them.
function bootable(snapshot) {
    const seen = new Set();
    const nums = [];
    for (const n of snapshot.bootOrder) {
        if (!seen.has(n) && snapshot.entries.get(n)?.active) {
            seen.add(n);
            nums.push(n);
        }
    }
    // BootNext can point at entries that aren't in BootOrder.
    for (const n of [...snapshot.entries.keys()].sort((a, b) => a - b)) {
        if (!seen.has(n) && snapshot.entries.get(n).active)
            nums.push(n);
    }
    return nums;
}

/** @returns {BootState} */
export function deriveState(snapshot) {
    const none = {windows: null, defaultEntry: null, bootNext: null};
    if (!snapshot.efi)
        return {status: 'unsupported', ...none};

    const order = bootable(snapshot);
    const inBootOrder = new Set(snapshot.bootOrder);
    const defaultNum = order.find(n => inBootOrder.has(n)) ?? null;
    const windowsNum = order.find(n => snapshot.entries.get(n).windows) ?? null;

    const state = {
        windows: entry(snapshot, windowsNum),
        defaultEntry: entry(snapshot, defaultNum),
        bootNext: entry(snapshot, snapshot.bootNext),
    };

    if (windowsNum === null)
        return {status: 'no-windows', ...state};
    if (windowsNum === defaultNum)
        return {status: 'windows-is-default', ...state};
    if (snapshot.bootNext === windowsNum)
        return {status: 'armed', ...state};
    // We disarm by pointing BootNext at the default (efibootmgr 18 can't
    // delete it), so that counts as ready too.
    if (snapshot.bootNext === null || snapshot.bootNext === defaultNum)
        return {status: 'ready', ...state};
    return {status: 'other', ...state};
}

/**
 * The entry number to put in BootNext for `target`.
 *
 * @param {BootState} state
 * @param {'windows'|'default'} target
 * @returns {number}
 */
export function targetEntry(state, target) {
    if (target === 'windows') {
        if (!state.windows)
            throw new Error('No Windows Boot Manager entry found');
        return state.windows.num;
    }
    if (target === 'default') {
        if (!state.defaultEntry)
            throw new Error('No default boot entry found');
        return state.defaultEntry.num;
    }
    throw new Error(`unknown target: ${target}`);
}

/**
 * Is the firmware already where a write to `target` would put it?
 *
 * 'default' just means the next boot is the usual one, whatever the status.
 * That way a BootNext set by some other tool can still be undone when Windows
 * is the default or has no entry.
 */
export function reached(state, target) {
    if (target === 'windows') {
        if (state.status === 'windows-is-default')
            return state.bootNext === null || state.bootNext.num === state.windows.num;
        return state.status === 'armed';
    }
    if (!state.defaultEntry)
        return state.status !== 'unsupported' && state.bootNext === null;
    return state.bootNext === null || state.bootNext.num === state.defaultEntry.num;
}
