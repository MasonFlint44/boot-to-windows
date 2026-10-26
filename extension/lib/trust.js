// SPDX-License-Identifier: GPL-2.0-or-later
//
// Checks whether a file is safe for root to run or load. No GI imports:
// functions that need Gio take it as an argument.
//
// "Trust info" for a path is one of:
//   {uid, mode, type}  what's on disk
//   MISSING            nothing there
//   null               couldn't check (e.g. the directory isn't readable)

/**
 * Owned by root and not writable by anyone else. Otherwise a user process
 * could swap in its own code.
 *
 * @param {{uid: number, mode: number, type: string}|null} info
 * @param {'regular'|'directory'} wantType
 */
export function isTrustedInfo(info, wantType = 'regular') {
    if (!info || info.type !== wantType)
        return false;
    return info.uid === 0 && (info.mode & 0o022) === 0;
}

export const MISSING = Object.freeze({type: 'missing'});

export const TRUST_ATTRIBUTES = 'standard::type,unix::uid,unix::mode';

// Gio.FileInfo -> trust info. GLib 2.78/2.80 returns an empty info instead of
// an error for a file in a directory we can't search (Fedora 39/40's
// polkit rules.d), so an empty info means null.
export function infoFromGio(Gio, info) {
    if (!info.has_attribute('standard::type') || !info.has_attribute('unix::uid'))
        return null;
    const type = {
        [Gio.FileType.DIRECTORY]: 'directory',
        [Gio.FileType.REGULAR]: 'regular',
        [Gio.FileType.SYMBOLIC_LINK]: 'symlink',
    }[info.get_file_type()] ?? 'other';
    return {
        uid: info.get_attribute_uint32('unix::uid'),
        mode: info.get_attribute_uint32('unix::mode'),
        type,
    };
}

// A failed query is MISSING if the file isn't there, otherwise null.
export function infoFromError(Gio, e) {
    const is = code => typeof e?.matches === 'function' && e.matches(Gio.IOErrorEnum, code);
    return is(Gio.IOErrorEnum.NOT_FOUND) || is(Gio.IOErrorEnum.NOT_DIRECTORY) ? MISSING : null;
}

// Synchronous version, for prefs and the root helper.
export function queryTrustInfo(Gio, path) {
    try {
        return infoFromGio(Gio, Gio.File.new_for_path(path).query_info(
            TRUST_ATTRIBUTES, Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS, null));
    } catch (e) {
        return infoFromError(Gio, e);
    }
}
