// SPDX-License-Identifier: GPL-2.0-or-later
//
// What the toggle and its menu show for each state. No GI imports.

export const ICON_FILE = 'boot-to-windows-symbolic.svg'; // in icons/
export const NAME = 'Boot to Windows';
// "Boot to Windows" gets cut off in a Quick Settings toggle.
export const TOGGLE_TITLE = 'Next Boot';

// Firmware names like "ubuntu" -> "Ubuntu". Names with any capitals are left
// alone ("openSUSE"). Empty names -> null.
export function displayName(description) {
    const name = (description ?? '').trim();
    if (!name)
        return null;
    return name === name.toLowerCase() ? name[0].toUpperCase() + name.slice(1) : name;
}

// Name of the default entry, or null if it has none. Says "Windows" when
// Windows is the default, rather than "Windows Boot Manager".
export function defaultName(state) {
    if (!state.defaultEntry)
        return null;
    if (state.windows?.num === state.defaultEntry.num)
        return 'Windows';
    return displayName(state.defaultEntry.description);
}

// If there's nothing to switch to (no UEFI, no Windows entry, or Windows is
// already the default) the toggle hides, like Bluetooth does without an
// adapter. The settings page says why.
export function presentation(state) {
    const def = defaultName(state);
    const disarmLabel = `Start ${def ?? 'the default'} next time`;
    switch (state.status) {
    case 'armed':
        return {visible: true, checked: true, subtitle: 'Windows',
            header: 'Windows, once', canDisarm: true, disarmLabel};
    case 'ready':
        return {visible: true, checked: false, subtitle: def ?? 'Default',
            header: def ?? 'Default', canDisarm: false, disarmLabel};
    case 'other': {
        const what = displayName(state.bootNext.description) ?? 'Another entry';
        return {visible: true, checked: false, subtitle: what,
            header: `${what}, once`, canDisarm: true, disarmLabel};
    }
    default:
        return {visible: false, checked: false, subtitle: null, header: '',
            canDisarm: false, disarmLabel};
    }
}
