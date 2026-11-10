# Almost Arc

Makes Zen Browser look and feel almost like Arc.

- **Toolbar is the top of the page card.** Rounded top corners, the card's shadow, a full-height sidebar beside it, and square corners in borderless fullscreen.
- **Toolbar color matches the page.** It's sampled from the page's top edge once each page has loaded. New tabs and other transparent pages get a frosted tint over your space gradient.
- **Centered URL pill** sized to its text: the domain is bright and the path dimmed, with a highlight on hover. Clicking it opens Zen's floating address bar, like Arc's command bar, and clicking again closes it. The pill itself never moves. A URL too long for the pill is cut at its end with a single `…` (`google.com/sea…`).
- **Copy-link button** sits right next to the pill. **Site settings / extensions** moves to the right side of the toolbar.
- **Arc-style essentials tiles:** light, frosted tiles, and an outlined tile for the selected one.
- **Hidden-sidebar (compact) mode works like Arc.** The pop-out sidebar runs full height with the window buttons at its top, and a sidebar button starts the toolbar.
- **Auto Picture-in-Picture like Arc:** a playing video pops out when you switch tabs, minimize, or switch to another app or desktop, and closes when you come back. Spotlight, screenshots and Control Center don't trigger it, and neither does clicking an app that doesn't cover Zen's window, such as one on another monitor. App and desktop switching is macOS only.
- **Arc's PiP controls:** **Back to Tab**, the site's domain, **Minimize** (closes PiP and keeps the video playing, so you still hear it) and **Close** across the top; a big play/pause with 15-second skips in the middle; a slim progress bar at the bottom. Firefox's volume controls stay, bottom right.
- **Flick PiP into a corner:** swipe with two fingers over the Picture-in-Picture window and it glides to the screen corner in that direction. Click and drag still puts it anywhere.
- **Cmd+Z undoes your tab changes** from the current session: reopens closed tabs (back into their folder or Essentials), and puts moved and pinned or unpinned tabs back. Text fields keep their normal undo. See [Tab undo safeguards](#tab-undo-safeguards).
- **Tells you when something needs doing:** if a Zen update removed the script loader, a notice at the bottom of the window says to rerun `almost-arc install`. When a new Almost Arc release is out, a bar at the top says so, with the command to update (install script, Homebrew and curl installs; Sine updates mods itself). It checks GitHub at most once a day.
- **Optional:** show only the domain in the URL pill.

Built and tested on **Zen 1.24.1b (Firefox 159), macOS**.

## Install with Sine

1. Install [Sine](https://github.com/CosmoCreeper/Sine).
2. Zen → Settings → Sine Mods → Sine settings → enable **installing JS from unofficial sources**.
3. Paste this mod's GitHub repo (`shree-venkatesh/Almost-Arc`) into the box under the marketplace and install it.
4. In the mod's settings, set the recommended options: single toolbar **off**, hide toolbar in compact mode **off**, floating address bar **Always**, hide www. **on**, and auto-PiP to taste.
5. Restart Zen.

## Install with Homebrew (macOS)

```bash
brew install shree-venkatesh/tap/almost-arc
almost-arc install
```

Quit Zen before running `almost-arc install`. It runs the same `install.sh` described below, so the same steps apply: clear the startup cache afterwards, and rerun `almost-arc install` after every Zen update.

- **Update:** quit Zen, then `almost-arc update` (runs `brew update`, `brew upgrade almost-arc` and `almost-arc install`).
- **Remove:** `almost-arc uninstall`, then `brew uninstall almost-arc`.
- **Beta:** `almost-arc update --beta` installs the newest tagged version, which may not be in Homebrew yet. A plain `almost-arc install` goes back to the Homebrew version.

## Install without Homebrew (macOS)

```bash
curl -fsSL https://almostarc.net/install.sh | bash
```

Quit Zen first. This downloads the latest release into `~/.almost-arc`, adds the same `almost-arc` command to `/usr/local/bin` (it may ask for your password), and installs. Don't mix the two installs: the curl installer stops if Almost Arc is already installed with Homebrew, and the Homebrew `almost-arc` stops if it was installed with curl.

- **After a Zen update:** `almost-arc install`.
- **Update Almost Arc:** `almost-arc update`.
- **Remove:** `almost-arc uninstall` removes the mod, the command and `~/.almost-arc`.
- **Beta:** `almost-arc update --beta` (or `curl -fsSL https://almostarc.net/install.sh | bash -s -- --beta`) installs the newest tagged version, which may not be a release yet. A plain `almost-arc update` goes back to the latest release.

## Install without Sine

```bash
git clone https://github.com/shree-venkatesh/Almost-Arc.git
cd Almost-Arc
./install.sh
```

Quit Zen first. The script then:

- **Adds a small script loader** ([fx-autoconfig](https://github.com/MrOtherGuy/fx-autoconfig), included in `vendor/`) to the Zen app. It may ask for your password.
- **Adds the styles** to your profile's `chrome/` folder as `almost-arc.css`, imported from `userChrome.css`. Your existing CSS is kept.
- **Adds the scripts** to `chrome/JS/`.
- **Writes the recommended settings** into `user.js` in a marked block that's easy to remove.
- **Gives Zen the Almost Arc icon** in the Dock and Finder (macOS), as a Finder custom icon. `./uninstall.sh` puts Zen's own icon back. To keep Zen's icon, install with `ALMOST_ARC_ICON=0 ./install.sh`.

Then open `about:support`, click **Clear startup cache**, and let Zen restart.

Linux, or a non-default profile or install location:

```bash
ZEN_PROFILE=/path/to/profile ZEN_APP=/path/to/zen-install ./install.sh
```

**After every Zen update**, rerun `./install.sh`. Updates replace the app folder and remove the script loader and the icon. Your profile files are not affected.

To remove: `./uninstall.sh`.

## Files

| File | What it does |
|---|---|
| `chrome.css` | All styling: toolbar card, shadow, pill, spacing, compact-mode layout |
| `JS/arcToolbarTint.uc.js` | Samples the top of each page once it loads and colors the toolbar to match |
| `JS/arcUrlbarFit.uc.js` | The centered URL pill: sized to its text, fits narrow windows, opens and closes the floating address bar |
| `JS/arcUrlbarButtons.uc.js` | Moves the copy-link button next to the pill and site settings / extensions to the right |
| `JS/arcCompactSidebar.uc.js` | Arc-style pop-out sidebar and toolbar sidebar button in compact mode |
| `JS/arcAutoPip.uc.js` | Auto PiP when another app or desktop comes to the front (macOS); closes when you return. Pref `almost-arc.pip-on-blur` |
| `JS/arcPipLayout.uc.js` | Arc's PiP controls. Pref `almost-arc.pip-layout` |
| `JS/arcPipFlick.uc.js` | Two-finger swipe sends the PiP window to a corner. Pref `almost-arc.pip-flick` |
| `JS/arcTabUndo.uc.js` | Cmd+Z tab undo (close, move, pin/unpin), with safeguards. Pref `almost-arc.tab-undo` |
| `JS/arcNotices.uc.js` | Marks the window as scripted (so the CSS can warn when the loader is missing) and shows the new-release notice. Pref `almost-arc.update-notice` |
| `JS/arcDomainOnly.uc.js` | Optional domain-only URL. Pref `almost-arc.domain-only` (off by default) |
| `theme.json`, `preferences.json` | Sine mod metadata and settings panel |
| `assets/app-icon.png` | The Zen app icon `install.sh` sets on macOS |
| `vendor/fx-autoconfig/` | Script loader used by `install.sh` |
| `tests/` | Auto-PiP tests: `node --test 'tests/*.test.mjs'` (Node 22) |
| `install.sh` / `uninstall.sh` | Manual install without Sine |

## Settings

- **With Sine:** Zen → Settings → Sine Mods → Almost Arc.
- **Without Sine:** open `about:config` (type it in the address bar and accept the warning), then search `almost-arc`.

| Setting | Default | What it does |
| --- | --- | --- |
| `almost-arc.tab-undo` | on | Cmd+Z undoes tab changes |
| `almost-arc.pip-on-blur` | on | Auto PiP when you switch to another app or desktop (macOS) |
| `almost-arc.pip-layout` | on | Arc's PiP controls (Back to Tab, Minimize, Close, 15 s skips) |
| `almost-arc.pip-flick` | on | Two-finger swipe over a PiP window sends it to a corner |
| `almost-arc.domain-only` | off | Show only the domain in the URL pill |
| `almost-arc.update-notice` | on | Notice when a new release is out (checks GitHub once a day) |
| `almost-arc.hide-scripts-notice` | off | Hide the "scripts aren't running" notice |
| `almost-arc.pip-debug`, `almost-arc.undo-debug` | off | Write debug logs to your profile folder |

Restart Zen after changing one. Settings from 1.0.0 (`arc-toolbar.*`) are carried over to these names automatically.

## Tweaking

The sizes and colors are CSS variables at the top of `chrome.css`:

- `--arc-bar-height`: toolbar height
- `--arc-url-inset`: gap above and below the pill
- `--arc-url-max-width`: widest the URL pill gets
- `--arc-bar-pad-start`: space before the first button
- `--arc-tile-*`: essentials tile colors
- `--arc-toolbar-icon-size`: size of the toolbar sidebar and site settings / extensions icons

## Tab undo safeguards

Cmd+Z only undoes things **you** did in **this session**:

1. **Only your own actions count.** A change is recorded only if it follows your own click, drag or keypress within 1.5s. Zen's own restores and syncs are never recorded.
2. **Startup is ignored.** Nothing is recorded until Zen has finished restoring your session.
3. **No big undos.** If a single undo would change more than 5 tabs, it's refused and the undo history is cleared.
4. **A backup before every undo.** Your session file is copied to `<profile>/zen-sessions-undo-backups/` first, keeping the last 10.

Closed tabs only reopen if Firefox's most recently closed tab is the one you closed. Moves between spaces, and creating or deleting folders, aren't undone.

## Limitations

- **Left sidebar only, macOS-style window buttons.** The compact-mode sidebar layout is skipped for right-side sidebars and Windows/Linux-style buttons, and the rest still works.
- **No bold domain.** Firefox can dim the path but can't make the domain bold.
- **The toolbar color is fixed per page load.** Sites that switch theme after loading keep the first color until you reload.
- **The URL pill needs the floating address bar** (`zen.urlbar.behavior = float`). With other settings you get Zen's normal URL bar, still centered and styled.
- **The JS features need a script loader** (Sine or `install.sh`). With CSS only you get the look, but not the page color, pill, PiP or undo.

## License

Copyright (c) 2026 shree-venkatesh.

Almost Arc is licensed under the [Mozilla Public License 2.0](LICENSE), the same license as Zen and Firefox.

`vendor/fx-autoconfig/` is [fx-autoconfig](https://github.com/MrOtherGuy/fx-autoconfig) by MrOtherGuy, included unmodified under its own MPL-2.0 license.

Not affiliated with The Browser Company or Arc.
