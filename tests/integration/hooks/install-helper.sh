# shellcheck shell=bash
# SPDX-License-Identifier: GPL-2.0-or-later
# ROOT_SETUP hook: install the one-click helper using the exact command the
# preferences page shows users (minus `sudo`, since this already runs as root).
set -eu
js=$(mktemp --suffix=.js)
echo "import {terminalCommand} from 'file:///ext/lib/install.js'; print(terminalCommand('/ext'));" > "$js"
cmd=$(gjs -m "$js"); rm -f "$js"
cmd=${cmd//sudo /}
echo "[root-setup] $cmd"
sh -c "$cmd"
