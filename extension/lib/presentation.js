// SPDX-License-Identifier: GPL-2.0-or-later
//
// What the toggle and its menu show for each state. No GI imports.

export const ICON_FILE = 'boot-to-windows-symbolic.svg'; // in icons/
export const NAME = 'Boot to Windows';

// If there's nothing to switch to (no UEFI, no Windows entry, or Windows is
// already the default) the toggle hides, like Bluetooth does without an
// adapter. The settings page says why.
export function presentation(state) {
    const def = state.defaultEntry?.description || 'the default system';
    switch (state.status) {
    case 'armed':
        return {visible: true, checked: true, subtitle: 'Next restart',
            header: 'Windows, once', canDisarm: true};
    case 'ready':
        return {visible: true, checked: false, subtitle: null,
            header: `${def} (as usual)`, canDisarm: false};
    case 'other': {
        const what = state.bootNext.description || 'another entry';
        return {visible: true, checked: false, subtitle: `Next: ${what}`,
            header: `${what}, once`, canDisarm: true};
    }
    default:
        return {visible: false, checked: false, subtitle: null, header: '', canDisarm: false};
    }
}
