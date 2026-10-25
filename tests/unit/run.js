// SPDX-License-Identifier: GPL-2.0-or-later
//
//   gjs -m tests/unit/run.js [name-filter]

import GLib from 'gi://GLib';
import System from 'system';

import {run} from './harness.js';
import './efivars.test.js';
import './state.test.js';
import './writer.test.js';
import './helperCore.test.js';
import './firmware.test.js';
import './presentation.test.js';
import './install.test.js';

// Gio async calls need a running main loop.
const loop = new GLib.MainLoop(null, false);
let failures = 1;
run({filter: ARGV[0] ?? null})
    .then(n => (failures = n))
    .catch(e => logError(e))
    .finally(() => loop.quit());
loop.run();
System.exit(failures === 0 ? 0 : 1);
