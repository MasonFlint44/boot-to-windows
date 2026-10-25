#!/bin/bash
# Container entrypoint (runs as root): set up fixture firmware, install the
# extension under test for user "tester", seed dconf, then hand off to session.sh.
#
# Inputs (mounted/env by run.sh):
#   /ext            extension source dir (read-only); uuid from its metadata.json
#   /test/test.sh   test script, sourced after the shell is ready (with lib.sh)
#   /out            writable dir: logs + artifacts are copied here at the end
#   ENABLE_AT_START=1|0   put the extension in enabled-extensions before start (default 1)
#   SHELL_ARGS      override gnome-shell arguments
#   READY_TIMEOUT   seconds to wait for the shell (default 90)
#   /hooks/root-setup.sh  optional, run as root before the session (ROOT_SETUP= in run.sh)
#   STRICT_METADATA=1  don't add the running major to shell-version (test the real list)
set -euo pipefail
. /opt/harness/efivars.sh

export HARNESS_RUN=/run/harness
mkdir -p "$HARNESS_RUN" /run/user/1000 /out
: > "$HARNESS_RUN/pkexec.log"; : > "$HARNESS_RUN/efibootmgr.log"
chown -R tester:tester "$HARNESS_RUN" /run/user/1000; chmod 700 /run/user/1000

# gnome-shell hard-fails at startup without a *system* bus (loginManager.js,
# timeLimitsManager.js connect to it). A bare dbus-daemon is enough: no logind
# behind it, the shell degrades gracefully when org.freedesktop.login1 is absent.
mkdir -p /run/dbus; rm -f /run/dbus/pid
# systemd's RPM scriptlets leave /run/systemd/seats in the image; its mere existence
# makes loginManager.js pick the logind backend (fatal without logind). Remove it
# so the shell uses LoginManagerDummy.
rm -rf /run/systemd
dbus-daemon --system --fork --nopidfile

GNOME_VERSION=$(gnome-shell --version | awk '{print $3}')
export GNOME_MAJOR=${GNOME_VERSION%%.*}
echo "[harness] $(gnome-shell --version) on $(. /etc/os-release; echo "$PRETTY_NAME")"

# --- fake firmware ----------------------------------------------------------
# run.sh mounts a tmpfs on /sys/firmware with --security-opt systempaths=unconfined
# (Docker otherwise masks /sys/firmware with a read-only tmpfs).
if mkdir -p "$EFIVARS" 2>/dev/null && touch "$EFIVARS/.probe" 2>/dev/null; then
    rm -f "$EFIVARS/.probe"
    if [ -d /fixture-efivars ] && [ -n "$(ls -A /fixture-efivars 2>/dev/null)" ]; then
        cp -a /fixture-efivars/. "$EFIVARS/"
    else
        efivars_default_fixture
    fi
    chown -R tester:tester /sys/firmware/efi
    echo "[harness] fixture efivars at $EFIVARS: $(ls "$EFIVARS" | sed 's/-8be4df61.*//' | tr '\n' ' ')"
else
    echo "[harness] WARNING: $EFIVARS not writable; no fixture firmware (did run.sh add the tmpfs?)"
fi

# --- extension under test ---------------------------------------------------
EXT_UUID=""
if [ -f /ext/metadata.json ]; then
    EXT_UUID=$(gjs -c 'const [ok, b] = imports.gi.GLib.file_get_contents("/ext/metadata.json"); print(JSON.parse(new TextDecoder().decode(b)).uuid);')
    dest=/home/tester/.local/share/gnome-shell/extensions/$EXT_UUID
    mkdir -p "$dest"; cp -a /ext/. "$dest/"
    # Make shell-version include the major under test so version validation can't block
    # loading -- unless STRICT_METADATA=1 (then the committed list is what gets tested).
    [ "${STRICT_METADATA:-0}" = 1 ] || gjs -c "
        const GLib = imports.gi.GLib;
        const p = '$dest/metadata.json';
        const m = JSON.parse(new TextDecoder().decode(GLib.file_get_contents(p)[1]));
        m['shell-version'] = [...new Set([...(m['shell-version'] || []), '$GNOME_MAJOR'])];
        GLib.file_set_contents(p, JSON.stringify(m, null, 2));"
    if [ -d "$dest/schemas" ] && ls "$dest"/schemas/*.gschema.xml >/dev/null 2>&1; then
        glib-compile-schemas "$dest/schemas"
    fi
    chown -R tester:tester /home/tester/.local
fi
export EXT_UUID

# --- optional root-side setup hook (e.g. install /usr/local/libexec/boot-to-windows/<helper>
# or a polkit policy). Tests run as uid 1000 and the pkexec shim does NOT elevate,
# so anything that must be root-owned goes here. Mounted by run.sh from ROOT_SETUP=.
if [ -f /hooks/root-setup.sh ]; then echo "[harness] running root-setup hook"; bash /hooks/root-setup.sh; fi

# --- dconf (compiled offline; no dconf-service needed before start) ----------
enabled="'harness@btw.test'"
[ -n "$EXT_UUID" ] && [ "${ENABLE_AT_START:-1}" = 1 ] && enabled+=", '$EXT_UUID'"
src=/home/tester/.config/dconf-src; mkdir -p "$src" /home/tester/.config/dconf
cat > "$src/00-harness" <<EOF
[org/gnome/shell]
enabled-extensions=[$enabled]
disable-user-extensions=false
welcome-dialog-last-shown-version='999'

[org/gnome/desktop/interface]
enable-animations=false
EOF
dconf compile /home/tester/.config/dconf/user "$src"
chown -R tester:tester /home/tester/.config

set +e
runuser -u tester -- env HARNESS_RUN="$HARNESS_RUN" EXT_UUID="$EXT_UUID" GNOME_MAJOR="$GNOME_MAJOR" \
    XDG_RUNTIME_DIR=/run/user/1000 SHELL_ARGS="${SHELL_ARGS:-}" READY_TIMEOUT="${READY_TIMEOUT:-90}" \
    dbus-run-session -- /opt/harness/session.sh \
    3>&1 4>&2 >"$HARNESS_RUN/session-bus.log" 2>&1   # bus + activated services -> log; session.sh restores 1/2
rc=$?
set -e

cp -a "$HARNESS_RUN"/. /out/ 2>/dev/null || true
[ -d "$EFIVARS" ] && { mkdir -p /out/efivars-final; cp -a "$EFIVARS"/. /out/efivars-final/; }
chmod -R a+rwX /out 2>/dev/null || true
echo "[harness] exit $rc"
exit $rc
