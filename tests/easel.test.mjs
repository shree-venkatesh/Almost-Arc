// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// JS/arcEasel.uc.js: easel tabs. Part 1 runs the script in a fake Zen window; part 2
// runs the easel page it writes (easel.js, exactly as written) against a fake page.
// Run: node --test 'tests/*.test.mjs'

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const SRC = fs.readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "JS/arcEasel.uc.js"), "utf8");
const settle = () => new Promise(r => setImmediate(r));
const PAGE_DIR = "/prof/chrome/almost-arc-easel";
const PREFIX = "chrome://almostarc-easel/content/";

// ---- part 1: the script in Zen's window ----

/** opts: prefs, files (Map path -> text, shared between "windows"), tabs (restored tabs) */
function startZen(opts = {}) {
  const o = { prefs: {}, files: new Map(), tabs: [], ...opts };
  const prefs = new Map(Object.entries(o.prefs));
  const defaults = new Map();
  const writes = [];
  const reg = o.reg || { registered: false, autoRegistered: [] };
  const Services = {
    prefs: {
      getDefaultBranch: () => ({ setBoolPref: (k, v) => defaults.set(k, v) }),
      getBoolPref: (k, d) => (prefs.has(k) ? prefs.get(k) : defaults.has(k) ? defaults.get(k) : d),
    },
    io: { newURI: spec => ({ spec }) },
    scriptSecurityManager: { getSystemPrincipal: () => "SYSTEM" },
  };
  const Cc = {
    "@mozilla.org/chrome/chrome-registry;1": { getService: () => ({
      convertChromeURL(uri) {
        if (!reg.registered || !uri.spec.startsWith(PREFIX)) throw new Error("not registered");
        return { spec: "file://" + PAGE_DIR + "/" + uri.spec.slice(PREFIX.length) };
      },
    }) },
    "@mozilla.org/file/local;1": { createInstance: () => ({
      initWithPath(p) { this.path = p; },
      exists() { return o.files.has(this.path); },
    }) },
  };
  const Ci = { nsIChromeRegistry: {}, nsIFile: {}, nsIComponentRegistrar: {} };
  const Components = { manager: { QueryInterface: () => ({
    autoRegister(f) { reg.autoRegistered.push(f.path); reg.registered = true; },
  }) } };
  const IOUtils = {
    async makeDirectory() {},
    async readUTF8(p) { if (!o.files.has(p)) throw new Error("NotFound"); return o.files.get(p); },
    async writeUTF8(p, text) { writes.push(p); o.files.set(p, text); },
  };
  const PathUtils = { profileDir: "/prof", join: (...a) => a.join("/") };

  // items: ids, or {command} for Zen's + menu items (they have no id)
  const popup = (id, items) => {
    const kids = items.map(i => ({ ...(typeof i === "string" ? { id: i } : i),
      after(el) { kids.splice(kids.indexOf(this) + 1, 0, el); },
      before(el) { kids.splice(kids.indexOf(this), 0, el); } }));
    const matches = (k, sel) => sel === `#${k.id}` || sel === `menuitem[command="${k.command}"]`;
    return { id, kids, querySelector: sel => kids.find(k => matches(k, sel)) || null, prepend(el) { kids.unshift(el); } };
  };
  const menus = { menu_FilePopup: popup("menu_FilePopup", ["menu_newNavigatorTab", "menu_newPrivateWindow"]),
    tabContextMenu: popup("tabContextMenu", ["context_openANewTab", "context_reloadTab"]) };
  if (!o.noPlus) menus.zenCreateNewPopup = popup("zenCreateNewPopup",
    [{ command: "cmd_zenOpenWorkspaceCreation" }, { command: "cmd_zenOpenFolderCreation" },
     { command: "cmd_zenNewEmptySplit" }, { command: "cmd_newNavigatorTab" }]);
  const winListeners = {};
  const document = {
    getElementById: id => menus[id] || Object.values(menus).flatMap(m => m.kids).find(k => k.id === id) || null,
    createXULElement: () => {
      const listeners = {};
      return { attrs: {}, setAttribute(k, v) { this.attrs[k] = v; }, addEventListener: (t, fn) => (listeners[t] = fn),
        command: () => listeners.command?.() };
    },
  };
  const opened = [];
  const gBrowser = {
    tabs: o.tabs,
    addTab(url, params) { const tab = { url, params }; opened.push(tab); return tab; },
    selectedTab: null,
  };
  const context = {
    Services, Cc, Ci, Components, IOUtils, PathUtils, document, gBrowser,
    console: { warn() {}, error() {} },
    crypto: { getRandomValues: a => { for (let i = 0; i < a.length; i++) a[i] = (i * 37 + 11) & 255; return a; } },
    Uint8Array, Array, Object, String, Number, Error, Promise, Math, Date, JSON,
  };
  context.window = context;
  context.addEventListener = (t, fn) => (winListeners[t] ||= []).push(fn);
  vm.createContext(context);
  vm.runInContext(SRC, context, { filename: "arcEasel.uc.js" });
  return {
    files: o.files, writes, reg, opened, gBrowser, menus,
    item: id => Object.values(menus).flatMap(m => m.kids).find(k => k.id === id),
    /** Zen builds its + menu now (after the script ran) and opens it. */
    plusMenuAppears() {
      menus.zenCreateNewPopup ||= popup("zenCreateNewPopup", [{ command: "cmd_newNavigatorTab" }]);
      (winListeners.popupshowing || []).forEach(fn => fn({ target: menus.zenCreateNewPopup }));
    },
  };
}

describe("easel: setting up the page", () => {
  test("writes the page into the profile's chrome folder and registers it", async () => {
    const z = startZen();
    await settle(); await settle();
    for (const f of ["easel.html", "easel.js", "easel.css", "icon.svg", "easel.manifest"]) {
      assert.ok(z.files.has(`${PAGE_DIR}/${f}`), f);
    }
    assert.equal(z.files.get(`${PAGE_DIR}/easel.manifest`), "content almostarc-easel ./\n");
    assert.deepEqual(z.reg.autoRegistered, [`${PAGE_DIR}/easel.manifest`]);
    const html = z.files.get(`${PAGE_DIR}/easel.html`);
    assert.match(html, /<script src="easel\.js\?[a-z0-9]+"><\/script>/);
    assert.doesNotMatch(html, /<script>/, "no inline script in a privileged page");
  });

  test("the next window (or next start) doesn't rewrite unchanged files or register twice", async () => {
    const z = startZen();
    await settle(); await settle();
    const z2 = startZen({ files: z.files, reg: z.reg });
    await settle(); await settle();
    assert.deepEqual(z2.writes, []);
    assert.equal(z.reg.autoRegistered.length, 1);
  });

  test("on a restart it registers right away, before rewriting anything", () => {
    const files = new Map([[`${PAGE_DIR}/easel.manifest`, "content almostarc-easel ./\n"]]);
    const z = startZen({ files });
    assert.equal(z.reg.registered, true);     // synchronously, so a restored easel tab can load
  });

  test("an easel tab that loaded before the page existed is loaded again", async () => {
    let reloads = 0;
    const tab = { hasAttribute: () => false, linkedBrowser: {
      currentURI: { spec: `${PREFIX}easel.html#abcdef0123456789` },
      documentURI: { spec: "about:neterror?e=fileNotFound" }, reload: () => reloads++ } };
    const other = { hasAttribute: () => false, linkedBrowser: {
      currentURI: { spec: "https://example.com/" }, documentURI: { spec: "about:neterror" }, reload: () => reloads++ } };
    startZen({ tabs: [tab, other] });
    await settle(); await settle();
    assert.equal(reloads, 1);
  });
});

describe("easel: New Easel", () => {
  test("is in the File menu after New Tab, and in the tab context menu", () => {
    const z = startZen();
    assert.deepEqual(z.menus.menu_FilePopup.kids.map(k => k.id), ["menu_newNavigatorTab", "almost-arc-new-easel", "menu_newPrivateWindow"]);
    assert.equal(z.menus.tabContextMenu.kids[1].id, "almost-arc-new-easel-tab");
    assert.equal(z.item("almost-arc-new-easel").attrs.label, "New Easel");
  });

  test("is in Zen's + menu (bottom of the sidebar), just above New Tab, with an icon", () => {
    const z = startZen();
    const kids = z.menus.zenCreateNewPopup.kids;
    assert.deepEqual(kids.map(k => k.id || k.command), ["cmd_zenOpenWorkspaceCreation", "cmd_zenOpenFolderCreation",
      "cmd_zenNewEmptySplit", "almost-arc-new-easel-plus", "cmd_newNavigatorTab"]);
    assert.equal(kids[3].attrs.label, "New Easel");
    assert.equal(kids[3].attrs.image, "chrome://almostarc-easel/content/menu-icon.svg");
  });

  test("the + menu's icon is written with the page, in the menu's text color", async () => {
    const z = startZen();
    await settle(); await settle();
    assert.match(z.files.get(`${PAGE_DIR}/menu-icon.svg`), /stroke="context-fill"/);
  });

  test("a + menu Zen builds later still gets it, once", () => {
    const z = startZen({ noPlus: true });
    z.plusMenuAppears();
    z.plusMenuAppears();            // opened again: no second copy
    assert.deepEqual(z.menus.zenCreateNewPopup.kids.map(k => k.id || k.command), ["almost-arc-new-easel-plus", "cmd_newNavigatorTab"]);
  });

  test("New Easel in the + menu opens an easel", async () => {
    const z = startZen();
    z.item("almost-arc-new-easel-plus").command();
    await settle(); await settle();
    assert.equal(z.opened.length, 1);
  });

  test("opens and selects a new easel tab with its own id", async () => {
    const z = startZen();
    z.item("almost-arc-new-easel").command();
    await settle(); await settle();
    assert.equal(z.opened.length, 1);
    assert.match(z.opened[0].url, /^chrome:\/\/almostarc-easel\/content\/easel\.html#[a-f0-9]{16}$/);
    assert.equal(z.opened[0].params.triggeringPrincipal, "SYSTEM");
    assert.equal(z.gBrowser.selectedTab, z.opened[0]);
  });

  test("pref almost-arc.easel off: nothing written, no menu items", async () => {
    const z = startZen({ prefs: { "almost-arc.easel": false } });
    await settle();
    assert.equal(z.files.size, 0);
    assert.equal(z.item("almost-arc-new-easel"), undefined);
  });
});

// ---- part 2: the page ----

function pageSource() {
  const z = startZen();
  return settle().then(settle).then(() => z.files.get(`${PAGE_DIR}/easel.js`));
}

const ID = "abcdef0123456789";
const FILE = `/prof/almost-arc-easels/${ID}.json`;

/** opts: hash, saved (file contents), unreadable (file exists but can't be parsed) */
async function openPage(opts = {}) {
  const js = await pageSource();
  const o = { hash: `#${ID}`, ...opts };
  const disk = new Map();
  if (o.saved) disk.set(FILE, JSON.parse(JSON.stringify(o.saved)));
  const io = { reads: 0, moves: [], writes: 0 };
  const IOUtils = {
    async exists(p) { return disk.has(p) || (o.unreadable && p === FILE); },
    async readJSON(p) { io.reads++; if (o.unreadable) throw new Error("bad JSON"); return JSON.parse(JSON.stringify(disk.get(p))); },
    async writeJSON(p, data) { io.writes++; disk.set(p, JSON.parse(JSON.stringify(data))); },
    async makeDirectory() {},
    async move(a, b) { io.moves.push([a, b]); },
  };
  // canvas: records text drawn; text is 0.5 x font size wide per character
  const drawn = { texts: [] };
  const ctx2d = new Proxy({ font: "10px x",
    measureText(t) { return { width: t.length * parseFloat(this.font) * 0.5 }; },
    fillText(t, x, y) { drawn.texts.push([t, x, y]); },
    clearRect() { drawn.texts = []; },
  }, { get: (t, k) => (k in t ? t[k] : () => {}), set: (t, k, v) => ((t[k] = v), true) });
  let focused = null;
  const el = id => {
    const listeners = {};
    return { id, hidden: id === "editor", disabled: false, value: "", width: 0, height: 0, attrs: {}, style: {},
      addEventListener: (t, fn) => (listeners[t] = fn), listeners,
      setAttribute(k, v) { this.attrs[k] = v; }, getAttribute(k) { return this.attrs[k] ?? null; },
      querySelectorAll: () => [], setPointerCapture() {},
      focus() { focused = this; }, blur() { if (focused === this) { focused = null; listeners.blur?.(); } },
      getContext: () => ctx2d };
  };
  const els = Object.fromEntries(["ink", "name", "editor", "broken", "bar", "tools", "colors", "sizes", "undo", "redo", "clear"].map(i => [i, el(i)]));
  const docListeners = {};
  const document = {
    title: "Untitled Easel",
    documentElement: { dataset: {} },
    getElementById: id => els[id] || null,
    addEventListener: (t, fn) => (docListeners[t] = fn),
  };
  let timers = [], frames = [];
  const window = { innerWidth: 800, innerHeight: 600, devicePixelRatio: 2, addEventListener() {},
    matchMedia: () => ({ addEventListener() {} }) };
  const context = {
    window, document, IOUtils, location: { hash: o.hash }, navigator: { platform: "MacIntel" },
    PathUtils: { profileDir: "/prof", join: (...a) => a.join("/") },
    getComputedStyle: () => ({ getPropertyValue: () => "#111" }),
    requestAnimationFrame: fn => (frames.push(fn), frames.length),
    setTimeout: fn => (timers.push(fn), timers.length), clearTimeout: () => { timers = timers.filter(f => f.keep); },
    console: { error() {} }, Math, JSON, Array, Number, String, Date, Promise, Object, Set,
  };
  vm.createContext(context);
  vm.runInContext(js, context, { filename: "easel.js" });
  await settle(); await settle();
  frames.splice(0).forEach(f => f());

  const ink = els.ink.listeners;
  const pointer = (type, [x, y], shiftKey = false) =>
    ink[type]?.({ button: 0, pointerId: 1, clientX: x, clientY: y, shiftKey, getCoalescedEvents: () => [] });
  const click = (group, attr, value) =>
    els[group].listeners.click({ target: { closest: sel => (sel === `[${attr}]` ? { getAttribute: () => value } : null) } });
  const p = {
    els, io, disk, document, drawn,
    get focused() { return focused; },
    /** Let the save happen. */
    async saved() { timers.splice(0).forEach(f => f()); await settle(); await settle(); return disk.get(FILE); },
    /** The canvas as it is now. */
    render() { frames.splice(0).forEach(f => f()); return drawn; },
    stroke(...pts) { pointer("pointerdown", pts[0]); for (const q of pts.slice(1)) pointer("pointermove", q); pointer("pointerup", pts.at(-1)); },
    shiftClick(q) { pointer("pointerdown", q, true); pointer("pointerup", q, true); },
    dblclick([x, y]) { ink.dblclick({ clientX: x, clientY: y }); },
    tool: t => click("tools", "data-tool", t),
    color: c => click("colors", "data-color", c),
    size: s => click("sizes", "data-size", String(s)),
    key(key, { shift = false, mod = true, target = null } = {}) {
      const e = { key, metaKey: mod, ctrlKey: false, altKey: false, shiftKey: shift, target, taken: false,
        preventDefault() { this.taken = true; }, stopPropagation() { this.stopped = true; } };
      docListeners.keydown(e);
      return e;
    },
    typeName(v) { els.name.value = v; els.name.listeners.input(); },
    /** Type into the open text box (replacing what's in it). */
    type(v) { els.editor.value = v; els.editor.listeners.input(); },
    editorKey(key, mod = false) {
      els.editor.listeners.keydown({ key, metaKey: mod, ctrlKey: false, preventDefault() {} });
    },
  };
  return p;
}

const firsts = data => data.items.map(s => (s.k === "text" ? s.v : s.p[0]));

describe("easel page: drawing and saving", () => {
  test("a line you draw is saved with its color and size", async () => {
    const p = await openPage();
    p.stroke([10, 10], [20, 12], [40, 20]);
    const data = await p.saved();
    assert.equal(data.items.length, 1);
    assert.deepEqual(data.items[0], { c: "ink", w: 5, p: [[10, 10], [20, 12], [40, 20]] });
  });

  test("color and size buttons change the next line", async () => {
    const p = await openPage();
    p.color("#0090ff"); p.size(10);
    p.stroke([0, 0], [5, 5]);
    const s = (await p.saved()).items[0];
    assert.equal(s.c, "#0090ff"); assert.equal(s.w, 10);
  });

  test("a click without moving is a dot", async () => {
    const p = await openPage();
    p.stroke([30, 30]);
    assert.deepEqual((await p.saved()).items[0].p, [[30, 30]]);
  });

  test("the name you type becomes the tab title and is saved", async () => {
    const p = await openPage();
    p.typeName("Trip ideas");
    assert.equal(p.document.title, "Trip ideas");
    assert.equal((await p.saved()).name, "Trip ideas");
    p.typeName("  ");
    assert.equal(p.document.title, "Untitled Easel");
  });

  test("reopening the tab (or restarting Zen) brings the drawing and name back", async () => {
    const saved = { v: 2, name: "Plans", items: [{ c: "#e5484d", w: 2, p: [[1, 2], [3, 4]] },
      { k: "text", c: "ink", f: 24, x: 5, y: 6, v: "hello" }] };
    const p = await openPage({ saved });
    assert.equal(p.document.title, "Plans");
    assert.equal(p.els.name.value, "Plans");
    assert.deepEqual(p.render().texts.map(t => t[0]), ["hello"]);
    p.stroke([50, 50], [60, 60]);
    assert.deepEqual(firsts(await p.saved()), [[1, 2], "hello", [50, 50]]);
  });

  test("an easel saved by 1.2.5 (lines only, as \"strokes\") still opens", async () => {
    const p = await openPage({ saved: { v: 1, name: "Old", strokes: [{ c: "ink", w: 5, p: [[1, 1], [2, 2]] }] } });
    p.stroke([9, 9]);
    const data = await p.saved();
    assert.equal(data.v, 2);
    assert.deepEqual(firsts(data), [[1, 1], [9, 9]]);
    assert.equal(data.strokes, undefined);
  });

  test("anything odd in the saved file is dropped, the rest kept", async () => {
    const saved = { name: 42, items: [
      { c: "url(javascript:1)", w: 2, p: [[1, 1]] }, { c: "ink", w: "big", p: [[1, 1]] },
      { c: "ink", w: 999, p: [[1, 1], "x", [2, 2]] }, null,
      { k: "text", c: "ink", f: 24, x: 1, y: 1, v: "   " }, { k: "text", c: "ink", f: 500, x: 1, y: 1, v: "big" },
      { k: "text", c: "ink", f: 24, x: "1", y: 1, v: "bad x" }] };
    const p = await openPage({ saved });
    p.stroke([9, 9]);
    const data = await p.saved();
    assert.equal(data.name, "");
    assert.deepEqual(data.items[0], { c: "ink", w: 40, p: [[1, 1], [2, 2]] });
    assert.deepEqual(data.items[1], { k: "text", c: "ink", f: 120, x: 1, y: 1, v: "big" });
    assert.equal(data.items.length, 3);
  });

  test("a file that can't be read is set aside, never overwritten", async () => {
    const p = await openPage({ unreadable: true });
    assert.equal(p.io.moves.length, 1);
    assert.equal(p.io.moves[0][0], FILE);
    assert.match(p.io.moves[0][1], /\.json\.broken-\d+$/);
  });

  test("a broken address (not an easel id) reads and writes nothing", async () => {
    const p = await openPage({ hash: "#../../prefs" });
    assert.equal(p.els.broken.hidden, false);
    assert.equal(p.els.bar.hidden, true);
    assert.equal(p.io.reads + p.io.writes, 0);
  });
});

describe("easel page: undo, eraser, clear", () => {
  test("Cmd+Z undoes the last line, Cmd+Shift+Z redoes it", async () => {
    const p = await openPage();
    p.stroke([1, 1], [9, 9]);
    p.stroke([20, 20], [30, 30]);
    const e = p.key("z");
    assert.ok(e.taken && e.stopped, "Cmd+Z is the easel's, not Zen's");
    assert.deepEqual(firsts(await p.saved()), [[1, 1]]);
    p.key("z", { shift: true });
    assert.deepEqual(firsts(await p.saved()), [[1, 1], [20, 20]]);
  });

  test("Cmd+Z while typing the name is left to the text box", async () => {
    const p = await openPage();
    p.stroke([1, 1], [9, 9]);
    const e = p.key("z", { target: p.els.name });
    assert.equal(e.taken, false);
    assert.equal((await p.saved()).items.length, 1);
  });

  test("the eraser removes the lines it touches; Cmd+Z puts them back in place", async () => {
    const p = await openPage();
    p.stroke([0, 0], [100, 0]);        // A
    p.stroke([0, 50], [100, 50]);      // B
    p.stroke([0, 100], [100, 100]);    // C
    p.tool("eraser");
    p.stroke([50, -5], [50, 5], [52, 60], [55, 98], [50, 102]);   // through A, B and C in one drag
    assert.equal((await p.saved()).items.length, 0);
    p.key("z");
    assert.deepEqual(firsts(await p.saved()), [[0, 0], [0, 50], [0, 100]]);
  });

  test("erasing the first and last of three in one drag, then undo: same order", async () => {
    const p = await openPage();
    p.stroke([0, 0], [100, 0]);        // A
    p.stroke([200, 50], [300, 50]);    // B, out of the way
    p.stroke([0, 100], [100, 100]);    // C
    p.tool("eraser");
    p.stroke([50, 0], [50, 50], [50, 100]);
    assert.deepEqual(firsts(await p.saved()), [[200, 50]]);
    p.key("z");
    assert.deepEqual(firsts(await p.saved()), [[0, 0], [200, 50], [0, 100]]);
  });

  test("Clear empties the easel and Cmd+Z brings everything back", async () => {
    const p = await openPage();
    p.stroke([1, 1], [2, 2]);
    p.stroke([5, 5], [6, 6]);
    p.els.clear.listeners.click();
    assert.equal((await p.saved()).items.length, 0);
    p.key("z");
    assert.equal((await p.saved()).items.length, 2);
  });

  test("picking a color switches back from the eraser to the pen", async () => {
    const p = await openPage();
    p.tool("eraser");
    p.color("#30a46c");
    p.stroke([1, 1], [5, 5]);
    assert.equal((await p.saved()).items[0].c, "#30a46c");
  });
});

describe("easel page: text boxes", () => {
  // font size for the size buttons: thin 16, medium 24, thick 40; text is 12 px per character at 24
  test("click with the text tool, type, click away: a text box in the color and size picked", async () => {
    const p = await openPage();
    p.tool("text");
    p.color("#e5484d");
    p.stroke([100, 100]);
    assert.equal(p.els.editor.hidden, false);
    assert.equal(p.focused, p.els.editor);
    p.type("Groceries\nmilk");
    p.stroke([400, 400]);                  // click away: ends it, doesn't start another
    assert.equal(p.els.editor.hidden, true);
    const data = await p.saved();
    assert.equal(data.items.length, 1);
    assert.deepEqual(data.items[0], { k: "text", c: "#e5484d", f: 24, x: 100, y: 85, v: "Groceries\nmilk" });
    assert.deepEqual(p.render().texts.map(t => t[0]), ["Groceries", "milk"]);
  });

  test("the text field sits where the text will be drawn and grows as you type", async () => {
    const p = await openPage();
    p.tool("text");
    p.stroke([100, 100]);
    p.type("abcd");
    const st = p.els.editor.style;
    assert.equal(st.left, "100px"); assert.equal(st.top, "85px");
    assert.equal(st.width, `${4 * 12 + 24}px`);
    p.type("abcd\nefgh");
    assert.equal(st.height, `${2 * 30}px`);
  });

  test("an empty text box leaves nothing behind (and nothing to undo)", async () => {
    const p = await openPage();
    p.tool("text");
    p.stroke([100, 100]);
    p.editorKey("Escape");
    assert.equal(p.els.editor.hidden, true);
    assert.equal((await p.saved()), undefined);
    assert.equal(p.els.undo.disabled, true);
  });

  test("clicking a text box with the text tool edits it; Cmd+Z undoes the edit", async () => {
    const p = await openPage({ saved: { v: 2, name: "", items: [{ k: "text", c: "ink", f: 24, x: 100, y: 100, v: "hello" }] } });
    p.tool("text");
    p.stroke([110, 110]);
    assert.equal(p.els.editor.value, "hello");
    assert.deepEqual(p.render().texts, [], "the field shows it while you type");
    p.type("hello world");
    p.editorKey("Enter", true);            // Cmd+Enter ends it
    assert.equal((await p.saved()).items[0].v, "hello world");
    assert.equal((await p.saved()).items.length, 1);
    p.key("z");
    assert.equal((await p.saved()).items[0].v, "hello");
  });

  test("emptying a text box removes it; Cmd+Z brings it back", async () => {
    const p = await openPage({ saved: { v: 2, name: "", items: [{ k: "text", c: "ink", f: 24, x: 100, y: 100, v: "hello" }] } });
    p.tool("text");
    p.stroke([110, 110]);
    p.type("");
    p.editorKey("Escape");
    assert.equal((await p.saved()).items.length, 0);
    p.key("z");
    assert.deepEqual(firsts(await p.saved()), ["hello"]);
  });

  test("keys while typing in a text box are the text box's", async () => {
    const p = await openPage();
    p.stroke([1, 1], [9, 9]);
    p.tool("text");
    p.stroke([100, 100]);
    for (const [k, mod] of [["z", true], ["a", true], ["Backspace", false]]) {
      assert.equal(p.key(k, { mod, target: p.els.editor }).taken, false, k);
    }
  });

  test("picking a color while typing recolors the text box", async () => {
    const p = await openPage();
    p.tool("text");
    p.stroke([100, 100]);
    p.type("hi");
    p.color("#0090ff");
    assert.equal(p.focused, p.els.editor, "still typing");
    p.editorKey("Escape");
    assert.equal((await p.saved()).items[0].c, "#0090ff");
  });

  test("the eraser removes text boxes too", async () => {
    const p = await openPage({ saved: { v: 2, name: "", items: [{ k: "text", c: "ink", f: 24, x: 100, y: 100, v: "hello" }] } });
    p.tool("eraser");
    p.stroke([120, 110]);
    assert.equal((await p.saved()).items.length, 0);
  });
});

describe("easel page: selecting", () => {
  const three = { v: 2, name: "", items: [
    { c: "ink", w: 5, p: [[0, 0], [50, 0]] },                       // A
    { c: "ink", w: 5, p: [[300, 300], [350, 300]] },                // B
    { k: "text", c: "ink", f: 24, x: 100, y: 100, v: "hello" },     // C: 100..160 x 100..130
  ] };

  test("drag a box: what's in it is selected; drag a selected thing: it all moves; Cmd+Z moves it back", async () => {
    const p = await openPage({ saved: three });
    p.tool("select");
    p.stroke([-10, -10], [200, 200]);      // around A and C, not B
    p.stroke([110, 110], [130, 150]);      // grab C, move 20 right, 40 down
    let data = await p.saved();
    assert.deepEqual(data.items[0].p, [[20, 40], [70, 40]]);
    assert.deepEqual([data.items[2].x, data.items[2].y], [120, 140]);
    assert.deepEqual(data.items[1].p, [[300, 300], [350, 300]], "B stays");
    p.key("z");
    data = await p.saved();
    assert.deepEqual(data.items[0].p, [[0, 0], [50, 0]]);
    assert.deepEqual([data.items[2].x, data.items[2].y], [100, 100]);
  });

  test("click one thing: only it moves", async () => {
    const p = await openPage({ saved: three });
    p.tool("select");
    p.stroke([325, 300], [325, 310]);
    const data = await p.saved();
    assert.deepEqual(data.items[1].p, [[300, 310], [350, 310]]);
    assert.deepEqual(data.items[0].p, [[0, 0], [50, 0]]);
  });

  test("Delete removes the selection; Cmd+Z puts it back in place", async () => {
    const p = await openPage({ saved: three });
    p.tool("select");
    p.stroke([-10, -10], [200, 200]);
    assert.ok(p.key("Backspace", { mod: false }).taken);
    assert.deepEqual(firsts(await p.saved()), [[300, 300]]);
    p.key("z");
    assert.deepEqual(firsts(await p.saved()), [[0, 0], [300, 300], "hello"]);
  });

  test("shift-click adds to the selection and takes away from it", async () => {
    const p = await openPage({ saved: three });
    p.tool("select");
    p.stroke([25, 0]);                     // A
    p.shiftClick([325, 300]);              // + B
    p.shiftClick([25, 0]);                 // - A
    p.key("Delete", { mod: false });
    assert.deepEqual(firsts(await p.saved()), [[0, 0], "hello"]);
  });

  test("Cmd+A selects everything; a color then recolors all of it (one Cmd+Z)", async () => {
    const p = await openPage({ saved: three });
    p.key("a");
    p.color("#8e4ec6");
    assert.deepEqual((await p.saved()).items.map(s => s.c), ["#8e4ec6", "#8e4ec6", "#8e4ec6"]);
    p.key("z");
    assert.deepEqual((await p.saved()).items.map(s => s.c), ["ink", "ink", "ink"]);
  });

  test("a size with lines and text selected: thicker lines, bigger text", async () => {
    const p = await openPage({ saved: three });
    p.key("a");
    p.size(10);
    const data = await p.saved();
    assert.deepEqual([data.items[0].w, data.items[2].f], [10, 40]);
  });

  test("double-click a text box with the select tool to edit it", async () => {
    const p = await openPage({ saved: three });
    p.tool("select");
    p.dblclick([110, 110]);
    assert.equal(p.els.editor.hidden, false);
    assert.equal(p.els.editor.value, "hello");
  });

  test("a click on empty space or Escape drops the selection", async () => {
    const p = await openPage({ saved: three });
    p.key("a");
    assert.ok(p.key("Escape", { mod: false }).taken);
    assert.equal(p.key("Backspace", { mod: false }).taken, false, "nothing selected any more");
    p.key("a");
    p.stroke([600, 500]);
    assert.equal(p.key("Backspace", { mod: false }).taken, false);
  });

  test("a click on a thing without moving it isn't a step to undo", async () => {
    const p = await openPage({ saved: three });
    p.tool("select");
    p.stroke([25, 0]);
    assert.equal(p.els.undo.disabled, true);
  });
});
