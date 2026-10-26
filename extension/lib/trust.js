// SPDX-License-Identifier: GPL-2.0-or-later
//
// Which files are safe for root to execute or load. Pure: callers fetch the
// file info (Gio, async or sync) and pass in the fields, or pass the Gio
// module in.
//
// A path's trust info is one of:
//   {uid, mode, type}  what's on disk
//   MISSING            nothing is there
//   null               it can't be checked (e.g. its directory is unreadable)

/**
 * A file root may execute or load must be owned by root and writable by no
 * one else, or a user process could swap in its own code.
 *
 * @param {{uid: number, mode: number, type: string}|null} info
 * @param {'regular'|'directory'} wantType
 */
export function isTrustedInfo(info, wantType = 'regular') {
    if (!info || info.type !== wantType)
        return false;
    return info.uid === 0 && (info.mode & 0o022) === 0;
}

/** Trust info for a path that doesn't exist. */
export const MISSING = Object.freeze({type: 'missing'});

/** Field names to request from Gio.File.query_info. */
export const TRUST_ATTRIBUTES = 'standard::type,unix::uid,unix::mode';

/**
 * Convert a Gio.FileInfo to the plain shape isTrustedInfo takes, or null when
 * the info is empty. Older GLib (2.78/2.80) answers a query for a file in a
 * directory the user can't search with an empty info rather than an error,
 * e.g. /usr/share/polkit-1/rules.d on Fedora 39/40. Takes the Gio module as
 * an argument so this file stays importable without GI.
 */
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

/**
 * Trust info for a failed query: MISSING when the file isn't there, null
 * when it can't be checked (no permission, cancelled, anything else).
 */
export function infoFromError(Gio, e) {
    const is = code => typeof e?.matches === 'function' && e.matches(Gio.IOErrorEnum, code);
    return is(Gio.IOErrorEnum.NOT_FOUND) || is(Gio.IOErrorEnum.NOT_DIRECTORY) ? MISSING : null;
}

/** Trust info for a path, read synchronously (prefs, the root helper). */
export function queryTrustInfo(Gio, path) {
    try {
        return infoFromGio(Gio, Gio.File.new_for_path(path).query_info(
            TRUST_ATTRIBUTES, Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS, null));
    } catch (e) {
        return infoFromError(Gio, e);
    }
}
