#!/usr/bin/env bash
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at https://mozilla.org/MPL/2.0/.
#
# Real-Zen smoke test on Linux: downloads the official Zen for Linux (cached),
# makes a fresh home folder and profile, installs Almost Arc from this checkout
# with ./install.sh the way a user would, starts Zen under Xvfb with Marionette
# and runs tests/zen/smoke.mjs against it.
#
# Usage: tests/zen/run-linux.sh [work dir] [-- smoke.mjs args]
# Needs: curl, tar, xz, Xvfb (xvfb-run), node 22.
set -euo pipefail
REPO="$(cd "$(dirname "$0")/../.." && pwd)"
WORK="${1:-${TMPDIR:-/tmp}/almost-arc-zen-test}"; shift || true
[ "${1:-}" = "--" ] && shift
ZEN_VERSION="${ZEN_VERSION:-latest}"
mkdir -p "$WORK"

# ---- Zen ------------------------------------------------------------------
if [ ! -x "$WORK/app/zen/zen" ]; then
  url="https://github.com/zen-browser/desktop/releases/latest/download/zen.linux-x86_64.tar.xz"
  [ "$ZEN_VERSION" != latest ] && url="https://github.com/zen-browser/desktop/releases/download/$ZEN_VERSION/zen.linux-x86_64.tar.xz"
  echo "Downloading $url"
  mkdir -p "$WORK/dl" "$WORK/app"
  curl -fsSL -o "$WORK/dl/zen.tar.xz" "$url"
  tar -xJf "$WORK/dl/zen.tar.xz" -C "$WORK/app"
fi
echo "Zen $(sed -n 's/^Version=//p' "$WORK/app/zen/application.ini" | head -1)"

# ---- a fresh home and profile (Zen makes it on its first start) -------------
rm -rf "$WORK/home"; mkdir -p "$WORK/home"
export HOME="$WORK/home"
timeout 30 "$WORK/app/zen/zen" --headless about:blank >"$WORK/first-run.log" 2>&1 || true
for _ in $(seq 1 20); do
  grep -qs '^Default=' "$HOME"/.config/zen/installs.ini "$HOME"/.zen/installs.ini && break
  sleep 0.5
done

# ---- the mod, installed like a user would (Zen's folder found by install.sh) ----
# like Zen's own Linux installer: a `zen` command in ~/.local/bin
mkdir -p "$HOME/.local/bin" && ln -sf "$WORK/app/zen/zen" "$HOME/.local/bin/zen"
export PATH="$HOME/.local/bin:$PATH"
# Zen's app folder isn't writable on a normal install; this copy is.
# NO_MOD=1: plain Zen, to compare against (smoke.mjs checks then fail where the mod is needed)
if [ "${NO_MOD:-0}" = 1 ]; then rm -f "$WORK/app/zen/config.js" "$WORK/app/zen/defaults/pref/config-prefs.js"
else "$REPO/install.sh" </dev/null; fi

ROOT="$HOME/.zen"; [ -d "$ROOT" ] || ROOT="$HOME/.config/zen"
REL="$(awk -F= '/^\[Install/{f=1} f&&/^Default=/{print $2; exit}' "$ROOT/profiles.ini")"
PROFILE="$ROOT/$REL"
# the plain Zen to compare with gets the same layout the mod uses (sidebar + top toolbar)
[ "${NO_MOD:-0}" = 1 ] && echo 'user_pref("zen.view.use-single-toolbar", false);' >> "$PROFILE/user.js"
# the test video plays with sound (Firefox only pops out unmuted videos on a tab switch)
echo 'user_pref("media.autoplay.default", 0);' >> "$PROFILE/user.js"
# no update check against GitHub during the test
echo 'user_pref("almost-arc.update-notice", false);' >> "$PROFILE/user.js"
# tab undo explains its decisions in <profile>/almost-arc-undo-debug.log (shown on failure)
echo 'user_pref("almost-arc.undo-debug", true);' >> "$PROFILE/user.js"

# ---- run ----------------------------------------------------------------------
PORT="${MARIONETTE_PORT:-2828}"
echo "user_pref(\"marionette.port\", $PORT);" >> "$PROFILE/user.js"
# A window manager (ZEN_TEST_WM, else twm or openbox if installed) so Zen draws its own
# title bar and window buttons as on a desktop (client-side, as on GNOME).
WM="${ZEN_TEST_WM:-$(command -v twm || command -v openbox || true)}"
WM_ARGS=""
if [ "$(basename "${WM:-x}")" = twm ]; then
  # place windows without asking for a click, no twm title bar of its own
  printf 'RandomPlacement\nNoTitle\n' > "$WORK/twmrc"; WM_ARGS="-f $WORK/twmrc"
fi
MOZ_GTK_TITLEBAR_DECORATION="${MOZ_GTK_TITLEBAR_DECORATION:-client}" \
  MOZ_REMOTE_ALLOW_SYSTEM_ACCESS=1 WM="$WM" WM_ARGS="$WM_ARGS" setsid xvfb-run -a -s "-screen 0 1440x900x24" \
  bash -c '[ -n "$WM" ] && { "$WM" $WM_ARGS >/dev/null 2>&1 & sleep 1; }; exec "$0" "$@"' \
  "$WORK/app/zen/zen" --marionette -profile "$PROFILE" >"$WORK/zen.log" 2>&1 &
ZEN_PID=$!
trap 'kill -- -$ZEN_PID 2>/dev/null || true' EXIT
status=0
node "${SMOKE:-$REPO/tests/zen/smoke.mjs}" --port "$PORT" "$@" || status=$?
if [ "$status" != 0 ]; then
  echo "--- Zen's log (last 40 lines)"; tail -40 "$WORK/zen.log"
  echo "--- tab undo log"; tail -30 "$PROFILE/almost-arc-undo-debug.log" 2>/dev/null || true
fi
exit "$status"
