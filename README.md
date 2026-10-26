# Boot to Windows

A GNOME Shell Quick Settings toggle for UEFI dual-boot PCs. Turn it on and
the next restart goes to Windows. The restart after that goes back to your
usual system. GRUB and your boot order aren't touched.

- Click the "Boot to Windows" toggle to arm or disarm it. A top-bar icon
  shows while Windows is armed.
- "Restart to Windows…" in the toggle's menu arms Windows and opens GNOME's
  normal restart dialog.
- "Start as usual next time" undoes it.
- The settings page shows what the firmware will boot next. It can also undo
  a one-time boot set by some other tool, even when the toggle is hidden
  (e.g. when Windows is already the default).

## Install

From [extensions.gnome.org](https://extensions.gnome.org) once it's listed
there, or download the zip from a
[GitHub release](https://github.com/MasonFlint44/boot-to-windows/releases):

```sh
gnome-extensions install boot-to-windows@masonflint.com.shell-extension.zip
```

On Wayland, log out and back in, then enable it in the Extensions app.

## How it works

UEFI has a variable called `BootNext`. If it's set, the firmware boots that
entry once and then deletes it. The extension:

1. Reads `BootNext`, `BootOrder` and the `Boot####` entries from
   `/sys/firmware/efi/efivars`. Anyone can read these, so no password is
   needed just to check.
2. Finds the Windows Boot Manager entry by its name or by its loader path
   (`\EFI\Microsoft\Boot\bootmgfw.efi`). It looks it up again every time, in
   case the entries got renumbered.
3. Sets `BootNext` with `pkexec`, then reads the firmware again to check the
   change took.

To disarm, it points `BootNext` at your default entry instead of deleting it.
That has the same effect, and works around a bug in efibootmgr 18 that breaks
`--delete-bootnext` ([fixed upstream][ebm-fix] but not released yet).

[ebm-fix]: https://github.com/rhboot/efibootmgr/commit/0ca99d4

## One-click mode

Changing firmware variables needs root, so by default every change asks for
an admin password. After the first time, the extension offers to set up
one-click mode, which lets admins at the computer switch without a password
(GNOME already lets them restart without one).

To turn it on, open the extension's settings and click Enable under
"One-click mode". It asks for your password once. If you'd rather use a
terminal, the same steps are:

```sh
# install or update
sudo gjs -m ~/.local/share/gnome-shell/extensions/boot-to-windows@masonflint.com/helper/install.js
# remove
sudo gjs -m ~/.local/share/gnome-shell/extensions/boot-to-windows@masonflint.com/helper/install.js remove
```

This installs:

- A small root-owned helper in `/usr/local/libexec/boot-to-windows/`. It only
  accepts `windows` or `default` and reads the entry numbers from the
  firmware itself, so it can't be used to boot anything else.
- A polkit action for the helper, which asks for an admin password by
  default.
- A polkit rule that skips the password for members of `sudo`, `admin` or
  `wheel` who are logged in locally. Other users, and remote or inactive
  sessions, still get a password prompt.

The extension only uses the helper if all of its files, and the folders
above it, are owned by root and not writable by anyone else. Otherwise it
asks for a password like before. Some distros don't let users read
`/usr/share/polkit-1/rules.d`, in which case the rule can't be checked. That's
OK, since the rule only decides whether to ask for a password.

Turn one-click mode off before you remove the extension. GNOME doesn't run
any code when an extension is removed, so the helper would be left behind.
If that already happened, reinstall the extension and run the `remove`
command above, or delete the files yourself:

```sh
sudo rm -rf /usr/local/libexec/boot-to-windows
sudo rm -f /usr/share/polkit-1/actions/com.masonflint.BootToWindows.set-next-boot.policy \
           /usr/share/polkit-1/rules.d/50-com.masonflint.BootToWindows.rules
```

One-click mode isn't available on image-based systems like Fedora
Silverblue, since `/usr` is read-only there.

Updating the extension doesn't update an installed helper, because that
would need your password. The settings page shows an Update button when the
helper is out of date, and newer versions of the extension keep working with
older helpers in the meantime.

As for security: anyone at the keyboard can already pick Windows from the
firmware's boot menu. The helper and the polkit rule don't allow anything
beyond that.

## Requirements

- A PC booted in UEFI mode, with a Windows Boot Manager entry
- `efibootmgr`
- GNOME Shell 45–50 (see `shell-version` in
  [`metadata.json`](extension/metadata.json)). CI tests each version in a
  real headless GNOME Shell.

## Development

```sh
npm install                       # just eslint; the extension has no dependencies
npm run lint
npm test                          # unit tests (gjs)
tests/integration/test-all.sh     # integration tests, GNOME 45-50 in Docker
tests/integration/test-all.sh 50  # one version
./tools/pack.sh                   # build the zip for extensions.gnome.org
./tools/install-dev.sh            # install into your session (log out/in on Wayland)
```

The integration tests run the extension in a real GNOME Shell against fake
firmware variables and fake `pkexec`/`efibootmgr`, so nothing touches real
NVRAM. See [`tests/integration/README.md`](tests/integration/README.md).

`extension/lib/` has the logic (parsing, state, install checks) with no GI
imports, so the unit tests and the root helper can use it directly.
`firmware.js` and `writer.js` are the Gio parts, and `extension.js` and
`prefs.js` are just UI.

To release: add a dated section to [CHANGELOG.md](CHANGELOG.md), set
`version-name` in `metadata.json` to match, commit, and push a `vX.Y.Z` tag.
The release workflow runs CI and attaches the tested zip to a GitHub release.

## License

GPL-2.0-or-later
