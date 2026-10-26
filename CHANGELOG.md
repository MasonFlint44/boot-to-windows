# Changelog

Uses [semantic versioning](https://semver.org). extensions.gnome.org numbers
uploads on its own (1, 2, 3…), separately from these.

## [Unreleased]

## [1.0.3] - 2026-10-26

### Changed

- The toggle is now called "Next Boot", with what starts next underneath
  ("Windows", or your usual system). "Boot to Windows" didn't fit and got
  cut off. The menu header still says "Boot to Windows".
- "As usual" is replaced by the name of your usual system, e.g. "Start
  Ubuntu next time" in the menu and "Start Ubuntu" in the settings.
- Lowercase boot entry names like "ubuntu" are shown capitalized.

## [1.0.2] - 2026-10-25

### Changed

- Shorter, plainer text in the settings page, notifications and the
  extension's description.
- Rewrote the README.

## [1.0.1] - 2026-10-25

### Changed

- New icon.
- The Enable, Update and Remove buttons in the settings no longer run a
  script from the extension's folder as root, just `install` and `rm`.

### Fixed

- Disabling the extension now also removes the one-click suggestion
  notification if it's still showing.

## [1.0.0] - 2026-10-25

First public release.

### Added

- A "Boot to Windows" toggle in Quick Settings that sets the firmware's
  one-time `BootNext` variable, so only the next restart goes to Windows.
- "Restart to Windows…" in the toggle's menu, which arms Windows and opens
  the normal restart dialog.
- "Start as usual next time" to undo it.
- A top-bar icon while Windows is armed.
- A settings page showing what boots next and the Windows and default
  entries. It can also undo a one-time boot set by another tool.
- Optional one-click mode (a small root-owned helper and a polkit rule) so
  admins at the computer can switch without a password.
- Support for GNOME Shell 45–50.

[Unreleased]: https://github.com/MasonFlint44/boot-to-windows/compare/v1.0.3...HEAD
[1.0.3]: https://github.com/MasonFlint44/boot-to-windows/compare/v1.0.2...v1.0.3
[1.0.2]: https://github.com/MasonFlint44/boot-to-windows/compare/v1.0.1...v1.0.2
[1.0.1]: https://github.com/MasonFlint44/boot-to-windows/compare/v1.0.0...v1.0.1
[1.0.0]: https://github.com/MasonFlint44/boot-to-windows/releases/tag/v1.0.0
