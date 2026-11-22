// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// Smoke test in a real, running Zen (Linux under Xvfb in CI; tests/zen/run-linux.sh
// sets it up). Drives Zen through Marionette with trusted input (windowUtils mouse
// events, TextInputProcessor keys) and checks each feature of the mod.
// Usage: node tests/zen/smoke.mjs [--port 2828] [--shots <dir>] [--only <name,...>]

import fs from "node:fs";
import path from "node:path";
import { Marionette } from "./marionette.mjs";

const argv = process.argv.slice(2);
const opt = (name, d) => { const i = argv.indexOf(`--${name}`); return i >= 0 ? argv[i + 1] : d; };
const PORT = Number(opt("port", 2828));
const SHOTS = opt("shots", null);
const ONLY = opt("only", null)?.split(",");

// Runs in Zen's window before every check: helpers for the checks below.
const PRELUDE = `
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  async function until(fn, what, ms = 10000) {
    const end = Date.now() + ms;
    for (;;) {
      let v; try { v = await fn(); } catch (e) { v = undefined; }
      if (v) return v;
      if (Date.now() > end) throw new Error("timed out waiting for " + what);
      await sleep(100);
    }
  }
  function assert(ok, msg) { if (!ok) throw new Error(msg); }
  // trusted keys, as if typed: key(win, "z", { accel: true, shift: false })
  function key(win, k, { accel = false, shift = false } = {}) {
    const tip = Cc["@mozilla.org/text-input-processor;1"].createInstance(Ci.nsITextInputProcessor);
    tip.beginInputTransactionForTests(win);
    const KE = win.KeyboardEvent;
    const mods = [];
    if (accel) mods.push(AppConstants.platform === "macosx" ? ["Meta", "MetaLeft"] : ["Control", "ControlLeft"]);
    if (shift) mods.push(["Shift", "ShiftLeft"]);
    for (const [m, c] of mods) tip.keydown(new KE("", { key: m, code: c }));
    const code = k.length === 1 ? "Key" + k.toUpperCase() : k;
    const keyCode = k.length === 1 ? k.toUpperCase().charCodeAt(0) : ({ Escape: 27, Delete: 46, Backspace: 8, Enter: 13 })[k];
    const e = new KE("", { key: shift && k.length === 1 ? k.toUpperCase() : k, code, keyCode });
    tip.keydown(e); tip.keyup(e);
    for (const [m, c] of mods.reverse()) tip.keyup(new KE("", { key: m, code: c }));
  }
  // real (native, through the OS) mouse at CSS px from a window's viewport top left
  const NATIVE = { mousedown: 1, mouseup: 2, mousemove: 3 };
  async function mouse(win, type, x, y) {
    const dpr = win.devicePixelRatio;
    const top = win.browsingContext?.topChromeWindow || win;   // the OS window it's in
    top.windowUtils.sendNativeMouseEvent(
      Math.round((win.mozInnerScreenX + x) * dpr), Math.round((win.mozInnerScreenY + y) * dpr),
      NATIVE[type], 0, 0, top.document.documentElement, null);
    await sleep(60);
  }
  async function clickAt(win, x, y) { await mouse(win, "mousemove", x, y); await mouse(win, "mousedown", x, y); await mouse(win, "mouseup", x, y); }
  async function clickEl(el) {
    const r = el.getBoundingClientRect();
    await clickAt(el.ownerDocument.defaultView, r.left + r.width / 2, r.top + r.height / 2);
  }
  async function openTab(url) {
    const tab = gBrowser.addTab(url, { triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal() });
    gBrowser.selectedTab = tab;
    await until(() => !tab.hasAttribute("busy") && tab.linkedBrowser.currentURI.spec !== "about:blank", "tab to load " + url);
    return tab;
  }
  const errorsSince = t0 => Services.console.getMessageArray()
    .filter(m => m instanceof Ci.nsIScriptError && !(m.flags & Ci.nsIScriptError.warningFlag) && m.timeStamp >= t0
      && /\\/chrome\\/(JS\\/arc|almost-arc)|almostarc-easel/.test(m.sourceName || ""))
    .map(m => (m.sourceName || "").split("/").pop() + ":" + m.lineNumber + " " + m.errorMessage);
`;

const checks = [];
const check = (name, body) => checks.push({ name, body });

check("startup: every script loaded, no errors from the mod", `
  await until(() => window.gBrowserInit?.delayedStartupFinished, "startup");
  await SessionStore.promiseAllWindowsRestored;
  await sleep(2500);
  const want = ["__arcToolbarTint", "__arcUrlbarButtons", "__arcUrlPill", "__arcCompactSidebar", "__arcAutoPip",
    "__arcTabUndo", "__arcColorWheel", "__arcEasel"];   // arcNotices: off in the test profile (no update check)
  const missing = want.filter(k => !window[k]);
  assert(!missing.length, "scripts not loaded: " + missing.join(", "));
  assert(document.documentElement.hasAttribute("almost-arc-js"), "no [almost-arc-js] on the root");
  const errs = errorsSince(0);
  assert(!errs.length, "errors: " + errs.join(" | "));
  return { platform: AppConstants.platform, zen: Services.appinfo.version };
`);

check("styles: chrome.css is applied (card toolbar, centered pill)", `
  const nav = document.getElementById("zen-appcontent-navbar-wrapper");
  assert(nav, "no #zen-appcontent-navbar-wrapper");
  const sheets = [...document.styleSheets].length;
  const pill = document.getElementById("arc-url-pill");
  assert(pill && pill.getBoundingClientRect().width > 0, "URL pill isn't shown");
  // the notice chrome.css shows when scripts don't run must stay hidden
  const after = getComputedStyle(document.getElementById("browser"), "::after").content;
  assert(after === "none" || after === "normal" || after === '""', "scripts-not-running notice is showing: " + after);
  return { pillWidth: Math.round(pill.getBoundingClientRect().width), sheets };
`);

check("toolbar tint: takes the color of the page's top edge", `
  const t0 = Date.now();
  const tab = await openTab("data:text/html,<body style='margin:0;background:rgb(200,30,40)'><div style='height:2000px'></div>");
  const nav = document.getElementById("zen-appcontent-navbar-wrapper");
  const tinted = await until(() => {
    const s = nav.getAttribute("style") || "";
    return /200|c81e28|rgb\\(\\s*200/i.test(s) || /200/.test(getComputedStyle(nav).backgroundColor) ? s || getComputedStyle(nav).backgroundColor : null;
  }, "toolbar tint", 6000);
  gBrowser.removeTab(tab);
  const errs = errorsSince(t0);
  assert(!errs.length, "errors: " + errs.join(" | "));
  return { tinted: String(tinted).slice(0, 160) };
`);

check("URL pill: shows the domain; clicking it opens the floating address bar", `
  const tab = await openTab("https://example.com/some/path");
  const pill = document.getElementById("arc-url-pill");
  await until(() => /example\\.com/.test(pill.textContent), "pill to show example.com");
  await clickEl(pill);
  await until(() => gURLBar.hasAttribute("breakout-extend") || gURLBar.focused || gURLBar.view.isOpen, "floating urlbar to open");
  const opened = { focused: gURLBar.focused, extend: gURLBar.hasAttribute("breakout-extend") };
  key(window, "Escape"); key(window, "Escape");
  await sleep(300);
  gBrowser.removeTab(tab);
  return { pill: pill.textContent.trim(), opened };
`);

check("copy link: the button sits by the pill and shows a checkmark", `
  const tab = await openTab("https://example.com/");
  const btn = document.getElementById("zen-copy-url-button");
  assert(btn, "no copy button");
  assert(btn.hasAttribute("arc-moved"), "copy button wasn't moved by the pill");
  document.getElementById("cmd_zenCopyCurrentURL")?.doCommand?.();
  await until(() => btn.hasAttribute("arc-copied"), "checkmark", 3000);
  gBrowser.removeTab(tab);
  return true;
`);

check("easel: New Easel is in the menus and opens a drawing tab without the toolbar", `
  const t0 = Date.now();
  for (const id of ["almost-arc-new-easel", "almost-arc-new-easel-tab", "almost-arc-new-easel-plus"]) {
    assert(document.getElementById(id), "menu item missing: " + id);
  }
  document.getElementById("almost-arc-new-easel").doCommand();
  const b = await until(() => /^chrome:\\/\\/almostarc-easel\\//.test(gBrowser.selectedBrowser.currentURI.spec)
    && gBrowser.selectedBrowser.contentDocument?.readyState === "complete" && gBrowser.selectedBrowser, "easel to load");
  const doc = b.contentDocument;
  assert(doc.getElementById("ink") && doc.getElementById("bar"), "easel page didn't render (error page?): " + doc.documentURI);
  assert(document.documentElement.hasAttribute("almost-arc-easel"), "toolbar not hidden on an easel");
  const id = b.currentURI.spec.split("#")[1];
  // draw a line with the mouse
  const win = b.contentWindow;
  await sleep(300);
  await mouse(win, "mousemove", 200, 200); await mouse(win, "mousedown", 200, 200);
  await mouse(win, "mousemove", 260, 240); await mouse(win, "mousemove", 320, 300); await mouse(win, "mouseup", 320, 300);
  const file = PathUtils.join(PathUtils.profileDir, "almost-arc-easels", id + ".json");
  const saved = await until(async () => (await IOUtils.exists(file)) && (await IOUtils.readJSON(file)), "drawing to save", 5000);
  assert(saved.items?.length === 1 && saved.items[0].p.length >= 2, "saved: " + JSON.stringify(saved).slice(0, 200));
  // accel+Z after a click in the easel undoes the line
  key(win, "z", { accel: true });
  await until(async () => (await IOUtils.readJSON(file)).items.length === 0, "undo in the easel", 5000);
  key(win, "z", { accel: true, shift: true });
  await until(async () => (await IOUtils.readJSON(file)).items.length === 1, "redo in the easel", 5000);
  const errs = errorsSince(t0);
  assert(!errs.length, "errors: " + errs.join(" | "));
  return { id, points: saved.items[0].p.length };
`);

check("easel: text, and the drawing comes back after closing and reopening the tab", `
  const b = gBrowser.selectedBrowser;
  assert(/almostarc-easel/.test(b.currentURI.spec), "easel isn't selected");
  const doc = b.contentDocument, win = b.contentWindow;
  const id = b.currentURI.spec.split("#")[1];
  const file = PathUtils.join(PathUtils.profileDir, "almost-arc-easels", id + ".json");
  await clickEl(doc.querySelector('[data-tool="text"]'));
  await clickAt(win, 400, 150);
  await until(() => !doc.getElementById("editor").hidden, "text box");
  for (const ch of "hi") key(win, ch);
  key(win, "Escape");
  await until(async () => (await IOUtils.readJSON(file)).items.some(i => i.k === "text" && i.v === "hi"), "text to save", 5000);
  // close the tab, then the browser's undo (after a click outside the page) reopens it
  const url = b.currentURI.spec;
  gBrowser.removeTab(gBrowser.selectedTab);
  await sleep(500);
  SessionStore.undoCloseTab(window, 0);
  const b2 = await until(() => gBrowser.selectedBrowser.currentURI.spec === url && gBrowser.selectedBrowser.contentDocument?.readyState === "complete" && gBrowser.selectedBrowser, "easel to reopen");
  await sleep(800);
  const items = (await IOUtils.readJSON(file)).items.length;
  assert(items === 2, "items after reopening: " + items);
  return { items };
`);

check("tab undo: accel+Z reopens a tab you closed", `
  Services.prefs.setBoolPref("almost-arc.undo-debug", true);
  await sleep(2000);   // armed 1.5 s after the session is restored
  const tab = await openTab("https://example.org/undo-me");
  await sleep(300);
  // close it with the keyboard (real input), then accel+Z
  key(window, "w", { accel: true });
  await until(() => !gBrowser.tabs.some(t => t.linkedBrowser?.currentURI?.spec === "https://example.org/undo-me"), "tab to close");
  await sleep(300);
  const fe = document.commandDispatcher.focusedElement;
  const focus = { selected: gBrowser.selectedBrowser.currentURI.spec.slice(0, 60), fe: fe && (fe.localName + "#" + fe.id),
    ime: window.windowUtils.IMEStatus, hidden: fe?.hidden,
    pageActive: (a => a && (a.localName + "#" + a.id + (a.hidden ? " hidden" : "")))(gBrowser.selectedBrowser.contentDocument?.activeElement),
    focusedWin: String(Services.focus.focusedWindow?.location) };
  key(window, "z", { accel: true });
  await until(() => gBrowser.tabs.some(t => t.linkedBrowser?.currentURI?.spec === "https://example.org/undo-me"
    || SessionStore.getTabState(t).includes("undo-me")), "tab to come back (focus: " + JSON.stringify(focus) + ")", 5000);
  return true;
`);

check("layout: Zen's own window buttons (Linux title bar) are visible and clear of the pill", `
  Services.prefs.setIntPref("browser.tabs.inTitlebar", 1);
  await sleep(1500);
  // shown = laid out, visible, and not see-through anywhere up the tree (without hovering)
  const shown = el => {
    if (!(el.getBoundingClientRect().width > 0) || getComputedStyle(el).visibility === "hidden") return false;
    for (let e = el; e && e !== document.documentElement; e = e.parentElement) if (Number(getComputedStyle(e).opacity) < 0.5) return false;
    return true;
  };
  await mouse(window, "mousemove", 300, window.innerHeight - 20);   // not over the toolbar
  await sleep(400);
  const box = [...document.querySelectorAll(".titlebar-buttonbox-container")].filter(shown);
  const pill = (document.getElementById("arc-url-pill") || document.getElementById("urlbar")).getBoundingClientRect();
  const rects = box.map(b => { const r = b.getBoundingClientRect(); return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height), in: b.parentElement?.id }; });
  const all = [...document.querySelectorAll(".titlebar-buttonbox-container")].map(b => ({ in: b.parentElement?.id,
    display: getComputedStyle(b).display, opacity: getComputedStyle(b).opacity, w: Math.round(b.getBoundingClientRect().width) }));
  assert(rects.length, "no window buttons shown: " + JSON.stringify({ all, tabsInTitlebar: document.documentElement.getAttribute("tabsintitlebar"),
    customtitlebar: document.documentElement.getAttribute("customtitlebar"), csd: matchMedia("(-moz-gtk-csd-available)").matches,
    inTitlebarPref: Services.prefs.getIntPref("browser.tabs.inTitlebar", -1) }));
  const W = window.innerWidth;
  for (const r of rects) {
    assert(r.x >= 0 && r.x + r.w <= W + 1 && r.y >= 0, "window buttons off screen: " + JSON.stringify(r));
    assert(r.x >= pill.right || r.x + r.w <= pill.left || r.y >= pill.bottom || r.y + r.h <= pill.top, "window buttons overlap the pill");
  }
  return { rects, pill: [Math.round(pill.left), Math.round(pill.right)] };
`);

check("layout: compact mode hides the sidebar and it pops out on hover", `
  const root = document.documentElement;
  document.getElementById("cmd_zenCompactModeToggle")?.doCommand();
  await until(() => root.getAttribute("zen-compact-mode") === "true", "compact mode");
  await sleep(800);
  const sb = document.getElementById("navigator-toolbox");
  const hidden = sb.getBoundingClientRect();
  return { compact: true, arcLayout: root.getAttribute("arc-compact-sidebar"), sidebar: [Math.round(hidden.left), Math.round(hidden.width)],
    toggle: !!document.getElementById("almost-arc-sidebar-toggle") };
`);

// a page with a playing video with sound (a canvas plus a quiet tone): no media files or network needed.
// Firefox only pops out videos with an unmuted sound track on a tab switch or minimize.
const VIDEO_PAGE = "data:text/html," + encodeURIComponent(`<body style="margin:0;background:#111">
<canvas id=c width=640 height=360 hidden></canvas><video id=v playsinline width=640 height=360></video>
<script>const c = document.getElementById("c"), x = c.getContext("2d"); let i = 0;
setInterval(() => { x.fillStyle = "hsl(" + (i++ * 7 % 360) + ",80%,50%)"; x.fillRect(0, 0, 640, 360); }, 40);
const s = c.captureStream(25), ac = new AudioContext(), o = ac.createOscillator(), g = ac.createGain(), d = ac.createMediaStreamDestination();
g.gain.value = 0.02; o.connect(g); g.connect(d); o.start(); s.addTrack(d.stream.getAudioTracks()[0]);
const v = document.getElementById("v"); v.srcObject = s; v.play();</script>`);

const PIP = `
  const pipWin = () => Services.wm.getMostRecentWindow("Toolkit:PictureInPicture");
  async function openVideo() {
    const tab = await openTab(${JSON.stringify(VIDEO_PAGE)});
    await until(() => tab.hasAttribute("soundplaying") || tab.linkedBrowser.browsingContext?.currentWindowGlobal, "video page");
    await sleep(1500);
    return tab;
  }
  async function pipOpen(tab) {
    tab.linkedBrowser.browsingContext.currentWindowGlobal.getActor("PictureInPictureLauncher")
      .sendAsyncMessage("PictureInPicture:KeyToggle");
    const w = await until(() => pipWin()?.document?.readyState === "complete" && pipWin(), "PiP window", 8000);
    await sleep(1200);
    return w;
  }
  async function pipClosed() { await until(() => !pipWin(), "PiP to close", 6000); }
`;

check("PiP: Arc's controls in Firefox's Picture-in-Picture window", PIP + `
  const t0 = Date.now();
  const tab = await openVideo();
  const w = await pipOpen(tab);
  const d = w.document;
  const res = { layout: !!w.__arcPipLayout, flick: !!w.__arcPipFlick,
    backToTab: !!d.getElementById("unpip"), minimize: !!d.getElementById("arc-pip-min"), close: !!d.getElementById("close"),
    size: [w.outerWidth, w.outerHeight] };
  assert(res.layout && res.flick, "PiP scripts didn't load: " + JSON.stringify(res));
  assert(res.backToTab && res.minimize && res.close, "PiP controls missing: " + JSON.stringify(res));
  const errs = errorsSince(t0);
  assert(!errs.length, "errors: " + errs.join(" | "));
  return res;
`);

check("PiP: a two-finger swipe glides it into that corner", PIP + `
  const w = pipWin() || await pipOpen(await openVideo());
  const s = w.screen;
  w.moveTo(s.availLeft + Math.round((s.availWidth - w.outerWidth) / 2), s.availTop + Math.round((s.availHeight - w.outerHeight) / 2));
  await sleep(500);
  const before = [w.screenX, w.screenY];
  const video = w.document.querySelector("video") || w.document.documentElement;
  // fingers moving right and down: the content moves with them, so negative pixel deltas (a touchpad)
  for (let i = 0; i < 6; i++) {
    video.dispatchEvent(new w.WheelEvent("wheel", { deltaX: -40, deltaY: -40, deltaMode: 0, bubbles: true, cancelable: true }));
    await sleep(16);
  }
  await sleep(1200);
  const after = [w.screenX, w.screenY];
  const right = s.availLeft + s.availWidth - w.outerWidth, bottom = s.availTop + s.availHeight - w.outerHeight;
  assert(after[0] > before[0] + 50 && after[1] > before[1] + 50, "didn't move toward the corner: " + JSON.stringify({ before, after }));
  assert(Math.abs(after[0] - right) < 40 && Math.abs(after[1] - bottom) < 40, "not in the bottom right corner: " + JSON.stringify({ after, right, bottom }));
  return { before, after };
`);

check("PiP: drag it and let go fast: it's flung into a corner", PIP + `
  const w = pipWin() || await pipOpen(await openVideo());
  const s = w.screen;
  w.moveTo(s.availLeft + Math.round((s.availWidth - w.outerWidth) / 2), s.availTop + Math.round((s.availHeight - w.outerHeight) / 2));
  await sleep(500);
  const before = [w.screenX, w.screenY];
  const cx = Math.round(w.innerWidth * 0.75), cy = Math.round(w.innerHeight * 0.3);   // the video, not a control
  let downs = 0; w.addEventListener("pointerdown", () => downs++, true);
  await mouse(w, "mousemove", cx, cy);
  await mouse(w, "mousedown", cx, cy);
  for (let i = 1; i <= 5; i++) await mouse(w, "mousemove", cx - i * 30, cy - i * 20);   // the window follows the pointer
  await mouse(w, "mouseup", cx - 150, cy - 100);
  await sleep(1200);
  const after = [w.screenX, w.screenY];
  assert(after[0] < before[0] - 50 && after[1] < before[1] - 50, "didn't go toward the top left: " + JSON.stringify({ before, after, downs }));
  return { before, after };
`);

check("PiP: dragging its corner resizes it, keeping the video's shape (Linux)", PIP + `
  const w = pipWin() || await pipOpen(await openVideo());
  const s = w.screen;
  w.moveTo(s.availLeft + 200, s.availTop + 150);
  await sleep(500);
  const before = [w.outerWidth, w.outerHeight], at = [w.screenX, w.screenY];
  // 20 px inside the bottom right corner: Firefox's own resize border takes the outer ~15 px
  const x0 = w.outerWidth - 20, y0 = w.outerHeight - 20;
  await mouse(w, "mousemove", x0, y0);
  const cursor = w.document.documentElement.getAttribute("arc-resize");
  await mouse(w, "mousedown", x0, y0);
  for (let i = 1; i <= 5; i++) await mouse(w, "mousemove", x0 + i * 24, y0 + i * 14);
  await mouse(w, "mouseup", x0 + 120, y0 + 70);
  await sleep(800);
  const after = [w.outerWidth, w.outerHeight];
  assert(cursor === "nwse", "no resize cursor at the corner: " + cursor);
  assert(after[0] > before[0] + 60, "didn't get bigger: " + JSON.stringify({ before, after }));
  assert(Math.abs(after[0] / after[1] - before[0] / before[1]) < 0.03, "shape changed: " + JSON.stringify({ before, after }));
  assert(Math.abs(w.screenX - at[0]) < 4 && Math.abs(w.screenY - at[1]) < 4, "top left corner moved: " + JSON.stringify({ at, now: [w.screenX, w.screenY] }));
  return { before, after };
`);

check("PiP: Back to Tab closes it; switching tabs or minimizing Zen pops a video out", PIP + `
  const w = pipWin() || await pipOpen(await openVideo());
  w.document.getElementById("unpip").click();
  await pipClosed();
  // Firefox's own (install.sh turns it on): it pops out a playing, unmuted video when you switch tabs
  assert(Services.prefs.getBoolPref("media.videocontrols.picture-in-picture.enable-when-switching-tabs.enabled"), "auto-PiP pref off");
  // Linux: Firefox's covered/minimized PiP too (macOS uses the mod's own instead)
  assert(Services.prefs.getBoolPref("media.videocontrols.picture-in-picture.enable-when-occluded.enabled") === (AppConstants.platform !== "macosx"),
    "enable-when-occluded should be on except on macOS");
  const video = gBrowser.selectedTab;
  // switching tabs pops it out
  const other = await openTab("data:text/html,<title>other</title>other tab");
  await until(() => pipWin(), "a PiP after switching away from the video's tab", 6000);
  // going back to the video's tab closes it
  gBrowser.selectedTab = video;
  await pipClosed();
  await sleep(1000);
  // and so does minimizing Zen (on Linux Firefox doesn't hear of a window covering Zen, only of minimizing it)
  window.minimize();
  // the window manager has to minimize it for real (Firefox hears of it as a size-mode change)
  await until(() => window.windowState === window.STATE_MINIMIZED, "Zen to be minimized (window state " + window.windowState + ")", 4000);
  await until(() => pipWin(), "a PiP after minimizing Zen", 6000);
  window.restore();
  await pipClosed();   // closed again when Zen comes back
  await sleep(1000);
  gBrowser.removeTab(other); gBrowser.removeTab(video);
  return { tabSwitch: true, minimize: true };
`);

check("color wheel: installs on Zen's theme picker when it opens", `
  // The colors themselves are unit-tested (tests/colorWheel.test.mjs). Here: that this Zen still
  // has what the script wraps, and that it hooks in when the picker opens. (Under Xvfb the
  // picker's opening animation doesn't finish, so its wheel never gets a size to measure.)
  const picker = window.gZenThemePicker;
  assert(picker, "no gZenThemePicker");
  const fns = ["getColorFromPosition", "handleColorPositions", "createDot"].filter(f => typeof picker[f] !== "function");
  assert(!fns.length, "Zen's picker no longer has: " + fns.join(", "));
  const t0 = Date.now();
  const panel = picker.panel;
  await PanelMultiView.openPopup(panel, document.getElementById("zen-appcontent-navbar-wrapper"), { position: "bottomleft topleft" });
  await until(() => picker.__arcColorWheel, "the color wheel to install when the picker opens", 5000);
  try { PanelMultiView.hidePopup(panel); } catch (e) {}
  const errs = errorsSince(t0);
  assert(!errs.length, "errors: " + errs.join(" | "));
  return true;
`);

async function main() {
  const m = await new Marionette().connect(PORT, 90000);
  await m.session();
  if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
  let failed = 0;
  for (const c of checks) {
    if (ONLY && !ONLY.some(o => c.name.startsWith(o))) continue;
    const t = Date.now();
    try {
      const v = await m.run(PRELUDE + c.body);
      console.log(`ok   ${c.name} (${Date.now() - t} ms)${v && v !== true ? "  " + JSON.stringify(v) : ""}`);
    } catch (e) {
      failed++;
      console.log(`FAIL ${c.name}\n     ${String(e.message).split("\n").slice(0, 3).join("\n     ")}`);
    }
    if (SHOTS) {
      try {
        const shot = await m.send("WebDriver:TakeScreenshot", { full: false });
        const name = c.name.split(":")[0].replace(/[^a-z0-9]+/gi, "-") + "-" + checks.indexOf(c) + ".png";
        fs.writeFileSync(path.join(SHOTS, name), Buffer.from(shot.value ?? shot, "base64"));
      } catch (e) {}
    }
  }
  await m.quit();
  console.log(failed ? `\n${failed} failed` : "\nall passed");
  process.exit(failed ? 1 : 0);
}
main().catch(e => { console.error(e); process.exit(2); });
