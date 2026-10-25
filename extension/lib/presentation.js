// SPDX-License-Identifier: GPL-2.0-or-later
//
// What the toggle and its menu show for each boot state. Pure: no GI imports.

export const ICON = 'system-reboot-symbolic';
export const NAME = 'Boot to Windows';

/**
 * What the toggle shows for each state. `sensitive: false` greys it out when
 * there is nothing useful to toggle.
 */
export function presentation(state) {
    const def = state.defaultEntry?.description || 'the default system';
    switch (state.status) {
    case 'armed':
        return {checked: true, sensitive: true, subtitle: 'Next restart',
            header: 'Windows, once', canDisarm: true};
    case 'ready':
        return {checked: false, sensitive: true, subtitle: null,
            header: `${def} (as usual)`, canDisarm: false};
    case 'other':
        return {checked: false, sensitive: true,
            subtitle: `Next: ${state.bootNext.description || 'another entry'}`,
            header: `${state.bootNext.description || 'Another entry'}, once`, canDisarm: true};
    case 'windows-is-default':
        return {checked: false, sensitive: false, subtitle: 'Already the default',
            header: 'Windows is the default system', canDisarm: false};
    case 'no-windows':
        return {checked: false, sensitive: false, subtitle: 'No Windows found',
            header: 'No Windows Boot Manager entry', canDisarm: false};
    default:
        return {checked: false, sensitive: false, subtitle: 'Needs UEFI',
            header: 'This computer did not boot with UEFI', canDisarm: false};
    }
}
