# shellcheck shell=bash
# Prototype test for fixture-extension/ (harness-probe@btw.test). Sourced by
# session.sh after the shell is READY, with lib.sh helpers loaded; set -e is on.
T=$(qs_toggle_js 'Harness Probe')

log "1. extension loaded"
assert_ext_active
assert_eq "$(shell_eval "$(qs_toggles_js 'Harness Probe').length")" 1 "exactly one 'Harness Probe' toggle"

log "2. initial state from fixture efivars (no BootNext)"
assert_eq "$(shell_eval "$T.checked")" false "toggle unchecked"
assert_eq "$(shell_eval "$T.subtitle")" '"BootNext: none"' "subtitle says none"

log "3. click -> pkexec efibootmgr --bootnext 0001"
shim_reset
shell_eval "$T.emit('clicked', 1)" >/dev/null
wait_until 10 eval 'test -n "$(bootnext)"' || fail "BootNext never written"
assert_eq "$(bootnext)" 0001 "fixture BootNext = 0001"
assert_eq "$(pkexec_calls)" "/usr/bin/efibootmgr --bootnext 0001" "pkexec argv"
assert_eq "$(efibootmgr_calls)" "--bootnext 0001" "efibootmgr argv"
wait_until 5 eval 'test "$(shellctl eval "$T.checked")" = true' || fail "toggle not checked after write"
assert_eq "$(shell_eval "$T.subtitle")" '"BootNext: Boot0001"' "subtitle reflects BootNext"

log "4. external change + method call through Eval"
efibootmgr --delete-bootnext >/dev/null
assert_eq "$(shell_eval "$T.sync()")" null "sync() returns null (no BootNext)"
assert_eq "$(shell_eval "$T.checked")" false "unchecked after sync()"

log "5. auth dialog dismissed -> no write, error surfaced"
shim_reset; pkexec_mode dismiss
shell_eval "$T.emit('clicked', 1)" >/dev/null
wait_until 5 grep -q bootnext "$HARNESS_RUN/pkexec.log" || fail "pkexec not invoked"
wait_until 5 eval 'test "$(shellctl eval "$T.subtitle" | cut -c2-11)" = "failed (12"' || fail "no error subtitle: $(shellctl eval "$T.subtitle")"
assert_eq "$(bootnext || true)" "" "BootNext untouched"
assert_eq "$(efibootmgr_calls)" "" "efibootmgr never ran"
shim_reset

log "6. disable/enable cycles"
for i in 1 2 3; do
    ext_disable "$EXT_UUID"; wait_ext_state "$EXT_UUID" INACTIVE
    assert_eq "$(shell_eval "$(qs_toggles_js 'Harness Probe').length")" 0 "cycle $i: toggle gone"
    ext_enable "$EXT_UUID"; wait_ext_state "$EXT_UUID" ACTIVE
    assert_eq "$(shell_eval "$(qs_toggles_js 'Harness Probe').length")" 1 "cycle $i: one toggle back"
done

log "7. clean logs"
assert_eq "$(shellctl errors "$EXT_UUID")" "" "GetExtensionErrors empty"
assert_no_log_errors
