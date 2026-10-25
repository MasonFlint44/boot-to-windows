# shellcheck shell=bash
# Fixture efivarfs helpers (sourced). File format = 4-byte LE attributes, then data.
EFIVARS=${EFIVARS:-/sys/firmware/efi/efivars}
EFI_GUID=8be4df61-93ca-11d2-aa0d-00e098032b8c
EFI_ATTRS=07000000   # NV | BOOTSERVICE_ACCESS | RUNTIME_ACCESS

efivar_path() { echo "$EFIVARS/$1-$EFI_GUID"; }

# hex_to_file HEX FILE  (HEX = contiguous lowercase hex digits)
hex_to_file() {
    local hex=$1 out=$2 esc='' i
    for ((i = 0; i < ${#hex}; i += 2)); do esc+="\\x${hex:i:2}"; done
    printf '%b' "$esc" > "$out"
}

file_to_hex() { od -An -tx1 -v "$1" | tr -d ' \n'; }

# u16le 0001 -> 0100
u16le() { local v=$((16#$1)); printf '%02x%02x' $((v & 255)) $((v >> 8)); }
u32le() { local v=$1; printf '%02x%02x%02x%02x' $((v & 255)) $(((v >> 8) & 255)) $(((v >> 16) & 255)) $(((v >> 24) & 255)); }
u64le() { local v=$1 i; for ((i = 0; i < 8; i++)); do printf '%02x' $(((v >> (8 * i)) & 255)); done; }

# ASCII string -> null-terminated UCS-2LE hex
ucs2() { local s=$1 i; for ((i = 0; i < ${#s}; i++)); do printf '%02x00' "'${s:i:1}"; done; printf '0000'; }

# efivar_write NAME DATAHEX   (attributes prefix added)
efivar_write() { hex_to_file "$EFI_ATTRS$2" "$(efivar_path "$1")"; chmod 0644 "$(efivar_path "$1")"; }
efivar_delete() { rm -f "$(efivar_path "$1")"; }
# efivar_data_hex NAME -> data hex without the 4 attribute bytes ('' if absent)
efivar_data_hex() { local f; f=$(efivar_path "$1"); [ -f "$f" ] || return 1; local h; h=$(file_to_hex "$f"); echo "${h:8}"; }

# u16 list helpers: "0000,0001" <-> hex
u16list_hex() { local IFS=, x out=''; for x in $1; do out+=$(u16le "$x"); done; echo "$out"; }
hex_u16list() { local h=$1 i out=() ; for ((i = 0; i + 4 <= ${#h}; i += 4)); do out+=("$(printf '%02X%02X' $((16#${h:i+2:2})) $((16#${h:i:2})))"); done; local IFS=,; echo "${out[*]}"; }

# Device path nodes
dp_hd() { # partnum start size sig-hex(32, GPT GUID bytes as stored)
    printf '0401%s' "$(u16le 002a)"; u32le "$1"; u64le "$2"; u64le "$3"; printf '%s0202' "$4"
}
dp_file() { local p; p=$(ucs2 "$1"); printf '0404%s%s' "$(u16le "$(printf '%04x' $((4 + ${#p} / 2)))")" "$p"; }
dp_end() { printf '7fff0400'; }

# efivar_boot_entry NUM DESCRIPTION LOADER_PATH [active=1]
efivar_boot_entry() {
    local num=$1 desc=$2 path=$3 active=${4:-1} fpl
    fpl="$(dp_hd 1 2048 1048576 0123456789abcdef0123456789abcdef)$(dp_file "$path")$(dp_end)"
    efivar_write "Boot$num" "$(u32le "$active")$(u16le "$(printf '%04x' $((${#fpl} / 2)))")$(ucs2 "$desc")$fpl"
}

# efivar_boot_desc NUM -> description string (ASCII subset of UCS-2)
efivar_boot_desc() {
    local h i desc='' lo hi
    h=$(efivar_data_hex "Boot$1") || return 1
    for ((i = 12; i + 4 <= ${#h}; i += 4)); do
        lo=${h:i:2}; hi=${h:i+2:2}
        [ "$lo$hi" = 0000 ] && break
        desc+=$(printf '%b' "\\x$lo")
    done
    printf '%s\n' "$desc"
}

# Default fixture: Ubuntu (0000) is current + first, Windows (0001) second, no BootNext.
efivars_default_fixture() {
    mkdir -p "$EFIVARS"
    efivar_boot_entry 0000 ubuntu '\EFI\ubuntu\shimx64.efi'
    efivar_boot_entry 0001 'Windows Boot Manager' '\EFI\Microsoft\Boot\bootmgfw.efi'
    efivar_write BootOrder "$(u16list_hex 0000,0001)"
    efivar_write BootCurrent "$(u16le 0000)"
    efivar_write Timeout "$(u16le 0000)"
}
