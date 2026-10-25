// Stand-in extension for the integration harness: a Quick Settings toggle that
// mirrors UEFI BootNext. Reads efivars in-process; writes via
// `pkexec /usr/bin/efibootmgr --bootnext 0001` (shimmed in the test image).
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';

import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {QuickToggle, SystemIndicator} from 'resource:///org/gnome/shell/ui/quickSettings.js';

const GUID = '8be4df61-93ca-11d2-aa0d-00e098032b8c';
const EFIVARS = '/sys/firmware/efi/efivars';
const WINDOWS_ENTRY = '0001';

function readVar(name) {
    try {
        const [, bytes] = Gio.File.new_for_path(`${EFIVARS}/${name}-${GUID}`).load_contents(null);
        return bytes.subarray(4); // drop the 4 attribute bytes
    } catch {
        return null;
    }
}
const hex4 = n => n.toString(16).toUpperCase().padStart(4, '0');

const ProbeToggle = GObject.registerClass(
class ProbeToggle extends QuickToggle {
    constructor() {
        // 'title' is the property name on 45+ ('label' was the 43 name).
        super({title: 'Harness Probe', iconName: 'system-reboot-symbolic', toggleMode: false});
        this._clickedId = this.connect('clicked', () => this._onClicked());
        this.sync();
    }

    // Public so tests can call it through Eval.
    sync() {
        const data = readVar('BootNext');
        const next = data && data.length >= 2 ? hex4(data[0] | (data[1] << 8)) : null;
        this.checked = next === WINDOWS_ENTRY;
        this.subtitle = this._error ?? (next ? `BootNext: Boot${next}` : 'BootNext: none');
        return next;
    }

    _onClicked() {
        const argv = this.checked
            ? ['pkexec', '/usr/bin/efibootmgr', '--delete-bootnext']
            : ['pkexec', '/usr/bin/efibootmgr', '--bootnext', WINDOWS_ENTRY];
        const proc = Gio.Subprocess.new(argv, Gio.SubprocessFlags.STDERR_PIPE | Gio.SubprocessFlags.STDOUT_SILENCE);
        proc.communicate_utf8_async(null, null, (p, res) => {
            const [, , stderr] = p.communicate_utf8_finish(res);
            this._error = p.get_successful() ? null : `failed (${p.get_exit_status()}): ${stderr.trim()}`;
            this.sync();
        });
    }
});

const ProbeIndicator = GObject.registerClass(
class ProbeIndicator extends SystemIndicator {
    constructor() {
        super();
        this.toggle = new ProbeToggle();
        this.quickSettingsItems.push(this.toggle);
    }

    destroy() {
        this.quickSettingsItems.forEach(item => item.destroy());
        super.destroy();
    }
});

export default class HarnessProbeExtension extends Extension {
    enable() {
        this._indicator = new ProbeIndicator();
        Main.panel.statusArea.quickSettings.addExternalIndicator(this._indicator);
        this._timer = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 60, () => {
            this._indicator.toggle.sync();
            return GLib.SOURCE_CONTINUE;
        });
    }

    disable() {
        GLib.source_remove(this._timer);
        this._timer = null;
        this._indicator.destroy();
        this._indicator = null;
    }
}
