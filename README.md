# Almost Arc

A free mod that makes [Zen Browser](https://zen-browser.app) look and feel almost like Arc: a centered URL pill, a toolbar tinted to each page, Arc's pop-out sidebar, and Arc-style Picture-in-Picture.

**[Download for Mac](https://github.com/shree-venkatesh/Almost-Arc/releases/latest)** · [almostarc.net](https://almostarc.net) · [What's new](https://almostarc.net/#whats-new)

<!-- Screenshot or GIF of Zen with Almost Arc goes here, e.g.
<p align="center"><img src="assets/screenshot.png" alt="Zen Browser with Almost Arc" width="900"></p>
-->

Built and tested on **Zen 1.24.1b (Firefox 159), macOS 13 or later**. Linux mostly works; Windows isn't supported.

## Features

- **Arc's toolbar.** The toolbar is the top of the page card, with rounded corners and the card's shadow, and takes the color of each page's top edge once it loads.
- **Centered URL pill.** Sized to the address, domain bright and path dimmed. Click it for Zen's floating address bar, like Arc's command bar. The copy-link button sits beside it and shows a checkmark when you copy.
- **Arc's sidebar.** Frosted essentials tiles, and a compact mode where the sidebar pops out full height with the window buttons at its top.
- **Auto Picture-in-Picture.** A playing video pops out when you switch tabs, minimize, switch to another desktop or to an app in full screen, and goes back when you return. Switching to an app while Zen stays on screen (on another monitor, or a window over Zen) doesn't trigger it, nor does system UI (Spotlight, Control Center, screenshots). Desktop and app switching is macOS only.
- **Arc's PiP controls.** Back to Tab, Minimize (keeps the video playing), 15-second skips and a slim progress bar. Swipe with two fingers on the trackpad to fling the window into a corner.
- **Cmd+Z for tabs.** Reopens tabs you closed, including everything Zen's Clear closed, and puts moved and pinned or unpinned tabs back, within six [safeguards](#tab-undo-safeguards).
- **Updates from inside Zen.** When a new version is out, Zen shows a bar with an **Update** button, then **Restart Zen**. If a Zen update switched the mod's scripts off, a notice gives you the command that fixes it.

## Install

### The installer (easiest, macOS)

1. Download **Almost-Arc-for-Zen-X.Y.Z.pkg** from the [latest release](https://github.com/shree-venkatesh/Almost-Arc/releases/latest).
2. Open it. The installer isn't signed by Apple yet, so the first time macOS says it can't verify it:
   1. Click **Done** (not Move to Trash).
   2. Open **System Settings → Privacy & Security**.
   3. **Scroll down** to the **Security** section and click **Open Anyway** next to the installer's name.
   4. Enter your password and click **Open**.
3. Click through. If Zen is open, the installer asks to quit it (your windows and tabs are saved as usual).
4. Open Zen.

If you don't have Zen, the installer downloads the official Zen from [Zen's own releases](https://github.com/zen-browser/desktop/releases) first, checked to be signed by the Zen team. Every install method below does the same, except Sine.

### Other ways

<details>
<summary><b>Homebrew</b></summary>

Quit Zen, then:

```bash
brew install shree-venkatesh/tap/almost-arc
almost-arc install
```

</details>

<details>
<summary><b>One Terminal command (no Homebrew)</b></summary>

Quit Zen, then:

```bash
curl -fsSL https://almostarc.net/install.sh | bash
```

This downloads the latest release into `~/.almost-arc` and adds the `almost-arc` command to `/usr/local/bin` (it may ask for your password). Use either this or Homebrew, not both: each one stops if Almost Arc is already installed the other way.

</details>

<details>
<summary><b>Sine</b></summary>

1. Install [Sine](https://github.com/CosmoCreeper/Sine).
2. Zen → Settings → Sine Mods → Sine settings → enable **installing JS from unofficial sources**.
3. Paste `shree-venkatesh/Almost-Arc` into the box under the marketplace and install it.
4. In the mod's settings, set the recommended options: single toolbar **off**, hide toolbar in compact mode **off**, floating address bar **Always**, hide www. **on**, and auto-PiP to taste.
5. Restart Zen.

Sine keeps the mod updated; the rest of this page's update steps don't apply.

</details>

<details>
<summary><b>From the repo (also Linux)</b></summary>

Quit Zen, then:

```bash
git clone https://github.com/shree-venkatesh/Almost-Arc.git
cd Almost-Arc
./install.sh
```

The script:

- **installs Zen if you don't have it** (macOS), and starts it once in the background so it creates your profile;
- **adds a small script loader** ([fx-autoconfig](https://github.com/MrOtherGuy/fx-autoconfig), included in `vendor/`) to the Zen app; it may ask for your password;
- **adds the styles** to your profile's `chrome/` folder as `almost-arc.css`, imported from `userChrome.css` (your existing CSS is kept), and the scripts to `chrome/JS/`;
- **writes the recommended settings** into `user.js` in a marked block that's easy to remove;
- **gives Zen the Almost Arc icon** in the Dock and Finder (macOS). To keep Zen's icon, install with `ALMOST_ARC_ICON=0 ./install.sh`.

For Linux, or a non-default profile or install location:

```bash
ZEN_PROFILE=/path/to/profile ZEN_APP=/path/to/zen-install ./install.sh
```

</details>

After a Homebrew, Terminal or repo install, open `about:support`, click **Clear startup cache** and let Zen restart. (The installer does this for you.)

## Updating and removing

| | Installer, Homebrew or Terminal command | From the repo |
| --- | --- | --- |
| **Update Almost Arc** | Click **Update** on the bar Zen shows, or quit Zen and run `almost-arc update` | `git pull && ./install.sh` |
| **After a Zen update** | `almost-arc install`, or open the installer again | `./install.sh` |
| **Try the newest beta** | `almost-arc update --beta` (a plain `almost-arc update` goes back) | `git pull` gets betas already |
| **Remove** | `almost-arc uninstall` (Homebrew: then `brew uninstall almost-arc`) | `./uninstall.sh` |

Zen's updates replace the app, which removes the script loader and the Almost Arc icon, so the mod needs installing again. Your profile isn't touched, and Zen shows a notice when it happens.

Removing puts everything back, including Zen's own icon.

## Settings

- **With Sine:** Zen → Settings → Sine Mods → Almost Arc.
- **Otherwise:** open `about:config` (type it in the address bar and accept the warning), then search `almost-arc`.

| Setting | Default | What it does |
| --- | --- | --- |
| `almost-arc.tab-undo` | on | Cmd+Z undoes tab changes |
| `almost-arc.pip-on-blur` | on | Auto PiP when you switch to another app or desktop (macOS) |
| `almost-arc.pip-layout` | on | Arc's PiP controls (Back to Tab, Minimize, Close, 15 s skips) |
| `almost-arc.pip-flick` | on | Two-finger trackpad swipe over a PiP window sends it to a corner (mouse wheels don't) |
| `almost-arc.domain-only` | off | Show only the domain in the URL pill |
| `almost-arc.update-notice` | on | Notice when a new release is out (checks GitHub once a day) |
| `almost-arc.hide-scripts-notice` | off | Hide the "scripts aren't running" notice |
| `almost-arc.pip-debug`, `almost-arc.undo-debug` | off | Write debug logs to your profile folder |

Restart Zen after changing one. Settings from 1.0.0 (`arc-toolbar.*`) are carried over automatically.

## Tab undo safeguards

Cmd+Z only undoes things **you** did in **this session**:

1. **Only your own actions count.** A change is recorded only if it follows your own click, drag or keypress within 1.5 s. Zen's own restores and syncs are never recorded.
2. **Startup is ignored.** Nothing is recorded until Zen has finished restoring your session.
3. **No big moves.** If a single undo would move, pin or unpin more than 5 tabs, it's refused and the undo history is cleared. Reopening closed tabs has no such limit, up to the 25 recently closed tabs Firefox remembers; when it's more than 5, they're reopened where they were but not pinned or put back into folders.
4. **A backup before every undo.** Your session file is copied to `<profile>/zen-sessions-undo-backups/` first, keeping the last 10.
5. **Only the tab you closed.** A closed tab is only reopened if Firefox's most recently closed tab is the one you closed.
6. **Text fields keep their undo.** In the address bar, a text field or a text box on a page, Cmd+Z undoes your typing as usual.

Moves between spaces, and creating or deleting folders, aren't undone.

## Limitations

- **Left sidebar only, macOS-style window buttons.** The compact-mode sidebar layout is skipped for right-side sidebars and Windows/Linux-style buttons; the rest still works.
- **No bold domain.** Firefox can dim the path but can't make the domain bold.
- **The toolbar color is fixed per page load.** Sites that switch theme after loading keep the first color until you reload.
- **The URL pill needs the floating address bar** (`zen.urlbar.behavior = float`). With other settings you get Zen's normal URL bar, still centered and styled.
- **The JS features need a script loader** (Sine, or any install method above). With CSS only you get the look, but not the page color, pill, PiP or undo.

## Feedback

Found a bug or have an idea? [Send feedback](https://tally.so/r/q5DNBY) with a short form (no account needed), or [open an issue](https://github.com/shree-venkatesh/Almost-Arc/issues) if you have a GitHub account.

## For developers

### Files

| File | What it does |
|---|---|
| `chrome.css` | All styling: toolbar card, shadow, pill, spacing, compact-mode layout |
| `JS/arcToolbarTint.uc.js` | Samples the top of each page once it loads and colors the toolbar to match |
| `JS/arcUrlbarFit.uc.js` | The centered URL pill: sized to its text, fits narrow windows, opens and closes the floating address bar |
| `JS/arcUrlbarButtons.uc.js` | Moves the copy-link button next to the pill (with the copied checkmark) and site settings / extensions to the right |
| `JS/arcCompactSidebar.uc.js` | Arc-style pop-out sidebar and toolbar sidebar button in compact mode |
| `JS/arcAutoPip.uc.js` | Auto PiP when another app or desktop comes to the front (macOS); closes when you return |
| `JS/arcPipLayout.uc.js` | Arc's PiP controls |
| `JS/arcPipFlick.uc.js` | Two-finger swipe sends the PiP window to a corner |
| `JS/arcTabUndo.uc.js` | Cmd+Z tab undo (close, move, pin/unpin), with safeguards |
| `JS/arcNotices.uc.js` | The "scripts aren't running" notice and the new-release notice with its Update button |
| `JS/arcDomainOnly.uc.js` | Optional domain-only URL |
| `theme.json`, `preferences.json` | Sine mod metadata and settings panel |
| `install.sh` / `uninstall.sh` | Install and remove without Sine (what every other method runs) |
| `get-zen.sh` | Installs the official Zen if it's missing, and creates a profile (macOS) |
| `pkg/` | The macOS installer (.pkg): `pkg/build.sh`, its install scripts and pages |
| `site/` | almostarc.net, and the `curl` installer (`site/install.sh`) |
| `assets/app-icon.png` | The Zen app icon set on macOS |
| `vendor/fx-autoconfig/` | Script loader |
| `tests/` | Tests for auto-PiP, the PiP fling, the notices and tab undo |

### Tests

```bash
node --test 'tests/*.test.mjs'
```

Node 22, no dependencies. They run the real scripts with Zen, Firefox and macOS faked, and run on every push.

### Tweaking

The sizes and colors are CSS variables at the top of `chrome.css`:

- `--arc-bar-height`: toolbar height
- `--arc-url-inset`: gap above and below the pill
- `--arc-url-max-width`: widest the URL pill gets
- `--arc-bar-pad-start`: space before the first button
- `--arc-tile-*`: essentials tile colors
- `--arc-toolbar-icon-size`: size of the toolbar sidebar and site settings / extensions icons

## License

Copyright (c) 2026 shree-venkatesh.

Almost Arc is licensed under the [Mozilla Public License 2.0](LICENSE), the same license as Zen and Firefox.

`vendor/fx-autoconfig/` is [fx-autoconfig](https://github.com/MrOtherGuy/fx-autoconfig) by MrOtherGuy, included unmodified under its own MPL-2.0 license.

Almost Arc is an independent mod, not affiliated with Zen, The Browser Company or Arc.
