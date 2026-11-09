# Almost Arc — agent instructions

Almost Arc makes Zen Browser look and behave like Arc. It ships as a Sine mod
(`theme.json`) and can also be installed without Sine via `./install.sh`, or via
Homebrew (`brew install shree-venkatesh/tap/almost-arc`, formula in the
`shree-venkatesh/homebrew-tap` repo; it wraps `install.sh` / `uninstall.sh` as
`almost-arc install|uninstall`).
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
| `JS/arcUrlbarButtons.uc.js` | Moves Zen's copy-URL button left of the pill and site-data button right of it |
| `JS/arcCompactSidebar.uc.js` | Arc-like compact-mode pop-out sidebar + `#almost-arc-sidebar-toggle` button |
| `JS/arcAutoPip.uc.js` | macOS auto-PiP on app/desktop switch via `lsappinfo`; closes its own PiP on return |
| `JS/arcPipLayout.uc.js` | Loaded into the PiP window. Restyles Firefox's player like Arc: top bar (`#unpip` "Back to Tab", domain from `PictureInPicture.weakWinToBrowser`, our `#arc-pip-min`, `#close`), center 15 s skips + play/pause, inset progress-bar pill, volume bottom right; other loose `#controls > button`s hidden. The window's CSP blocks `<style>` and `data:` images, so CSS goes through `windowUtils.loadSheetUsingURIString` and icons are inline SVG. 15 s seeks move `#scrubber` (+ input/change events) using `#timestamp`'s duration; Minimize = Shift+click on `#close` (Firefox's close-without-pausing). Pref `almost-arc.pip-layout` |
| `JS/arcPipFlick.uc.js` | Loaded into the PiP window (`chrome://global/content/pictureinpicture/player.xhtml`, via `@include` and theme.json). Two-finger swipe (wheel events) → glide to the corner in that direction (400 ms ease-out); rest of the swipe and its momentum ignored. Pref `almost-arc.pip-flick` |
| `JS/arcTabUndo.uc.js` | Cmd+Z undo for tab close / move / pin (current session only, heavily safeguarded) |
| `JS/arcDomainOnly.uc.js` | Optional domain-only URL display (`almost-arc.domain-only`) |
| `install.sh` / `uninstall.sh` | Non-Sine install: fx-autoconfig loader, CSS import, scripts, `user.js` block |
| `vendor/fx-autoconfig/` | Vendored script loader (its own license) |
| `site/` | almostarc.net: one self-contained `index.html` (currently a placeholder; the owner is designing the real page themselves). Analytics: GoatCounter (`shree-venkatesh.goatcounter.com`, no cookies) |
| `site/install.sh` | The `curl -fsSL https://almostarc.net/install.sh \| bash` installer for people without Homebrew: downloads the latest release to `~/.almost-arc`, symlinks an `almost-arc` command (install / update / uninstall / --version) into `/usr/local/bin`, runs the release's `install.sh`. Refuses only when Almost Arc is already installed with Homebrew (the formula's `almost-arc` likewise refuses when `~/.almost-arc` exists). Everything runs inside `main()` so a truncated download can't run partway |
| `.github/workflows/pages.yml` | Deploys `site/` to GitHub Pages on pushes to `main` that touch it |
| `.github/workflows/update-homebrew.yml` | On a published Release, updates the formula in `shree-venkatesh/homebrew-tap` |

## Install / test loop

- Zen must be **closed** before `./install.sh` (it refuses otherwise). Restart Zen to pick up changes.
- The loader's `config.js` lives in `/Applications/Zen.app/Contents/Resources` and is wiped by Zen updates; rerunning `./install.sh` restores it.
- `install.sh` writes the recommended **Zen/Firefox** prefs from `preferences.json` between `// >>> almost-arc` and `// <<< almost-arc` in `user.js`; keep that block in sync. Do **not** put `almost-arc.*` prefs there (user.js would reset them every startup): each script registers its own `almost-arc.*` defaults with `Services.prefs.getDefaultBranch("")` so they show in about:config for every install method, and migrates the 1.0.0 `arc-toolbar.*` value if present.
- Debug logs (off by default) go to the profile dir: `almost-arc.pip-debug` → `almost-arc-pip-debug.log`, `almost-arc.undo-debug` → `almost-arc-undo-debug.log`.
- There are no automated tests; verify in a running Zen.

## Hard constraints — do not violate

1. **No LaunchAgent / auto-reinstall** of the loader after Zen updates. The user explicitly rejected this.
2. **Tab undo keeps every safeguard**: arm only after `SessionStore.promiseAllWindowsRestored` + 1.5 s; record only changes within 1.5 s of real user input; ignore Zen's startup-restore moves; refuse (and clear history) if an undo would touch >5 tabs; back up `zen-sessions.jsonlz4` to `<profile>/zen-sessions-undo-backups/` (keep 10) before each undo; only undo a close if the closed-tab URL matches; skip Cmd+Z when typing (`windowUtils.IMEStatus`, focused input/textarea). An earlier version without these wiped the user's pinned tabs and folders.
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

1. Bump `version` in `theme.json`.
2. Update `README.md` (features, settings, limitations) if behavior changed.
3. Commit, push to `main`, then `git tag vX.Y.Z && git push --tags`.
4. Create the GitHub Release for the tag (`gh release create vX.Y.Z --verify-tag`).
5. Publishing the Release (not a bare tag, not a pre-release) runs
   `.github/workflows/update-homebrew.yml`, which points `Formula/almost-arc.rb` in
   `shree-venkatesh/homebrew-tap` at the new tarball. It needs the
   `HOMEBREW_TAP_TOKEN` secret (fine-grained token, Contents read/write on the tap only).
   Check the Actions tab; rerun it manually with the tag if it failed.
