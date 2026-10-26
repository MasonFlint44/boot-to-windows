#!/bin/bash
# SPDX-License-Identifier: GPL-2.0-or-later
# Every integration suite, plus the harness self-tests, on every GNOME version
# in metadata.json. The real suites run with the strict version gate on (the
# extension must load on its own shell-version list).
#
#   ./test-all.sh [versions...]      default: all of metadata.json's shell-version
set -uo pipefail
cd "$(dirname "$0")" || exit
EXT=../../extension
mapfile -t versions < <(if [ $# -gt 0 ]; then printf '%s\n' "$@"; else
    python3 -c 'import json;print("\n".join(json.load(open("../../extension/metadata.json"))["shell-version"]))'; fi)
# test script | root-setup hook | extension | strict shell-version check
suites=(
    "tests/suite.sh||$EXT|1"
    "tests/prefs-buttons.sh||$EXT|1"
    "tests/helper.sh|hooks/install-helper.sh|$EXT|1"
    "tests/helper-tampered.sh|hooks/install-helper-tampered.sh|$EXT|1"
    # Harness self-tests: the assertions and the version gate can fail.
    "selftest/expect-failures.sh||selftest/broken-extension|0"
    "selftest/expect-out-of-date.sh||selftest/broken-extension|1"
)
mkdir -p .work
run_one() {
    local v=$1 s hook ext strict name
    IFS='|' read -r s hook ext strict <<< "$2"
    name=$(basename "$s" .sh)
    if ROOT_SETUP=$hook STRICT_METADATA=$strict OUT_DIR="$PWD/.work/out-$v-$name" ./run.sh "$v" "$ext" "$s" > ".work/$v-$name.log" 2>&1
    then echo "PASS  GNOME $v  $name"
    else
        echo "FAIL  GNOME $v  $name  (.work/$v-$name.log)"
        grep -v '^\[test\] ok' ".work/$v-$name.log" | tail -25 | sed "s/^/    [$v $name] /"
        return 1
    fi
}
pids=()
for v in "${versions[@]}"; do
    # Build each image once, before its suites run in parallel.
    docker image inspect "btw-gnome:$v" >/dev/null 2>&1 || ./run.sh "$v" "$EXT" >/dev/null 2>&1
    for s in "${suites[@]}"; do run_one "$v" "$s" & pids+=($!); done
done
rc=0; for p in "${pids[@]}"; do wait "$p" || rc=1; done
exit $rc
