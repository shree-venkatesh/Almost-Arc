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
# Remove the Almost Arc app icon that install.sh set (macOS).
APP_BUNDLE="${ZEN_APP:-/Applications/Zen.app/Contents/Resources}"; APP_BUNDLE="${APP_BUNDLE%/Contents/Resources}"
if [ "$(uname)" = Darwin ] && [ -e "$APP_BUNDLE/Icon"$'\r' ]; then
  ISUDO=""; [ -w "$APP_BUNDLE" ] || ISUDO="sudo"
  $ISUDO osascript -l JavaScript -e 'function run(a) { ObjC.import("AppKit");
    return $.NSWorkspace.sharedWorkspace.setIconForFileOptions(null, a[0], 0); }' \
    "$APP_BUNDLE" >/dev/null 2>&1 || true
  [ -e "$APP_BUNDLE/Icon"$'\r' ] && $ISUDO rm -f "$APP_BUNDLE/Icon"$'\r' || true
  echo "Removed the Almost Arc icon from Zen."
fi
echo "Removed. Restart Zen. Prefs it changed keep their current values; reset them in about:config if you want."
