#!/usr/bin/env bash
# Almost Arc for Zen - manual install (no Sine needed).
# Usage:  ./install.sh                 (auto-detects Zen + default profile)
#         ZEN_PROFILE=/path/to/profile ZEN_APP=/path/to/zen/resources ./install.sh
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"

# ---- locate Zen ---------------------------------------------------------
case "$(uname)" in
  Darwin) ZEN_ROOT="$HOME/Library/Application Support/zen"
          ZEN_APP="${ZEN_APP:-/Applications/Zen.app/Contents/Resources}" ;;
  Linux)  ZEN_ROOT="$HOME/.zen"; [ -d "$ZEN_ROOT" ] || ZEN_ROOT="$HOME/.config/zen"
          ZEN_APP="${ZEN_APP:-}" ;;
  *) echo "Unsupported OS. Set ZEN_PROFILE and ZEN_APP and rerun."; exit 1 ;;
esac

if [ -z "${ZEN_PROFILE:-}" ]; then
  REL="$(awk -F= '/^\[Install/{f=1} f&&/^Default=/{print $2; exit}' "$ZEN_ROOT/profiles.ini")"
  ZEN_PROFILE="$ZEN_ROOT/$REL"
fi
[ -d "$ZEN_PROFILE" ] || { echo "Profile not found: $ZEN_PROFILE"; exit 1; }
if [ -z "$ZEN_APP" ] || [ ! -d "$ZEN_APP" ]; then
  echo "Zen install folder not found. Set ZEN_APP to the folder that contains Zen's omni.ja"
  echo "(e.g. /opt/zen) and rerun."; exit 1
fi

if pgrep -xi zen >/dev/null 2>&1; then
  echo "Please quit Zen first (Cmd+Q / close all windows), then rerun."; exit 1
fi

echo "Profile: $ZEN_PROFILE"
echo "Zen app: $ZEN_APP"
CHROME="$ZEN_PROFILE/chrome"
mkdir -p "$CHROME/JS"

# ---- 1. script loader (fx-autoconfig) ----------------------------------
SUDO=""; [ -w "$ZEN_APP" ] || SUDO="sudo"
if [ ! -f "$ZEN_APP/config.js" ]; then
  echo "Installing script loader into Zen (may ask for your password)..."
  $SUDO cp "$HERE/vendor/fx-autoconfig/program/config.js" "$ZEN_APP/"
  $SUDO mkdir -p "$ZEN_APP/defaults/pref"
  $SUDO cp "$HERE/vendor/fx-autoconfig/program/defaults/pref/config-prefs.js" "$ZEN_APP/defaults/pref/"
else
  echo "Script loader already present in Zen (config.js) - leaving it."
fi
if [ ! -d "$CHROME/utils" ]; then
  cp -R "$HERE/vendor/fx-autoconfig/utils" "$CHROME/utils"
else
  echo "chrome/utils already exists (Sine/fx-autoconfig) - leaving it."
fi

# ---- 2. styles -----------------------------------------------------------
cp "$HERE/chrome.css" "$CHROME/almost-arc.css"
touch "$CHROME/userChrome.css"
if ! grep -q 'almost-arc.css' "$CHROME/userChrome.css"; then
  { echo '@import url("almost-arc.css");'; cat "$CHROME/userChrome.css"; } > "$CHROME/userChrome.css.tmp"
  mv "$CHROME/userChrome.css.tmp" "$CHROME/userChrome.css"
fi

# ---- 3. scripts ----------------------------------------------------------
# remove scripts from older versions of this mod
rm -f "$CHROME/JS/zzArcDebug.uc.js" "$CHROME/JS/zzPipDebug.uc.js"
cp "$HERE"/JS/*.uc.js "$CHROME/JS/"

# ---- 4. prefs (user.js, managed block) ----------------------------------
USERJS="$ZEN_PROFILE/user.js"
touch "$USERJS"
sed -i.bak '/\/\/ >>> almost-arc/,/\/\/ <<< almost-arc/d' "$USERJS"
cat >> "$USERJS" <<'PREFS'
// >>> almost-arc (managed by Almost Arc install.sh - edit or remove freely)
user_pref("toolkit.legacyUserProfileCustomizations.stylesheets", true);
user_pref("zen.view.use-single-toolbar", false);
user_pref("zen.view.compact.hide-toolbar", false);
user_pref("zen.urlbar.behavior", "float");
user_pref("browser.urlbar.trimWww", true);
user_pref("browser.urlbar.formatting.enabled", true);
user_pref("media.videocontrols.picture-in-picture.enable-when-switching-tabs.enabled", true);
user_pref("media.videocontrols.picture-in-picture.enable-when-occluded.enabled", true);
// <<< almost-arc
PREFS

echo
echo "Done. Open Zen -> about:support -> 'Clear startup cache', and let it restart."
echo "Note: Zen updates remove the loader from the app folder - rerun this script after updating."
