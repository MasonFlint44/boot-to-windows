# shellcheck shell=bash
# SPDX-License-Identifier: GPL-2.0-or-later
#
# The one-click helper route, plus the preferences page. Run with the helper
# installed by the same command the prefs page shows users:
#
#   ROOT_SETUP=hooks/install-helper.sh ./run.sh <ver> ../../extension tests/helper.sh
#
# (The fake pkexec doesn't elevate, so the helper runs as the test user; that
# is enough to prove the extension calls it, and that it works end to end.)

NAME='Boot to Windows'
T=$(qs_toggle_js "$NAME")
HELPER=/usr/local/libexec/boot-to-windows/boot-to-windows-helper
EXT_DIR=$HOME/.local/share/gnome-shell/extensions/$EXT_UUID
wait_checked() { wait_until 10 eval "test \"\$(shellctl eval '$T.checked')\" = $1" || fail "checked never became $1"; }
prefs_rows() { WAYLAND_DISPLAY=${WAYLAND_DISPLAY:-wayland-0} GI_TYPELIB_PATH=/usr/lib64/gnome-shell/girepository-1.0 LD_LIBRARY_PATH=/usr/lib64/gnome-shell gjs -m /tests/prefs-probe.js "$EXT_DIR" 2>"$HARNESS_RUN/prefs.err"; }

log_mark

log "1. helper installed root-owned by the prefs page's command"
assert_eq "$(stat -c '%U %a' $HELPER)" "root 755" "helper owner/mode"
assert_eq "$(stat -c '%U %a' /usr/local/libexec/boot-to-windows/lib/state.js)" "root 644" "module owner/mode"
assert_ext_active

log "2. click goes through the helper with only a verb"
shim_reset
shell_eval "$T.emit('clicked', 1)" >/dev/null
wait_checked true
assert_eq "$(pkexec_calls)" "$HELPER windows" "pkexec argv"
assert_eq "$(efibootmgr_calls)" "--bootnext 0001" "helper picked the Windows entry itself"
assert_eq "$(bootnext)" 0001 "BootNext"

log "3. disarm through the helper"
shim_reset
shell_eval "$T.emit('clicked', 1)" >/dev/null
wait_checked false
assert_eq "$(pkexec_calls)" "$HELPER default" "pkexec argv"
assert_eq "$(bootnext)" 0000 "BootNext = default"

log "4. helper refuses anything else"
set +e
out=$("$HELPER" --bootnext 0003 2>&1); rc=$?
set -e
assert_eq "$rc" 2 "usage exit code"
assert_contains "$out" "usage" "usage message"

log "5. preferences page builds and reports the install"
rows=$(prefs_rows) || fail "prefs probe failed: $(cat "$HARNESS_RUN/prefs.err")"
echo "$rows"
assert_contains "$rows" '"title":"Windows entry","subtitle":"Windows Boot Manager (Boot0001)"' "windows entry row"
assert_contains "$rows" '"title":"Default entry","subtitle":"ubuntu (Boot0000)"' "default entry row"
assert_contains "$rows" '"title":"Helper","subtitle":"Installed"' "helper status row"
assert_contains "$rows" '"title":"Uninstall","subtitle":"sudo rm -rf /usr/local/libexec/boot-to-windows && sudo rm -f' "uninstall command shown"
case $rows in *'"title":"Install or update"'*) fail "install offered although installed" ;; esac
pass "no install row when installed"

log "6. clean logs"
assert_eq "$(shellctl errors "$EXT_UUID")" "" "GetExtensionErrors empty"
assert_no_log_errors
