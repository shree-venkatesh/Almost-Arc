// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// Runs a real JS/*.uc.js file in Node with Zen/Firefox/macOS faked around it.
// Only what the scripts touch is faked; anything else throws, so a script
// reaching for something new fails loudly instead of passing by accident.

import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
export const PIP_URL = "chrome://global/content/pictureinpicture/player.xhtml";
export const ZEN_PID = 4242;
export const ZEN_ASN = "ASN:0x0-0x1001:";

// Apps macOS knows about, keyed by ASN (what `lsappinfo front` prints).
export const APPS = {
  zen:           { asn: ZEN_ASN,          pid: ZEN_PID, type: "Foreground", bundle: "app.zen-browser.zen" },
  safari:        { asn: "ASN:0x0-0x2002:", pid: 501,  type: "Foreground", bundle: "com.apple.Safari" },
  finder:        { asn: "ASN:0x0-0x2003:", pid: 502,  type: "Foreground", bundle: "com.apple.finder" },
  slack:         { asn: "ASN:0x0-0x2004:", pid: 503,  type: "Foreground", bundle: "com.tinyspeck.slackmacgap" },
  controlCenter: { asn: "ASN:0x0-0x3001:", pid: 601,  type: "UIElement",  bundle: "com.apple.controlcenter" },
  notifications: { asn: "ASN:0x0-0x3002:", pid: 602,  type: "UIElement",  bundle: "com.apple.notificationcenterui" },
  spotlight:     { asn: "ASN:0x0-0x3003:", pid: 603,  type: "UIElement",  bundle: "com.apple.Spotlight" },
  screenshot:    { asn: "ASN:0x0-0x3004:", pid: 604,  type: "Foreground", bundle: "com.apple.screencaptureui" },
  dock:          { asn: "ASN:0x0-0x3005:", pid: 605,  type: "UIElement",  bundle: "com.apple.dock" },
  stageManager:  { asn: "ASN:0x0-0x3006:", pid: 606,  type: "UIElement",  bundle: "com.apple.WindowManager" },
  emojiPicker:   { asn: "ASN:0x0-0x3007:", pid: 607,  type: "Foreground", bundle: "com.apple.CharacterPaletteIM" },
  loginWindow:   { asn: "ASN:0x0-0x3008:", pid: 608,  type: "Foreground", bundle: "com.apple.loginwindow" },
  helper:        { asn: "ASN:0x0-0x3009:", pid: 609,  type: "BackgroundOnly", bundle: "com.example.helper" },
};

/**
 * Load JS/arcAutoPip.uc.js into a fake Zen window.
 * opts:
 *   platform     "macosx" (default) | "linux"
 *   prefs        { "almost-arc.pip-on-blur": true, ... } user values
 *   front        app key or list of app keys: what successive `lsappinfo front` calls see
 *                (the last one repeats). Default "safari".
 *   lsappinfoFails  true: every lsappinfo call throws
 *   allForeground   true: lsappinfo reports every app as "Foreground" (tests the bundle ignore list alone)
 *   tab          { soundplaying, muted, pictureinpicture, autoPipped }
 *   win          { windowState, isFullyOccluded, fullscreen, screenX, screenY, outerWidth, outerHeight }
 *   activeWindow "other" (default: another app has focus) | "zenWindow" | "pip"
 *   windows      on-screen windows macOS reports (CGWindowList): an array of
 *                { app, x, y, w, h } (app key, "zen" for this window), a list of such
 *                arrays for successive looks (the last repeats), or "fail".
 *                Default: Zen isn't on screen (the app is full screen or on another desktop).
 *   openOnToggle true (default): an AutoToggle opens a PiP window for the tab
 *   oldPlayer    true: PiP windows lack closeFromForeground() (older Firefox)
 */
export async function loadAutoPip(opts = {}) {
  const o = {
    platform: "macosx", prefs: {}, front: "safari", tab: {}, win: {},
    activeWindow: "other", windows: null, openOnToggle: true, ...opts,
  };
  const fronts = [].concat(o.front);
  const calls = { lsappinfo: [], osascript: 0 };
  let lastFront = [].concat(o.front)[0];
  const toggles = [];
  const logs = [];
  const prefs = new Map(Object.entries({ "almost-arc.pip-debug": true, ...o.prefs }));
  const defaults = new Map();

  // ---- macOS: lsappinfo + osascript through Subprocess ----
  function lsappinfo(args) {
    calls.lsappinfo.push(args.join(" "));
    if (o.lsappinfoFails) throw new Error("lsappinfo: launch failed");
    if (args[0] === "find") return `${ZEN_ASN}\n`;
    if (args[0] === "front") {
      const key = fronts.length > 1 ? fronts.shift() : fronts[0];
      lastFront = key;
      return `${APPS[key].asn}\n`;
    }
    if (args[0] === "info") {
      const asn = args[args.length - 1];
      const app = Object.values(APPS).find(a => a.asn === asn);
      if (!app) return "";
      const type = o.allForeground ? "Foreground" : app.type;
      return `"pid"=${app.pid}\n"ApplicationType"="${type}"\n"CFBundleIdentifier"="${app.bundle}"\n`;
    }
    throw new Error(`unexpected lsappinfo ${args.join(" ")}`);
  }
  function osascript() {
    calls.osascript++;
    if (o.windows === "fail") throw new Error("osascript failed");
    const W = window;
    const zenRect = { x: W.screenX, y: W.screenY, w: W.outerWidth, h: W.outerHeight };
    let list = o.windows ?? [{ app: lastFront, ...zenRect }];   // Zen not on this desktop
    if (Array.isArray(list[0])) list = o.windows.length > 1 ? o.windows.shift() : o.windows[0];
    return JSON.stringify(list.map(w => ({
      pid: APPS[w.app].pid, layer: w.layer ?? 0, alpha: 1,
      b: { X: w.x, Y: w.y, Width: w.w, Height: w.h },
    })));
  }
  const Subprocess = {
    async call({ command, arguments: args }) {
      let out;
      if (command === "/usr/bin/lsappinfo") out = lsappinfo(args);
      else if (command === "/usr/bin/osascript") out = osascript(args);
      else throw new Error(`unexpected command ${command}`);
      let sent = false;
      return {
        stdout: { readString: async () => (sent ? "" : ((sent = true), out)) },
        wait: async () => ({ exitCode: 0 }),
      };
    },
  };

  // ---- Zen window, tab, PiP ----
  const autoPipped = new WeakMap();
  const winToBrowser = new WeakMap();
  const pipList = [];
  // Firefox's own record of which tabs have a PiP open (PictureInPicture's
  // browserWeakMap). While a tab is in it, Firefox keeps the tab "visible", so
  // switching away from it never auto-PiPs. Only Firefox's close paths clear it;
  // window.close() on the player does not.
  const firefoxPipTabs = new Map();
  const makePip = owner => {
    const w = {
      document: { documentURI: PIP_URL }, closed: false,
      close() { this.closed = true; pipList.splice(pipList.indexOf(this), 1); },
    };
    if (!o.oldPlayer) w.closeFromForeground = () => {   // player.js: closeSinglePipWindow({ reason: "Foregrounded" })
      if (owner) {
        const n = (firefoxPipTabs.get(owner) || 1) - 1;
        n > 0 ? firefoxPipTabs.set(owner, n) : firefoxPipTabs.delete(owner);
      }
      w.close();
    };
    pipList.push(w);
    if (owner) { winToBrowser.set(w, owner); firefoxPipTabs.set(owner, (firefoxPipTabs.get(owner) || 0) + 1); }
    return w;
  };
  const tabAttrs = new Set();
  if (o.tab.soundplaying !== false) tabAttrs.add("soundplaying");
  if (o.tab.pictureinpicture) tabAttrs.add("pictureinpicture");
  const browser = {
    audioMuted: !!o.tab.muted,
    browsingContext: { currentWindowGlobal: { getActor(name) {
      return { sendAsyncMessage(msg) {
        toggles.push(`${name}:${msg}`);
        if (o.openOnToggle) makePip(browser);
      } };
    } } },
  };
  if (o.tab.autoPipped) autoPipped.set(browser, {});
  const tab = { hasAttribute: a => tabAttrs.has(a) };

  const listeners = {};
  const window = {
    STATE_MINIMIZED: 2, STATE_NORMAL: 3,
    windowState: o.win.windowState ?? 3,
    isFullyOccluded: !!o.win.isFullyOccluded,
    screenX: o.win.screenX ?? 0, screenY: o.win.screenY ?? 25,
    outerWidth: o.win.outerWidth ?? 1512, outerHeight: o.win.outerHeight ?? 920,
    addEventListener(type, fn) { (listeners[type] ||= []).push(fn); },
  };
  const otherZenWindow = { document: { documentURI: "chrome://browser/content/browser.xhtml" } };

  const Services = {
    appinfo: { processID: ZEN_PID },
    prefs: {
      getDefaultBranch: () => ({
        setBoolPref: (k, v) => defaults.set(k, v),
        getBoolPref: (k, d) => (defaults.has(k) ? defaults.get(k) : d),
      }),
      prefHasUserValue: k => prefs.has(k),
      getBoolPref: (k, d) => (prefs.has(k) ? prefs.get(k) : defaults.has(k) ? defaults.get(k) : d),
      setBoolPref: (k, v) => prefs.set(k, v),
      clearUserPref: k => prefs.delete(k),
    },
    wm: { *getEnumerator() { yield window; yield* [...pipList]; } },
    focus: {
      get activeWindow() {
        return o.activeWindow === "zenWindow" ? otherZenWindow
             : o.activeWindow === "pip" ? (pipList[0] ?? makePip(null))
             : null;
      },
    },
  };

  const context = {
    window, Services, console,
    AppConstants: { platform: o.platform },
    document: { fullscreenElement: o.win.fullscreen ? {} : null },
    gBrowser: { selectedBrowser: browser, selectedTab: tab },
    PathUtils: { profileDir: "/profile", join: (...p) => p.join("/") },
    IOUtils: { writeUTF8: async (_f, s) => { logs.push(s.replace(/^\S+\s+\[autoPip\] /, "").trim()); } },
    ChromeUtils: {
      importESModule(url) {
        if (url.endsWith("Subprocess.sys.mjs")) return { Subprocess };
        if (url.endsWith("PictureInPicture.sys.mjs"))
          return { PictureInPicture: { weakAutoPipBrowserToParent: autoPipped, weakWinToBrowser: winToBrowser } };
        throw new Error(`unexpected module ${url}`);
      },
    },
    setTimeout, clearTimeout, Promise, Number, Set, Map, WeakMap, JSON, Math, Date, Error,
  };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(ROOT, "JS/arcAutoPip.uc.js"), "utf8"), context,
                  { filename: "arcAutoPip.uc.js" });
  await settle();   // the startup `lsappinfo find` for Zen's own ASN

  return {
    toggles, logs, calls, prefs, pipList, browser,
    /** Firefox still thinks this tab has a PiP open (tab switching won't auto-PiP it). */
    get tabStuckInPip() { return firefoxPipTabs.has(browser) && !pipList.some(w => winToBrowser.get(w) === browser); },
    /** Another app or desktop took focus; resolves when the script has decided. */
    async deactivate() {
      await Promise.all((listeners.deactivate || []).map(fn => fn({ type: "deactivate" })));
      await settle();
    },
    /** Deactivate, and come back before the script's front-app lookup finishes. */
    async deactivateThenReturnQuickly() {
      const p = Promise.all((listeners.deactivate || []).map(fn => fn({ type: "deactivate" })));
      (listeners.activate || []).forEach(fn => fn({ type: "activate" }));
      await p; await settle();
    },
    /** Zen came back to the front. */
    activate() { (listeners.activate || []).forEach(fn => fn({ type: "activate" })); },
    /** A PiP window that was already open (another video, or opened by hand). */
    existingPip(owner = browser) { return makePip(owner); },
    set(changes) { Object.assign(o, changes); },
    get hasListeners() { return !!(listeners.activate || listeners.deactivate); },
    lastLog() { return logs[logs.length - 1] || ""; },
  };
}

const settle = () => new Promise(r => setTimeout(r, 0));
