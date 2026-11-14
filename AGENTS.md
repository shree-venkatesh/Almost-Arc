# Almost Arc — agent instructions

Almost Arc makes Zen Browser look and behave like Arc. It ships as a Sine mod
(`theme.json`) and can also be installed without Sine via `./install.sh`, or via
Homebrew (`brew install shree-venkatesh/tap/almost-arc`, formula in the
`shree-venkatesh/homebrew-tap` repo; it wraps `install.sh` / `uninstall.sh` as
`almost-arc install|update|uninstall`, `--beta` for the newest tag).
License: MPL-2.0. Author: shree-venkatesh. Target: Zen 1.24.x (Firefox 159) on
macOS (Apple Silicon); Linux is best-effort, Windows is unsupported.

## Repo layout

| Path | What it is |
| --- | --- |
| `theme.json` | Sine manifest: name, version, `style.chrome`, `preferences`, `readme`, and `scripts` (every `JS/*.uc.js` with its `include`: `chrome://browser/content/browser.xhtml`, or the PiP player for `arcPipFlick.uc.js`) |
| `preferences.json` | Mod settings UI (checkbox / dropdown / string). Checkbox prefs drive `-moz-pref()` media queries in CSS |
| `chrome.css` | All styling: slim toolbar, card top, centered URL pill, compact sidebar, essentials tiles, fullscreen corners |
| `JS/arcToolbarTint.uc.js` | Samples the top 4 CSS px of the page (`drawSnapshot`) once per load (150/1000/2500 ms) and tints the toolbar |
| `JS/arcUrlbarFit.uc.js` | Static centered URL pill (`#arc-url-group` > `#arc-url-pill`); click toggles the floating urlbar; `fitSpace()` sets `--arc-url-avail` |
| `JS/arcUrlbarButtons.uc.js` | Moves Zen's copy-URL button left of the pill and site-data button right of it; sets `[arc-copied]` on the copy button for 1.5 s on `cmd_zenCopyCurrentURL` (checkmark in CSS; Zen's own toast still shows) |
| `JS/arcCompactSidebar.uc.js` | Arc-like compact-mode pop-out sidebar + `#almost-arc-sidebar-toggle` button |
| `JS/arcAutoPip.uc.js` | macOS auto-PiP on app/desktop switch via `lsappinfo`; skips it while Zen's page is still mostly visible (on-screen windows from CoreGraphics via `osascript`, front to back: the windows in front of Zen's hide less than half of the page area, e.g. another monitor or a smaller window over part of Zen; rechecked after 600 ms for Space animations); closes its own PiP on return |
| `JS/arcPipLayout.uc.js` | Loaded into the PiP window. Restyles Firefox's player like Arc: top bar (`#unpip` "Back to Tab", domain from `PictureInPicture.weakWinToBrowser`, our `#arc-pip-min`, `#close`), center 15 s skips + play/pause, inset progress-bar pill, volume bottom right; other loose `#controls > button`s hidden. The window's CSP blocks `<style>` and `data:` images, so CSS goes through `windowUtils.loadSheetUsingURIString` and icons are inline SVG. 15 s seeks move `#scrubber` (+ input/change events) using `#timestamp`'s duration; Minimize = Shift+click on `#close` (Firefox's close-without-pausing). Pref `almost-arc.pip-layout` |
| `JS/arcPipFlick.uc.js` | Loaded into the PiP window (`chrome://global/content/pictureinpicture/player.xhtml`, via `@include` and theme.json). Two-finger swipe (wheel events) → glide to the corner in that direction (400 ms ease-out); rest of the swipe and its momentum ignored. Pref `almost-arc.pip-flick` |
| `JS/arcTabUndo.uc.js` | Cmd+Z undo for tab close / move / pin (current session only, heavily safeguarded) |
| `JS/arcNotices.uc.js` | Sets `[almost-arc-js]` on the root (chrome.css shows a "scripts aren't running" notice on `#browser::after` without it, after 8 s; pref `almost-arc.hide-scripts-notice`). New-release notice via `gNotificationBox`: reads `chrome/almost-arc-install.json` (written by install.sh: version, method `cli`/`git`, channel `release`/`beta` from `ALMOST_ARC_BETA=1`, which the curl installer and the tap formula set for `--beta`, dir; absent for Sine, so no notice). Release channel checks `releases/latest`, beta channel the newest `vX.Y.Z` tag, each at most daily with its own cache (`almost-arc.update-last-check`/`-latest`, `-beta` suffix for beta; `-skip`), one window per session. **Update** button: runs `almost-arc update [--beta]` (first of `/opt/homebrew/bin`, `/usr/local/bin`, `~/.almost-arc/bin`) or, for git installs, `git pull --ff-only && ./install.sh`, via `Subprocess` with `ALMOST_ARC_FROM_ZEN=1` (install.sh then allows Zen to be running and uses `sudo -n`) and a full PATH; output to `<profile>/almost-arc-update.log`; then **Restart Zen** = `invalidateCachesOnRestart()` + restart. On failure the bar shows the Terminal command. Pref `almost-arc.update-notice` |
| `JS/arcDomainOnly.uc.js` | Optional domain-only URL display (`almost-arc.domain-only`) |
| `get-zen.sh` | macOS: if `/Applications/Zen.app` is missing, downloads the official `zen.macos-universal.dmg` from Zen's GitHub releases, copies it off the image with `ditto --noextattr` + `xattr -cr`, checks `codesign --verify --deep` and `TeamIdentifier=9V5K9TP787` (into a variable first: `grep -q` in a pipe under `pipefail` fails at random), installs it owned by the user; if there's no `[Install…] Default=` profile, runs Zen headless once to create one. `get-zen.sh` as the user (install.sh runs it when Zen or the profile is missing, default paths only), `get-zen.sh <user>` as root (the .pkg). Last line on failure: `Error: <message>` |
| `install.sh` / `uninstall.sh` | Non-Sine install: fx-autoconfig loader, CSS import, scripts, `user.js` block, and on macOS the Zen app icon (`assets/app-icon.png`, set as a Finder custom icon via `NSWorkspace setIcon:forFile:`; `ALMOST_ARC_ICON=0` skips it; uninstall removes it) |
| `vendor/fx-autoconfig/` | Vendored script loader (its own license) |
| `tests/` | `node --test 'tests/*.test.mjs'` (Node 22, no dependencies). `harness.mjs` runs a real `JS/*.uc.js` in `node:vm` with Zen, Firefox and macOS (`lsappinfo`, `osascript` window list) faked; `autoPip.test.mjs` covers every auto-PiP case, `notices.test.mjs` the notices, `tabUndo.test.mjs` (self-contained fakes) tab undo and every safeguard. CI: `.github/workflows/tests.yml` |
| `site/` | almostarc.net: one self-contained `index.html` styled as a browser window with Almost Arc (sidebar tabs routed by hash: `#home`, `#install`, `#features`, `#whats-new`, `#help`). **What's new** is written by hand: one `<article class="rel">` per full Release, newest first, with the Latest badge on the newest. Download for Mac reads the `.pkg` of `releases/latest`. Analytics: GoatCounter (`shree-venkatesh.goatcounter.com`, no cookies) |
| `site/install.sh` | The `curl -fsSL https://almostarc.net/install.sh \| bash` installer for people without Homebrew: downloads the latest release to `~/.almost-arc`, symlinks an `almost-arc` command (install / update / uninstall / --version) into `/usr/local/bin`, runs the release's `install.sh`. `--beta` (`| bash -s -- --beta`, `almost-arc install|update --beta`) uses the newest `vX.Y.Z` tag from the GitHub API instead of the latest Release. Refuses only when Almost Arc is already installed with Homebrew (the formula's `almost-arc` likewise refuses when `~/.almost-arc` exists). Everything runs inside `main()` so a truncated download can't run partway |
| `pkg/` | "Almost Arc for Zen" macOS installer. `build.sh <version> <tarball> <out.pkg>` (macOS only; unsigned unless `PKG_SIGN_IDENTITY`) packs the release tarball + `site/install.sh` into `/Library/Application Support/Almost Arc/pkg`. `scripts/preinstall` asks to quit Zen (AppleScript quit, never force). `scripts/postinstall` (root): runs the release's `get-zen.sh <user>` (Zen if missing, profile if none; its `Error:` line becomes the dialog), installs loader + icon + `/usr/local/bin/almost-arc`, then runs `site/install.sh` as the console user with `ALMOST_ARC_TARBALL`/`ALMOST_ARC_VERSION`/`ALMOST_ARC_ICON=0`, then clears the startup cache. `distribution.xml`: `rootVolumeOnly` (no destination page), no license page, logo background built by `build.sh`; welcome/conclusion pages are HTML converted to RTF by `textutil` (Installer shows HTML as source). macOS ships bash 3.2: no empty arrays under `set -u` |
| `.github/workflows/pkg.yml` | On fresh macOS runners (no Zen): job `pkg` builds the .pkg, installs it, checks files, Zen launches, installs again, attaches it to every Release / pre-release; job `terminal` runs `./install.sh` (the Homebrew / curl / git path) and checks. Also weekly, to catch Zen changing its download |
| `.github/workflows/pages.yml` | Deploys `site/` to GitHub Pages on pushes to `main` that touch it |
| `.github/workflows/update-homebrew.yml` | On every Release / pre-release, attaches `almost-arc-X.Y.Z.tar.gz` (counted downloads; on a promotion it reads the SHA-256 GitHub records instead of downloading the file, so the count stays clean); on full Releases, points the formula in `shree-venkatesh/homebrew-tap` at it |

## Install / test loop

- Zen must be **closed** before `./install.sh` (it refuses otherwise). Restart Zen to pick up changes.
- The loader's `config.js` lives in `/Applications/Zen.app/Contents/Resources` and is wiped by Zen updates; rerunning `./install.sh` restores it.
- `install.sh` writes the recommended **Zen/Firefox** prefs from `preferences.json` between `// >>> almost-arc` and `// <<< almost-arc` in `user.js`; keep that block in sync. Do **not** put `almost-arc.*` prefs there (user.js would reset them every startup): each script registers its own `almost-arc.*` defaults with `Services.prefs.getDefaultBranch("")` so they show in about:config for every install method, and migrates the 1.0.0 `arc-toolbar.*` value if present.
- Debug logs (off by default) go to the profile dir: `almost-arc.pip-debug` → `almost-arc-pip-debug.log`, `almost-arc.undo-debug` → `almost-arc-undo-debug.log`.
- Tests: `node --test 'tests/*.test.mjs'`. Auto-PiP (`arcAutoPip.uc.js`), the notices (`arcNotices.uc.js`) and tab undo (`arcTabUndo.uc.js`) are covered; run them after touching either, and add a test for every new case or bug. They test decisions against faked Zen/macOS answers, so still verify in a running Zen. Everything else has no automated tests.

## Hard constraints — do not violate

1. **No LaunchAgent / auto-reinstall** of the loader after Zen updates. The user explicitly rejected this.
2. **Tab undo keeps every safeguard**: arm only after `SessionStore.promiseAllWindowsRestored` + 1.5 s; record only changes within 1.5 s of real user input; ignore Zen's startup-restore moves; refuse (and clear history) if an undo would move, pin or unpin >5 tabs (a step of closes only may reopen more through `SessionStore.undoCloseTab`, owner's decision 2026-11-12, but above 5 it only reopens: no pinning or folder moves); back up `zen-sessions.jsonlz4` to `<profile>/zen-sessions-undo-backups/` (keep 10) before each undo; only undo a close if the closed-tab URL matches; skip Cmd+Z when typing (`windowUtils.IMEStatus`, focused input/textarea). An earlier version without these wiped the user's pinned tabs and folders.
3. **Auto-PiP must not fire** on Control Center, Notification Center, Spotlight, screenshots, Dock, or other system UI — only on a real switch to a `Foreground` app or another desktop. Don't go back to focus/occlusion-based triggers (too sensitive / don't fire on Space switches).
4. **The URL pill is static**: hover highlight is fine, but clicking must not change, expand, or select its text — it only toggles the floating urlbar.
5. **Toolbar tint is sampled at load**, not continuously.
6. All prefs are namespaced `almost-arc.*`. Never reintroduce `arc-toolbar`.
7. `install.sh` and `uninstall.sh` must stay executable (`chmod +x` after rewriting).
8. Debug logging stays off by default and never writes outside the profile dir.

## Zen / Firefox gotchas

- Layout assumed: "Sidebar and Top Toolbar" (`zen.view.use-single-toolbar=false`), `zen.urlbar.behavior="float"`.
- `.urlbar-background` is a **class**, not an id.
- Zen sets `container: urlbar-container / inline-size` on `#urlbar-container`; override with `container-type: normal` or it collapses to 0 width.
- `browser.urlbar.trimHttps` only works with `trimURLs=true`.
- Zen folders are tab groups (`addTabs`); essentials use `gZenPinnedTabManager.addToEssentials`.
- Unloaded tabs report `about:blank` — use `SessionStore.getTabState` for the real URL.
- Zen sessions are `zen-sessions.jsonlz4` (mozlz4); backups in `zen-sessions-backup/`.

## Conventions

- Every file keeps its MPL-2.0 header.
- CSS rules are scoped under `:root:not([zen-single-toolbar="true"]):not([inDOMFullscreen="true"]):not([popup-window])`.
- Moved Zen buttons get `skipintoolbarset` + `arc-moved`.
- Scripts guard their feature with their pref and degrade silently if Zen internals are missing.

## Releasing

Every version is a tag. Small fixes are published as GitHub **pre-releases**
(betas); a full **Release** happens only when the owner explicitly asks for one.

| | Pre-release | Release |
| --- | --- | --- |
| Sine, `git pull` users | get it | get it |
| `almost-arc install --beta` / `update --beta` (newest tag) | get it | get it |
| Homebrew, curl (`almost-arc update`) | no | get it |

Pre-release (the default):

1. Bump `version` in `theme.json`.
2. Update `README.md` (features, settings, limitations) if behavior changed.
3. Commit, push to `main`, then `git tag vX.Y.Z && git push origin vX.Y.Z`.
4. `gh release create vX.Y.Z --verify-tag --prerelease --latest=false --title "Almost Arc X.Y.Z (beta)"`,
   notes starting "Beta. Install it with `almost-arc update --beta`."

Full Release, only when asked:

- New version: steps 1-3, then `gh release create vX.Y.Z --verify-tag`. The notes
  cover everything since the last full Release, including the betas in between.
- Either way, add the Release to the site's **What's new** (`site/index.html`,
  `#whats-new`): a short entry in plain words, and move the Latest badge to it.
- Promoting an existing beta: `gh release edit vX.Y.Z --prerelease=false --latest`
  (and retitle / rewrite the notes).

`.github/workflows/pkg.yml` attaches `Almost-Arc-for-Zen-X.Y.Z.pkg` to every Release
and pre-release.

`.github/workflows/update-homebrew.yml` attaches `almost-arc-X.Y.Z.tar.gz` (a
`git archive` of the tag) to every Release and pre-release. Homebrew, the curl
installer and `--beta` download that file, so GitHub counts downloads (it doesn't
count its automatic "Source code" archives). The count is an internal tracker, not
shown in the README:
`gh api repos/shree-venkatesh/Almost-Arc/releases -q '.[]|"\(.tag_name) \([.assets[].download_count]|add // 0)"'`
For full Releases only (event `released`), it then points `Formula/almost-arc.rb` in
`shree-venkatesh/homebrew-tap` at that file. It needs the
`HOMEBREW_TAP_TOKEN` secret (fine-grained token, Contents read/write on the tap
only). Check the Actions tab; rerun it manually with the tag if it failed.
