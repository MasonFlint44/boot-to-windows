// SPDX-License-Identifier: GPL-2.0-or-later
//
// Parsers for the UEFI variables we read. No GI imports, so the shell, the
// root helper and the unit tests can all use them.
//
// An efivarfs file is 4 bytes of little-endian attributes followed by the
// variable's data. The parsers take the whole file, attributes included.

import {EFI_GLOBAL_GUID} from './constants.js';

const ATTR_BYTES = 4;

// The firmware only boots entries with this bit set.
const LOAD_OPTION_ACTIVE = 0x1;

// Device path node type/subtype for a file path (UEFI spec 10.3).
const DP_MEDIA = 0x04;
const DP_MEDIA_FILE_PATH = 0x04;

const BOOT_ENTRY_RE = /^Boot([0-9A-Fa-f]{4})-([0-9a-fA-F-]{36})$/;

export class EfiParseError extends Error {
    constructor(message) {
        super(message);
        this.name = 'EfiParseError';
    }
}

function view(bytes) {
    return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

// e.g. BootNext -> BootNext-8be4df61-...
export function varFileName(name) {
    return `${name}-${EFI_GLOBAL_GUID}`;
}

// 0x1a -> "001A", the way efibootmgr writes entry numbers.
export function formatEntry(num) {
    if (!Number.isInteger(num) || num < 0 || num > 0xffff)
        throw new RangeError(`not a boot entry number: ${num}`);
    return num.toString(16).toUpperCase().padStart(4, '0');
}

// Boot0003-<global guid> -> 3. Anything else -> null.
export function bootEntryNumber(fileName) {
    const m = BOOT_ENTRY_RE.exec(fileName);
    if (!m || m[2].toLowerCase() !== EFI_GLOBAL_GUID)
        return null;
    return parseInt(m[1], 16);
}

// BootNext and BootCurrent are a single u16.
export function parseU16Var(bytes) {
    if (bytes.byteLength !== ATTR_BYTES + 2)
        throw new EfiParseError(`expected 6 bytes, got ${bytes.byteLength}`);
    return view(bytes).getUint16(ATTR_BYTES, true);
}

// BootOrder is an array of u16.
export function parseBootOrder(bytes) {
    const len = bytes.byteLength - ATTR_BYTES;
    if (len < 0 || len % 2 !== 0)
        throw new EfiParseError(`bad BootOrder length ${bytes.byteLength}`);
    const dv = view(bytes);
    const order = [];
    for (let off = ATTR_BYTES; off < bytes.byteLength; off += 2)
        order.push(dv.getUint16(off, true));
    return order;
}

// Reads a NUL-terminated UCS-2 string. Returns [string, offset after the NUL].
function readUcs2z(dv, start, end) {
    let s = '';
    for (let off = start; off + 1 < end; off += 2) {
        const ch = dv.getUint16(off, true);
        if (ch === 0)
            return [s, off + 2];
        s += String.fromCharCode(ch);
    }
    throw new EfiParseError('unterminated UCS-2 string');
}

/**
 * Parse a Boot#### variable (EFI_LOAD_OPTION):
 *   u32 Attributes, u16 FilePathListLength, CHAR16 Description[],
 *   EFI_DEVICE_PATH FilePathList[], u8 OptionalData[]
 *
 * Returns {active, description, filePaths}, where filePaths holds any
 * file path nodes, like \EFI\Microsoft\Boot\bootmgfw.efi.
 */
export function parseLoadOption(bytes) {
    const dv = view(bytes);
    const end = bytes.byteLength;
    if (end < ATTR_BYTES + 6)
        throw new EfiParseError('load option too short');

    const attributes = dv.getUint32(ATTR_BYTES, true);
    const pathListLen = dv.getUint16(ATTR_BYTES + 4, true);
    const [description, pathStart] = readUcs2z(dv, ATTR_BYTES + 6, end);

    const pathEnd = pathStart + pathListLen;
    if (pathEnd > end)
        throw new EfiParseError('device path list overruns variable');

    const filePaths = [];
    let off = pathStart;
    while (off + 4 <= pathEnd) {
        const type = dv.getUint8(off);
        const subtype = dv.getUint8(off + 1);
        const nodeLen = dv.getUint16(off + 2, true);
        if (nodeLen < 4 || off + nodeLen > pathEnd)
            throw new EfiParseError('bad device path node length');
        if (type === DP_MEDIA && subtype === DP_MEDIA_FILE_PATH) {
            // Not every firmware NUL-terminates this, so stop at the node end.
            let p = '';
            for (let i = off + 4; i + 1 < off + nodeLen; i += 2) {
                const ch = dv.getUint16(i, true);
                if (ch === 0)
                    break;
                p += String.fromCharCode(ch);
            }
            filePaths.push(p);
        }
        // Keep going past end nodes (0x7f): there can be more than one
        // path instance in the list.
        off += nodeLen;
    }

    return {
        active: (attributes & LOAD_OPTION_ACTIVE) !== 0,
        description,
        filePaths,
    };
}

/**
 * Build a state.js Snapshot from efivarfs file contents. Variables that
 * don't parse are skipped and listed in `problems`, so one weird vendor
 * entry doesn't hide the toggle.
 *
 * @param {boolean} efi  whether the efivars directory exists at all
 * @param {Map<string, Uint8Array>} files  efivarfs file name → contents
 * @param {string[]} problems  variables that couldn't be read at all
 */
export function snapshotFromFiles(efi, files, problems = []) {
    const snapshot = {efi, bootNext: null, bootOrder: [], entries: new Map(), problems: [...problems]};
    const tryParse = (name, fn) => {
        try {
            return fn(files.get(name));
        } catch (e) {
            snapshot.problems.push(`${name.replace(/-.*/, '')}: ${e.message}`);
            return undefined;
        }
    };

    const nextName = varFileName('BootNext');
    if (files.has(nextName))
        snapshot.bootNext = tryParse(nextName, parseU16Var) ?? null;

    const orderName = varFileName('BootOrder');
    if (files.has(orderName))
        snapshot.bootOrder = tryParse(orderName, parseBootOrder) ?? [];

    for (const name of files.keys()) {
        const num = bootEntryNumber(name);
        if (num === null)
            continue;
        const opt = tryParse(name, parseLoadOption);
        if (opt)
            snapshot.entries.set(num, {...opt, windows: isWindowsEntry(opt)});
    }
    return snapshot;
}

// The files a snapshot needs: BootNext, BootOrder and Boot####.
export function isRelevantVar(fileName) {
    return fileName === varFileName('BootNext') ||
        fileName === varFileName('BootOrder') ||
        bootEntryNumber(fileName) !== null;
}

const WINDOWS_LOADER_RE = /\\EFI\\Microsoft\\Boot\\bootmgfw\.efi$/i;

// Windows names its entry "Windows Boot Manager". Check the loader path too
// in case someone renamed it.
export function isWindowsEntry(option) {
    if (option.description.trim() === 'Windows Boot Manager')
        return true;
    return option.filePaths.some(p => WINDOWS_LOADER_RE.test(p));
}
