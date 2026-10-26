# Boot to Windows

A GNOME Shell Quick Settings toggle for UEFI dual-boot PCs. It sends the **next
restart, and only that one**, to Windows. Your normal boot order, GRUB, and
every later boot stay the same.

- **Toggle** "Boot to Windows" to arm or disarm. An icon appears in the top bar
  while Windows is armed, so a pending switch never gets forgotten.
- **Restart to Windows…** in the toggle's menu arms Windows and opens GNOME's
  usual restart dialog (with its countdown and unsaved-work warning).
- **Start as usual next time** undoes it.

## How it works

UEFI firmware has a one-shot variable, `BootNext`. The firmware boots that
entry once, then deletes the variable itself. The extension:

1. **Reads** `BootNext`, `BootOrder` and the `Boot####` entries straight from
   `/sys/firmware/efi/efivars`. These are world-readable, so checking state
   needs no privileges and no subprocess.
2. **Finds** the Windows Boot Manager entry by its description or its loader
   path (`\EFI\Microsoft\Boot\bootmgfw.efi`), and looks it up fresh every time,
   so renumbered entries don't break it.
3. **Writes** `BootNext` through `pkexec`, then re-reads the firmware and shows
   what it actually reports. It never trusts an exit code alone.

Disarming points `BootNext` at your default entry rather than deleting it,
because `efibootmgr` 18 (the current release) has a bug that breaks
`--delete-bootnext` ([fixed upstream][ebm-fix], unreleased). The effect is the
same: the next boot is your usual one, and then the firmware clears it.

[ebm-fix]: https://github.com/rhboot/efibootmgr/commit/0ca99d4

## Password prompts and one-click mode

Out of the box, every change asks for an administrator password: changing
firmware variables needs root, and polkit guards `pkexec efibootmgr` that way.
After the first one, the extension offers (once) to set up one-click mode.

**One-click mode** lets administrators logged in at the computer switch
without a password, the same way GNOME already lets them restart. Turn it on
from the extension's settings, under **One-click mode** → **Enable**. That asks
for an administrator password once. The same steps are shown for a terminal
under **Use a terminal instead**. It installs:

- a small helper, **root-owned**, in `/usr/local/libexec/boot-to-windows/`. It
  takes exactly one word, `windows` or `default`, and works out the entry
  numbers from the firmware itself, so it can't be pointed at anything else.
- a polkit action for the helper. By default it asks for an admin password,
- plus a polkit rule that skips the password only for members of `sudo`,
  `admin` or `wheel` who are **logged in at this machine**. Other accounts,
  and remote or inactive sessions, still need a password.

The extension only uses the helper if it, its modules, its policy and the
folders above it are root-owned and writable by no one else. Otherwise it
falls back to the password route. (On distros where users can't read
`/usr/share/polkit-1/rules.d`, the rule itself can't be checked. That's fine:
the rule only decides whether to ask for a password.) **Turn off one-click
switching** in the same place removes everything.

Anyone at the keyboard could make the same choice from the firmware's boot
menu. The narrow helper and the admin-only rule keep it at that.

## Requirements

- A PC booted in UEFI mode with a Windows Boot Manager entry
- `efibootmgr`
- GNOME Shell: see `shell-version` in [`metadata.json`](extension/metadata.json).
  Every listed version (45–50) passes the full integration suite in CI, in a
  real headless GNOME Shell.

## Development

```sh
npm install                       # eslint only; the extension has no runtime deps
npm run lint
npm test                          # unit tests (gjs)
tests/integration/test-all.sh     # every suite, real headless GNOME Shell 45-50 in Docker
tests/integration/test-all.sh 50  # just one version
./tools/pack.sh                   # build/…shell-extension.zip for extensions.gnome.org
./tools/install-dev.sh            # install into your session (Wayland: log out/in after)
```

The integration suites (`tests/integration/tests/`) drive the real extension
through GNOME Shell's Eval interface, against fake firmware variables and a
fake `pkexec`/`efibootmgr`. Nothing touches real NVRAM. See
[`tests/integration/README.md`](tests/integration/README.md).

Code layout: `extension/lib/` holds pure, GI-free modules (`efivars`,
`state`, `presentation`, `install`, `trust`, `helperCore`), unit-tested
directly, plus thin Gio layers (`firmware`, `writer`). `extension.js` and
`prefs.js` are only UI. The root helper reuses the same pure modules.

## License

GPL-2.0-or-later
