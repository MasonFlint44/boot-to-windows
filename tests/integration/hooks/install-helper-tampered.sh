# shellcheck shell=bash
# SPDX-License-Identifier: GPL-2.0-or-later
# ROOT_SETUP hook: install the helper as users would, then make one module
# group-writable. The extension must refuse it and use the password route.
set -eu
js=$(mktemp --suffix=.js)
echo "import {terminalCommand} from 'file:///ext/lib/install.js'; print(terminalCommand('/ext'));" > "$js"
cmd=$(gjs -m "$js"); rm -f "$js"
cmd=${cmd//sudo /}
echo "[root-setup] $cmd"
sh -c "$cmd"
chmod g+w /usr/local/libexec/boot-to-windows/lib/state.js
echo "[root-setup] tampered: lib/state.js is group-writable"
