# shellcheck shell=bash
# Harness self-test: proves the assertions can fail. Run with selftest/broken-extension:
#   ./run.sh <major> selftest/broken-extension selftest/expect-failures.sh
log "broken extension must be ERROR, with errors reported both ways"
wait_ext_state "$EXT_UUID" ERROR 15
errs=$(shellctl errors "$EXT_UUID"); log "GetExtensionErrors: $errs"
assert_contains "$errs" "deliberately failed" "GetExtensionErrors carries the exception"
if ( assert_ext_active "$EXT_UUID" ) >/dev/null 2>&1; then fail "assert_ext_active passed on a broken extension"; fi
pass "assert_ext_active rejects it"
e=$(log_errors_for "$EXT_UUID"); log "log_errors_for:"; printf '%s\n' "$e" | head -6
[ -n "$e" ] || fail "log scanner missed the exception"
if ( assert_no_log_errors ) >/dev/null 2>&1; then fail "assert_no_log_errors passed"; fi
pass "assert_no_log_errors rejects it"

log "Eval must be refused once unsafe mode is off"
ext_disable harness@btw.test; wait_ext_state harness@btw.test INACTIVE
out=$(shellctl eval '1+1') && rc=0 || rc=$?
log "Eval with unsafe_mode=false -> rc=$rc out='$out'"
[ $rc != 0 ] || fail "Eval succeeded without unsafe mode"
pass "Eval gated on unsafe mode"
ext_enable harness@btw.test; wait_ext_state harness@btw.test ACTIVE
assert_eq "$(shell_eval '1+1')" 2 "Eval back after re-enabling harness"
