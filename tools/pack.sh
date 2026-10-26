#!/bin/sh
# Build the extensions.gnome.org upload: build/boot-to-windows@masonflint.com.shell-extension.zip
set -eu
cd "$(dirname "$0")/.."
mkdir -p build
gnome-extensions pack extension \
    --extra-source=lib \
    --extra-source=helper \
    --extra-source=icons \
    --out-dir=build --force
zip=build/boot-to-windows@masonflint.com.shell-extension.zip
# Only the extension itself goes to users: fail on anything else.
extra=$(unzip -Z1 "$zip" | grep -Ev '^(metadata\.json|extension\.js|prefs\.js|(schemas|lib|helper|icons)/|lib/[a-zA-Z]+\.js|icons/[a-z-]+-symbolic\.svg|schemas/[a-z.-]+\.gschema\.xml|helper/(boot-to-windows-helper|install\.js|com\.masonflint\.BootToWindows\.(set-next-boot\.policy|rules)))$' || true)
[ -z "$extra" ] || { echo "unexpected files in the zip:" >&2; echo "$extra" >&2; exit 1; }
echo "built: $zip"
