# shellcheck shell=bash
# shellcheck disable=SC2016  # eval '…' conditions expand later, on purpose
# SPDX-License-Identifier: GPL-2.0-or-later
#
# The one-click helper route, plus the preferences page. Run with the helper
# installed by the same command the prefs page shows users:
#
#   ROOT_SETUP=hooks/install-helper.sh ./run.sh <ver> ../../extension tests/helper.sh
#
# The fake pkexec doesn't elevate, so the helper runs as the test user. That's
# enough to check the extension calls it and that it works.

# Fail fast if the fake firmware didn't mount: every later step depends on it.
[ -f "$(efivar_path Boot0001)" ] || fail "fixture efivars missing at $EFIVARS (see the harness warning above)"

NAME='Boot to Windows'
T=$(qs_toggle_js "$NAME")
HELPER=/usr/local/libexec/boot-to-windows/boot-to-windows-helper
wait_checked() { wait_until 10 eval "test \"\$(shellctl eval '$T.checked')\" = $1" || fail "checked never became $1"; }

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
rows=$(prefs_probe)
echo "$rows"
assert_contains "$rows" '"title":"Windows entry","subtitle":"Windows Boot Manager (Boot0001)"' "windows entry row"
assert_contains "$rows" '"title":"Default entry","subtitle":"ubuntu (Boot0000)"' "default entry row"
assert_contains "$rows" '"title":"One-click status","subtitle":"On. Administrators at this computer can switch without a password."' "status row"
assert_contains "$rows" '"title":"Turn off one-click switching"' "remove offered"
assert_contains "$rows" '"title":"Remove","subtitle":"sudo gjs -m ~/.local/share/gnome-shell/extensions/boot-to-windows@masonflint.com/helper/install.js remove"' "short terminal remove command"
case $rows in *'"title":"Enable one-click switching"'*|*'"title":"Update the helper"'*) fail "install offered although installed" ;; esac
pass "no enable/update when installed"

log "6. no one-click suggestion when the helper did the work"
assert_eq "$(shell_eval "Main.messageTray.getSources().flatMap(s => s.notifications).filter(n => n.title === 'Skip the password next time?').length")" 0 "not suggested"

log "7. the terminal remove command takes it all out"
as_root gjs -m "$HOME/.local/share/gnome-shell/extensions/$EXT_UUID/helper/install.js" remove >/dev/null
for f in /usr/local/libexec/boot-to-windows /usr/share/polkit-1/actions/com.masonflint.BootToWindows.set-next-boot.policy \
         /usr/share/polkit-1/rules.d/50-com.masonflint.BootToWindows.rules; do
    ! as_root test -e "$f" || fail "$f still there"
done
pass "removed"
set +e; out=$(gjs -m "$HOME/.local/share/gnome-shell/extensions/$EXT_UUID/helper/install.js" 2>&1); rc=$?; set -e
assert_eq "$rc" 1 "refuses to run without root"
assert_contains "$out" "run this with sudo" "says why"

log "8. clean logs"
assert_eq "$(shellctl errors "$EXT_UUID")" "" "GetExtensionErrors empty"
assert_no_log_errors
