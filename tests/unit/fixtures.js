// SPDX-License-Identifier: GPL-2.0-or-later
//
// Builders for efivarfs file contents, so tests describe firmware in terms of
// entries instead of hex dumps. The byte layout mirrors what real firmware
// produces (checked against a real machine's variables in efivars.test.js).

import {varFileName} from '../../extension/lib/efivars.js';

const ATTRS = [0x07, 0x00, 0x00, 0x00]; // NV | BS | RT

function u16(n) {
    return [n & 0xff, (n >> 8) & 0xff];
}

function u32(n) {
    return [n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >>> 24) & 0xff];
}

function ucs2z(s) {
    const out = [];
    for (const ch of s)
        out.push(...u16(ch.charCodeAt(0)));
    out.push(0, 0);
    return out;
}

export function bootNextBytes(num) {
    return new Uint8Array([...ATTRS, ...u16(num)]);
}

export function bootOrderBytes(nums) {
    return new Uint8Array([...ATTRS, ...nums.flatMap(u16)]);
}

/** A hard-drive media node like real firmware writes (GPT partition 1). */
function hdNode() {
    const body = [
        ...u32(1), // partition number
        ...u32(0x800), 0, 0, 0, 0, // start LBA (u64)
        ...u32(0x219800), 0, 0, 0, 0, // size (u64)
        ...new Array(16).fill(0xab), // partition GUID
        0x02, // GPT
        0x02, // GUID signature
    ];
    return [0x04, 0x01, ...u16(4 + body.length), ...body];
}

function fileNode(path) {
    const body = ucs2z(path);
    return [0x04, 0x04, ...u16(4 + body.length), ...body];
}

const END_NODE = [0x7f, 0xff, 0x04, 0x00];

/**
 * An EFI_LOAD_OPTION.
 * @param {object} p
 * @param {string} p.description
 * @param {string|null} [p.path]   loader path; null = no file node (e.g. PXE)
 * @param {boolean} [p.active]
 * @param {number[]} [p.optional]  trailing optional data
 */
export function loadOptionBytes({description, path = null, active = true, optional = []}) {
    const devicePath = path === null
        ? [0x05, 0x01, 0x09, 0x00, 0x81, 0x00, 0x00, 0x00, 0x00, ...END_NODE]
        : [...hdNode(), ...fileNode(path), ...END_NODE];
    return new Uint8Array([
        ...ATTRS,
        ...u32(active ? 1 : 0),
        ...u16(devicePath.length),
        ...ucs2z(description),
        ...devicePath,
        ...optional,
    ]);
}

export const WINDOWS = {description: 'Windows Boot Manager', path: '\\EFI\\Microsoft\\Boot\\bootmgfw.efi'};
export const UBUNTU = {description: 'ubuntu', path: '\\EFI\\ubuntu\\shimx64.efi'};
export const DVD = {description: 'UEFI:CD/DVD Drive', path: null};

/**
 * efivarfs file map for a machine.
 * @param {object} p
 * @param {Object<number, object>} p.entries  entry number → loadOptionBytes args
 * @param {number[]} [p.order]
 * @param {number|null} [p.next]
 */
export function firmwareFiles({entries, order = [], next = null}) {
    const files = new Map();
    for (const [num, opt] of Object.entries(entries)) {
        const name = `Boot${Number(num).toString(16).toUpperCase().padStart(4, '0')}`;
        files.set(varFileName(name), loadOptionBytes(opt));
    }
    files.set(varFileName('BootOrder'), bootOrderBytes(order));
    if (next !== null)
        files.set(varFileName('BootNext'), bootNextBytes(next));
    return files;
}

/** The dual-boot layout this extension was written for. */
export function dualBoot({next = null} = {}) {
    return firmwareFiles({
        entries: {0: WINDOWS, 2: UBUNTU, 3: DVD},
        order: [2, 0, 3],
        next,
    });
}
