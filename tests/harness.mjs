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

// Apps macOS knows about. type: what NSRunningApplication.activationPolicy says
// (Foreground = regular, UIElement = accessory, BackgroundOnly = prohibited).
export const APPS = {
  zen:           { pid: ZEN_PID, type: "Foreground", bundle: "app.zen-browser.zen" },
  safari:        { pid: 501,  type: "Foreground", bundle: "com.apple.Safari" },
  finder:        { pid: 502,  type: "Foreground", bundle: "com.apple.finder" },
  slack:         { pid: 503,  type: "Foreground", bundle: "com.tinyspeck.slackmacgap" },
  controlCenter: { pid: 601,  type: "UIElement",  bundle: "com.apple.controlcenter" },
  notifications: { pid: 602,  type: "UIElement",  bundle: "com.apple.notificationcenterui" },
  spotlight:     { pid: 603,  type: "UIElement",  bundle: "com.apple.Spotlight" },
  screenshot:    { pid: 604,  type: "Foreground", bundle: "com.apple.screencaptureui" },
  dock:          { pid: 605,  type: "UIElement",  bundle: "com.apple.dock" },
  stageManager:  { pid: 606,  type: "UIElement",  bundle: "com.apple.WindowManager" },
  emojiPicker:   { pid: 607,  type: "Foreground", bundle: "com.apple.CharacterPaletteIM" },
  loginWindow:   { pid: 608,  type: "Foreground", bundle: "com.apple.loginwindow" },
  helper:        { pid: 609,  type: "BackgroundOnly", bundle: "com.example.helper" },
};

/**
 * Load JS/arcAutoPip.uc.js into a fake Zen window.
 * opts:
 *   platform     "macosx" (default) | "linux"
 *   prefs        { "almost-arc.pip-on-blur": true, ... } user values
 *   front        app key or list of app keys: what successive front-app lookups
 *                (NSWorkspace.frontmostApplication) see (the last one repeats). Default "safari".
 *   frontFails   true: the front-app lookup finds no app
 *   allForeground   true: every app reports a regular activation policy (tests the bundle ignore list alone)
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
  // fresh per test: the debug timeline patches its prototype
  const LauncherParent = class { receiveMessage(msg) { return `handled ${msg.name}`; } };
  const calls = { front: 0, windows: 0, released: 0, subprocess: [] };
  let lastFront = [].concat(o.front)[0];
  const toggles = [];
  const logs = [];
  const prefs = new Map(Object.entries({ "almost-arc.pip-debug": true, ...o.prefs }));
  const defaults = new Map();

  // ---- macOS, through a fake js-ctypes: the front app (Objective-C runtime) and
  // the on-screen window list (CoreGraphics) ----
  function frontApp() {
    calls.front++;
    if (o.frontFails) return null;
    const key = fronts.length > 1 ? fronts.shift() : fronts[0];
    lastFront = key;
    return APPS[key];
  }
  // on-screen windows, as CGWindowListCopyWindowInfo would list them
  function cgWindowList() {
    calls.windows++;
    if (o.windows === "fail") throw new Error("CGWindowListCopyWindowInfo failed");
    const W = window;
    const zenRect = { x: W.screenX, y: W.screenY, w: W.outerWidth, h: W.outerHeight };
    let list = o.windows ?? [{ app: lastFront, ...zenRect }];   // Zen not on this desktop
    if (Array.isArray(list[0])) list = o.windows.length > 1 ? o.windows.shift() : o.windows[0];
    return list.map(w => ({ pid: APPS[w.app].pid, layer: w.layer ?? 0, alpha: 1, b: { X: w.x, Y: w.y, Width: w.w, Height: w.h } }));
  }
  // A fake js-ctypes with just what arcAutoPip's CoreGraphics lookup uses:
  // CF objects are plain JS values, pointers are { isNull, v }.
  const ptr = v => ({ v, isNull: () => v == null });
  const KEYS = { kCGWindowOwnerPID: "pid", kCGWindowLayer: "layer", kCGWindowAlpha: "alpha", kCGWindowBounds: "b" };
  const scalar = () => (v = 0) => { const c = { value: v, address: () => c }; return c; };
  const NATIVE = {
    CGWindowListCopyWindowInfo: (opts, id) => { calls.cgOptions = opts; return ptr(cgWindowList()); },
    CGRectMakeWithDictionaryRepresentation: (d, out) => { Object.assign(out, { x: d.v.X, y: d.v.Y, w: d.v.Width, h: d.v.Height }); return true; },
    CFArrayGetCount: a => a.v.length,
    CFArrayGetValueAtIndex: (a, i) => ptr(a.v[i]),
    CFDictionaryGetValue: (d, k) => ptr(d.v[k]),
    CFNumberGetValue: (n, type, out) => { out.value = n.v; return true; },
    CFRelease: a => { calls.released++; },
    objc_getClass: name => ptr(name === "NSWorkspace" ? { cls: name } : null),
    sel_registerName: name => name,
  };
  // objc_msgSend, declared once per return type: each selector must use the right one
  const SELECTORS = {
    sharedWorkspace: "void*", frontmostApplication: "void*", bundleIdentifier: "void*",
    processIdentifier: "int32", activationPolicy: "long", UTF8String: "char*",
  };
  const msgSend = ret => (self, sel) => {
    const want = SELECTORS[sel];
    if (!want) throw new Error(`unexpected selector ${sel}`);
    const got = ret === ctypes.int32_t ? "int32" : ret === ctypes.char.ptr ? "char*" : ret;
    if (got !== want) throw new Error(`${sel} sent with return type ${got}, needs ${want}`);
    const v = self.v;
    switch (sel) {
      case "sharedWorkspace": return ptr(v.cls ? { ws: true } : null);
      case "frontmostApplication": return ptr(frontApp());
      case "processIdentifier": return v.pid;
      case "activationPolicy": return { Foreground: 0, UIElement: 1, BackgroundOnly: 2 }[o.allForeground ? "Foreground" : v.type];
      case "bundleIdentifier": return ptr(v.bundle ? { str: v.bundle } : null);
      case "UTF8String": return { isNull: () => false, readString: () => v.str };
    }
  };
  const ctypes = {
    default_abi: "abi", voidptr_t: "void*", uint32_t: "u32", int32_t: scalar(), long: "long", bool: "bool", void_t: "void",
    char: { ptr: "char-ptr" },
    double: scalar(),
    cast: x => x,
    StructType: function () { const T = function () { const r = { x: 0, y: 0, w: 0, h: 0, address: () => r }; return r; }; T.ptr = "ptr"; return T; },
    open: path => ({
      declare(name, abi, ret) {
        if (name === "objc_msgSend") return msgSend(ret);
        if (name in KEYS) return KEYS[name];
        if (!(name in NATIVE)) throw new Error(`unexpected symbol ${name}`);
        return NATIVE[name];
      },
    }),
  };
  // Nothing should start a process on an app switch; any attempt is recorded and fails
  const Subprocess = {
    async call({ command }) {
      calls.subprocess.push(command);
      throw new Error(`unexpected command ${command}`);
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
        if (url.endsWith("ctypes.sys.mjs")) return { ctypes };
        if (url.endsWith("PictureInPicture.sys.mjs"))
          return { PictureInPicture: { weakAutoPipBrowserToParent: autoPipped, weakWinToBrowser: winToBrowser },
                   PictureInPictureLauncherParent: LauncherParent };
        throw new Error(`unexpected module ${url}`);
      },
    },
    setTimeout, clearTimeout, Promise, Number, Set, Map, WeakMap, JSON, Math, Date, Error,
  };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(ROOT, "JS/arcAutoPip.uc.js"), "utf8"), context,
                  { filename: "arcAutoPip.uc.js" });
  await settle();

  return {
    toggles, logs, calls, prefs, pipList, browser,
    /** macOS reports Zen fully covered (true) or not; fires occlusionstatechange. */
    cover(on = true) {
      window.isFullyOccluded = on;
      (listeners.occlusionstatechange || []).forEach(fn => fn({ type: "occlusionstatechange" }));
    },
    /** Zen minimized to the Dock (true) or restored; fires sizemodechange. */
    minimize(on = true) {
      window.windowState = on ? window.STATE_MINIMIZED : window.STATE_NORMAL;
      (listeners.sizemodechange || []).forEach(fn => fn({ type: "sizemodechange" }));
    },
    /** Firefox's PiP launcher actor class (the debug timeline wraps its receiveMessage). */
    LauncherParent,
    /** A message from this window's page to Firefox's PiP launcher, as an actor of it gets it. */
    pipMessage(name, data = {}) {
      const actor = Object.create(LauncherParent.prototype);
      actor.browsingContext = { top: { embedderElement: { documentGlobal: window } } };
      return actor.receiveMessage({ name, data });
    },
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
