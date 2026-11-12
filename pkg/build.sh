#!/bin/bash
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at https://mozilla.org/MPL/2.0/.
#
# Builds "Almost Arc for Zen" .pkg (macOS only: pkgbuild, productbuild).
#   pkg/build.sh <version> <almost-arc-X.Y.Z.tar.gz> <output.pkg>
# The package carries the release file and the curl installer (site/install.sh);
# pkg/scripts/postinstall does the install. Unsigned unless PKG_SIGN_IDENTITY is
# set to a "Developer ID Installer: ..." identity in the keychain.
set -euo pipefail
VERSION="$1"; TARBALL="$2"; OUT="$3"
HERE="$(cd "$(dirname "$0")" && pwd)"
work="$(mktemp -d)"; trap 'rm -rf "$work"' EXIT

mkdir -p "$work/root"
cp "$TARBALL" "$work/root/almost-arc-$VERSION.tar.gz"
cp "$HERE/../site/install.sh" "$work/root/install.sh"
printf '%s\n' "$VERSION" > "$work/root/VERSION"
chmod 755 "$HERE/scripts/preinstall" "$HERE/scripts/postinstall"

pkgbuild --root "$work/root" \
  --install-location "/Library/Application Support/Almost Arc/pkg" \
  --scripts "$HERE/scripts" \
  --identifier net.almostarc.installer --version "$VERSION" \
  "$work/almost-arc.pkg"

# Installer shows .html pages as source in some cases; RTF it always renders.
mkdir "$work/resources"
# Logo, bottom-left: 128 pt with a 24 pt margin, 1x and 2x in one TIFF for Retina.
for scale in 1 2; do
  sips -z $((128 * scale)) $((128 * scale)) "$HERE/../assets/app-icon.png" --out "$work/logo$scale.png" >/dev/null
  sips -p $((176 * scale)) $((176 * scale)) "$work/logo$scale.png" --out "$work/logo$scale.png" >/dev/null
done
tiffutil -cathidpicheck "$work/logo1.png" "$work/logo2.png" -out "$work/resources/background.tiff" >/dev/null
for page in welcome conclusion; do
  textutil -convert rtf -output "$work/resources/$page.rtf" "$HERE/resources/$page.html"
done

sed "s/@VERSION@/$VERSION/g" "$HERE/distribution.xml" > "$work/distribution.xml"
sign=(); [ -n "${PKG_SIGN_IDENTITY:-}" ] && sign=(--sign "$PKG_SIGN_IDENTITY")
productbuild --distribution "$work/distribution.xml" \
  --resources "$work/resources" --package-path "$work" ${sign[@]+"${sign[@]}"} "$OUT"
echo "Built $OUT"
