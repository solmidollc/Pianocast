#!/usr/bin/env bash
# scripts/install-salamander-hq.sh
#
# Install the full 16-velocity-layer Salamander Grand Piano V3 OGG sample
# tree into public/samples/salamander-hq/ for the local Concert Grand (HQ)
# instrument. The OGG-Vorbis archive at archive.org is the official
# precomputed pack — ~78 MB compressed, ~80 MB on disk after extraction
# (the SFZ headers and a couple of metadata files make up the difference).
#
# Production note
#   This script exists so the local development build can preview / tune
#   against the full set without re-downloading every time. End-user
#   distributions still ship without these files; the in-app HQ entry has
#   `bundled: true` only in this local copy.
#
# Idempotent: re-running on an existing tree exits early.
# Requirements: bash, curl, tar, bunzip2 (all stock on macOS and Linux).

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TARGET_DIR="$REPO_ROOT/public/samples/salamander-hq"
ARCHIVE_URL="https://archive.org/download/SalamanderGrandPianoV3/SalamanderGrandPianoV3_OggVorbis.tar.bz2"
TMP_TARBALL="$REPO_ROOT/public/samples/salamander.tar.bz2"

mkdir -p "$REPO_ROOT/public/samples"

# Idempotency check — count OGG files; 480 is the canonical V3 count
# (30 sampled notes × 16 velocity layers).
if [ -d "$TARGET_DIR" ]; then
  ogg_count="$(ls "$TARGET_DIR" 2>/dev/null | grep -c '\.ogg$' || true)"
  if [ "$ogg_count" -ge 480 ]; then
    echo "Salamander HQ already installed ($ogg_count .ogg files in $TARGET_DIR). Skipping."
    exit 0
  fi
fi

echo "Downloading Salamander Grand Piano V3 (OGG, ~78 MB)…"
curl -L --progress-bar -o "$TMP_TARBALL" "$ARCHIVE_URL"

echo "Extracting…"
tar -xjf "$TMP_TARBALL" -C "$REPO_ROOT/public/samples"

mkdir -p "$TARGET_DIR"
# The archive uses an "ogg/" subdir for samples plus an SFZ + README at
# the top level. We flatten the OGG files into salamander-hq/ and stash
# the SFZ next to them for reference; everything else is discarded.
mv "$REPO_ROOT/public/samples/SalamanderGrandPianoV3_OggVorbis/ogg/"* "$TARGET_DIR/"

# Rename "#" -> "s" in sample filenames (D#1v1.ogg → Ds1v1.ogg). Vite's
# dev server can't reliably resolve %23-encoded sharps in static paths,
# and the catalogue's HQ_NOTE_NAMES is written in the renamed form.
ls "$TARGET_DIR" | perl -ne 'chomp; if (/#/) { my $new = $_; $new =~ s/#/s/g; rename "'"$TARGET_DIR"'/$_", "'"$TARGET_DIR"'/$new" or warn "$_: $!\n"; }'
if [ -f "$REPO_ROOT/public/samples/SalamanderGrandPianoV3_OggVorbis/SalamanderGrandPianoV3.sfz" ]; then
  mv "$REPO_ROOT/public/samples/SalamanderGrandPianoV3_OggVorbis/SalamanderGrandPianoV3.sfz" \
     "$TARGET_DIR/SalamanderGrandPianoV3.sfz"
fi
if [ -f "$REPO_ROOT/public/samples/SalamanderGrandPianoV3_OggVorbis/README" ]; then
  mv "$REPO_ROOT/public/samples/SalamanderGrandPianoV3_OggVorbis/README" \
     "$TARGET_DIR/SALAMANDER-README"
fi
rm -rf "$REPO_ROOT/public/samples/SalamanderGrandPianoV3_OggVorbis"
rm -f "$TMP_TARBALL"

ogg_count="$(ls "$TARGET_DIR" 2>/dev/null | grep -c '\.ogg$' || true)"
echo "Installed $ogg_count OGG samples into $TARGET_DIR"
echo
echo "License: CC BY 3.0 — credited in About / Credits via the catalogue's"
echo "attribution string. Do not redistribute outside that license."
