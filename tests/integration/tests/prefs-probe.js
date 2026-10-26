// SPDX-License-Identifier: GPL-2.0-or-later
//
// Builds the extension's real preferences page with GNOME's own prefs
// framework (loaded from the Extensions app's gresource) and prints every
// row and button, plus any toast shown, as JSON:
// [{group}, {title, subtitle}, {button}, {toast}].
//
//   gjs -m prefs-probe.js <installed extension dir> [button label to click]
//
// With a label, clicks that button, waits until it is done (no button says
// "Waiting…" any more) and prints the page after.
//
// PROBE_NO_PKEXEC=1: hide pkexec from the page (PATH points nowhere), to
// test what the page does when it can't start a command at all.

import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Gtk from 'gi://Gtk?version=4.0';
import System from 'system';

Gio.Resource.load('/usr/share/gnome-shell/org.gnome.Shell.Extensions.src.gresource')._register();

const dir = ARGV[0];
const [, bytes] = GLib.file_get_contents(`${dir}/metadata.json`);
// The shape the Extensions app passes: parsed metadata plus path and dir.
const metadata = {...JSON.parse(new TextDecoder().decode(bytes)), path: dir, dir: Gio.File.new_for_path(dir)};


function walk(w, visit) {
    visit(w);
    for (let c = w.get_first_child(); c; c = c.get_next_sibling())
        walk(c, visit);
}

function rows(window) {
    const out = [];
    walk(window, w => {
        if (w instanceof Adw.PreferencesGroup && w.title)
            out.push({group: w.title});
        else if (w instanceof Adw.ActionRow)
            out.push({title: w.title, subtitle: w.subtitle});
        else if (w instanceof Gtk.Button && w.label)
            out.push({button: w.label});
    });
    return out;
}

const waiting = window => rows(window).some(r => r.button === 'Waiting…');

// No top-level await: promise callbacks from Gio (the button's pkexec run)
// aren't delivered while a module is still evaluating. Run the work from a
// plain main loop instead, like tests/unit/run.js.
async function main() {
    Adw.init();
    const {default: Prefs} = await import(`file://${dir}/prefs.js`);
    const prefs = new Prefs(metadata);
    const window = new Adw.PreferencesWindow();
    const toasts = [];
    window.add_toast = toast => toasts.push(toast.title);
    await prefs.fillPreferencesWindow(window);

    const click = ARGV[1];
    if (click) {
        let button = null;
        walk(window, w => {
            if (w instanceof Gtk.Button && w.label === click)
                button = w;
        });
        if (!button) {
            printerr(`no button labelled ${click}: ${JSON.stringify(rows(window))}`);
            throw new Error('no such button');
        }
        if (GLib.getenv('PROBE_NO_PKEXEC') === '1')
            GLib.setenv('PATH', '/nonexistent', true);
        button.emit('clicked');
        const start = GLib.get_monotonic_time();
        await new Promise(resolve => GLib.timeout_add(GLib.PRIORITY_DEFAULT, 100, () => {
            const done = !waiting(window) || GLib.get_monotonic_time() - start > 20e6;
            if (done)
                resolve();
            return !done;
        }));
    }

    print(JSON.stringify([...rows(window), ...toasts.map(toast => ({toast}))]));
}

const loop = new GLib.MainLoop(null, false);
let code = 1;
main().then(() => (code = 0)).catch(e => printerr(e.stack ?? e)).finally(() => loop.quit());
loop.run();
System.exit(code);
