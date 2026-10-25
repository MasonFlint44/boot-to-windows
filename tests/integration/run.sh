#!/bin/bash
# run.sh <gnome-major> <extension-dir> [test-script]
#   Builds btw-gnome:<major> if missing (REBUILD=1 forces), then runs real
#   gnome-shell headless in it with the extension installed and the test sourced.
# Env: DOCKER (default: docker on PATH, else /usr/local/bin/docker)
#      OUT_DIR (default: tests/integration/.work/out-<major>)  logs + final efivars
#      FIXTURE_EFIVARS=dir  seed efivars from a dir of real-format files instead of the default
#      ENABLE_AT_START=0    start with the extension disabled (tests enable it via D-Bus)
#      ROOT_SETUP=file.sh   run as root in the container before the session (install helpers)
#      STRICT_METADATA=1    don't patch shell-version (verify the committed list)
#      SHELL_ARGS, READY_TIMEOUT  passed through (see harness/entrypoint.sh)
set -euo pipefail
HERE=$(cd "$(dirname "$0")" && pwd)
DOCKER=${DOCKER:-$(command -v docker || echo /usr/local/bin/docker)}

usage() { echo "usage: $0 <45|46|47|48|49|50> <extension-dir> [test-script]" >&2; exit 2; }
[ $# -ge 2 ] || usage
major=$1; ext=$(cd "$2" && pwd); test=${3:-}
declare -A FEDORA_FOR_GNOME=([45]=39 [46]=40 [47]=41 [48]=42 [49]=43 [50]=44)
fedora=${FEDORA_FOR_GNOME[$major]:-}; [ -n "$fedora" ] || usage
[ -f "$ext/metadata.json" ] || { echo "no metadata.json in $ext" >&2; exit 2; }

image=btw-gnome:$major
if [ "${REBUILD:-0}" = 1 ] || ! "$DOCKER" image inspect "$image" >/dev/null 2>&1; then
    echo "[run] building $image from fedora:$fedora"
    "$DOCKER" build -q --build-arg FEDORA="$fedora" --build-arg ARCHIVE="${ARCHIVE:-0}" -t "$image" "$HERE" >/dev/null
fi

out=${OUT_DIR:-$HERE/.work/out-$major}
rm -rf "$out"; mkdir -p "$out"
# SC2054: commas belong to docker --mount syntax, not array separators
# shellcheck disable=SC2054
# The commas below are docker --mount syntax, not array separators.
# shellcheck disable=SC2054
args=(--rm --init
      --security-opt systempaths=unconfined          # unmask /sys/firmware ...
      --security-opt apparmor=unconfined             # docker-default AppArmor denies writes under /sys/firmware/** (Ubuntu hosts, CI)
      --mount type=tmpfs,destination=/sys/firmware   # ... and put a writable tmpfs there for fixture efivars
      -v "$ext:/ext:ro" -v "$out:/out"
      -e LANG=C.UTF-8                                # real sessions are UTF-8; C locale mangles "…" in Eval output
      -e ENABLE_AT_START="${ENABLE_AT_START:-1}" -e STRICT_METADATA="${STRICT_METADATA:-0}" -e READY_TIMEOUT="${READY_TIMEOUT:-90}")
[ -n "${SHELL_ARGS:-}" ] && args+=(-e SHELL_ARGS="$SHELL_ARGS")
[ -n "$test" ] && args+=(-v "$(cd "$(dirname "$test")" && pwd)/$(basename "$test"):/test/test.sh:ro")
# The test's directory too, for helper files it uses (e.g. prefs-probe.js).
[ -n "$test" ] && args+=(-v "$(cd "$(dirname "$test")" && pwd):/tests:ro")
[ -n "${ROOT_SETUP:-}" ] && args+=(-v "$(cd "$(dirname "$ROOT_SETUP")" && pwd)/$(basename "$ROOT_SETUP"):/hooks/root-setup.sh:ro")
[ -n "${FIXTURE_EFIVARS:-}" ] && args+=(-v "$(cd "$FIXTURE_EFIVARS" && pwd):/fixture-efivars:ro")

start=$SECONDS
set +e
"$DOCKER" run "${args[@]}" --name "btw-gnome-$major-$$" "$image" 2>&1 | tee "$out/run.log"
rc=${PIPESTATUS[0]}
set -e
echo "[run] GNOME $major: exit $rc in $((SECONDS - start))s (logs: $out)"
exit "$rc"
