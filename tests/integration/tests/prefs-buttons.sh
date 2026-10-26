# shellcheck shell=bash
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
RULES=/usr/share/polkit-1/rules.d/50-com.masonflint.BootToWindows.rules
POLICY=/usr/share/polkit-1/actions/com.masonflint.BootToWindows.set-next-boot.policy
# As root: on Fedora 39/40 the polkit rules directory is unreadable to users.
rstat() { sudo -n stat -c "$1" "$2"; }
rexists() { sudo -n test -e "$1"; }

log_mark
assert_ext_active

log "1. dismissing the password prompt installs nothing"
shim_reset; pkexec_mode dismiss
rows=$(prefs_probe Enable)
assert_contains "$rows" '"title":"One-click status","subtitle":"Off.' "still off"
assert_eq "$(pkexec_calls | cut -c1-20)" "/bin/sh -c install\\ " "one pkexec of /bin/sh for the whole job"
! rexists "$HELPER" || fail "helper installed despite dismissal"
pass "nothing installed"

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
wait_until 10 eval "test \"\$(shellctl eval '$T.checked')\" = false" || fail "never disarmed"
assert_eq "$(pkexec_calls)" "/usr/bin/efibootmgr --bootnext 0000" "efibootmgr route"

log "6. clean logs"
assert_no_log_errors
