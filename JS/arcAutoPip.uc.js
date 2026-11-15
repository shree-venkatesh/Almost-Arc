// ==UserScript==
// @name           Arc auto Picture-in-Picture (front-app based)
// @description    Like Arc: when another *app* comes to the front (app switch, or a
//                 desktop/Space switch) while a video plays, pop it into PiP; close it
//                 when you come back. Spotlight, screenshots, Control Center and
//                 notifications are background helpers that never become the front
//                 app, so they don't trigger it. Nor does switching to an app while
//                 Zen stays on the current desktop (another monitor, or a window over
//                 part of Zen): only leaving the desktop pops it out. Also pops it
//                 out when Zen stays fully covered or minimized for 0.4 s (pref
//                 almost-arc.pip-when-covered; replaces Firefox's enable-when-occluded).
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
  for (const [name, def] of [["pip-on-blur", true], ["pip-when-covered", true], ["pip-debug", false]]) {
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

  // PiP when Zen is fully covered or minimized is done here, not by Firefox's
  // enable-when-occluded: macOS reports a window "fully covered" for a moment during
  // app switches, and opening the PiP itself makes it report Zen uncovered, so
  // Firefox's version flashed a PiP open and shut. Here Zen must stay covered for
  // COVER_MS, and the PiP closes when you come back to Zen. Firefox's own is turned
  // off so the two don't both fire.
  const ON_SWITCH = Services.prefs.getBoolPref("almost-arc.pip-on-blur", true);
  const ON_COVER = Services.prefs.getBoolPref("almost-arc.pip-when-covered", true);
  const FX_OCCLUDED = "media.videocontrols.picture-in-picture.enable-when-occluded.enabled";
  try { if (Services.prefs.getBoolPref(FX_OCCLUDED, false)) Services.prefs.setBoolPref(FX_OCCLUDED, false); } catch (e) {}
  if (!ON_SWITCH && !ON_COVER) return;

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
  const COVER_MS = 400;           // how long Zen must stay fully covered / minimized before PiP
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

  // On-screen windows, front to back, from CoreGraphics, called in Zen itself via
  // ctypes (window positions need no permission, only titles would). Until 1.2.9
  // this ran `osascript -l JavaScript` with the ObjC bridge: right after each such
  // run macOS made Zen the active app again, ~0.7 s after you'd switched away, so
  // Zen jumped in front of the app you'd picked, then dropped behind it when you
  // clicked that app again (owner's 1.2.9 log, with iTerm, Discord, Spotify).
  let cg = null;
  function openCG() {
    if (cg) return cg;
    const { ctypes } = ChromeUtils.importESModule("resource://gre/modules/ctypes.sys.mjs");
    const CF = ctypes.open("/System/Library/Frameworks/CoreFoundation.framework/CoreFoundation");
    const CGL = ctypes.open("/System/Library/Frameworks/CoreGraphics.framework/CoreGraphics");
    const P = ctypes.voidptr_t, ABI = ctypes.default_abi;
    const CGRect = new ctypes.StructType("CGRect",
      [{ x: ctypes.double }, { y: ctypes.double }, { w: ctypes.double }, { h: ctypes.double }]);
    cg = {
      ctypes, CGRect,
      list: CGL.declare("CGWindowListCopyWindowInfo", ABI, P, ctypes.uint32_t, ctypes.uint32_t),
      rect: CGL.declare("CGRectMakeWithDictionaryRepresentation", ABI, ctypes.bool, P, CGRect.ptr),
      count: CF.declare("CFArrayGetCount", ABI, ctypes.int32_t, P),          // CFIndex; counts fit in 32 bits
      at: CF.declare("CFArrayGetValueAtIndex", ABI, P, P, ctypes.long),
      get: CF.declare("CFDictionaryGetValue", ABI, P, P, P),
      num: CF.declare("CFNumberGetValue", ABI, ctypes.bool, P, ctypes.long, P),
      release: CF.declare("CFRelease", ABI, ctypes.void_t, P),
      key: {
        pid: CGL.declare("kCGWindowOwnerPID", P), layer: CGL.declare("kCGWindowLayer", P),
        alpha: CGL.declare("kCGWindowAlpha", P), bounds: CGL.declare("kCGWindowBounds", P),
      },
    };
    return cg;
  }
  async function screenWindows() {
    const c = openCG(), { ctypes } = c;
    const number = (dict, key, double) => {
      const v = dict && c.get(dict, key);
      if (!v || v.isNull()) return undefined;
      const out = double ? ctypes.double(0) : ctypes.int32_t(0);
      // kCFNumberDoubleType 13, kCFNumberSInt32Type 3
      return c.num(v, double ? 13 : 3, ctypes.cast(out.address(), ctypes.voidptr_t)) ? out.value : undefined;
    };
    const arr = c.list(1 | 16, 0);   // on screen only, no desktop elements
    if (!arr || arr.isNull()) throw new Error("CGWindowListCopyWindowInfo returned nothing");
    const wins = [];
    try {
      for (let i = 0, n = c.count(arr); i < n; i++) {
        const d = c.at(arr, i);
        const b = c.get(d, c.key.bounds);
        const r = new c.CGRect();
        if (!b || b.isNull() || !c.rect(b, r.address())) continue;
        wins.push({ pid: number(d, c.key.pid), layer: number(d, c.key.layer), alpha: number(d, c.key.alpha, true),
                    b: { X: r.x, Y: r.y, Width: r.w, Height: r.h } });
      }
    } finally { c.release(arr); }
    return wins.filter(w => w.layer === 0 && w.alpha !== 0);   // normal app windows
  }
  const overlap = (a, b) =>
    Math.max(0, Math.min(a.X + a.Width, b.X + b.Width) - Math.max(a.X, b.X)) *
    Math.max(0, Math.min(a.Y + a.Height, b.Y + b.Height) - Math.max(a.Y, b.Y));

  // Is this Zen window still on screen, i.e. on the current desktop (Space)? Then
  // switching apps doesn't pop the video out (another monitor, side by side, a
  // window over part of Zen). A window covering all of Zen is onCoverChange's job.
  async function zenStillVisible() {
    const me = { X: window.screenX, Y: window.screenY, Width: window.outerWidth, Height: window.outerHeight };
    const wins = await screenWindows();
    return wins.some(w => w.pid === MY_PID && overlap(w.b, me) > 0.5 * me.Width * me.Height);
  }

  function canPip({ whileHidden = false } = {}) {
    const browser = gBrowser.selectedBrowser;
    const tab = gBrowser.selectedTab;
    if (!browser || browser.audioMuted) return "muted/no browser";
    if (!tab.hasAttribute("soundplaying")) return "no sound playing";
    if (tab.hasAttribute("pictureinpicture")) return "already in PiP";
    if (PiP?.weakAutoPipBrowserToParent?.has(browser)) return "already auto-PiP'd";
    if (document.fullscreenElement) return "video fullscreen";
    // Minimized / fully covered: the covered check below handles it — don't double-toggle
    if (!whileHidden && hidden()) return "hidden (the covered check handles it)";
    return null;
  }
  const hidden = () => window.windowState === window.STATE_MINIMIZED || !!window.isFullyOccluded;

  function requestPip(why) {
    ours = { browser: gBrowser.selectedBrowser, before: new Set(pipWindows()) };
    try {
      gBrowser.selectedBrowser.browsingContext.currentWindowGlobal
        .getActor("PictureInPictureLauncher")
        .sendAsyncMessage("PictureInPicture:AutoToggle");
      log(`PiP requested (${why})`);
    } catch (e) { log(`PiP request failed: ${e}`); }
  }

  // Zen fully covered (by other apps' windows on this desktop) or minimized: PiP,
  // but only if it stays that way for COVER_MS. Back in Zen (onActivate) closes it.
  let coverTimer = 0;
  function onCoverChange() {
    clearTimeout(coverTimer);
    if (!ON_COVER || !hidden()) return;
    coverTimer = setTimeout(() => {
      if (!hidden()) { log("skip: covered only for a moment"); return; }
      if (Services.focus.activeWindow === window) { log("skip (covered): Zen has focus"); return; }
      const skip = canPip({ whileHidden: true });
      if (skip) { log(`skip (covered): ${skip}`); return; }
      requestPip(window.windowState === window.STATE_MINIMIZED ? "Zen minimized" : "Zen fully covered");
    }, COVER_MS);
  }

  async function onDeactivate() {
    if (!ON_SWITCH) return;
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
    requestPip(`front app: ${r.front}`);
  }

  function onActivate() {
    token++;
    clearTimeout(coverTimer);
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
  window.addEventListener("occlusionstatechange", onCoverChange);
  window.addEventListener("sizemodechange", onCoverChange);
  log(`loaded (pid ${MY_PID})`);

  // ---- almost-arc.pip-debug only: a timeline of everything around PiP ----
  // Who asks for a PiP (a page's own PiP request, Firefox's auto-toggle, a click),
  // and what this window was doing then, to find PiPs that open by themselves.
  if (DEBUG) {
    const state = () => {
      const tab = gBrowser.selectedTab, b = gBrowser.selectedBrowser;
      const active = Services.focus.activeWindow;
      return `[focus: ${active === window ? "this window" : active?.document?.documentURI === PIP_URL ? "PiP" : active ? "other Zen window" : "another app"}` +
        `, covered: ${window.isFullyOccluded}, state: ${window.windowState}, page active: ${b?.docShellIsActive}` +
        `, sound: ${tab?.hasAttribute("soundplaying")}]`;
    };
    window.addEventListener("activate", () => log(`event: activate ${state()}`));
    window.addEventListener("deactivate", () => log(`event: deactivate ${state()}`));
    window.addEventListener("occlusionstatechange", () => log(`event: covered changed ${state()}`));
    window.addEventListener("sizemodechange", () => log(`event: size mode changed ${state()}`));
    try {
      const mod = ChromeUtils.importESModule(
        "moz-src:///toolkit/components/pictureinpicture/PictureInPicture.sys.mjs");
      for (const cls of ["PictureInPictureLauncherParent", "PictureInPictureParent", "PictureInPictureToggleParent"]) {
        const proto = mod[cls]?.prototype;
        if (!proto || proto.__arcPipLogged) continue;
        proto.__arcPipLogged = true;
        const orig = proto.receiveMessage;
        proto.receiveMessage = function (msg) {
          try {
            if (!/Timestamp|Scrubber|UpdateEligible|VolumeChange/.test(msg.name)) {
              const d = msg.data || {};
              const bits = ["isPipApiRequest", "autoFocus", "playing", "isMuted"].filter(k => k in d).map(k => `${k}=${d[k]}`);
              const owner = this.browsingContext?.top?.embedderElement?.documentGlobal;
              const mine = owner === window;
              if (mine || !owner) log(`message: ${msg.name} ${bits.join(" ")} ${mine ? state() : ""}`);
            }
          } catch (e) {}
          return orig.apply(this, arguments);
        };
      }
    } catch (e) { log(`PiP message logging failed: ${e}`); }
    const ww = {
      observe(subject, topic) {
        if (topic === "domwindowopened") {
          subject.addEventListener("load", () => {
            if (subject.document?.documentURI === PIP_URL) log(`PiP window opened ${state()}`);
          }, { once: true });
        } else if (topic === "domwindowclosed" && subject.document?.documentURI === PIP_URL) {
          log(`PiP window closed ${state()}`);
        }
      },
    };
    try {
      Services.ww.registerNotification(ww);
      window.addEventListener("unload", () => Services.ww.unregisterNotification(ww), { once: true });
    } catch (e) { log(`PiP window logging failed: ${e}`); }
  }
})();
