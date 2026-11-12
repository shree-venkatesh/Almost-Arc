#!/bin/bash
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at https://mozilla.org/MPL/2.0/.
#
# Makes sure Zen is ready for Almost Arc (macOS only):
#   1. If /Applications/Zen.app is missing, downloads the official Zen from
#      Zen's own GitHub releases, checks it's intact and signed by the Zen team,
#      and installs it, owned by the user (so Zen keeps updating itself).
#   2. If the user has no Zen profile yet, starts Zen once in the background
#      (headless) so Zen creates one.
# Zen itself is never changed here; it stays Zen's product.
#
# Usage:  get-zen.sh           as yourself (install.sh runs this when Zen is missing)
#         get-zen.sh <user>    as root, for that user (the .pkg installer)
# On failure the last line printed is "Error: <message for a person>".

set -uo pipefail
APP=/Applications/Zen.app
ZEN_DMG="https://github.com/zen-browser/desktop/releases/latest/download/zen.macos-universal.dmg"
ZEN_TEAM=9V5K9TP787        # the Apple Developer ID team that signs Zen

say()  { echo "$*"; }
fail() { echo "Error: $*"; exit 1; }
[ "$(uname)" = Darwin ] || fail "get-zen.sh is for macOS."

if [ $# -ge 1 ]; then          # as root, on behalf of a user
  [ "$(id -u)" -eq 0 ] || fail "get-zen.sh <user> must run as root."
  U="$1"; UID_="$(id -u "$U")" || fail "No such user: $U"
  H="$(dscl . -read "/Users/$U" NFSHomeDirectory | awk '{print $2}')"
  as_user() { launchctl asuser "$UID_" sudo -u "$U" -H "$@"; }
  SUDO=""
else
  [ "$(id -u)" -ne 0 ] || fail "Run get-zen.sh as yourself, or as root with a user name."
  U="$(id -un)"; H="$HOME"
  as_user() { "$@"; }
  SUDO=""; [ -w /Applications ] || SUDO=sudo   # non-admin accounts
fi

tmp="$(mktemp -d)"
cleanup() { hdiutil detach -quiet "$tmp/mnt" >/dev/null 2>&1; rm -rf "$tmp"; }
trap cleanup EXIT

# ---- 1. Zen --------------------------------------------------------------------
if [ ! -d "$APP" ]; then
  say "Zen isn't installed: downloading it from Zen's GitHub releases..."
  curl -fsSL --retry 3 "$ZEN_DMG" -o "$tmp/zen.dmg" \
    || fail "Couldn't download Zen. Check your internet connection and try again."
  mkdir "$tmp/mnt"
  hdiutil attach -quiet -nobrowse -readonly -mountpoint "$tmp/mnt" "$tmp/zen.dmg" \
    || fail "Couldn't open the Zen download. Try again."
  src="$(find "$tmp/mnt" -maxdepth 1 -name '*.app' | head -n 1)"
  [ -n "$src" ] || fail "The Zen download didn't contain the app."
  # Copy it off the disk image without Finder metadata (which fails codesign's
  # checks), verify the copy, and only then put it in Applications.
  ditto --noextattr --noqtn "$src" "$tmp/Zen.app" || fail "Couldn't copy Zen from the download."
  xattr -cr "$tmp/Zen.app" 2>/dev/null
  # Intact, and signed by Zen's own Developer ID team. (codesign's details go into
  # a variable first: piping into grep -q under pipefail fails at random.)
  sig="$(codesign -dv --verbose=2 "$tmp/Zen.app" 2>&1)"
  if ! out="$(codesign --verify --deep "$tmp/Zen.app" 2>&1)" ||
     ! printf '%s\n' "$sig" | grep -x "TeamIdentifier=$ZEN_TEAM" >/dev/null; then
    say "codesign: $out"
    printf '%s\n' "$sig" | grep -E '^(Authority|TeamIdentifier|Identifier)='
    fail "The Zen download failed its signature check, so it wasn't installed."
  fi
  say "Installing Zen $(defaults read "$tmp/Zen.app/Contents/Info" CFBundleShortVersionString 2>/dev/null) into Applications..."
  $SUDO mv "$tmp/Zen.app" "$APP" || fail "Couldn't move Zen to Applications."
  if [ "$(id -u)" -eq 0 ] || [ -n "$SUDO" ]; then
    $SUDO chown -R "$U":admin "$APP"   # like a drag install: Zen can update itself
  fi
fi

# ---- 2. a Zen profile ------------------------------------------------------------
ZR="$H/Library/Application Support/zen"
has_profile() {
  [ -f "$ZR/profiles.ini" ] &&
    awk -F= '/^\[Install/{f=1} f&&/^Default=/{ok=1} END{exit !ok}' "$ZR/profiles.ini"
}
if ! has_profile; then
  say "No Zen profile yet: starting Zen once in the background to create it..."
  as_user "$APP/Contents/MacOS/zen" --headless about:blank >/dev/null 2>&1 &
  for _ in $(seq 1 40); do has_profile && break; sleep 1; done
  sleep 3                                  # let it finish writing the profile
  pkill -TERM -u "$U" -x zen 2>/dev/null
  for _ in $(seq 1 10); do pgrep -u "$U" -x zen >/dev/null || break; sleep 1; done
  pkill -KILL -u "$U" -x zen 2>/dev/null
  has_profile || fail "Zen didn't create a profile. Open Zen once, quit it, then try again."
fi
exit 0
