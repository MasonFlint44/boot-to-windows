# shellcheck shell=bash
# SPDX-License-Identifier: GPL-2.0-or-later
#
# A root job queue for tests, standing in for an approved polkit prompt
# without sudo, setuid or PAM (which behave differently on CI runners).
# The entrypoint (root) runs rootq_serve in the background; the test user
# calls as_root CMD... and gets CMD's stdout, stderr and exit status.
ROOTQ=${ROOTQ:-/run/harness/rootq}

rootq_serve() {
    # Runs in the background of a `set -e` script: a job failing must not
    # take the queue down with it.
    set +e +u +o pipefail
    mkdir -p "$ROOTQ"; chmod 1777 "$ROOTQ"
    local f id argv
    while :; do
        for f in "$ROOTQ"/*.argv; do
            [ -e "$f" ] || continue
            id=${f%.argv}
            mv "$f" "$id.run" || continue
            mapfile -d '' -t argv < "$id.run"
            "${argv[@]}" > "$id.out" 2> "$id.err" < /dev/null
            echo $? > "$id.rc.tmp"
            chmod 644 "$id.out" "$id.err" "$id.rc.tmp"
            mv "$id.rc.tmp" "$id.rc"
        done
        sleep 0.05
    done
}

as_root() {
    local id; id=$ROOTQ/$$.$RANDOM.$SECONDS
    printf '%s\0' "$@" > "$id.tmp" && mv "$id.tmp" "$id.argv"
    local end=$((SECONDS + 60))
    until [ -e "$id.rc" ]; do
        [ $SECONDS -lt $end ] || { echo "as_root: no answer from the root queue" >&2; return 125; }
        sleep 0.05
    done
    cat "$id.out"; cat "$id.err" >&2
    local rc; rc=$(cat "$id.rc"); rm -f "$id".*
    return "$rc"
}
