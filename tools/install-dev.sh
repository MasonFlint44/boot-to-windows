#!/bin/sh
# Install the working tree into this user's GNOME Shell. On Wayland the shell
# only picks up new code after logging out and back in.
set -eu
cd "$(dirname "$0")/.."
./tools/pack.sh
gnome-extensions install --force build/boot-to-windows@masonflint.com.shell-extension.zip
echo "installed. Log out and back in, then: gnome-extensions enable boot-to-windows@masonflint.com"
