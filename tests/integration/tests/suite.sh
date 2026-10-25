# shellcheck shell=bash
# SPDX-License-Identifier: GPL-2.0-or-later
#
# Integration suite for the real extension, run inside a real headless GNOME
# Shell. Sourced by session.sh after the shell is READY; set -e is on.
#
#   ./run.sh <45..50> ../../extension tests/suite.sh
#
# Default fixture: Boot0000 "ubuntu" (default), Boot0001 "Windows Boot Manager",
# no BootNext. No helper installed, so writes go to pkexec efibootmgr.

NAME='Boot to Windows'
T=$(qs_toggle_js "$NAME")
IND="Main.panel.statusArea.quickSettings._indicators.get_children().find(c => c._toggle?.title === \"$NAME\")"
NOTES='Main.messageTray.getSources().flatMap(s => s.notifications).filter(n => n.title === "Boot to Windows").map(n => n.body ?? n.bannerBodyText ?? "")'

checked()  { shell_eval "$T.checked"; }
subtitle() { shell_eval "$T.subtitle"; }
icon_on()  { shell_eval "$IND._icon.visible"; }
notes()    { shell_eval "$NOTES.length"; }
click()    { shell_eval "$T.emit('clicked', 1)" >/dev/null; }
open_qs()  { shell_eval 'Main.panel.statusArea.quickSettings.menu.open(false)' >/dev/null; }
close_qs() { shell_eval 'Main.panel.statusArea.quickSettings.menu.close(false)' >/dev/null; }
idle()     { wait_until 10 eval 'test "$(shellctl eval "$T._busy")" = false' || fail "still busy"; }
wait_checked() { wait_until 10 eval "test \"\$(shellctl eval '$T.checked')\" = $1" || fail "checked never became $1"; }

log_mark

log "1. loads, one toggle, honest initial state"
assert_ext_active
assert_eq "$(shell_eval "$(qs_toggles_js "$NAME").length")" 1 "exactly one toggle"
wait_until 5 eval 'test "$(shellctl eval "$T.reactive")" = true' || fail "toggle never became clickable"
assert_eq "$(checked)" false "unchecked with no BootNext"
assert_eq "$(subtitle)" null "no subtitle when nothing is armed"
assert_eq "$(icon_on)" false "top-bar icon hidden"
assert_eq "$(shell_eval "$T.menu._headerSubtitle?.text ?? $T.menu._headerSubtitle?.get_text?.()")" '"ubuntu (as usual)"' "menu header names the default"

log "2. click arms Windows through pkexec efibootmgr, verified by re-read"
shim_reset
click
wait_checked true
assert_eq "$(bootnext)" 0001 "BootNext = Windows entry"
assert_eq "$(pkexec_calls)" "/usr/bin/efibootmgr --bootnext 0001" "pkexec argv"
assert_eq "$(subtitle)" '"Next restart"' "subtitle"
assert_eq "$(icon_on)" true "top-bar icon shown while armed"

log "3. click again disarms by pointing at the default (no --delete-bootnext)"
shim_reset
click
wait_checked false
assert_eq "$(bootnext)" 0000 "BootNext = default entry"
assert_eq "$(pkexec_calls)" "/usr/bin/efibootmgr --bootnext 0000" "pkexec argv"
assert_eq "$(subtitle)" null "back to no subtitle"
assert_eq "$(icon_on)" false "icon hidden again"

log "4. double click while busy runs exactly one write"
shim_reset; pkexec_mode slow
shell_eval "($T.emit('clicked', 1), $T.emit('clicked', 1), $T.emit('clicked', 1), null)" >/dev/null
assert_eq "$(subtitle)" '"Waiting…"' "busy subtitle"
assert_eq "$(shell_eval "$T.reactive")" false "not clickable while busy"
idle
assert_eq "$(wc -l < "$HARNESS_RUN/pkexec.log")" 1 "one pkexec call"
assert_eq "$(checked)" true "armed"
assert_eq "$(bootnext)" 0001 "BootNext = Windows"

log "5. a refresh during a write cannot show stale state"
shim_reset; pkexec_mode slow
click                                    # disarm, slowly
open_qs; close_qs                        # triggers refresh mid-write
idle
assert_eq "$(checked)" false "final state is the write's verified result"
assert_eq "$(bootnext)" 0000 "BootNext = default"
shim_reset

log "6. dismissing the password dialog: no write, no notification"
before=$(notes)
pkexec_mode dismiss
click
idle
assert_eq "$(checked)" false "still unchecked"
assert_eq "$(bootnext)" 0000 "BootNext untouched"
assert_eq "$(efibootmgr_calls)" "" "efibootmgr never ran"
assert_eq "$(notes)" "$before" "no notification for a dismissed prompt"
assert_eq "$(shell_eval "$T.reactive")" true "clickable again"
shim_reset

log "7. not authorized: notification, state unchanged"
pkexec_mode deny
click
idle
assert_eq "$(checked)" false "still unchecked"
wait_until 5 eval 'test "$(notes)" -gt "$before"' || fail "no notification"
assert_contains "$(shell_eval "$NOTES.at(-1)")" "Not authorized" "notification says why"
shim_reset

log "8. efibootmgr fails: notification, no false success"
before=$(notes)
efibootmgr_mode fail
click
idle
assert_eq "$(checked)" false "not checked after a failed write"
wait_until 5 eval 'test "$(notes)" -gt "$before"' || fail "no notification"
shim_reset

log "9. external change is picked up when Quick Settings opens"
efivar_write BootNext "$(u16le 0001)"
assert_eq "$(checked)" false "not yet re-read"
open_qs
wait_checked true
assert_eq "$(icon_on)" true "icon follows"
close_qs
efivar_write BootNext "$(u16le 0000)"
open_qs; wait_checked false; close_qs

log "10. BootNext set to another entry by someone else"
efivar_boot_entry 0003 'UEFI:CD/DVD Drive' '\EFI\Boot\bootx64.efi'
efivar_write BootNext "$(u16le 0003)"
open_qs
wait_until 5 eval 'test "$(subtitle)" = "\"Next: UEFI:CD/DVD Drive\""' || fail "subtitle: $(subtitle)"
assert_eq "$(checked)" false "not checked for another entry"
assert_eq "$(shell_eval "$T._disarmItem.visible")" true "can undo it"
close_qs
efivar_write BootNext "$(u16le 0000)"
efivar_delete Boot0003

log "11. nothing to switch to: toggle hidden, comes back when it applies"
efivar_write BootOrder "$(u16list_hex 0001,0000)"   # Windows already default
open_qs
wait_until 5 eval 'test "$(shellctl eval "$T.visible")" = false' || fail "still visible when Windows is default"
close_qs
efivar_write BootOrder "$(u16list_hex 0000,0001)"
efivar_delete Boot0001                               # no Windows at all
open_qs
wait_until 5 eval 'test "$(shellctl eval "$T.visible")" = false' || fail "still visible with no Windows"
close_qs
efivar_boot_entry 0001 'Windows Boot Manager' '\EFI\Microsoft\Boot\bootmgfw.efi'
open_qs
wait_until 5 eval 'test "$(shellctl eval "$T.visible")" = true' || fail "never came back"
close_qs

log "12. Restart to Windows… arms, then hands off to GNOME's restart dialog"
shim_reset
# Stub the session restart (no gnome-session in the container) on the
# SystemActions singleton the extension uses, and mark restart available.
shell_eval "(async () => {
    const SA = await import('resource:///org/gnome/shell/misc/systemActions.js');
    const sa = SA.getDefault();
    global._btwRestarts = 0;
    sa.activateRestart = () => { global._btwRestarts++; };
    Object.defineProperty(sa, 'canRestart', {get: () => true, configurable: true});
})(), null" >/dev/null
sleep 0.5
shell_eval "$T._render()" >/dev/null
assert_eq "$(shell_eval "$T._restartItem.getSensitive?.() ?? $T._restartItem.sensitive")" true "menu item enabled"
shell_eval "$T._restartItem.activate(null)" >/dev/null
wait_until 10 eval 'test "$(shellctl eval global._btwRestarts)" = 1' || fail "restart dialog never requested"
assert_eq "$(bootnext)" 0001 "armed before restart"
assert_eq "$(pkexec_calls)" "/usr/bin/efibootmgr --bootnext 0001" "one write"

log "13. restart is NOT requested if arming fails"
shim_reset
shell_eval "$T._write('default')" >/dev/null; idle
shim_reset; pkexec_mode dismiss
shell_eval "$T._restartItem.activate(null)" >/dev/null
idle
assert_eq "$(shell_eval global._btwRestarts)" 1 "no second restart"
shim_reset

log "14. disable mid-write: no errors from a destroyed toggle"
pkexec_mode slow
click
ext_disable "$EXT_UUID"; wait_ext_state "$EXT_UUID" INACTIVE
sleep 4                                  # let the slow pkexec finish
assert_eq "$(shell_eval "$(qs_toggles_js "$NAME").length")" 0 "toggle gone"
shim_reset
ext_enable "$EXT_UUID"; wait_ext_state "$EXT_UUID" ACTIVE

log "15. disable/enable cycles leave exactly one toggle and one indicator"
for i in 1 2 3; do
    ext_disable "$EXT_UUID"; wait_ext_state "$EXT_UUID" INACTIVE
    assert_eq "$(shell_eval "$(qs_toggles_js "$NAME").length")" 0 "cycle $i: gone"
    ext_enable "$EXT_UUID"; wait_ext_state "$EXT_UUID" ACTIVE
    assert_eq "$(shell_eval "$(qs_toggles_js "$NAME").length")" 1 "cycle $i: one toggle"
done
assert_eq "$(shell_eval "Main.panel.statusArea.quickSettings._indicators.get_children().filter(c => c._toggle?.title === \"$NAME\").length")" 1 "one indicator"

log "16. clean logs"
assert_eq "$(shellctl errors "$EXT_UUID")" "" "GetExtensionErrors empty"
assert_no_log_errors
if grep -n "already disposed\|has been already disposed" "$HARNESS_RUN/shell.log"; then
    fail "disposed-object warnings in the shell log"
fi
pass "no disposed-object warnings"

log "17. preferences page without the helper offers the install command"
rows=$(WAYLAND_DISPLAY=${WAYLAND_DISPLAY:-wayland-0} GI_TYPELIB_PATH=/usr/lib64/gnome-shell/girepository-1.0 LD_LIBRARY_PATH=/usr/lib64/gnome-shell \
    gjs -m /tests/prefs-probe.js "$HOME/.local/share/gnome-shell/extensions/$EXT_UUID") || fail "prefs probe failed"
assert_contains "$rows" '"title":"Helper","subtitle":"Not installed"' "helper status"
assert_contains "$rows" '"title":"Install or update","subtitle":"sudo install -d' "install command shown"
case $rows in *'"title":"Uninstall"'*) fail "uninstall offered with nothing installed" ;; esac
pass "no uninstall row"
