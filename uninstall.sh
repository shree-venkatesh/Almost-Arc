#!/usr/bin/env bash
# Removes Almost Arc files from your Zen profile. Leaves the script loader in place
# (other mods may use it); delete config.js + defaults/pref/config-prefs.js from the
# Zen app folder yourself if you want it gone.
set -euo pipefail
case "$(uname)" in
  Darwin) ZEN_ROOT="$HOME/Library/Application Support/zen" ;;
  *) ZEN_ROOT="$HOME/.zen"; [ -d "$ZEN_ROOT" ] || ZEN_ROOT="$HOME/.config/zen" ;;
esac
if [ -z "${ZEN_PROFILE:-}" ]; then
  REL="$(awk -F= '/^\[Install/{f=1} f&&/^Default=/{print $2; exit}' "$ZEN_ROOT/profiles.ini")"
  ZEN_PROFILE="$ZEN_ROOT/$REL"
fi
CHROME="$ZEN_PROFILE/chrome"
for f in arcToolbarTint arcUrlbarButtons arcUrlbarFit arcCompactSidebar arcDomainOnly arcAutoPip arcTabUndo arcPipFlick arcPipLayout arcNotices zzArcDebug zzPipDebug; do
  rm -f "$CHROME/JS/$f.uc.js"
done
rm -f "$CHROME/almost-arc.css" "$CHROME/almost-arc-install.json"
[ -f "$CHROME/userChrome.css" ] && sed -i.bak '/almost-arc.css/d' "$CHROME/userChrome.css"
[ -f "$ZEN_PROFILE/user.js" ] && sed -i.bak '/\/\/ >>> almost-arc/,/\/\/ <<< almost-arc/d' "$ZEN_PROFILE/user.js"
# Remove the Almost Arc app icon that install.sh set (macOS). A Finder custom icon
# is two things: the hidden "Icon\r" file in Zen.app and the "has custom icon" flag
# (kHasCustomIcon, 0x04 in byte 8 of com.apple.FinderInfo) on Zen.app itself. Both
# must go: the flag without the file makes Finder and the Dock show a plain folder.
APP_BUNDLE="${ZEN_APP:-/Applications/Zen.app/Contents/Resources}"; APP_BUNDLE="${APP_BUNDLE%/Contents/Resources}"
finder_info() { xattr -px com.apple.FinderInfo "$APP_BUNDLE" 2>/dev/null | tr -d ' \n'; }
has_icon_flag() {
  local hex; hex="$(finder_info)"
  [ "${#hex}" -ge 18 ] && [ $(( 0x${hex:16:2} & 0x04 )) -ne 0 ]
}
if [ "$(uname)" = Darwin ] && [ -d "$APP_BUNDLE" ] && { [ -e "$APP_BUNDLE/Icon"$'\r' ] || has_icon_flag; }; then
  ISUDO=""; [ -w "$APP_BUNDLE" ] || ISUDO="sudo"
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
  # Make Finder and the Dock drop the cached icon and read Zen's own again
  $ISUDO touch "$APP_BUNDLE" 2>/dev/null || true
  /System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister -f "$APP_BUNDLE" >/dev/null 2>&1 || true
  osascript -e "tell application \"Finder\" to update (POSIX file \"$APP_BUNDLE\" as alias)" >/dev/null 2>&1 || true
  killall Dock 2>/dev/null || true     # the Dock restarts at once with fresh icons
  if [ -e "$APP_BUNDLE/Icon"$'\r' ] || has_icon_flag; then
    echo "Couldn't fully remove the Almost Arc icon from Zen. Reinstalling Zen from zen-browser.app restores it."
  else
    echo "Removed the Almost Arc icon from Zen."
  fi
fi
echo "Removed. Restart Zen. Prefs it changed keep their current values; reset them in about:config if you want."
