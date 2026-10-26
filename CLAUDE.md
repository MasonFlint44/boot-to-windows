# Boot to Windows: notes for working on this repo

GNOME Shell (45–50) Quick Settings toggle that sets UEFI `BootNext` so the
next restart goes to Windows. README.md explains what it does and how; this
file is what to keep in mind when changing it.

## Commands

```sh
npm run lint                      # eslint (PATH needs node: ~/.nvm/versions/node/*/bin)
npm test                          # gjs unit tests, tests/unit/
tests/integration/test-all.sh     # every suite + harness self-tests, GNOME 45-50 in Docker (CI runs this)
tests/integration/test-all.sh 50  # one version
./tools/pack.sh                   # build/…shell-extension.zip (only extension/ goes in)
./tools/install-dev.sh            # install into this session; on Wayland it loads at next login
```

- The Docker images are ~1.8 GB each. Delete them after local runs
  (`docker rmi btw-gnome:{45..50}`); CI builds its own.
- Before an extensions.gnome.org upload, run the reviewers' analyzer on the
  zip in a throwaway venv: `pip install shexli && shexli build/*.zip`. The one
  expected warning is EGO-P-007 (`helper/install.js`, `lib/helperCore.js`
  aren't imported by extension.js/prefs.js; the root helper and the terminal
  installer use them).

## Layout

- `extension/lib/`: pure modules (no GI imports, unit-tested directly):
  `efivars` (parsers), `state` (snapshot → status), `presentation`,
  `install` (helper manifest, install steps, status), `trust`, `helperCore`.
  Thin Gio layers: `firmware` (async reads), `writer` (pkexec, verify by
  re-read), `notify` (45 vs 46+ notification API).
- `extension.js`, `prefs.js`: UI only.
- `extension/helper/`: the optional root helper (GJS), its polkit policy
  and rule, and `install.js` (the terminal installer).
- `tests/integration/`: real headless gnome-shell per version, fake efivars
  on a tmpfs, `pkexec`/`efibootmgr` shims. See its README.

## Rules that aren't obvious from the code

- **Never trust an exit code.** After every write, re-read the firmware and
  show what it reports.
- **Disarm = set BootNext to the default entry.** efibootmgr 18's
  `--delete-bootnext` is broken (validates Boot0001; fixed upstream in
  0ca99d4, unreleased).
- **Nothing user-writable runs as root.** This is an extensions.gnome.org rule:
  - the helper is used only when it, its libs, its policy, its rule (when
    visible) and its parent folders are root-owned and not group/world
    writable;
  - the settings buttons run `pkexec /bin/sh -c "<install steps>"`, never
    `pkexec` on a script from the extension folder.
- **The helper's verbs `windows` and `default` are frozen.** Installed
  helpers never update with the extension, so newer versions must keep
  working with old ones. A unit test pins them.
- **Trust info is three-valued:** file info, `MISSING` (not found), or `null`
  (can't check, e.g. Fedora 39/40's unreadable `rules.d`). Only the polkit
  rule may be `null` without disqualifying the helper.
- **enable()/disable():** create nothing before `enable()`. Everything
  created or connected there is destroyed or disconnected in `destroy()` /
  `disable()`. Async results that land after destroy are dropped (check the
  cancellable).
- **Shell code never does synchronous file IO.** Firmware reads are async
  everywhere, the helper included (it runs a main loop).
- Firmware strings go into widgets as plain text (`use_markup: false` set
  before the text), since `&` breaks markup on GNOME 45–47.
- `shell-version` lists only versions whose CI row is green.
- The helper only runs from its installed layout (`lib/` beside it).

## Releasing

1. Add a dated `## [x.y.z] - YYYY-MM-DD` section to CHANGELOG.md.
2. Set `version-name` in `extension/metadata.json` to `x.y.z` (semver). Don't
   set `version`: extensions.gnome.org manages it.
3. Commit, then `git tag -a vx.y.z -m 'Boot to Windows x.y.z' && git push origin vx.y.z`.
4. `release.yml` checks tag, version-name and changelog agree, runs all of
   CI, and publishes the tested zip. Upload that zip to extensions.gnome.org.

Pushing goes over SSH (the gh token lacks the `workflow` scope).
