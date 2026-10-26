# shellcheck shell=bash
# shellcheck disable=SC2016  # eval '…' conditions expand later, on purpose
# SPDX-License-Identifier: GPL-2.0-or-later
#
# The settings page's Enable / Remove buttons, run for real as root (the fake
# pkexec's "root" mode stands in for an approved password prompt):
#
#   ./run.sh <ver> ../../extension tests/prefs-buttons.sh

# Fail fast if the fake firmware didn't mount: every later step depends on it.
[ -f "$(efivar_path Boot0001)" ] || fail "fixture efivars missing at $EFIVARS (see the harness warning above)"

NAME='Boot to Windows'
T=$(qs_toggle_js "$NAME")
HELPER=/usr/local/libexec/boot-to-windows/boot-to-windows-helper
INSTALLER=$HOME/.local/share/gnome-shell/extensions/$EXT_UUID/helper/install.js
RULES=/usr/share/polkit-1/rules.d/50-com.masonflint.BootToWindows.rules
POLICY=/usr/share/polkit-1/actions/com.masonflint.BootToWindows.set-next-boot.policy
# As root: on Fedora 39/40 the polkit rules directory is unreadable to users.
rstat() { as_root stat -c "$1" "$2"; }
rexists() { as_root test -e "$1"; }

log_mark
assert_ext_active

log "1. dismissing the password prompt installs nothing"
shim_reset; pkexec_mode dismiss
rows=$(prefs_probe Enable)
assert_contains "$rows" '"title":"One-click status","subtitle":"Off.' "still off"
assert_eq "$(pkexec_calls | cut -c1-20)" "/bin/sh -c install\\ " "one pkexec of a root shell for the whole job"
! rexists "$HELPER" || fail "helper installed despite dismissal"
pass "nothing installed"
case $rows in *'"toast"'*) fail "a dismissed prompt is not an error: $rows" ;; esac
pass "no error shown"

log "1b. pkexec can't even start: the page says why and the button comes back"
shim_reset
rows=$(PROBE_NO_PKEXEC=1 prefs_probe Enable)
assert_contains "$rows" '{"toast":"Failed to execute child process' "error shown"
assert_contains "$rows" '"button":"Enable"' "button usable again"
assert_eq "$(pkexec_calls)" "" "nothing ran"

log "2. Enable installs everything root-owned, with one prompt"
shim_reset; pkexec_mode root
rows=$(prefs_probe Enable)
assert_eq "$(wc -l < "$HARNESS_RUN/pkexec.log")" 1 "one prompt"
assert_contains "$rows" '"title":"One-click status","subtitle":"On.' "page shows it on"
assert_contains "$rows" '"title":"Turn off one-click switching"' "remove offered now"
for f in "$HELPER" "$RULES" "$POLICY" /usr/local/libexec/boot-to-windows/lib/state.js; do
    assert_eq "$(rstat %U "$f")" root "$f root-owned"
done
assert_eq "$(rstat %a "$HELPER")" 755 "helper mode"
assert_eq "$(rstat %a "$RULES")" 644 "rule mode"

log "3. the toggle now goes through the helper"
shim_reset; pkexec_mode allow
shell_eval "$T.emit('clicked', 1)" >/dev/null
wait_until 10 eval "test \"\$(shellctl eval '$T.checked')\" = true" || fail "never armed"
assert_eq "$(pkexec_calls)" "$HELPER windows" "helper route"

log "3b. polkit rule deleted: counted as missing wherever users can see the folder"
as_root mv "$RULES" "$RULES.bak"
rows=$(prefs_probe)
shim_reset
shell_eval "$T.emit('clicked', 1)" >/dev/null
wait_until 10 eval "test \"\$(shellctl eval '$T.checked')\" = false" || fail "never disarmed"
if [ -x "$(dirname "$RULES")" ]; then      # can users look inside rules.d?
    assert_contains "$rows" '"title":"One-click status","subtitle":"Partly installed, so it is not used. Reinstall it."' "partial status"
    assert_contains "$rows" '"button":"Update"' "reinstall offered"
    assert_eq "$(pkexec_calls)" "/usr/bin/efibootmgr --bootnext 0000" "password route, so the suggestion can say why"
else
    # Fedora 39/40: users can't read rules.d, so the rule can't be checked.
    assert_contains "$rows" '"title":"One-click status","subtitle":"On.' "unreadable rule not held against it"
    assert_eq "$(pkexec_calls)" "$HELPER default" "helper still used"
fi
as_root mv "$RULES.bak" "$RULES"
assert_contains "$(prefs_probe)" '"title":"One-click status","subtitle":"On.' "back on"

log "4. Remove takes it all out"
shim_reset; pkexec_mode root
rows=$(prefs_probe Remove)
assert_contains "$rows" '"title":"One-click status","subtitle":"Off.' "page shows it off"
for f in "$HELPER" "$RULES" "$POLICY" /usr/local/libexec/boot-to-windows; do
    ! rexists "$f" || fail "$f still there"
done
pass "helper, policy and rule removed"

log "5. back to the password route"
shim_reset; pkexec_mode allow
shell_eval "$T.emit('clicked', 1)" >/dev/null
wait_until 10 eval "test \"\$(shellctl eval '$T.checked')\" = true" || fail "never armed"
assert_eq "$(pkexec_calls)" "/usr/bin/efibootmgr --bootnext 0001" "efibootmgr route"

log "6. image-based systems: explained, nothing offered, the installer refuses"
as_root touch /run/ostree-booted
rows=$(prefs_probe)
assert_contains "$rows" '"title":"One-click status","subtitle":"Not available: this system' "explained"
case $rows in *'"button":"Enable"'*|*'"title":"Use a terminal instead"'*) fail "install offered on an image-based system" ;; esac
pass "nothing offered"
set +e; out=$(as_root /usr/bin/gjs -m "$INSTALLER" 2>&1); rc=$?; set -e
as_root rm -f /run/ostree-booted
assert_eq "$rc" 1 "installer refuses"
assert_contains "$out" "image-based" "and says why"
! rexists "$HELPER" || fail "installed anyway"

log "7. a failing step reaches the page with the real reason"
# A plain file where the helper's folder goes makes the first step fail.
as_root mkdir -p /usr/local/libexec
as_root sh -c 'echo blocker > /usr/local/libexec/boot-to-windows'
shim_reset; pkexec_mode root
rows=$(prefs_probe Update)
as_root rm -f /usr/local/libexec/boot-to-windows
assert_contains "$rows" '{"toast":"install: cannot create directory' "install's own error shown"
assert_contains "$rows" '"button":"Update"' "button usable again"

log "8. clean logs"
assert_no_log_errors
