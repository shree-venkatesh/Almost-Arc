// ==UserScript==
// @name           Arc auto Picture-in-Picture (front-app based)
// @description    Like Arc: when another *app* comes to the front (app switch, or a
//                 desktop/Space switch) while a video plays, pop it into PiP; close it
//                 when you come back. Spotlight, screenshots, Control Center and
//                 notifications are background helpers that never become the front
//                 app, so they don't trigger it. Nor does switching to an app while
//                 Zen stays on the current desktop (another monitor, or a window over
//                 part of Zen): only leaving the desktop pops it out. (Fully covered
//                 is Firefox's enable-when-occluded, which install.sh turns on.)
//                 macOS only. Pref: almost-arc.pip-on-blur
// ==/UserScript==

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

(function () {
  if (window.__arcAutoPip) return;
  window.__arcAutoPip = true;

  // List this script's settings in about:config with their defaults, and carry over
  // values set under the 1.0.0 names (arc-toolbar.*), then remove those.
  for (const [name, def] of [["pip-on-blur", true], ["pip-debug", false]]) {
    try {
      const pref = `almost-arc.${name}`, old = `arc-toolbar.${name}`;
      Services.prefs.getDefaultBranch("").setBoolPref(pref, def);
      if (Services.prefs.prefHasUserValue(old)) {
        if (!Services.prefs.prefHasUserValue(pref)) Services.prefs.setBoolPref(pref, Services.prefs.getBoolPref(old, def));
        Services.prefs.clearUserPref(old);
      }
    } catch (e) {}
  }

  if (AppConstants.platform !== "macosx") return;
  if (!Services.prefs.getBoolPref("almost-arc.pip-on-blur", true)) return;

  const DEBUG = Services.prefs.getBoolPref("almost-arc.pip-debug", false);
  const LOG = PathUtils.join(PathUtils.profileDir, "almost-arc-pip-debug.log");
  const log = msg => {
    if (!DEBUG) return;
    IOUtils.writeUTF8(LOG, `${new Date().toISOString().slice(11, 23)}  [autoPip] ${msg}\n`, { mode: "appendOrCreate" }).catch(() => {});
  };

  const { Subprocess } = ChromeUtils.importESModule("resource://gre/modules/Subprocess.sys.mjs");
  let PiP = null;
  try {
    ({ PictureInPicture: PiP } = ChromeUtils.importESModule(
      "moz-src:///toolkit/components/pictureinpicture/PictureInPicture.sys.mjs"));
  } catch (e) {}

  const PIP_URL = "chrome://global/content/pictureinpicture/player.xhtml";
  const MY_PID = Services.appinfo.processID;
  const RETRY_MS = 40;            // second look if macOS hadn't switched the front app yet
  const SPACE_MS = 600;           // a desktop (Space) switch animates; look again after it
  let token = 0;
  // What this script opened, so it can close exactly that on return
  let ours = null;   // { browser, before: Set<pipWindow> }

  const pipWindows = () => {
    const list = [];
    for (const w of Services.wm.getEnumerator(null)) if (w.document?.documentURI === PIP_URL) list.push(w);
    return list;
  };

  // Ask macOS which app is in front (built-in `lsappinfo`, no permissions needed).
  // Fast path: one `lsappinfo front` call, compared with Zen's own app id (cached).
  const LSAPPINFO = "/usr/bin/lsappinfo";
  async function run(args) {
    const proc = await Subprocess.call({ command: LSAPPINFO, arguments: args });
    let out = "", chunk;
    while ((chunk = await proc.stdout.readString())) out += chunk;
    await proc.wait();
    return out.trim();
  }
  let myASN = null;
  run(["find", `pid=${MY_PID}`]).then(a => { myASN = a.match(/ASN:[^\s]+/)?.[0] || null; log(`my ASN: ${myASN}`); })
    .catch(e => log(`lsappinfo find failed: ${e}`));

  // macOS system UI that can briefly take the front without being a "real" app switch
  const IGNORE_BUNDLES = new Set([
    "com.apple.controlcenter",
    "com.apple.notificationcenterui",
    "com.apple.Spotlight",
    "com.apple.screencaptureui",
    "com.apple.screenshot.launcher",
    "com.apple.systemuiserver",
    "com.apple.dock",                  // Mission Control, Launchpad, app switcher UI
    "com.apple.WindowManager",         // Stage Manager
    "com.apple.loginwindow",
    "com.apple.SecurityAgent",
    "com.apple.UserNotificationCenter",
    "com.apple.TextInputMenuAgent",
    "com.apple.TextInputSwitcher",
    "com.apple.CharacterPaletteIM",    // emoji picker
    "com.apple.PIPAgent",
  ]);

  // Returns { zen: bool, real: bool, pid: number, front: string }.
  //   zen  - Zen is still the front app
  //   real - the front app is a normal app (not a background helper / system UI)
  async function frontInfo() {
    const front = (await run(["front"])).match(/ASN:[^\s]+/)?.[0];
    if (myASN && front && front === myASN) return { zen: true, real: false, pid: MY_PID, front };
    const info = await run(["info", "-only", "pid", "-only", "ApplicationType", "-only", "bundleid", front || "front"]);
    const pid = Number(info.match(/"pid"\s*=\s*(\d+)/)?.[1] ?? NaN);
    const type = info.match(/"ApplicationType"\s*=\s*"([^"]+)"/)?.[1] ?? "";
    const bundle = info.match(/"CFBundleIdentifier"\s*=\s*"([^"]+)"/)?.[1] ?? "";
    const zen = pid === MY_PID;
    const real = !zen && type === "Foreground" && !IGNORE_BUNDLES.has(bundle);
    return { zen, real, pid, front: `${bundle || front} (${type || "?"})` };
  }

  // On-screen windows, front to back, from CoreGraphics (via osascript; window
  // positions need no permission, only window titles would).
  const OSASCRIPT = "/usr/bin/osascript";
  const WINDOWS_JXA = `ObjC.import("CoreGraphics");
    function run() {
      var list = ObjC.deepUnwrap(ObjC.castRefToObject($.CGWindowListCopyWindowInfo(1 | 16, 0))) || [];
      return JSON.stringify(list.map(function (w) {
        return { pid: w.kCGWindowOwnerPID, layer: w.kCGWindowLayer, alpha: w.kCGWindowAlpha, b: w.kCGWindowBounds };
      }));
    }`;
  async function screenWindows() {
    const proc = await Subprocess.call({ command: OSASCRIPT, arguments: ["-l", "JavaScript", "-e", WINDOWS_JXA] });
    let out = "", chunk;
    while ((chunk = await proc.stdout.readString())) out += chunk;
    await proc.wait();
    return JSON.parse(out).filter(w => w.layer === 0 && w.alpha !== 0 && w.b);   // normal app windows
  }
  const overlap = (a, b) =>
    Math.max(0, Math.min(a.X + a.Width, b.X + b.Width) - Math.max(a.X, b.X)) *
    Math.max(0, Math.min(a.Y + a.Height, b.Y + b.Height) - Math.max(a.Y, b.Y));

  // Is this Zen window still on screen, i.e. on the current desktop (Space)? Then
  // this script doesn't pop the video out (another monitor, side by side, a window
  // over part of Zen). A window covering all of Zen is Firefox's job: with
  // enable-when-occluded (install.sh turns it on) it pops out once macOS reports
  // the window fully covered, and closes when any of it shows again.
  async function zenStillVisible() {
    const me = { X: window.screenX, Y: window.screenY, Width: window.outerWidth, Height: window.outerHeight };
    const wins = await screenWindows();
    return wins.some(w => w.pid === MY_PID && overlap(w.b, me) > 0.5 * me.Width * me.Height);
  }

  function canPip() {
    const browser = gBrowser.selectedBrowser;
    const tab = gBrowser.selectedTab;
    if (!browser || browser.audioMuted) return "muted/no browser";
    if (!tab.hasAttribute("soundplaying")) return "no sound playing";
    if (tab.hasAttribute("pictureinpicture")) return "already in PiP";
    if (PiP?.weakAutoPipBrowserToParent?.has(browser)) return "already auto-PiP'd";
    if (document.fullscreenElement) return "video fullscreen";
    // Minimized / fully covered: Firefox's own auto-PiP handles it — don't double-toggle
    if (window.windowState === window.STATE_MINIMIZED || window.isFullyOccluded) return "hidden (Firefox handles it)";
    return null;
  }

  async function onDeactivate() {
    const my = ++token;

    // Focus moved to another Zen window or the PiP player: still Zen, do nothing
    const active = Services.focus.activeWindow;
    if (active && active !== window) { log(`skip: focus still in Zen (${active.document?.documentURI === PIP_URL ? "PiP window" : "Zen window"})`); return; }

    const skip = canPip();
    if (skip) { log(`skip: ${skip}`); return; }

    let r;
    try {
      r = await frontInfo();
      // macOS may not have updated the front app yet — check once more shortly
      if (r.zen) {
        await new Promise(res => setTimeout(res, RETRY_MS));
        if (my !== token) return;
        r = await frontInfo();
      }
    } catch (e) { log(`lsappinfo failed: ${e}`); return; }
    if (my !== token) return;
    log(`front app: ${r.front}`);

    if (r.zen) { log("skip: Zen is still the front app"); return; }
    if (!r.real) { log("skip: front app is system UI / a background helper"); return; }

    // Zen's window is still on this desktop (the other app is on another monitor, side
    // by side, or over Zen): no PiP. Check twice, since a Space switch is still
    // animating at first.
    try {
      if (await zenStillVisible()) {
        await new Promise(res => setTimeout(res, SPACE_MS));
        if (my !== token) return;
        if (await zenStillVisible()) { log("skip: Zen's window is still visible (still on this desktop)"); return; }
      }
    } catch (e) { log(`window check failed, popping out anyway: ${e}`); }
    if (my !== token) return;

    const again = canPip();
    if (again) { log(`skip: ${again}`); return; }
    ours = { browser: gBrowser.selectedBrowser, before: new Set(pipWindows()) };
    try {
      gBrowser.selectedBrowser.browsingContext.currentWindowGlobal
        .getActor("PictureInPictureLauncher")
        .sendAsyncMessage("PictureInPicture:AutoToggle");
      log(`PiP requested (front app: ${r.front})`);
    } catch (e) { log(`PiP request failed: ${e}`); }
  }

  function onActivate() {
    token++;
    if (!ours) return;
    const { browser, before } = ours;
    ours = null;
    let closed = 0;
    for (const w of pipWindows()) {
      // the player we opened: belongs to that tab's video, and wasn't there before
      const owner = PiP?.weakWinToBrowser?.get(w);
      if ((owner ? owner === browser : true) && !before.has(w)) {
        // Close it the way Firefox closes its own auto-PiP (player.js
        // closeFromForeground -> closeSinglePipWindow "Foregrounded"). A bare
        // w.close() skips Firefox's bookkeeping: the tab stays marked as in PiP,
        // is never treated as hidden, and switching tabs stops auto-PiPing it.
        if (typeof w.closeFromForeground === "function") w.closeFromForeground();
        else w.close();
        closed++;
      }
    }
    log(closed ? `back in Zen: closed ${closed} auto-PiP window(s)` : "back in Zen: no auto-PiP window to close");
  }

  window.addEventListener("deactivate", onDeactivate);
  window.addEventListener("activate", onActivate);
  log(`loaded (pid ${MY_PID})`);
})();
