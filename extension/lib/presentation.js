// SPDX-License-Identifier: GPL-2.0-or-later
//
// What the toggle and its menu show for each boot state. Pure: no GI imports.

/** Symbolic (recoloured to the theme), in the extension's icons/ folder. */
export const ICON_FILE = 'boot-to-windows-symbolic.svg';
export const NAME = 'Boot to Windows';

/**
 * What the toggle shows for each state. When there is nothing to switch to
 * (no UEFI, no Windows entry, or Windows already boots by default) the toggle
 * is hidden, as GNOME does for e.g. Bluetooth without an adapter; the
 * settings page explains why.
 */
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
