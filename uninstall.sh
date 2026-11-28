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
for f in arcToolbarTint arcUrlbarButtons arcUrlbarFit arcCompactSidebar arcDomainOnly arcAutoPip arcTabUndo arcPipFlick arcPipLayout arcColorWheel arcEasel arcNotices zzArcDebug zzPipDebug; do
  rm -f "$CHROME/JS/$f.uc.js"
done
rm -f "$CHROME/almost-arc.css" "$CHROME/almost-arc-install.json"
# the easel page arcEasel.uc.js wrote (your drawings in <profile>/almost-arc-easels stay)
rm -rf "$CHROME/almost-arc-easel"
[ -f "$CHROME/userChrome.css" ] && sed -i.bak '/almost-arc.css/d' "$CHROME/userChrome.css"
[ -f "$ZEN_PROFILE/user.js" ] && sed -i.bak '/\/\/ >>> almost-arc/,/\/\/ <<< almost-arc/d' "$ZEN_PROFILE/user.js"
# Remove the Almost Arc app icon that install.sh set (macOS), with app-icon.sh
# (it clears both halves of a Finder custom icon and refreshes Finder and the Dock).
APP_BUNDLE="${ZEN_APP:-/Applications/Zen.app/Contents/Resources}"; APP_BUNDLE="${APP_BUNDLE%/Contents/Resources}"
if [ "$(uname)" = Darwin ] && [ -d "$APP_BUNDLE" ] &&
   { [ -e "$APP_BUNDLE/Icon"$'\r' ] || xattr -p com.apple.FinderInfo "$APP_BUNDLE" >/dev/null 2>&1; }; then
  out="$("$(cd "$(dirname "$0")" && pwd)/app-icon.sh" zen "$APP_BUNDLE" 2>&1)" || true
  out="${out##*$'\n'}"; out="${out#Error: }"
  [ "$out" = "Zen already has its own icon." ] || echo "$(printf '%s' "${out:0:1}" | tr '[:lower:]' '[:upper:]')${out:1}"
fi
echo "Removed. Restart Zen. Prefs it changed keep their current values; reset them in about:config if you want."
