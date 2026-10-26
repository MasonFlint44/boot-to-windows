// SPDX-License-Identifier: GPL-2.0-or-later
//
// Paths and IDs shared by the extension, prefs and the root helper. These are
// hardcoded on purpose: the helper runs as root and shouldn't take paths from
// anywhere a user can change.

// GUID of the global variables (BootNext, BootOrder, Boot####).
export const EFI_GLOBAL_GUID = '8be4df61-93ca-11d2-aa0d-00e098032b8c';

export const EFIVARS_DIR = '/sys/firmware/efi/efivars';

export const HELPER_DIR = '/usr/local/libexec/boot-to-windows';
export const HELPER_PATH = `${HELPER_DIR}/boot-to-windows-helper`;

// If a user could write to any of these, they could swap out HELPER_DIR.
export const HELPER_ANCESTORS = ['/usr', '/usr/local', '/usr/local/libexec'];

// Installed to HELPER_DIR/lib.
export const HELPER_LIBS = [
    'constants.js', 'efivars.js', 'firmware.js', 'helperCore.js',
    'state.js', 'trust.js',
];

export const POLKIT_ACTION_ID = 'com.masonflint.BootToWindows.set-next-boot';
export const POLICY_PATH =
    `/usr/share/polkit-1/actions/${POLKIT_ACTION_ID}.policy`;

// In /usr/share, not /etc, because users can't read /etc/polkit-1/rules.d
// and we want to be able to check the file.
export const RULES_PATH =
    '/usr/share/polkit-1/rules.d/50-com.masonflint.BootToWindows.rules';

// /usr/bin on Debian/Ubuntu, /usr/sbin elsewhere.
export const EFIBOOTMGR_CANDIDATES = [
    '/usr/bin/efibootmgr',
    '/usr/sbin/efibootmgr',
];

// The only arguments the helper accepts. Don't change or remove these:
// updating the extension doesn't update an installed helper (that needs a
// password), so newer versions have to keep working with old helpers.
// Adding verbs is fine.
export const HELPER_VERBS = Object.freeze(['windows', 'default']);

// Exists on OSTree systems like Silverblue, where /usr is read-only.
export const IMAGE_BASED_MARKER = '/run/ostree-booted';
