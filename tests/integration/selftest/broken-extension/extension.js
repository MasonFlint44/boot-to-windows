// Negative control for the harness: enable() throws, so the extension must land
// in state ERROR and the log scanner must find the exception.
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

export default class BrokenProbe extends Extension {
    enable() {
        throw new Error('broken-probe deliberately failed to enable');
    }

    disable() {}
}
