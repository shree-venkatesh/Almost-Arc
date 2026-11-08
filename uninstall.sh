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
for f in arcToolbarTint arcUrlbarButtons arcUrlbarFit arcCompactSidebar arcDomainOnly arcAutoPip arcTabUndo zzArcDebug zzPipDebug; do
  rm -f "$CHROME/JS/$f.uc.js"
done
rm -f "$CHROME/arc-toolbar.css" "$CHROME/almost-arc.css"
[ -f "$CHROME/userChrome.css" ] && sed -i.bak -e '/arc-toolbar.css/d' -e '/almost-arc.css/d' "$CHROME/userChrome.css"
[ -f "$ZEN_PROFILE/user.js" ] && sed -i.bak -e '/\/\/ >>> arc-toolbar/,/\/\/ <<< arc-toolbar/d' -e '/\/\/ >>> almost-arc/,/\/\/ <<< almost-arc/d' "$ZEN_PROFILE/user.js"
echo "Removed. Restart Zen. Prefs it changed keep their current values; reset them in about:config if you want."
