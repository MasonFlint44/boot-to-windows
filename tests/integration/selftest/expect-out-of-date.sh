# shellcheck shell=bash
# shellcheck disable=SC2016  # eval '…' conditions expand later, on purpose
# With STRICT_METADATA=1 and a shell-version list lacking the running major, the
# shell should refuse to load the extension (OUT_OF_DATE). Checks that the
# version gate the suites rely on actually works:
#   STRICT_METADATA=1 ./run.sh <major> selftest/broken-extension selftest/expect-out-of-date.sh
wait_ext_state "$EXT_UUID" OUT_OF_DATE 15
assert_eq "$(shellctl errors "$EXT_UUID")" "" "never loaded, so never failed"
