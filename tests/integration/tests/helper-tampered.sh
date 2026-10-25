# shellcheck shell=bash
# SPDX-License-Identifier: GPL-2.0-or-later
#
# A helper install with one group-writable module must not be used:
#
#   ROOT_SETUP=hooks/install-helper-tampered.sh ./run.sh <ver> ../../extension tests/helper-tampered.sh

NAME='Boot to Windows'
T=$(qs_toggle_js "$NAME")
EXT_DIR=$HOME/.local/share/gnome-shell/extensions/$EXT_UUID

log "1. falls back to the password route"
assert_ext_active
shim_reset
shell_eval "$T.emit('clicked', 1)" >/dev/null
wait_until 10 eval "test \"\$(shellctl eval '$T.checked')\" = true" || fail "never armed"
assert_eq "$(pkexec_calls)" "/usr/bin/efibootmgr --bootnext 0001" "helper skipped"

log "2. preferences page says it is not trusted and offers a reinstall"
rows=$(WAYLAND_DISPLAY=${WAYLAND_DISPLAY:-wayland-0} GI_TYPELIB_PATH=/usr/lib64/gnome-shell/girepository-1.0 LD_LIBRARY_PATH=/usr/lib64/gnome-shell gjs -m /tests/prefs-probe.js "$EXT_DIR") || fail "prefs probe failed"
assert_contains "$rows" '"title":"Helper","subtitle":"Found, but not root-owned. It will not be used. Reinstall it."' "untrusted status"
assert_contains "$rows" '"title":"Install or update","subtitle":"sudo install -d' "install command shown"
assert_no_log_errors
