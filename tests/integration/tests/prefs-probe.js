// SPDX-License-Identifier: GPL-2.0-or-later
//
// Builds the extension's real preferences page with GNOME's own prefs
// framework (loaded from the Extensions app's gresource) and prints every
// row as JSON: [{title, subtitle}].
//
//   gjs -m prefs-probe.js <installed extension dir>

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

Adw.init();
const {default: Prefs} = await import(`file://${dir}/prefs.js`);
const prefs = new Prefs(metadata);
const window = new Adw.PreferencesWindow();
await prefs.fillPreferencesWindow(window);

const rows = [];
(function walk(w) {
    if (w instanceof Adw.PreferencesGroup && w.title)
        rows.push({group: w.title});
    if (w instanceof Adw.ActionRow)
        rows.push({title: w.title, subtitle: w.subtitle});
    for (let c = w.get_first_child(); c; c = c.get_next_sibling())
        walk(c);
})(window);

print(JSON.stringify(rows));
void Gtk;
System.exit(0);
