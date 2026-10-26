#!/bin/bash
# SPDX-License-Identifier: GPL-2.0-or-later
# Every integration suite on every GNOME version in metadata.json, strict
# version gate on (the extension must load on its own shell-version list).
#
#   ./test-all.sh [versions...]      default: all of metadata.json's shell-version
set -uo pipefail
cd "$(dirname "$0")" || exit
EXT=../../extension
mapfile -t versions < <(if [ $# -gt 0 ]; then printf '%s\n' "$@"; else
    python3 -c 'import json;print("\n".join(json.load(open("../../extension/metadata.json"))["shell-version"]))'; fi)
suites=("tests/suite.sh|" "tests/prefs-buttons.sh|" "tests/helper.sh|hooks/install-helper.sh" "tests/helper-tampered.sh|hooks/install-helper-tampered.sh")
mkdir -p .work
run_one() {
    local v=$1 s=${2%%|*} hook=${2#*|} name; name=$(basename "$s" .sh)
    if ROOT_SETUP=$hook STRICT_METADATA=1 OUT_DIR="$PWD/.work/out-$v-$name" ./run.sh "$v" "$EXT" "$s" > ".work/$v-$name.log" 2>&1
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
