// Test-only: enables org.gnome.Shell.Eval by setting MetaContext:unsafe-mode,
// the same switch Looking Glass's "unsafe mode" toggle flips. GNOME 45-50 have
// no command-line flag for this. Shell shows a "System was put in unsafe mode"
// notification; that is expected inside the harness.
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

export default class HarnessExtension extends Extension {
    enable() {
        global.context.unsafe_mode = true;
    }

    disable() {
        global.context.unsafe_mode = false;
    }
}
