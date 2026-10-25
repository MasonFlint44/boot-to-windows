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

Out of the box, every change asks for an administrator password. That's
polkit's standard rule for `pkexec efibootmgr`.

For one click, install the optional helper. The extension's settings page
shows the exact commands, with a copy button. The helper:

- is installed **root-owned** to `/usr/local/libexec/boot-to-windows/`, so no
  user program can change what runs as root. The extension won't use it if
  any of its files are writable by anyone but root.
- takes exactly one word, `windows` or `default`, and works out the entry
  numbers from the firmware itself. It cannot be pointed at anything else.
- comes with a polkit action that lets the **active local session** run it
  without a password. Remote or inactive sessions still need admin auth.

Anyone at the keyboard could make the same choice from the firmware's boot
menu, which is why this is safe to allow without a password.

## Requirements

- A PC booted in UEFI mode with a Windows Boot Manager entry
- `efibootmgr`
- GNOME Shell: see `shell-version` in [`metadata.json`](extension/metadata.json).
  Each listed version is tested by CI in a real headless GNOME Shell.

## Development

```sh
npm install            # eslint only; the extension has no runtime deps
npm run lint
npm test               # unit tests (gjs)
tests/integration/run.sh 50 extension tests/integration/suite.sh   # real shell in Docker
./tools/pack.sh        # build/…shell-extension.zip for extensions.gnome.org
./tools/install-dev.sh # install into your session (Wayland: log out/in after)
```

Code layout: `extension/lib/` holds pure, GI-free modules (`efivars`,
`state`, `presentation`, `install`, `trust`, `helperCore`), unit-tested
directly, plus thin Gio layers (`firmware`, `writer`). `extension.js` and
`prefs.js` are only UI. The root helper reuses the same pure modules.

## License

GPL-2.0-or-later
