#!/usr/bin/env bash
# Generate extension icons from the canonical L@tr.link app icon.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ICON_DIR="$ROOT/public/icon"
SOURCE_ICON="$ROOT/../web/public/icon.png"
mkdir -p "$ICON_DIR"

if [[ ! -f "$SOURCE_ICON" ]]; then
  echo "Canonical icon not found at $SOURCE_ICON" >&2
  exit 1
fi

if command -v magick >/dev/null 2>&1; then
  for size in 16 32 48 128; do
    magick "$SOURCE_ICON" -resize "${size}x${size}" "$ICON_DIR/${size}.png"
  done
  exit 0
fi

if command -v sips >/dev/null 2>&1; then
  for size in 16 32 48 128; do
    sips -z "$size" "$size" "$SOURCE_ICON" --out "$ICON_DIR/${size}.png" >/dev/null
  done
  exit 0
fi

echo "Install ImageMagick or run this script on macOS with sips." >&2
exit 1
