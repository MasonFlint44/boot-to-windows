# shellcheck shell=bash
# Helpers available to test scripts (sourced before /test/test.sh).
# Env: EXT_UUID (extension under test), GNOME_MAJOR, HARNESS_RUN.
# shellcheck source=efivars.sh
. /opt/harness/efivars.sh

shellctl() { gjs -m /opt/harness/shellctl.js "$@"; }

log()  { echo "[test] $*"; }
fail() { echo "[test] FAIL: $*" >&2; exit 1; }
pass() { echo "[test] ok: $*"; }

assert_eq() { [ "$1" = "$2" ] || fail "${3:-assert_eq}: expected '$2', got '$1'"; pass "${3:-$2}"; }
assert_contains() { case $1 in *"$2"*) pass "${3:-contains $2}" ;; *) fail "${3:-assert_contains}: '$2' not in '$1'" ;; esac; }

# shell_eval JS -> JSON-stringified result (fails the test if Eval reports an exception)
shell_eval() { local out; out=$(shellctl eval "$1") || fail "Eval threw: $out  <- $1"; printf '%s\n' "$out"; }

ext_state() { shellctl state "$1" | awk '{print $2}'; }
ext_enable() { shellctl enable "$1" >/dev/null || fail "EnableExtension($1) returned false"; }
ext_disable() { shellctl disable "$1" >/dev/null || fail "DisableExtension($1) returned false"; }

# wait_until TIMEOUT_S CMD... : poll until CMD succeeds
wait_until() {
    local t=$1; shift; local end=$((SECONDS + t))
    until "$@"; do [ $SECONDS -lt $end ] || return 1; sleep 0.2; done
}
_state_is() { [ "$(ext_state "$1")" = "$2" ]; }
wait_ext_state() { wait_until "${3:-10}" _state_is "$1" "$2" || fail "$1 never reached $2 (now $(ext_state "$1"))"; pass "$1 is $2"; }

assert_ext_active() {
    local uuid=${1:-$EXT_UUID}
    wait_ext_state "$uuid" ACTIVE 15
    local errs; errs=$(shellctl errors "$uuid")
    [ -z "$errs" ] || fail "GetExtensionErrors($uuid): $errs"
}

# Shell log scanning. log_mark stores the current line count; log_errors_for prints
# JS ERROR / JS WARNING / CRITICAL blocks (message + stack) that mention UUID.
log_mark() { LOG_MARK=$(wc -l < "$HARNESS_RUN/shell.log"); }
log_errors_for() {
    local uuid=${1:-$EXT_UUID} from=$(( ${LOG_MARK:-0} + 1 ))
    tail -n +"$from" "$HARNESS_RUN/shell.log" | awk -v u="$uuid" '
        /JS ERROR|JS WARNING|Gjs-CRITICAL|Gjs-WARNING|-CRITICAL \*\*|Exception|Error:/ { flush(); blk=$0; inb=1; next }
        inb && /^[^ ]*@|^ *at |^\s+/ { blk = blk "\n" $0; next }
        { flush() }
        END { flush() }
        function flush() { if (inb && index(blk, u)) print blk "\n--"; inb=0; blk="" }'
}
assert_no_log_errors() {
    local e; e=$(log_errors_for "${1:-$EXT_UUID}")
    [ -z "$e" ] || fail "shell log has errors for ${1:-$EXT_UUID}:
$e"
    pass "no shell-log errors mention ${1:-$EXT_UUID}"
}

# Quick Settings: JS expression yielding the QuickToggle(s) whose title matches.
qs_toggles_js() {
    printf '%s' "Main.panel.statusArea.quickSettings.menu._grid.get_children().filter(c => c.title === $(printf '%s' "$1" | sed 's/["\\]/\\&/g; s/.*/"&"/'))"
}
qs_toggle_js() { printf '(%s)[0]' "$(qs_toggles_js "$1")"; }

# Shim logs
shim_reset() { : > "$HARNESS_RUN/pkexec.log"; : > "$HARNESS_RUN/efibootmgr.log"; rm -f "$HARNESS_RUN"/*.mode; }
pkexec_calls() { cat "$HARNESS_RUN/pkexec.log"; }
efibootmgr_calls() { cat "$HARNESS_RUN/efibootmgr.log"; }
pkexec_mode() { echo "$1" > "$HARNESS_RUN/pkexec.mode"; }          # allow|dismiss|deny|slow
efibootmgr_mode() { echo "$1" > "$HARNESS_RUN/efibootmgr.mode"; }  # ok|fail
bootnext() { local h; h=$(efivar_data_hex BootNext) && hex_u16list "$h"; }   # "0001" or empty/1
