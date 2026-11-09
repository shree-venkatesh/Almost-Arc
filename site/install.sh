#!/usr/bin/env bash
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at https://mozilla.org/MPL/2.0/.
#
# Almost Arc installer for people without Homebrew:
#   curl -fsSL https://almostarc.net/install.sh | bash
#
# Downloads the latest release into ~/.almost-arc, adds an `almost-arc`
# command (install / update / uninstall / --version) to /usr/local/bin,
# then runs the release's own install.sh. Rerunning it updates.
#
# Everything is inside main(), which runs on the last line, so a cut-off
# download can never run half a script.

main() {
  set -euo pipefail

  local REPO="shree-venkatesh/Almost-Arc"
  local SITE="https://almostarc.net"
  local ROOT="$HOME/.almost-arc"
  local BIN_DIR="${ALMOST_ARC_BIN_DIR:-/usr/local/bin}"
  local LINK="$BIN_DIR/almost-arc"
  local CMD="$ROOT/bin/almost-arc"

  say()  { printf '%s\n' "$*"; }
  fail() { printf 'Error: %s\n' "$*" >&2; exit 1; }

  command -v curl >/dev/null || fail "curl is needed."
  command -v tar  >/dev/null || fail "tar is needed."

  # ---- already installed with Homebrew? Then there would be two `almost-arc` ----
  local brew=""
  if command -v brew >/dev/null 2>&1; then brew="$(command -v brew)"
  elif [ -x /opt/homebrew/bin/brew ]; then brew=/opt/homebrew/bin/brew
  elif [ -x /usr/local/bin/brew ]; then brew=/usr/local/bin/brew
  fi
  if [ -n "$brew" ] && [ -e "$("$brew" --prefix)/opt/almost-arc" ]; then
    say "Almost Arc is already installed with Homebrew. Either keep using that:"
    say ""
    say "  brew update && brew upgrade almost-arc && almost-arc install"
    say ""
    say "or remove it first, then rerun this installer:"
    say ""
    say "  brew uninstall almost-arc"
    exit 1
  fi

  # ---- find the latest release ---------------------------------------------
  local tag
  tag="$(curl -fsSLo /dev/null -w '%{url_effective}' "https://github.com/$REPO/releases/latest")" \
    || fail "couldn't reach GitHub."
  tag="${tag##*/}"
  case "$tag" in v[0-9]*) ;; *) fail "couldn't find the latest release." ;; esac
  local version="${tag#v}"

  # ---- download it into ~/.almost-arc/app ----------------------------------
  say "Downloading Almost Arc $version..."
  mkdir -p "$ROOT/bin"
  local tmp; tmp="$(mktemp -d)"
  # shellcheck disable=SC2064  # expand now: $tmp is local and gone by the time EXIT fires
  trap "rm -rf '$tmp'" EXIT
  curl -fsSL "https://github.com/$REPO/archive/refs/tags/$tag.tar.gz" -o "$tmp/release.tar.gz" \
    || fail "download failed."
  mkdir "$tmp/app"
  tar -xzf "$tmp/release.tar.gz" -C "$tmp/app" --strip-components 1
  [ -x "$tmp/app/install.sh" ] || fail "the download doesn't look like an Almost Arc release."
  rm -rf "$ROOT/app"
  mv "$tmp/app" "$ROOT/app"
  printf '%s\n' "$version" > "$ROOT/VERSION"

  # ---- the almost-arc command ----------------------------------------------
  cat > "$CMD" <<EOF
#!/usr/bin/env bash
# almost-arc: manages Almost Arc installed with $SITE/install.sh
main() {
  set -euo pipefail
  local ROOT="\$HOME/.almost-arc"
  case "\${1:-}" in
    install)   shift; exec "\$ROOT/app/install.sh" "\$@" ;;
    update)    curl -fsSL "$SITE/install.sh" | bash ;;
    uninstall)
      shift
      "\$ROOT/app/uninstall.sh" "\$@"
      if [ -L "$LINK" ] && [ "\$(readlink "$LINK")" = "\$ROOT/bin/almost-arc" ]; then
        rm -f "$LINK" 2>/dev/null || sudo rm -f "$LINK"
      fi
      rm -rf "\$ROOT"
      echo "The almost-arc command and ~/.almost-arc are removed too."
      ;;
    -v|--version|version) echo "almost-arc \$(cat "\$ROOT/VERSION")" ;;
    *)
      echo "Usage: almost-arc <command>"
      echo
      echo "  install     Install Almost Arc into Zen again, e.g. after a Zen update (quit Zen first)"
      echo "  update      Download the latest Almost Arc and install it (quit Zen first)"
      echo "  uninstall   Remove Almost Arc from Zen, and this command"
      echo "  --version   Print the installed version"
      [ -z "\${1:-}" ] || [ "\$1" = "help" ] || [ "\$1" = "-h" ] || [ "\$1" = "--help" ] || exit 1
      ;;
  esac
}
main "\$@"
EOF
  chmod 755 "$CMD"

  if [ ! -L "$LINK" ] || [ "$(readlink "$LINK")" != "$CMD" ]; then
    [ -e "$LINK" ] && [ ! -L "$LINK" ] && fail "$LINK already exists and isn't ours; remove it and rerun."
    say "Adding the almost-arc command to $BIN_DIR (may ask for your password)..."
    if mkdir -p "$BIN_DIR" 2>/dev/null && [ -w "$BIN_DIR" ]; then
      ln -sf "$CMD" "$LINK"
    else
      sudo mkdir -p "$BIN_DIR"
      sudo ln -sf "$CMD" "$LINK"
    fi
  fi

  # ---- install into Zen ----------------------------------------------------
  say ""
  if "$ROOT/app/install.sh"; then
    say ""
    say "Later: 'almost-arc install' after a Zen update, 'almost-arc update' for a new"
    say "Almost Arc version, 'almost-arc uninstall' to remove it."
  else
    say ""
    say "Almost Arc $version is downloaded, but not installed into Zen yet."
    say "Fix the problem above (usually: quit Zen), then run:  almost-arc install"
    exit 1
  fi
}

main "$@"
