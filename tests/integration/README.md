# GNOME Shell integration tests

Runs a real gnome-shell (headless Wayland, software rendering) in Docker for
each GNOME version from 45 to 50, installs the extension, and runs a bash test
script that drives the shell over D-Bus (`org.gnome.Shell.Extensions` and
`org.gnome.Shell.Eval`). The firmware is fake: fixture efivars on a tmpfs at
`/sys/firmware/efi/efivars`, plus logging shims for `pkexec` and `efibootmgr`.

```sh
./test-all.sh                     # all suites and self-tests, every version in metadata.json (what CI runs)
./test-all.sh 50                  # one version

./run.sh <45..50> <extension-dir> [test-script]
./run.sh 50 ../../extension tests/suite.sh                                  # one suite
ROOT_SETUP=hooks/install-helper.sh ./run.sh 50 ../../extension tests/helper.sh
./run.sh 48 selftest/broken-extension selftest/expect-failures.sh           # harness self-test
STRICT_METADATA=1 ./run.sh 46 selftest/broken-extension selftest/expect-out-of-date.sh
```

Suites in `tests/`:

- `suite.sh`: the password route, races, restart, hiding, the settings page
- `prefs-buttons.sh`: the settings page's buttons, actually run as root
- `helper.sh`: the one-click route
- `helper-tampered.sh`: an unsafe helper install gets ignored

The self-tests in `selftest/` make sure the harness can fail: a broken
extension has to be caught, and the strict version check has to reject a
version that isn't listed.

The exit code is the result: 0 pass, 1 an assertion failed, 90 the shell
never became ready. Logs go to `.work/out-<major>/` (gitignored): `run.log`,
`shell.log` (gnome-shell output), `session-bus.log` (dbus and the services it
starts), `pkexec.log`, `efibootmgr.log` and `efivars-final/`.

Each version runs on the Fedora release that ships it (45 on fedora:39 up to
50 on fedora:44). Images get the latest point release at build time, not the
`.0`, so a bug only in a `.0` release wouldn't be caught. A run takes a few
seconds once the image is built. Images are about 1.8 GB each; delete them
when you're done (`docker rmi btw-gnome:{45..50}`).

## How it works

- The shell runs as `gnome-shell --headless --no-x11 --virtual-monitor 1280x720`
  on every version (override with `SHELL_ARGS=`). Mutter logs "Created
  surfaceless renderer without GPU", which is fine: it's llvmpipe from
  `mesa-dri-drivers`, no /dev/dri needed. 49 removed `--x11`, `--nested` and
  the `--sm-*` options, but `--no-x11` is still there.
- No systemd, `--privileged` or extra capabilities. Two things make up for it:
  1. A system bus. gnome-shell 50 aborts at startup without one
     (loginManager.js, timeLimitsManager.js). The entrypoint starts a bare
     `dbus-daemon --system --fork`.
  2. Deleting `/run/systemd`. systemd's RPM scriptlets leave
     `/run/systemd/seats` in the image, and `loginManager.js` picks the logind
     backend just because that directory exists, then dies without logind.
     Without it the shell uses `LoginManagerDummy`.
- The session runs as uid 1000 (`tester`) under `dbus-run-session`, with
  `XDG_RUNTIME_DIR=/run/user/1000`. dconf is compiled before start with
  `enabled-extensions=['harness@btw.test', <uuid>]`,
  `disable-user-extensions=false`, no welcome dialog and no animations.
- The shell counts as ready once `org.gnome.Shell` is on the bus,
  `harness@btw.test` is ACTIVE and `Main.layoutManager._startingUp` is false.
- `/ext` (read-only) is copied to
  `~/.local/share/gnome-shell/extensions/<uuid>/`. By default the running
  version is added to its `shell-version` so the version check can't block
  loading. `STRICT_METADATA=1` turns that off to test the committed list.
  Schemas in `schemas/` get compiled. `ENABLE_AT_START=0` starts with only the
  harness extension enabled, so tests can call `ext_enable` themselves.

### Eval

None of 45–50 has an `--unsafe-mode` flag. Unsafe mode is just
`global.context.unsafe_mode`, which Looking Glass toggles, and while it's off
`org.gnome.Shell.Eval` returns `(false, '')`. So the image includes a
test-only extension, `harness@btw.test` (`harness/harness-extension/`), that
turns it on in `enable()`. The shell then shows a "System was put in unsafe
mode" notification, which doesn't matter here.

From a test:

```sh
T=$(qs_toggle_js 'Next Boot')         # (Main.panel.statusArea.quickSettings.menu._grid.get_children().filter(c => c.title === "Next Boot"))[0]
shell_eval "$T.checked"               # -> false   (JSON-stringified result)
shell_eval "$T.subtitle"              # -> null
shell_eval "$T.emit('clicked', 1)"    # simulate a click
shell_eval "$T.refresh()"             # call any method on the toggle
```

`menu._grid` is private, but it's there on 45–50.

### Fake firmware

- `run.sh` passes `--security-opt systempaths=unconfined --mount
  type=tmpfs,destination=/sys/firmware`. Docker normally masks `/sys/firmware`
  with a small read-only tmpfs, and anything mounted there gets hidden under
  it. `systempaths=unconfined` removes the mask without needing privileges.
  Binding a host directory straight onto `/sys/firmware/efi/efivars` fails
  because runc can't mkdir inside read-only sysfs.
- The entrypoint fills the tmpfs with the default fixture: Boot0000 "ubuntu"
  (shimx64.efi) and Boot0001 "Windows Boot Manager" (bootmgfw.efi), both with
  real HD()+File() device paths, plus `BootOrder=0000,0001`,
  `BootCurrent=0000`, `Timeout=0` and no BootNext. `FIXTURE_EFIVARS=<dir>`
  seeds it from real files instead. Each file is 4 bytes of attributes
  (`07 00 00 00`) and then the data. `harness/efivars.sh` has helpers for
  tests (`efivar_write`, `efivar_boot_entry`, `efivar_data_hex`, `bootnext`,
  …).
- The tmpfs also hides the CI runner's own `/sys/firmware/efi`, so nothing in
  the container can reach real NVRAM.
- The `/usr/bin/pkexec` shim logs its arguments to `pkexec.log` and runs the
  command as the same user, without elevating. Like real pkexec it wants an
  absolute path. `pkexec_mode dismiss|deny` exits 126/127 with pkexec's
  error text, `slow` waits 3 s first, and `root` runs the command as root
  through the harness's root job queue, as if the prompt was approved.
- The `/usr/bin/efibootmgr` fake logs its arguments and supports
  `-n/--bootnext XXXX` (rejecting entries that don't exist),
  `-N/--delete-bootnext`, `-o/--bootorder` and a listing in the real format.
  `efibootmgr_mode fail` makes it exit 1.
- Tests run as uid 1000, so the helper has to be installed root-owned from a
  hook: `ROOT_SETUP=path/to/setup.sh ./run.sh …` runs the script as root
  before the session starts. Since the pkexec shim runs the helper as
  `tester`, its writes to the fixture efivars work. The tmpfs isn't efivarfs,
  though, so there's no immutable flag and nothing validates writes.

## Test script API (`harness/lib.sh`)

`shell_eval JS`, `shellctl {version|eval|info|state|enable|disable|errors|list}`,
`ext_state UUID` (45's ENABLED/DISABLED are reported as ACTIVE/INACTIVE),
`ext_enable`/`ext_disable`, `wait_ext_state UUID STATE [timeout]`,
`assert_ext_active [UUID]` (ACTIVE with no errors), `log_mark` +
`assert_no_log_errors [UUID]` (JS ERROR / CRITICAL blocks mentioning the
uuid), `assert_eq`, `assert_contains`, `wait_until SECS cmd…` (use
`eval '…'` for conditions with `$(…)`), `qs_toggles_js`/`qs_toggle_js TITLE`,
`shim_reset`, `pkexec_calls`, `efibootmgr_calls`, `pkexec_mode`,
`efibootmgr_mode`, `bootnext`. Test scripts are sourced with `set -e`, and
`$EXT_UUID`, `$GNOME_MAJOR` and `$HARNESS_RUN` are set.

## Gotchas

- Fedora 39, 40 and 41 are EOL but still resolve through the normal mirrors
  for now. When they stop, build with `REBUILD=1 ARCHIVE=1 ./run.sh …` (or
  `--build-arg ARCHIVE=1`) to use archives.fedoraproject.org instead.
- Images pick up whatever point release is current when they're built.
  `REBUILD=1` refreshes them.
- With Docker Desktop, bind-mount sources have to be under a shared path
  (`/home` is, `/tmp` isn't). That's why `.work/` is inside the repo.
- The session bus starts a lot of services (goa, evolution, portals, a11y).
  Their output goes to `session-bus.log`, not the test output.
- There's no ibus, GDM or NetworkManager, and the shell logs harmless
  messages about each. Filter shell log checks by uuid (like
  `assert_no_log_errors` does) rather than checking the whole log.

## GitHub Actions

`.github/workflows/ci.yml` runs `test-all.sh <major>` for each of 45–50 on
`ubuntu-24.04` and uploads `.work/` (it's hidden, hence
`include-hidden-files: true`). Each job builds its own image in a minute or
two. Two things are different from a desktop, and the harness handles both:
Ubuntu's AppArmor `docker-default` profile blocks writes under
`/sys/firmware` (so `run.sh` passes `apparmor=unconfined`), and `sudo` inside
the container fails under PAM (so root work goes through the root job queue
in `harness/rootq.sh`).

## Layout

```
Dockerfile                    one file, ARG FEDORA (+ ARCHIVE)
run.sh                        host driver
harness/entrypoint.sh         root: system bus, fixture efivars, ext install, dconf, hook
harness/session.sh            tester: start shell, wait for ready, source test, teardown
harness/lib.sh, efivars.sh    test helpers
harness/shellctl.js           gjs D-Bus client (Eval, extension info/state/enable/disable)
harness/shims/                pkexec, efibootmgr fakes
harness/harness-extension/    harness@btw.test (turns on unsafe mode for Eval)
hooks/                        ROOT_SETUP scripts (install the helper like a user would)
tests/                        the suites, plus prefs-probe.js (builds the real settings page)
selftest/                     checks that the harness can fail (run by test-all.sh)
```
