// SPDX-License-Identifier: GPL-2.0-or-later
//
// Fixed paths and identifiers shared by the extension, its preferences, and
// the optional root helper. Nothing here is configurable at runtime on
// purpose: the helper runs as root, so it must not take paths from anywhere a
// user could influence.

/** UEFI global variable namespace (BootNext, BootOrder, Boot####). */
export const EFI_GLOBAL_GUID = '8be4df61-93ca-11d2-aa0d-00e098032b8c';

/** Where the kernel exposes UEFI variables. */
export const EFIVARS_DIR = '/sys/firmware/efi/efivars';

/** Root-owned install location of the optional one-click helper. */
export const HELPER_DIR = '/usr/local/libexec/boot-to-windows';
export const HELPER_PATH = `${HELPER_DIR}/boot-to-windows-helper`;

/**
 * Directories above HELPER_DIR. If any is writable by non-root users, the
 * helper directory itself could be swapped out, so the helper isn't used.
 */
export const HELPER_ANCESTORS = ['/usr', '/usr/local', '/usr/local/libexec'];

/** Modules the helper imports, installed to HELPER_DIR/lib alongside it. */
export const HELPER_LIBS = [
    'constants.js', 'efivars.js', 'firmware.js', 'helperCore.js',
    'state.js', 'trust.js',
];

/** Polkit action that lets the active local session run the helper. */
export const POLKIT_ACTION_ID = 'com.masonflint.BootToWindows.set-next-boot';
export const POLICY_PATH =
    `/usr/share/polkit-1/actions/${POLKIT_ACTION_ID}.policy`;

/**
 * Polkit rule granting the action without a password to administrators at
 * the machine. /usr/share rather than /etc: /etc/polkit-1/rules.d isn't
 * readable by users, so the extension couldn't check the file.
 */
export const RULES_PATH =
    '/usr/share/polkit-1/rules.d/50-com.masonflint.BootToWindows.rules';

/** GSettings schema (extension/schemas/). */
export const SETTINGS_SCHEMA = 'org.gnome.shell.extensions.boot-to-windows';

/** efibootmgr lives in /usr/bin on Debian/Ubuntu and /usr/sbin elsewhere. */
export const EFIBOOTMGR_CANDIDATES = [
    '/usr/bin/efibootmgr',
    '/usr/sbin/efibootmgr',
];

/** Verbs the helper accepts. Anything else is rejected. */
export const HELPER_VERBS = ['windows', 'default'];
