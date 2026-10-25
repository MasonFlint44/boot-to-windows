# shellcheck shell=bash
# With STRICT_METADATA=1 and a shell-version list lacking the running major, the
# shell must refuse the extension (OUT_OF_DATE). Proves the version gate is real:
#   STRICT_METADATA=1 ./run.sh 46 fixture-extension selftest/expect-out-of-date.sh
wait_ext_state "$EXT_UUID" OUT_OF_DATE 15
assert_eq "$(shell_eval "$(qs_toggles_js 'Harness Probe').length")" 0 "no toggle when out of date"
