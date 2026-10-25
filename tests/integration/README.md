# GNOME Shell integration harness

Runs **real gnome-shell** (headless Wayland, software rendering) in Docker for each
GNOME major 45–50, installs an extension, and sources a bash test script that can
drive the shell through D-Bus (`org.gnome.Shell.Extensions` + `org.gnome.Shell.Eval`).
UEFI firmware is faked: fixture efivars on a tmpfs at `/sys/firmware/efi/efivars`,
plus logging shims for `pkexec` and `efibootmgr`.

```sh
./run.sh <45..50> <extension-dir> [test-script]
./run.sh 50 fixture-extension tests/probe.sh                          # the prototype test
./run.sh 48 selftest/broken-extension selftest/expect-failures.sh     # harness self-test
STRICT_METADATA=1 ./run.sh 46 fixture-extension selftest/expect-out-of-date.sh
for v in 45 46 47 48 49 50; do ./run.sh $v ../../path/to/extension tests/probe.sh || echo "FAIL $v"; done
```

Exit code = test result (0 pass, 1 assertion failed, 90 shell never became ready).
Logs land in `.work/out-<major>/` (gitignored): `run.log`, `shell.log` (gnome-shell
stdout/stderr), `session-bus.log` (dbus + activated services), `pkexec.log`,
`efibootmgr.log`, `efivars-final/`.

## Observed results (2026-10-25, Docker Desktop 29.7.2 on Ubuntu 26.04 host)

| GNOME | Base image | gnome-shell | Starts headless | Extension ACTIVE | disable→enable ×3 | Eval (via harness ext) | Firmware fixture + shims | Version gate (STRICT) |
|---|---|---|---|---|---|---|---|---|
| 45 | fedora:39 (EOL) | 45.10 | yes, ~1.0 s | yes | yes | yes | yes | n/a (fixture lists 45) |
| 46 | fedora:40 (EOL) | 46.10 | yes, ~0.9 s | yes | yes | yes | yes | OUT_OF_DATE as expected |
| 47 | fedora:41 (EOL) | 47.10 | yes, ~1.1 s | yes | yes | yes | yes | OUT_OF_DATE as expected |
| 48 | fedora:42 | 48.8 | yes, ~0.9 s | yes | yes | yes | yes | OUT_OF_DATE as expected |
| 49 | fedora:43 | 49.10 | yes, ~0.8 s | yes | yes | yes | yes | OUT_OF_DATE as expected |
| 50 | fedora:44 | 50.6 | yes, ~0.8 s | yes | yes | yes | yes | OUT_OF_DATE as expected |

`tests/probe.sh` = 26 assertions, all green on all six; `selftest/expect-failures.sh`
(broken extension → ERROR, both error channels catch it, Eval refused when unsafe
mode is off) green on all six. The probe runs against the latest point release in
each Fedora repo, not the `.0` — a `.0`-specific regression would not be caught.

**Timings (this host, 20 cores):** cold image build 70–130 s per version (all six in
parallel ≈ 2 min; dominated by the dnf download). Image size 1.7–1.9 GB each
(gnome-shell hard-depends on evolution-data-server, gnome-control-center bits, etc.;
`install_weak_deps=False` is already on). A run is ~3 s wall: the shell is READY in
≈1 s, the 26-assertion probe takes ≈1 s.

## How it works / flags

- **Command:** `gnome-shell --headless --no-x11 --virtual-monitor 1280x720`, identical
  on 45–50 (override with `SHELL_ARGS=`). Mutter logs "Created surfaceless renderer
  without GPU" — llvmpipe via `mesa-dri-drivers`, no /dev/dri needed. `--no-x11` still
  exists on 49/50; what 49 removed is `--x11`, `--nested` and the `--sm-*` options
  (49 added `--devkit`). `--debug-control` exists on 46+.
- **No systemd, no --privileged, no capabilities.** Two things are needed instead:
  1. A **system** bus. Without one gnome-shell 50 aborts at startup (loginManager.js /
     timeLimitsManager.js). The entrypoint runs a bare `dbus-daemon --system --fork`;
     polkitd even bus-activates on it.
  2. **Delete `/run/systemd`.** systemd's RPM scriptlets leave `/run/systemd/seats` in
     the image, and `loginManager.js` picks the logind backend purely on
     `GLib.access('/run/systemd/seats')`. With logind missing, that startup is fatal.
     Without the dir the shell uses `LoginManagerDummy`.
- **Session:** runs as uid 1000 `tester` under `dbus-run-session`, `XDG_RUNTIME_DIR=/run/user/1000`.
  dconf is compiled offline (`dconf compile ~/.config/dconf/user`) before start with
  `enabled-extensions=['harness@btw.test', <uuid>]`, `disable-user-extensions=false`,
  the welcome dialog suppressed and animations off.
- **Readiness** = `org.gnome.Shell` on the bus → `harness@btw.test` ACTIVE →
  `Eval('Main.layoutManager._startingUp') === false`.
- **Extension install:** `/ext` (ro) is copied to `~/.local/share/gnome-shell/extensions/<uuid>/`.
  Its `metadata.json` `shell-version` has the running major **appended** by default, so
  the version check can't block loading. `STRICT_METADATA=1` turns that off, so you test
  the committed list (an unlisted major comes out `OUT_OF_DATE`, as the self-test shows). Schemas
  under `schemas/` are compiled if present. `ENABLE_AT_START=0` starts with only the
  harness extension enabled, so tests can `ext_enable` it themselves.

### Eval / driving the UI

There is **no `--unsafe-mode` CLI flag on any of 45–50**. Unsafe mode is only
`global.context.unsafe_mode` (MetaContext:unsafe-mode), which Looking Glass toggles.
`org.gnome.Shell.Eval` returns `(false, '')` while it is off on every version
(confirmed by the self-test). The harness bakes a test-only system extension,
`harness@btw.test` (`harness/harness-extension/`), whose `enable()` sets
`global.context.unsafe_mode = true`. That makes Eval work identically on 45–50. The
shell then posts a "System was put in unsafe mode" notification, which is harmless.

From a test:
```sh
T=$(qs_toggle_js 'Harness Probe')     # (Main.panel.statusArea.quickSettings.menu._grid.get_children().filter(c => c.title === "Harness Probe"))[0]
shell_eval "$T.checked"               # -> false   (JSON-stringified result)
shell_eval "$T.subtitle"              # -> "BootNext: none"
shell_eval "$T.emit('clicked', 1)"    # simulate a click
shell_eval "$T.sync()"                # call any method on the toggle
```
`menu._grid` is a private field, but it exists and works on 45–50. `title`/`subtitle`
are the QuickToggle property names on all of them.

### Fake firmware

- `run.sh` passes `--security-opt systempaths=unconfined --mount type=tmpfs,destination=/sys/firmware`.
  By default Docker masks `/sys/firmware` with a 4 KB read-only tmpfs, and a plain
  `--mount`/`-v` there gets masked over. `systempaths=unconfined` drops the mask without
  privileges. Binding a host dir straight onto `/sys/firmware/efi/efivars` fails,
  because runc can't mkdir inside read-only sysfs. Binding a host dir onto
  `/sys/firmware` also works (with unconfined), but the tmpfs keeps host fixtures pristine.
- The entrypoint fills the tmpfs, owned by `tester`, with the default fixture: Boot0000
  "ubuntu" (shimx64.efi), Boot0001 "Windows Boot Manager" (bootmgfw.efi), both with real
  HD()+File() device paths, plus `BootOrder=0000,0001`, `BootCurrent=0000`, `Timeout=0`,
  and **no BootNext**. Pass `FIXTURE_EFIVARS=<dir>` to seed real-format files instead.
  Format = 4-byte LE attrs `07 00 00 00` + data. Helpers in `harness/efivars.sh`
  (`efivar_write`, `efivar_boot_entry`, `efivar_data_hex`, `bootnext`, …) are
  available inside tests.
- The tmpfs also hides a real `/sys/firmware/efi` on the CI runner, so nothing in the
  container can touch real NVRAM.
- **`/usr/bin/pkexec` shim:** appends shell-quoted argv to `pkexec.log`, then execs the
  command **as the same user** (no elevation). It requires an absolute path like real
  pkexec. `pkexec_mode dismiss|deny` → exit 126/127 with pkexec's stderr text.
- **`/usr/bin/efibootmgr` fake:** logs argv; supports `-n/--bootnext XXXX` (rejects
  nonexistent entries), `-N/--delete-bootnext`, `-o/--bootorder`, and prints a real-style
  listing. `efibootmgr_mode fail` → exit 1.
- **Helper in `/usr/local/libexec/boot-to-windows/`:** tests run as uid 1000, so install
  it root-owned from a hook: `ROOT_SETUP=path/to/setup.sh ./run.sh …`. The script runs
  as root before the session (verified on 50). Because the pkexec shim runs the helper
  as `tester`, the helper's writes to the fixture efivars succeed. The tmpfs is not
  efivarfs, though: `chattr -i`/immutable semantics don't exist there, and the kernel
  isn't validating writes.

## Test-script API (`harness/lib.sh`)

`shell_eval JS`, `shellctl {version|eval|info|state|enable|disable|errors|list}`,
`ext_state UUID` (names normalized: 45's ENABLED/DISABLED → ACTIVE/INACTIVE),
`ext_enable/ext_disable`, `wait_ext_state UUID STATE [timeout]`,
`assert_ext_active [UUID]` (ACTIVE + empty GetExtensionErrors), `log_mark` +
`assert_no_log_errors [UUID]` (JS ERROR / CRITICAL blocks mentioning the uuid),
`assert_eq`, `assert_contains`, `wait_until SECS cmd…` (use `eval '…'` for conditions
with `$(…)`), `qs_toggles_js/qs_toggle_js TITLE`, `shim_reset`, `pkexec_calls`,
`efibootmgr_calls`, `pkexec_mode`, `efibootmgr_mode`, `bootnext`. The script is sourced
with `set -e`; `$EXT_UUID`, `$GNOME_MAJOR`, `$HARNESS_RUN` are set.

## Gotchas

- **EOL Fedora:** 39/40/41 still resolve through the normal metalink today. When they
  stop, build with `REBUILD=1 ARCHIVE=1 ./run.sh …` (or `--build-arg ARCHIVE=1`), which rewrites
  the repos to archives.fedoraproject.org (verified building 39).
- **Point releases drift:** images take the latest point release at build time.
  `REBUILD=1` refreshes them; pin with a dated build if you need reproducibility.
- **Docker Desktop:** bind-mount sources must be under a shared path (`/home` is,
  `/tmp` is not). That's why `.work/` lives in the repo.
- The session bus activates lots of services (goa, evolution, portals, a11y). Their
  noise goes to `session-bus.log`, not the test output.
- No ibus, no GDM, no NetworkManager: the shell logs harmless messages about each.
  Filter shell-log assertions by uuid (as `assert_no_log_errors` does), not globally.

## GitHub Actions

```yaml
jobs:
  gnome-shell:
    runs-on: ubuntu-latest
    strategy:
      fail-fast: false
      matrix:
        gnome: [45, 46, 47, 48, 49, 50]
    steps:
      - uses: actions/checkout@v4
      - name: Integration test on GNOME ${{ matrix.gnome }}
        run: tests/integration/run.sh ${{ matrix.gnome }} <extension-dir> tests/integration/tests/<test>.sh
      - name: Upload logs
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: gnome-${{ matrix.gnome }}-logs
          path: tests/integration/.work/out-${{ matrix.gnome }}/
```
`run.sh` builds the image on first use (~1–2 min per job). To cache it, add
`docker/setup-buildx-action` + `docker/build-push-action` with `load: true`,
`tags: btw-gnome:${{ matrix.gnome }}`, `build-args: FEDORA=…`, and
`cache-from/cache-to: type=gha,scope=gnome-${{ matrix.gnome }}`. Map 45→39 … 50→44
with a matrix `include:`. Not yet run on a hosted runner. It should work there
unchanged, since it needs no privileges and no KVM, but that hasn't been observed.

## Layout

```
Dockerfile                    one file, ARG FEDORA (+ ARCHIVE)
run.sh                        host driver
harness/entrypoint.sh         root: system bus, fixture efivars, ext install, dconf, hook
harness/session.sh            tester: start shell, readiness, source test, teardown
harness/lib.sh, efivars.sh    test helpers
harness/shellctl.js           gjs D-Bus client (Eval, extension info/state/enable/disable)
harness/shims/                pkexec, efibootmgr fakes
harness/harness-extension/    harness@btw.test (unsafe mode → Eval)
fixture-extension/            harness-probe@btw.test stand-in QuickToggle
tests/probe.sh                prototype test (26 assertions)
selftest/                     negative controls
```
