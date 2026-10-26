#!/usr/bin/env bash
# Build-only font from upstream Noto CJK, pinned by commit and content hash.
set -euo pipefail
font_dir="${CARD_CJK_FONT_DIR:-${HOME}/.local/share/fonts}"
font_tmp=$(mktemp)
trap 'rm -f "$font_tmp"' EXIT
curl --fail --location --connect-timeout 15 --max-time 120 --retry 1 \
  https://raw.githubusercontent.com/notofonts/noto-cjk/f8d157532fbfaeda587e826d4cd5b21a49186f7c/Sans/OTC/NotoSansCJK-Regular.ttc \
  --output "$font_tmp"
printf '%s  %s\n' b76b0433203017ca80401b2ee0dd69350349871c4b19d504c34dbdd80541690a "$font_tmp" | sha256sum --check --strict
mkdir -p "$font_dir"
install -m 644 "$font_tmp" "$font_dir/NotoSansCJK-Regular.ttc"
fc-scan --format '%{family}\n' "$font_dir/NotoSansCJK-Regular.ttc" | grep --fixed-strings 'Noto Sans CJK SC'
fc-cache --force "$font_dir"
