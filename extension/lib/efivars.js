// SPDX-License-Identifier: GPL-2.0-or-later
//
// Pure parsers for the UEFI variables this extension reads. No GI imports, so
// the same code runs in the shell, in the root helper, and in unit tests.
//
// efivarfs file layout: 4-byte little-endian attributes, then the variable
// data. All parsers take the whole file (attributes included).

import {EFI_GLOBAL_GUID} from './constants.js';

const ATTR_BYTES = 4;

/** LOAD_OPTION_ACTIVE: the firmware only boots entries with this bit set. */
const LOAD_OPTION_ACTIVE = 0x1;

/** Device path node types we care about (UEFI spec §10.3). */
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

/** File name of a global variable in efivarfs, e.g. `BootNext-8be4…`. */
export function varFileName(name) {
    return `${name}-${EFI_GLOBAL_GUID}`;
}

/** 0 → "0000", 0x1a → "001A": the form efibootmgr and the firmware use. */
export function formatEntry(num) {
    if (!Number.isInteger(num) || num < 0 || num > 0xffff)
        throw new RangeError(`not a boot entry number: ${num}`);
    return num.toString(16).toUpperCase().padStart(4, '0');
}

/**
 * Entry number for an efivarfs file name like `Boot0003-<global guid>`, or
 * null if the name isn't a global Boot#### variable.
 */
export function bootEntryNumber(fileName) {
    const m = BOOT_ENTRY_RE.exec(fileName);
    if (!m || m[2].toLowerCase() !== EFI_GLOBAL_GUID)
        return null;
    return parseInt(m[1], 16);
}

/** BootNext / BootCurrent: a single u16. */
export function parseU16Var(bytes) {
    if (bytes.byteLength !== ATTR_BYTES + 2)
        throw new EfiParseError(`expected 6 bytes, got ${bytes.byteLength}`);
    return view(bytes).getUint16(ATTR_BYTES, true);
}

/** BootOrder: an array of u16. */
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

/** Read a NUL-terminated UCS-2 string; returns [string, offsetAfterNul]. */
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
 * EFI_LOAD_OPTION (a Boot#### variable):
 *   u32 Attributes, u16 FilePathListLength, CHAR16 Description[],
 *   EFI_DEVICE_PATH FilePathList[], u8 OptionalData[]
 *
 * Returns {active, description, filePaths}. filePaths are the media
 * file-path nodes (e.g. `\EFI\Microsoft\Boot\bootmgfw.efi`).
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
            // The path may or may not include its NUL; read up to node end.
            let p = '';
            for (let i = off + 4; i + 1 < off + nodeLen; i += 2) {
                const ch = dv.getUint16(i, true);
                if (ch === 0)
                    break;
                p += String.fromCharCode(ch);
            }
            filePaths.push(p);
        }
        // End nodes (type 0x7f) separate or close path instances. Walk the
        // whole list so file paths in later instances are seen too.
        off += nodeLen;
    }

    return {
        active: (attributes & LOAD_OPTION_ACTIVE) !== 0,
        description,
        filePaths,
    };
}

/**
 * Build a state.js Snapshot from efivarfs file contents.
 *
 * Unparseable variables are skipped and reported in `problems` rather than
 * failing the whole read: one odd vendor entry shouldn't hide the toggle.
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

/** Should this efivarfs file be read when building a snapshot? */
export function isRelevantVar(fileName) {
    return fileName === varFileName('BootNext') ||
        fileName === varFileName('BootOrder') ||
        bootEntryNumber(fileName) !== null;
}

const WINDOWS_LOADER_RE = /\\EFI\\Microsoft\\Boot\\bootmgfw\.efi$/i;

/**
 * Is this load option the Windows Boot Manager? Windows always registers
 * itself with this description, but match the loader path too so a renamed
 * entry still counts.
 */
export function isWindowsEntry(option) {
    if (option.description.trim() === 'Windows Boot Manager')
        return true;
    return option.filePaths.some(p => WINDOWS_LOADER_RE.test(p));
}
