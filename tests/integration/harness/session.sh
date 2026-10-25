#!/bin/bash
# Runs as "tester" inside dbus-run-session: start gnome-shell headless, wait for
# readiness, source the test script with lib.sh, stop the shell.
set -uo pipefail
# entrypoint passes the real stdout/stderr as fds 3/4 (1/2 = session-bus.log)
{ true >&3; } 2>/dev/null && exec 1>&3 2>&4 3>&- 4>&-
cd ~
# shellcheck source=lib.sh
. /opt/harness/lib.sh

export XDG_SESSION_TYPE=wayland
args=${SHELL_ARGS:-"--headless --no-x11 --virtual-monitor 1280x720"}
t0=$(date +%s.%N)
# shellcheck disable=SC2086
gnome-shell $args > "$HARNESS_RUN/shell.log" 2>&1 &
SHELL_PID=$!
echo "[harness] gnome-shell $args (pid $SHELL_PID)"

ready_fail() {
    echo "[harness] NOT READY: $1"; echo "----- shell.log (tail) -----"; tail -40 "$HARNESS_RUN/shell.log"
    kill "$SHELL_PID" 2>/dev/null; exit 90
}
deadline=$((SECONDS + READY_TIMEOUT))
# 1) shell on the bus  2) harness extension ACTIVE (=> Eval allowed)  3) startup animation done
until shellctl version >/dev/null 2>&1; do
    kill -0 "$SHELL_PID" 2>/dev/null || ready_fail "gnome-shell exited ($(wait "$SHELL_PID"; echo $?))"
    [ $SECONDS -lt $deadline ] || ready_fail "org.gnome.Shell never appeared"
    sleep 0.25
done
until [ "$(ext_state harness@btw.test)" = ACTIVE ]; do
    [ $SECONDS -lt $deadline ] || ready_fail "harness extension not ACTIVE ($(ext_state harness@btw.test))"
    sleep 0.25
done
until [ "$(shellctl eval 'Main.layoutManager._startingUp' 2>/dev/null)" = false ]; do
    [ $SECONDS -lt $deadline ] || ready_fail "Main.layoutManager still starting up"
    sleep 0.25
done
elapsed=$(awk -v a="$t0" -v b="$(date +%s.%N)" 'BEGIN{printf "%.1f", b-a}')
echo "[harness] READY: GNOME Shell $(shellctl version) in ${elapsed}s (Eval ok)"

if [ -f /test/test.sh ]; then
    ( set -e; . /test/test.sh ); rc=$?
else
    echo "[harness] no /test/test.sh; shell came up, nothing else to do"; rc=0
fi

kill -TERM "$SHELL_PID" 2>/dev/null
for _ in $(seq 40); do kill -0 "$SHELL_PID" 2>/dev/null || break; sleep 0.25; done
kill -KILL "$SHELL_PID" 2>/dev/null
if [ $rc = 0 ]; then echo "[harness] TEST PASSED"; else echo "[harness] TEST FAILED (rc=$rc)"; fi
exit $rc
