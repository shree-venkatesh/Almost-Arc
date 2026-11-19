// ==UserScript==
// @name           Almost Arc easels
// @description    Arc-style easels: a tab you draw in. "New Easel" (Zen's + button
//                 at the bottom of the sidebar, File menu, tab context menu) opens one; it saves as you draw and comes back with the
//                 tab (pin it, put it in a folder, restart Zen: the drawing is still
//                 there). Pen, eraser, colors, sizes, undo/redo (Cmd+Z / Cmd+Shift+Z),
//                 two-finger scroll to move around. Drawings are saved in the profile
//                 folder, <profile>/almost-arc-easels/<id>.json.
//                 Pref: almost-arc.easel (default true)
// ==/UserScript==

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// The easel page is a chrome:// page of our own (chrome://almostarc-easel/content/),
// written into <profile>/chrome/almost-arc-easel/ by this script and registered with a
// chrome manifest, so it works the same whatever loaded this script (install.sh's
// fx-autoconfig or Sine). It only ever draws strokes on a canvas: no web content, no
// HTML from the saved file.

(function () {
  if (window.__arcEasel) return;
  window.__arcEasel = true;

  const PREF = "almost-arc.easel";
  try { Services.prefs.getDefaultBranch("").setBoolPref(PREF, true); } catch (e) {}
  if (!Services.prefs.getBoolPref(PREF, true)) return;

  const HOST = "almostarc-easel";
  const PREFIX = `chrome://${HOST}/content/`;
  const DIR = PathUtils.join(PathUtils.profileDir, "chrome", "almost-arc-easel");
  const MANIFEST = PathUtils.join(DIR, "easel.manifest");

  // ---- the page ------------------------------------------------------------
  // Runs inside the easel tab (a privileged page: IOUtils / PathUtils are there).
  // Written out as easel.js from this function's source, so it must not use
  // anything from the script around it.
  function easelPage() {
    "use strict";
    const VALID_ID = /^[a-z0-9]{8,32}$/;
    const COLORS = ["ink", "#e5484d", "#f76b15", "#ffc53d", "#30a46c", "#0090ff", "#8e4ec6"];
    const SIZES = [2, 5, 10];
    const SAVE_MS = 400;
    const $ = id => document.getElementById(id);

    const id = location.hash.slice(1);
    if (!VALID_ID.test(id)) {
      $("broken").hidden = false;
      $("bar").hidden = true;
      return;
    }
    const dir = PathUtils.join(PathUtils.profileDir, "almost-arc-easels");
    const file = PathUtils.join(dir, `${id}.json`);

    const canvas = $("ink");
    const ctx = canvas.getContext("2d");
    const nameEl = $("name");
    let doc = { v: 1, name: "", strokes: [] };
    let loaded = false;
    let tool = "pen", color = COLORS[0], size = SIZES[1];
    let view = { x: 0, y: 0 };            // how far you've scrolled the drawing
    let current = null;                  // the stroke being drawn
    let erasing = null;                  // [[index, stroke]] removed by this eraser drag
    const undoStack = [], redoStack = [];

    // ---- saved file ----
    const num = v => typeof v === "number" && Number.isFinite(v);
    function clean(data) {
      const out = { v: 1, name: "", strokes: [] };
      if (typeof data?.name === "string") out.name = data.name.slice(0, 200);
      for (const s of Array.isArray(data?.strokes) ? data.strokes : []) {
        if (!COLORS.includes(s?.c) || !num(s?.w) || !Array.isArray(s?.p)) continue;
        const p = s.p.filter(q => Array.isArray(q) && num(q[0]) && num(q[1])).map(q => [q[0], q[1]]);
        if (p.length) out.strokes.push({ c: s.c, w: Math.min(Math.max(s.w, 1), 40), p });
      }
      return out;
    }
    let saveTimer = null;
    function save() {
      if (!loaded) return;
      clearTimeout(saveTimer);
      saveTimer = setTimeout(writeNow, SAVE_MS);
    }
    async function writeNow() {
      saveTimer = null;
      try {
        await IOUtils.makeDirectory(dir, { ignoreExisting: true });
        await IOUtils.writeJSON(file, doc, { tmpPath: `${file}.tmp` });
      } catch (e) { console.error("[easel] save failed", e); }
    }
    async function load() {
      try {
        if (await IOUtils.exists(file)) {
          try { doc = clean(await IOUtils.readJSON(file)); }
          catch (e) {
            // unreadable: keep it aside rather than overwrite it
            console.error("[easel] couldn't read", file, e);
            await IOUtils.move(file, `${file}.broken-${Date.now()}`).catch(() => {});
          }
        }
      } catch (e) { console.error("[easel] load failed", e); }
      loaded = true;
      nameEl.value = doc.name;
      showName();
      draw();
    }

    // ---- drawing ----
    function inkColor(c) {
      if (c !== "ink") return c;
      return getComputedStyle(document.documentElement).getPropertyValue("--ink").trim() || "#1d1c1a";
    }
    function strokePath(s) {
      const p = s.p;
      ctx.beginPath();
      ctx.lineWidth = s.w;
      ctx.strokeStyle = ctx.fillStyle = inkColor(s.c);
      if (p.length === 1) {
        ctx.arc(p[0][0] + view.x, p[0][1] + view.y, s.w / 2, 0, Math.PI * 2);
        ctx.fill();
        return;
      }
      ctx.moveTo(p[0][0] + view.x, p[0][1] + view.y);
      for (let i = 1; i < p.length - 1; i++) {   // smooth: curve through the midpoints
        const mx = (p[i][0] + p[i + 1][0]) / 2, my = (p[i][1] + p[i + 1][1]) / 2;
        ctx.quadraticCurveTo(p[i][0] + view.x, p[i][1] + view.y, mx + view.x, my + view.y);
      }
      const last = p[p.length - 1];
      ctx.lineTo(last[0] + view.x, last[1] + view.y);
      ctx.stroke();
    }
    let frame = 0;
    function draw() {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        const dpr = window.devicePixelRatio || 1;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, canvas.width / dpr, canvas.height / dpr);
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        for (const s of doc.strokes) strokePath(s);
        if (current) strokePath(current);
      });
    }
    function resize() {
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.round(window.innerWidth * dpr);
      canvas.height = Math.round(window.innerHeight * dpr);
      draw();
    }

    // ---- history ----
    function done(step) {
      undoStack.push(step);
      redoStack.length = 0;
      updateButtons();
      save();
    }
    function apply(step, back) {
      if (step.t === "add") {
        if (back) doc.strokes.splice(doc.strokes.lastIndexOf(step.s), 1);
        else doc.strokes.push(step.s);
      } else if (step.t === "erase") {
        if (back) for (const [i, s] of [...step.items].sort((a, b) => a[0] - b[0])) doc.strokes.splice(i, 0, s);
        else for (const [, s] of step.items) doc.strokes.splice(doc.strokes.indexOf(s), 1);
      } else if (step.t === "clear") {
        doc.strokes = back ? step.strokes.slice() : [];
      }
    }
    function undo() {
      const step = undoStack.pop();
      if (!step) return;
      apply(step, true);
      redoStack.push(step);
      updateButtons(); save(); draw();
    }
    function redo() {
      const step = redoStack.pop();
      if (!step) return;
      apply(step, false);
      undoStack.push(step);
      updateButtons(); save(); draw();
    }
    function updateButtons() {
      $("undo").disabled = !undoStack.length;
      $("redo").disabled = !redoStack.length;
      $("clear").disabled = !doc.strokes.length;
    }

    // ---- eraser: removes whole strokes it touches ----
    function distToSegment(px, py, a, b) {
      const dx = b[0] - a[0], dy = b[1] - a[1];
      const len = dx * dx + dy * dy;
      const t = len ? Math.max(0, Math.min(1, ((px - a[0]) * dx + (py - a[1]) * dy) / len)) : 0;
      return Math.hypot(px - (a[0] + t * dx), py - (a[1] + t * dy));
    }
    function eraseAt(x, y) {
      const R = 8;
      for (let i = doc.strokes.length - 1; i >= 0; i--) {
        const s = doc.strokes[i], p = s.p;
        let hit = false;
        for (let j = 0; j < p.length && !hit; j++) {
          hit = distToSegment(x, y, p[j], p[Math.min(j + 1, p.length - 1)]) <= R + s.w / 2;
        }
        if (hit) {
          // index among the strokes as they were before this drag
          let original = i;
          for (const [k] of [...erasing].sort((a, b) => a[0] - b[0])) if (k <= original) original++;
          erasing.push([original, s]);
          doc.strokes.splice(i, 1);
          draw();
        }
      }
    }

    // ---- pointer ----
    const at = e => [Math.round((e.clientX - view.x) * 10) / 10, Math.round((e.clientY - view.y) * 10) / 10];
    canvas.addEventListener("pointerdown", e => {
      if (e.button !== 0 || !loaded) return;
      canvas.setPointerCapture?.(e.pointerId);
      if (tool === "eraser") {
        erasing = [];
        eraseAt(...at(e));
      } else {
        current = { c: color, w: size, p: [at(e)] };
        draw();
      }
    });
    canvas.addEventListener("pointermove", e => {
      if (!current && !erasing) return;
      const events = e.getCoalescedEvents?.() || [e];
      for (const ev of events.length ? events : [e]) {
        const q = at(ev);
        if (erasing) { eraseAt(...q); continue; }
        const last = current.p[current.p.length - 1];
        if (Math.hypot(q[0] - last[0], q[1] - last[1]) >= 1) current.p.push(q);
      }
      if (current) draw();
    });
    function finish() {
      if (current) {
        const s = current;
        current = null;
        doc.strokes.push(s);
        done({ t: "add", s });
        draw();
      } else if (erasing) {
        const items = erasing;
        erasing = null;
        if (items.length) done({ t: "erase", items });
      }
    }
    canvas.addEventListener("pointerup", finish);
    canvas.addEventListener("pointercancel", finish);

    // two-finger scroll moves the drawing
    canvas.addEventListener("wheel", e => {
      e.preventDefault();
      const k = e.deltaMode === 1 ? 16 : 1;
      view = { x: view.x - e.deltaX * k, y: view.y - e.deltaY * k };
      draw();
    }, { passive: false });

    // ---- toolbar ----
    function select(group, attr, value) {
      for (const b of $(group).querySelectorAll(`[${attr}]`)) {
        b.setAttribute("aria-pressed", String(b.getAttribute(attr) === String(value)));
      }
    }
    function setTool(t) {
      tool = t;
      document.documentElement.dataset.tool = t;
      select("tools", "data-tool", t);
    }
    $("tools").addEventListener("click", e => {
      const b = e.target.closest?.("[data-tool]");
      if (b) setTool(b.getAttribute("data-tool"));
    });
    $("colors").addEventListener("click", e => {
      const b = e.target.closest?.("[data-color]");
      if (!b) return;
      color = b.getAttribute("data-color");
      select("colors", "data-color", color);
      setTool("pen");
    });
    $("sizes").addEventListener("click", e => {
      const b = e.target.closest?.("[data-size]");
      if (!b) return;
      size = Number(b.getAttribute("data-size"));
      select("sizes", "data-size", size);
    });
    $("undo").addEventListener("click", undo);
    $("redo").addEventListener("click", redo);
    $("clear").addEventListener("click", () => {
      if (!doc.strokes.length) return;
      const strokes = doc.strokes.slice();
      doc.strokes = [];
      done({ t: "clear", strokes });
      draw();
    });

    // ---- name ----
    function showName() {
      document.title = doc.name.trim() || "Untitled Easel";
    }
    nameEl.addEventListener("input", () => {
      doc.name = nameEl.value.slice(0, 200);
      showName();
      save();
    });
    nameEl.addEventListener("keydown", e => {
      if (e.key === "Enter" || e.key === "Escape") nameEl.blur();
    });

    // ---- keys ----
    const isMac = /Mac/.test(navigator.platform);
    document.addEventListener("keydown", e => {
      if (e.target === nameEl) return;            // typing the name: its own undo
      const mod = isMac ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey;
      const key = e.key?.toLowerCase();
      if (mod && !e.altKey && key === "z") {
        e.preventDefault(); e.stopPropagation();
        if (e.shiftKey) redo(); else undo();
      } else if (mod && !e.altKey && !e.shiftKey && key === "y" && !isMac) {
        e.preventDefault(); e.stopPropagation();
        redo();
      }
    }, true);

    window.addEventListener("resize", resize);
    window.matchMedia?.("(prefers-color-scheme: dark)").addEventListener?.("change", draw);
    // a last save when the tab closes or reloads
    window.addEventListener("pagehide", () => { if (saveTimer) { clearTimeout(saveTimer); writeNow(); } });

    setTool("pen");
    select("colors", "data-color", color);
    select("sizes", "data-size", size);
    updateButtons();
    resize();
    load();
  }

  const CSS = `
:root {
  --paper: #fbfaf8; --ink: #1d1c1a; --bar: rgba(255,255,255,.92); --bar-line: rgba(0,0,0,.09);
  --muted: #6f6c66; --hover: rgba(0,0,0,.06); --on: rgba(0,0,0,.1);
  color-scheme: light;
}
@media (prefers-color-scheme: dark) {
  :root {
    --paper: #1b1b1d; --ink: #eceae6; --bar: rgba(44,44,48,.92); --bar-line: rgba(255,255,255,.1);
    --muted: #a3a09a; --hover: rgba(255,255,255,.08); --on: rgba(255,255,255,.14);
    color-scheme: dark;
  }
}
* { box-sizing: border-box; }
[hidden] { display: none !important; }
html, body { margin: 0; height: 100%; overflow: hidden; background: var(--paper); color: var(--ink);
  font: 13px/1.3 -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif; }
#ink { position: fixed; inset: 0; width: 100%; height: 100%; touch-action: none; cursor: crosshair; }
:root[data-tool="eraser"] #ink { cursor: cell; }
#name { position: fixed; top: 14px; left: 16px; width: min(360px, calc(100% - 32px)); padding: 6px 8px;
  border: 0; border-radius: 8px; background: transparent; color: var(--ink);
  font-family: inherit; font-size: 15px; font-weight: 600; line-height: 1.2; outline: none; }
#name::placeholder { color: var(--muted); }
#name:hover { background: var(--hover); }
#name:focus { background: var(--bar); box-shadow: 0 0 0 1px var(--bar-line); }
#bar { position: fixed; left: 0; right: 0; bottom: 18px; margin: 0 auto; width: max-content;
  display: flex; align-items: center; gap: 4px; padding: 6px; max-width: calc(100% - 24px); flex-wrap: wrap;
  justify-content: center; background: var(--bar); border: 1px solid var(--bar-line); border-radius: 14px;
  box-shadow: 0 6px 24px rgba(0,0,0,.12); backdrop-filter: blur(12px); }
.group { display: flex; align-items: center; gap: 2px; }
.sep { width: 1px; height: 20px; background: var(--bar-line); margin: 0 4px; }
button { all: unset; display: grid; place-items: center; width: 30px; height: 30px; border-radius: 8px;
  color: var(--ink); cursor: default; }
button:hover:not(:disabled) { background: var(--hover); }
button[aria-pressed="true"] { background: var(--on); }
button:disabled { opacity: .35; }
button:focus-visible { box-shadow: 0 0 0 2px var(--muted); }
button svg { width: 18px; height: 18px; fill: none; stroke: currentColor; stroke-width: 1.7;
  stroke-linecap: round; stroke-linejoin: round; }
.dot { width: 16px; height: 16px; border-radius: 50%; background: var(--c); box-shadow: inset 0 0 0 1px rgba(0,0,0,.12); }
[data-color="ink"] .dot { background: var(--ink); }
[data-size] .dot { background: var(--ink); box-shadow: none; }
#broken { position: fixed; inset: 0; display: grid; place-items: center; color: var(--muted); font-size: 14px; }
`;

  const svg = d => `<svg viewBox="0 0 24 24" aria-hidden="true">${d}</svg>`;
  const ICONS = {
    pen: svg('<path d="M4 20l1-4L16 5a2.1 2.1 0 0 1 3 3L8 19z"/><path d="M14 7l3 3"/>'),
    eraser: svg('<path d="M8 20h12"/><path d="M5.5 15.5l9-9a2 2 0 0 1 2.8 0l1.2 1.2a2 2 0 0 1 0 2.8L11 18H7.5z"/><path d="M10 11l4 4"/>'),
    undo: svg('<path d="M9 14L4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>'),
    redo: svg('<path d="M15 14l5-5-5-5"/><path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13"/>'),
    clear: svg('<path d="M5 7h14"/><path d="M10 7V5h4v2"/><path d="M7 7l1 12h8l1-12"/>'),
  };
  const COLOR_NAMES = { ink: "Ink", "#e5484d": "Red", "#f76b15": "Orange", "#ffc53d": "Yellow",
    "#30a46c": "Green", "#0090ff": "Blue", "#8e4ec6": "Purple" };
  const SIZE_NAMES = { 2: "Thin", 5: "Medium", 10: "Thick" };

  // tiny hash so a changed file gets a new URL (no stale cached copy after an update)
  const hash = s => { let h = 5381; for (let i = 0; i < s.length; i++) h = (h * 33 + s.charCodeAt(i)) >>> 0; return h.toString(36); };

  function files() {
    const js = `// Almost Arc easel page. Written by arcEasel.uc.js; edits here are overwritten.\n(${easelPage.toString()})();\n`;
    const colors = Object.entries(COLOR_NAMES).map(([c, n]) =>
      `<button data-color="${c}" title="${n}" aria-label="${n}"><span class="dot" style="--c:${c === "ink" ? "var(--ink)" : c}"></span></button>`).join("");
    const sizes = Object.entries(SIZE_NAMES).map(([s, n]) =>
      `<button data-size="${s}" title="${n}" aria-label="${n}"><span class="dot" style="width:${Number(s) + 3}px;height:${Number(s) + 3}px"></span></button>`).join("");
    const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src chrome:; style-src chrome: 'unsafe-inline'; img-src chrome: data:">
<title>Untitled Easel</title>
<link rel="icon" href="icon.svg">
<link rel="stylesheet" href="easel.css?${hash(CSS)}">
</head>
<body>
<canvas id="ink"></canvas>
<input id="name" type="text" placeholder="Untitled Easel" aria-label="Easel name" spellcheck="false" autocomplete="off">
<div id="bar" role="toolbar" aria-label="Drawing tools">
  <div class="group" id="tools">
    <button data-tool="pen" title="Pen" aria-label="Pen">${ICONS.pen}</button>
    <button data-tool="eraser" title="Eraser" aria-label="Eraser">${ICONS.eraser}</button>
  </div>
  <div class="sep"></div>
  <div class="group" id="colors">${colors}</div>
  <div class="sep"></div>
  <div class="group" id="sizes">${sizes}</div>
  <div class="sep"></div>
  <div class="group">
    <button id="undo" title="Undo (Cmd+Z)" aria-label="Undo">${ICONS.undo}</button>
    <button id="redo" title="Redo (Cmd+Shift+Z)" aria-label="Redo">${ICONS.redo}</button>
    <button id="clear" title="Clear (Cmd+Z brings it back)" aria-label="Clear">${ICONS.clear}</button>
  </div>
</div>
<div id="broken" hidden>This easel's address is broken, so there's nothing to show.</div>
<script src="easel.js?${hash(js)}"></script>
</body>
</html>
`;
    const icon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><rect x="1.5" y="1.5" width="13" height="13" rx="3" fill="none" stroke="#8a8780" stroke-width="1.4"/><path d="M4.5 10.5c1.5-3 3-4 4-2.5s2 .5 3-2" fill="none" stroke="#8a8780" stroke-width="1.4" stroke-linecap="round"/></svg>\n`;
    return {
      "easel.html": html,
      "easel.css": CSS,
      "easel.js": js,
      "icon.svg": icon,
      // for Zen's + menu: drawn in the menu's text color, like Zen's own icons there
      "menu-icon.svg": `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="none" stroke="context-fill" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><path d="M2.75 13.25l.75-3 7.75-7.75a1.4 1.4 0 0 1 2 2L5.5 12.25z"/><path d="M9.75 4l2 2"/></svg>\n`,
      "easel.manifest": `content ${HOST} ./\n`,
    };
  }

  // ---- registering chrome://almostarc-easel/ ----------------------------------
  function registered() {
    try {
      Cc["@mozilla.org/chrome/chrome-registry;1"].getService(Ci.nsIChromeRegistry)
        .convertChromeURL(Services.io.newURI(`${PREFIX}easel.html`));
      return true;
    } catch (e) { return false; }
  }
  function register() {
    if (registered()) return true;
    const f = Cc["@mozilla.org/file/local;1"].createInstance(Ci.nsIFile);
    f.initWithPath(MANIFEST);
    if (!f.exists()) return false;
    Components.manager.QueryInterface(Ci.nsIComponentRegistrar).autoRegister(f);
    return registered();
  }

  const isEasel = uri => String(uri || "").startsWith(PREFIX);

  async function setup() {
    // Right away if the files are there from last time: a restored easel tab may load soon.
    try { register(); } catch (e) { console.warn("[arcEasel]", e); }
    let changed = false;
    await IOUtils.makeDirectory(DIR, { ignoreExisting: true });
    for (const [name, text] of Object.entries(files())) {
      const path = PathUtils.join(DIR, name);
      let old = null;
      try { old = await IOUtils.readUTF8(path); } catch (e) {}
      if (old !== text) { await IOUtils.writeUTF8(path, text, { tmpPath: `${path}.tmp` }); changed = true; }
    }
    if (!register()) throw new Error("couldn't register the easel page");
    // An easel tab that loaded before the page was there shows an error page: load it again.
    for (const tab of gBrowser.tabs) {
      const b = tab.linkedBrowser;
      if (!b || tab.hasAttribute("pending") || !isEasel(b.currentURI?.spec)) continue;
      const shown = b.documentURI?.spec;
      if (shown && !isEasel(shown)) b.reload();
    }
    return changed;
  }

  // ---- New Easel -----------------------------------------------------------
  function newId() {
    const bytes = crypto.getRandomValues(new Uint8Array(8));
    return Array.from(bytes, x => x.toString(16).padStart(2, "0")).join("");
  }
  let ready = null;
  async function openEasel() {
    try { await ready; } catch (e) { console.warn("[arcEasel]", e); return; }
    const tab = gBrowser.addTab(`${PREFIX}easel.html#${newId()}`, {
      triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal(),
    });
    gBrowser.selectedTab = tab;
  }

  // ref: the item to put it after (before, with before: true); not there: at the top
  function menuItem(id, popup, ref, { before = false, image = null } = {}) {
    if (!popup || document.getElementById(id)) return;
    const item = document.createXULElement("menuitem");
    item.id = id;
    item.setAttribute("label", "New Easel");
    if (image) item.setAttribute("image", image);
    item.addEventListener("command", openEasel);
    const at = ref && popup.querySelector(ref);
    if (at) before ? at.before(item) : at.after(item);
    else popup.prepend(item);
  }
  // Zen's + button at the bottom of the sidebar: just above its New Tab
  const PLUS_POPUP = "zenCreateNewPopup";
  const addToPlus = () => menuItem("almost-arc-new-easel-plus", document.getElementById(PLUS_POPUP),
    'menuitem[command="cmd_newNavigatorTab"]', { before: true, image: `${PREFIX}menu-icon.svg` });

  ready = setup().catch(e => { console.warn("[arcEasel]", e); throw e; });
  ready.catch(() => {});
  try {
    menuItem("almost-arc-new-easel", document.getElementById("menu_FilePopup"), "#menu_newNavigatorTab");
    menuItem("almost-arc-new-easel-tab", document.getElementById("tabContextMenu"), "#context_openANewTab");
    addToPlus();
  } catch (e) { console.warn("[arcEasel]", e); }
  // in case Zen builds the + menu later
  window.addEventListener("popupshowing", e => {
    if (e.target?.id === PLUS_POPUP) try { addToPlus(); } catch (err) { console.warn("[arcEasel]", err); }
  }, true);
  window.__arcEaselOpen = openEasel;
})();
