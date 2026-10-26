#!/bin/sh
# SPDX-License-Identifier: GPL-2.0-or-later
# Prints the CHANGELOG.md section for a version. Fails unless metadata.json's
# version-name matches and the changelog has a dated section for it.
#
#   tools/release-notes.sh 1.0.0 > notes.md
set -eu
cd "$(dirname "$0")/.."
version=${1:?usage: tools/release-notes.sh <version, e.g. 1.0.0>}

name=$(python3 -c 'import json; print(json.load(open("extension/metadata.json")).get("version-name", ""))')
[ "$name" = "$version" ] || { echo "metadata.json version-name is '$name', not '$version'" >&2; exit 1; }
# extensions.gnome.org's rule for version-name.
python3 -c 'import re,sys; sys.exit(0 if re.fullmatch(r"(?!^[. ]+$)[a-zA-Z0-9 .]{1,16}", sys.argv[1]) else 1)' "$version" ||
    { echo "'$version' is not a valid version-name" >&2; exit 1; }
if python3 -c 'import json,sys; sys.exit("version" in json.load(open("extension/metadata.json")))'; then :; else
    echo "metadata.json sets 'version'; extensions.gnome.org manages that field" >&2; exit 1
fi

notes=$(awk -v v="$version" '
    $0 ~ "^## \\[" v "\\] - [0-9]{4}-[0-9]{2}-[0-9]{2}$" { on = 1; next }
    on && /^## \[/ { exit }
    on && /^\[[^]]+\]: / { exit }
    on { print }' CHANGELOG.md)
[ -n "$(printf '%s' "$notes" | tr -d '[:space:]')" ] ||
    { echo "CHANGELOG.md has no dated section for $version (## [$version] - YYYY-MM-DD)" >&2; exit 1; }
printf '%s\n' "$notes" | sed -e '/./,$!d'
