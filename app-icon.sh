#!/usr/bin/env bash
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at https://mozilla.org/MPL/2.0/.
#
# Zen's app icon in the Dock and Finder (macOS): Almost Arc's, or Zen's own.
# Usage:  app-icon.sh almost-arc|zen [/path/to/Zen.app]
#
# The Almost Arc icon is a Finder custom icon, the same as pasting one in Get Info.
# A custom icon is two things: the hidden "Icon\r" file in Zen.app and the "has
# custom icon" flag (kHasCustomIcon, 0x04 in byte 8 of com.apple.FinderInfo) on
# Zen.app itself. Removing it must clear both: the flag without the file makes
# Finder and the Dock show a plain folder.
#
# Run by install.sh, uninstall.sh and the App icon choice in Zen's settings
# (Settings > Almost Arc), which sets ALMOST_ARC_FROM_ZEN=1: no Terminal to type a
# password in, so sudo -n. ALMOST_ARC_ICON_REFRESH=1 also refreshes Finder and the
# Dock after setting it (removing always does), so the change shows right away.
# Last line on failure: "Error: <message>".
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
CHOICE="${1:-}"
APP_BUNDLE="${2:-/Applications/Zen.app}"

fail() { echo "Error: $*"; exit 1; }
[ "$(uname)" = Darwin ] || fail "the app icon can only be changed on macOS."
[ -d "$APP_BUNDLE" ] || fail "Zen isn't at $APP_BUNDLE."

ISUDO=""; [ -w "$APP_BUNDLE" ] || ISUDO="sudo"
[ -n "$ISUDO" ] && [ "${ALMOST_ARC_FROM_ZEN:-0}" = 1 ] && ISUDO="sudo -n"

finder_info() { xattr -px com.apple.FinderInfo "$APP_BUNDLE" 2>/dev/null | tr -d ' \n'; }
has_icon_flag() {
  local hex; hex="$(finder_info)"
  [ "${#hex}" -ge 18 ] && [ $(( 0x${hex:16:2} & 0x04 )) -ne 0 ]
}
has_custom_icon() { [ -e "$APP_BUNDLE/Icon"$'\r' ] || has_icon_flag; }

# Make Finder and the Dock drop the cached icon and read the current one
refresh() {
  $ISUDO touch "$APP_BUNDLE" 2>/dev/null || true
  /System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister -f "$APP_BUNDLE" >/dev/null 2>&1 || true
  osascript -e "tell application \"Finder\" to update (POSIX file \"$APP_BUNDLE\" as alias)" >/dev/null 2>&1 || true
  killall Dock 2>/dev/null || true     # the Dock restarts at once with fresh icons
}

case "$CHOICE" in
  almost-arc)
    [ -f "$HERE/assets/app-icon.png" ] || fail "assets/app-icon.png is missing."
    if [ "$($ISUDO osascript -l JavaScript -e 'function run(a) { ObjC.import("AppKit");
          var img = $.NSImage.alloc.initWithContentsOfFile(a[0]);
          return $.NSWorkspace.sharedWorkspace.setIconForFileOptions(img, a[1], 0); }' \
          "$HERE/assets/app-icon.png" "$APP_BUNDLE" 2>/dev/null)" != true ]; then
      fail "couldn't set the icon on $APP_BUNDLE."
    fi
    [ "${ALMOST_ARC_ICON_REFRESH:-0}" = 1 ] && refresh
    echo "Set the Almost Arc icon on Zen."
    ;;
  zen)
    if has_custom_icon; then
      $ISUDO osascript -l JavaScript -e 'function run(a) { ObjC.import("AppKit");
        return $.NSWorkspace.sharedWorkspace.setIconForFileOptions(null, a[0], 0); }' \
        "$APP_BUNDLE" >/dev/null 2>&1 || true
      [ -e "$APP_BUNDLE/Icon"$'\r' ] && { $ISUDO rm -f "$APP_BUNDLE/Icon"$'\r' || true; }
      if has_icon_flag; then        # macOS didn't clear the flag: clear that one bit ourselves
        hex="$(finder_info)"
        hex="${hex:0:16}$(printf '%02x' $(( 0x${hex:16:2} & 0xfb )))${hex:18}"
        if [ -z "${hex//0/}" ]; then $ISUDO xattr -d com.apple.FinderInfo "$APP_BUNDLE" 2>/dev/null || true
        else $ISUDO xattr -wx com.apple.FinderInfo "$hex" "$APP_BUNDLE" 2>/dev/null || true; fi
      fi
      refresh
      has_custom_icon && fail "couldn't fully remove the Almost Arc icon from Zen. Reinstalling Zen from zen-browser.app restores it."
      echo "Removed the Almost Arc icon from Zen."
    else
      echo "Zen already has its own icon."
    fi
    ;;
  *) fail "usage: app-icon.sh almost-arc|zen [/path/to/Zen.app]" ;;
esac
