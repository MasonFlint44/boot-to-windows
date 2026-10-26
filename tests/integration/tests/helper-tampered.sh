# shellcheck shell=bash
# shellcheck disable=SC2016  # eval '…' conditions expand later, on purpose
# SPDX-License-Identifier: GPL-2.0-or-later
#
# A helper install with one group-writable module must not be used:
#
#   ROOT_SETUP=hooks/install-helper-tampered.sh ./run.sh <ver> ../../extension tests/helper-tampered.sh

# Fail fast if the fake firmware didn't mount: every later step depends on it.
[ -f "$(efivar_path Boot0001)" ] || fail "fixture efivars missing at $EFIVARS (see the harness warning above)"

NAME='Boot to Windows'
T=$(qs_toggle_js "$NAME")

log "1. falls back to the password route"
assert_ext_active
shim_reset
shell_eval "$T.emit('clicked', 1)" >/dev/null
wait_until 10 eval "test \"\$(shellctl eval '$T.checked')\" = true" || fail "never armed"
assert_eq "$(pkexec_calls)" "/usr/bin/efibootmgr --bootnext 0001" "helper skipped"

log "2. preferences page says it is not trusted and offers a reinstall"
rows=$(prefs_probe)
assert_contains "$rows" '"title":"One-click status","subtitle":"Found, but not safely installed (not root-owned), so it is not used. Reinstall it."' "untrusted status"
assert_contains "$rows" '"title":"Update the helper"' "update offered"
assert_no_log_errors
