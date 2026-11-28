// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// JS/arcSavedThemes.uc.js: the "Saved themes" row in Zen's space theme picker.
// Run: node --test 'tests/*.test.mjs'

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const SRC = fs.readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "JS/arcSavedThemes.uc.js"), "utf8");
const FILE = "/prof/almost-arc-themes.json";
const plain = v => JSON.parse(JSON.stringify(v));
const settle = async () => { for (let i = 0; i < 10; i++) await new Promise(r => setImmediate(r)); };

// ---- a small DOM: enough for the row ----
class El {
  constructor(tag) {
    this.tagName = tag; this.children = []; this.parentNode = null; this.attrs = new Map();
    this.listeners = new Map(); this.style = { props: new Map(), setProperty: (k, v) => this.style.props.set(k, v) };
    this.textContent = ""; this.value = "";
  }
  setAttribute(k, v) { this.attrs.set(k, String(v)); }
  getAttribute(k) { return this.attrs.has(k) ? this.attrs.get(k) : null; }
  removeAttribute(k) { this.attrs.delete(k); }
  hasAttribute(k) { return this.attrs.has(k); }
  get id() { return this.getAttribute("id"); }
  get firstChild() { return this.children[0] || null; }
  append(...kids) { for (const k of kids) { k.remove(); k.parentNode = this; this.children.push(k); } }
  after(k) { const p = this.parentNode; k.remove(); k.parentNode = p; p.children.splice(p.children.indexOf(this) + 1, 0, k); }
  remove() { if (this.parentNode) { const c = this.parentNode.children; c.splice(c.indexOf(this), 1); this.parentNode = null; } }
  matches(sel) {
    return sel.split(",").map(s => s.trim()).some(s => {
      if (s.startsWith("#")) return this.id === s.slice(1);
      if (s.startsWith(".")) return (this.getAttribute("class") || "").split(/\s+/).includes(s.slice(1));
      return false;
    });
  }
  closest(sel) { for (let e = this; e; e = e.parentNode) if (e.matches?.(sel)) return e; return null; }
  all() { return this.children.flatMap(c => [c, ...c.all()]); }
  querySelector(sel) { return this.all().find(e => e.matches(sel)) || null; }
  querySelectorAll(sel) { return this.all().filter(e => e.matches(sel)); }
  addEventListener(t, fn) { (this.listeners.get(t) || this.listeners.set(t, []).get(t)).push(fn); }
  dispatch(type, extra = {}) {
    const e = { type, target: this, button: 0, prevented: false, preventDefault() { this.prevented = true; }, stopPropagation() {}, ...extra };
    for (let n = this; n; n = n.parentNode) for (const fn of n.listeners.get(type) || []) fn(e);
    return e;
  }
  focus() {} select() {}
  openPopupAtScreen() { this.opened = true; }
}

/** opts: files (Map), space (theme of the space being edited), noPresets (Zen changed) */
function startZen(opts = {}) {
  const o = { files: new Map(), prefs: {}, ...opts };
  const prefs = new Map(Object.entries(o.prefs));
  const defaults = new Map();
  const panel = new El("panel"); panel.setAttribute("id", "PanelUI-zen-gradient-generator");
  const view = new El("panelview"); panel.append(view);
  const pagesRow = new El("hbox"); view.append(pagesRow);
  if (!o.noPresets) { const pages = new El("hbox"); pages.setAttribute("id", "PanelUI-zen-gradient-generator-color-pages"); pagesRow.append(pages); }
  const controls = new El("hbox"); controls.setAttribute("id", "PanelUI-zen-gradient-generator-controls"); view.append(controls);

  const space = { uuid: "s1", theme: o.space ?? theme([[10, 20, 30]]) };
  const calls = [];
  const listeners = new Map();
  const window = {
    gZenThemePicker: {
      get workspaceBeingEdited() { return space; },
      onWorkspaceChange: ws => calls.push(["repaint", ws.uuid]),
      invalidateGradientCache: () => calls.push(["invalidate"]),
    },
    gZenWorkspaces: { activeWorkspace: "s1", saveWorkspace: ws => calls.push(["save", ws.uuid, JSON.stringify(ws.theme)]) },
    addEventListener: (t, fn) => (listeners.get(t) || listeners.set(t, []).get(t)).push(fn),
  };
  window.window = window;
  const document = {
    createXULElement: tag => new El(tag),
    createElementNS: (_ns, tag) => new El(tag),
  };
  const Services = {
    prefs: {
      getDefaultBranch: () => ({ setBoolPref: (k, v) => defaults.set(k, v) }),
      getBoolPref: (k, d) => (prefs.has(k) ? prefs.get(k) : defaults.has(k) ? defaults.get(k) : d),
    },
    obs: { notifyObservers: () => calls.push(["notify"]) },
  };
  const writes = [];
  const IOUtils = {
    async exists(p) { return o.files.has(p); },
    async readJSON(p) { return JSON.parse(o.files.get(p)); },
    async writeJSON(p, data) { writes.push(p); o.files.set(p, JSON.stringify(data)); },
    async move(a, b) { o.files.set(b, o.files.get(a)); o.files.delete(a); },
  };
  const PathUtils = { profileDir: "/prof", join: (...a) => a.join("/") };
  vm.runInNewContext(SRC, { window, document, Services, IOUtils, PathUtils, console: { error() {} }, setTimeout: () => 0 });

  const fire = (type, target) => { for (const fn of listeners.get(type) || []) fn({ type, target }); };
  const open = async () => { fire("popupshowing", panel); await settle(); };
  const row = () => panel.querySelector("#arc-saved-themes");
  const swatches = () => panel.querySelectorAll(".arc-saved-theme");
  const saved = () => JSON.parse(o.files.get(FILE) || '{"themes":[]}').themes;
  return { panel, view, space, calls, files: o.files, writes, open, row, swatches, saved, fire };
}

function theme(colors, opacity = 0.5, texture = 0) {
  return {
    type: "gradient", opacity, texture, textureType: "grain",
    gradientColors: colors.map((c, i) => ({ c, isCustom: false, algorithm: "float", isPrimary: i === 0, lightness: 50, position: { x: 100 + i, y: 100 }, type: "explicit-lightness" })),
  };
}

describe("saved themes row", () => {
  test("appears under the preset colors when the picker opens, with a + button", async () => {
    const z = await startZen();
    await z.open();
    assert.ok(z.row());
    assert.equal(z.view.children.indexOf(z.row()), 1);   // right after the presets row
    assert.equal(z.swatches().length, 0);
    assert.ok(z.panel.querySelector(".arc-saved-themes-add"));
  });

  test("+ saves the space's theme under a name and opens the rename box", async () => {
    const z = await startZen();
    await z.open();
    z.panel.querySelector(".arc-saved-themes-add").dispatch("click");
    await settle();
    const s = z.saved();
    assert.equal(s.length, 1);
    assert.equal(s[0].name, "Theme 1");
    assert.deepEqual(s[0].theme.gradientColors.map(d => d.c), [[10, 20, 30]]);
    assert.equal(z.swatches().length, 1);
    assert.equal(z.swatches()[0].getAttribute("selected"), "true");   // it's the current one
    const input = z.panel.querySelector(".arc-saved-themes-rename");
    assert.equal(input.hasAttribute("hidden"), false);
    input.value = "  Ocean  ";
    input.dispatch("keydown", { key: "Enter" });
    await settle();
    assert.equal(z.saved()[0].name, "Ocean");
    assert.equal(input.hasAttribute("hidden"), true);
  });

  test("saving the same colors twice doesn't add a copy", async () => {
    const z = await startZen();
    await z.open();
    z.panel.querySelector(".arc-saved-themes-add").dispatch("click");
    await settle();
    z.space.theme = { ...theme([[10, 20, 30]]), gradientColors: theme([[10, 20, 30]]).gradientColors.map(d => ({ ...d, position: { x: 5, y: 5 } })) };
    z.panel.querySelector(".arc-saved-themes-add").dispatch("click");
    await settle();
    assert.equal(z.saved().length, 1);
  });

  test("a click on a saved theme puts it on the space: set, saved, repainted", async () => {
    const files = new Map([[FILE, JSON.stringify({ v: 1, themes: [
      { id: "aaaaaaaaaaaaaaaa", name: "Dusk", theme: theme([[200, 100, 50], [20, 30, 40]], 0.7, 0.25) },
    ] })]]);
    const z = await startZen({ files });
    await z.open();
    assert.equal(z.swatches().length, 1);
    assert.match(z.swatches()[0].style.props.get("background"), /linear-gradient\(135deg, rgb\(200, 100, 50\), rgb\(20, 30, 40\)\)/);
    z.swatches()[0].dispatch("click");
    assert.deepEqual(plain(z.space.theme.gradientColors.map(d => d.c)), [[200, 100, 50], [20, 30, 40]]);
    assert.equal(z.space.theme.opacity, 0.7);
    assert.equal(z.space.theme.texture, 0.25);
    assert.deepEqual(z.calls.map(c => c[0]), ["save", "repaint"]);
    assert.equal(z.swatches()[0].getAttribute("selected"), "true");
  });

  test("switching back and forth between two saved themes", async () => {
    const a = theme([[1, 2, 3]]), b = theme([[250, 240, 230]], 0.3);
    const files = new Map([[FILE, JSON.stringify({ v: 1, themes: [
      { id: "aaaaaaaaaaaaaaaa", name: "A", theme: a }, { id: "bbbbbbbbbbbbbbbb", name: "B", theme: b },
    ] })]]);
    const z = await startZen({ files });
    await z.open();
    z.swatches()[1].dispatch("click");
    assert.deepEqual(plain(z.space.theme.gradientColors[0].c), [250, 240, 230]);
    z.swatches()[0].dispatch("click");
    assert.deepEqual(plain(z.space.theme.gradientColors[0].c), [1, 2, 3]);
    assert.equal(z.swatches()[0].getAttribute("selected"), "true");
    assert.equal(z.swatches()[1].getAttribute("selected"), null);
  });

  test("editing a space that isn't the active one also refreshes its gradient", async () => {
    const files = new Map([[FILE, JSON.stringify({ v: 1, themes: [{ id: "aaaaaaaaaaaaaaaa", name: "A", theme: theme([[1, 2, 3]]) }] })]]);
    const z = await startZen({ files });
    z.space.uuid = "other";
    await z.open();
    z.swatches()[0].dispatch("click");
    assert.deepEqual(z.calls.map(c => c[0]), ["save", "repaint", "invalidate", "notify"]);
  });

  test("right-click menu: replace with current colors, rename, delete", async () => {
    const files = new Map([[FILE, JSON.stringify({ v: 1, themes: [
      { id: "aaaaaaaaaaaaaaaa", name: "A", theme: theme([[1, 2, 3]]) }, { id: "bbbbbbbbbbbbbbbb", name: "B", theme: theme([[4, 5, 6]]) },
    ] })]]);
    const z = await startZen({ files });
    await z.open();
    const ctx = z.swatches()[0].dispatch("contextmenu", { screenX: 1, screenY: 2 });
    assert.ok(ctx.prevented);
    assert.ok(z.panel.querySelector("#arc-saved-themes-menu").opened);
    z.panel.querySelector("#arc-saved-themes-update").dispatch("command");
    await settle();
    assert.deepEqual(z.saved()[0].theme.gradientColors[0].c, [10, 20, 30]);

    z.swatches()[1].dispatch("contextmenu", {});
    z.panel.querySelector("#arc-saved-themes-delete").dispatch("command");
    await settle();
    assert.deepEqual(z.saved().map(s => s.name), ["A"]);

    z.swatches()[0].dispatch("contextmenu", {});
    z.panel.querySelector("#arc-saved-themes-rename").dispatch("command");
    const input = z.panel.querySelector(".arc-saved-themes-rename");
    input.value = "Renamed";
    input.dispatch("keydown", { key: "Escape" });
    await settle();
    assert.equal(z.saved()[0].name, "A");          // Escape keeps the old name
  });

  test("another window's saves are picked up when the picker opens", async () => {
    const files = new Map();
    const one = await startZen({ files });
    const two = await startZen({ files });
    await one.open(); await two.open();
    one.panel.querySelector(".arc-saved-themes-add").dispatch("click");
    await settle();
    two.space.theme = theme([[9, 9, 9]]);
    two.panel.querySelector(".arc-saved-themes-add").dispatch("click");
    await settle();
    assert.equal(two.saved().length, 2);           // two didn't overwrite one's
    await one.open();
    assert.equal(one.swatches().length, 2);
  });

  test("the file is checked: bad colors and fields dropped, an unreadable file kept aside", async () => {
    const files = new Map([[FILE, JSON.stringify({ v: 1, themes: [
      { id: "aaaaaaaaaaaaaaaa", name: "X".repeat(100), theme: { gradientColors: [
        { c: [300, -5, 20.4] }, { c: "red; background: url(x)", isCustom: true }, { c: "#ff000080", isCustom: true }, { c: "nope" },
      ], opacity: 9, evil: "<script>" } },
      { id: "../../etc", name: "B", theme: null },
    ] })]]);
    const z = await startZen({ files });
    await z.open();
    assert.equal(z.swatches().length, 1);
    z.swatches()[0].dispatch("click");
    assert.deepEqual(plain(z.space.theme.gradientColors.map(d => d.c)), [[255, 0, 20], "#ff000080"]);
    assert.equal(z.space.theme.opacity, 1);
    assert.equal(z.space.theme.evil, undefined);
    assert.equal(z.swatches()[0].getAttribute("title").length, 40);

    const bad = new Map([[FILE, "{not json"]]);
    const y = await startZen({ files: bad });
    await y.open();
    assert.ok([...bad.keys()].some(k => k.startsWith(`${FILE}.broken-`)));
  });

  test("Zen's default theme (no colors) can be saved and shows as the plain swatch", async () => {
    const z = await startZen({ space: { type: "gradient", gradientColors: [], opacity: 0.5, texture: 0 } });
    await z.open();
    z.panel.querySelector(".arc-saved-themes-add").dispatch("click");
    await settle();
    assert.equal(z.swatches()[0].getAttribute("default"), "true");
  });

  test("the right-click menu's own popup events don't reach Zen's panel handlers", async () => {
    const z = await startZen();
    await z.open();
    let zenSaw = 0;
    z.panel.addEventListener("popuphidden", () => zenSaw++);
    z.panel.addEventListener("popupshowing", () => zenSaw++);
    const menu = z.panel.querySelector("#arc-saved-themes-menu");
    for (const type of ["popupshowing", "popuphidden"]) {
      const e = { type, target: menu, stopped: false, stopPropagation() { this.stopped = true; } };
      for (let n = menu; n && !e.stopped; n = n.parentNode) for (const fn of n.listeners.get(type) || []) fn(e);
    }
    assert.equal(zenSaw, 0);
  });

  test("Zen changed its picker: no row, nothing breaks", async () => {
    const z = await startZen({ noPresets: true });
    await z.open();
    assert.equal(z.row(), null);
  });

  test("pref off: nothing added", async () => {
    const z = await startZen({ prefs: { "almost-arc.saved-themes": false } });
    await z.open();
    assert.equal(z.row(), null);
  });
});
