# Changelog

Versions follow [semantic versioning](https://semver.org). Each one is the
`version-name` in `extension/metadata.json`, and a `v`-prefixed tag on GitHub.
(extensions.gnome.org numbers its uploads separately: 1, 2, 3…)

Releases are built from this file: the section for a version becomes its
GitHub release notes.

## [Unreleased]

## [1.0.1] - 2026-10-25

### Changed

- New top-bar and toggle icon: a restart arrow around a plain window.
- The settings page's Enable, Update and Remove buttons run their steps in a
  root shell again: root only runs standard tools (`install`, `rm`), never a
  script from the extension's folder.
- Firmware variables are always read asynchronously, in the settings page
  and the helper too.
- The description says the settings page can copy commands to the
  clipboard.

### Fixed

- Turning the extension off now also removes its one-click suggestion
  notification, if it is still showing.

## [1.0.0] - 2026-10-25

First public release.

### Added

- A **Boot to Windows** toggle in Quick Settings. It sends the next restart,
  and only that one, to Windows by setting the firmware's one-time `BootNext`
  variable. GRUB and the normal boot order are never touched.
- **Restart to Windows…** in the toggle's menu: arms Windows, then opens
  GNOME's usual restart dialog, which can still be cancelled.
- **Start as usual next time** to undo it.
- A top-bar icon while Windows is armed, so a pending switch is never
  forgotten.
- A settings page showing what the firmware will start next, the Windows and
  default entries, and anything it couldn't read. It can also undo a one-time
  boot that another tool set.
- Optional **one-click mode**: a small root-owned helper plus a polkit rule,
  set up from the settings page (or one `sudo` command). Administrators logged
  in at the computer can then switch without a password. Without it, each
  change asks for an administrator password.
- GNOME Shell 45–50, each tested in CI in a real headless shell.

[Unreleased]: https://github.com/MasonFlint44/boot-to-windows/compare/v1.0.1...HEAD
[1.0.1]: https://github.com/MasonFlint44/boot-to-windows/compare/v1.0.0...v1.0.1
[1.0.0]: https://github.com/MasonFlint44/boot-to-windows/releases/tag/v1.0.0
