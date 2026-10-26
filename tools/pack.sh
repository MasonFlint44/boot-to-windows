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
echo "built: $(ls build/*.shell-extension.zip)"
