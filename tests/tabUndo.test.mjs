// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// JS/arcTabUndo.uc.js: Cmd+Z for tab changes, and every safeguard around it.
// Run: node --test 'tests/*.test.mjs'

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const SRC = fs.readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "JS/arcTabUndo.uc.js"), "utf8");

const flush = async () => { for (let i = 0; i < 10; i++) await new Promise(r => setImmediate(r)); };

/**
 * A fake Zen window with tabs. opts:
 *   tabs         number of open tabs to start with (default 20), urls https://site<i>.test/
 *   maxClosed    how many closed tabs Firefox remembers (browser.sessionstore.max_tabs_undo, 25)
 *   prefs        user pref values
 *   noArm        true: the session restore never finishes
 */
async function load(opts = {}) {
  const o = { tabs: 20, maxClosed: 25, prefs: {}, ...opts };
  let now = 1_000_000;
  const timers = [];
  const fakeSetTimeout = (fn, ms = 0) => { const t = { at: now + ms, fn }; timers.push(t); return t; };
  const fakeClearTimeout = t => { const i = timers.indexOf(t); if (i >= 0) timers.splice(i, 1); };
  async function tick(ms) {
    now += ms;
    for (;;) {
      const due = timers.filter(t => t.at <= now).sort((a, b) => a.at - b.at)[0];
      if (!due) break;
      timers.splice(timers.indexOf(due), 1);
      due.fn();
      await flush();
    }
  }
  class FakeDate extends Date { constructor(...a) { super(...(a.length ? a : [now])); } static now() { return now; } }

  const prefs = new Map(Object.entries(o.prefs));
  const defaults = new Map();
  const Services = {
    prefs: {
      getDefaultBranch: () => ({ setBoolPref: (k, v) => defaults.set(k, v) }),
      prefHasUserValue: k => prefs.has(k),
      getBoolPref: (k, d) => (prefs.has(k) ? prefs.get(k) : defaults.has(k) ? defaults.get(k) : d),
      setBoolPref: (k, v) => prefs.set(k, v),
      clearUserPref: k => prefs.delete(k),
    },
  };

  // ---- tabs, folders, Firefox's recently-closed list ----
  const open = [];                 // tab strip, in order
  const closed = [];               // Firefox's recently closed tabs, newest first: { url, index }
  const calls = [];                // pin / unpin / move / group calls the script made
  const groups = new Map();
  function makeTab(url, extra = {}) {
    const attrs = new Set(extra.attrs || []);
    const tab = {
      url, pinned: !!extra.pinned, group: null, isConnected: true, closing: false,
      hasAttribute: a => attrs.has(a), setAttr: a => attrs.add(a),
      linkedBrowser: { currentURI: { spec: url } },
    };
    if (extra.group) groupOf(extra.group).tabs.push(tab), (tab.group = groupOf(extra.group));
    return tab;
  }
  function groupOf(id) {
    if (!groups.has(id)) groups.set(id, { id, label: id, tabs: [],
      addTabs(ts) { for (const t of ts) { calls.push(`group ${t.url} ${id}`); t.group = this; this.tabs.push(t); } } });
    return groups.get(id);
  }
  for (let i = 0; i < o.tabs; i++) open.push(makeTab(`https://site${i}.test/`));

  const tcListeners = {};
  const gBrowser = {
    tabContainer: { addEventListener: (type, fn) => (tcListeners[type] ||= []).push(fn) },
    pinTab: t => { calls.push(`pin ${t.url}`); t.pinned = true; },
    unpinTab: t => { calls.push(`unpin ${t.url}`); t.pinned = false; },
    moveTabTo: (t, { tabIndex }) => {
      calls.push(`move ${t.url} ${tabIndex}`);
      open.splice(open.indexOf(t), 1); open.splice(tabIndex, 0, t);
    },
    moveTabBefore: (t, other) => calls.push(`before ${t.url} ${other.url}`),
    moveTabAfter: (t, other) => calls.push(`after ${t.url} ${other.url}`),
    getTabGroupById: id => groups.get(id) || null,
  };
  const SessionStore = {
    promiseAllWindowsRestored: o.noArm ? new Promise(() => {}) : Promise.resolve(),
    getTabState: t => JSON.stringify({ entries: [{ url: t.url }], index: 1 }),
    getClosedTabDataForWindow: () => closed.map(c => ({ state: { entries: [{ url: c.url }], index: 1 } })),
    undoCloseTab(_w, i) {
      const [c] = closed.splice(i, 1);
      if (!c) return null;
      const tab = makeTab(c.url);
      open.splice(Math.min(c.index, open.length), 0, tab);
      calls.push(`reopen ${c.url}`);
      return tab;
    },
  };

  // ---- window, keyboard focus, files ----
  const winListeners = {};
  const focus = { ime: false, element: null };
  const window = {
    closed: false,
    addEventListener: (type, fn) => (winListeners[type] ||= []).push(fn),
    windowUtils: { get IMEStatus() { return focus.ime ? 1 : 0; } },
    isBlankPageURL: u => u === "about:blank" || u === "about:newtab",
  };
  const files = new Map();         // path -> true
  const IOUtils = {
    writeUTF8: async () => {},
    makeDirectory: async () => {},
    copy: async (_src, dst) => { files.set(dst, true); },
    getChildren: async dir => [...files.keys()].filter(f => f.startsWith(dir + "/")),
    remove: async f => { files.delete(f); },
  };
  const warnings = [];
  const context = {
    window, Services, gBrowser, IOUtils,
    console: { warn: (...a) => warnings.push(a.join(" ")), log() {} },
    AppConstants: { platform: "macosx" },
    Ci: { nsIDOMWindowUtils: { IME_STATUS_DISABLED: 0 } },
    document: { commandDispatcher: { get focusedElement() { return focus.element; } } },
    PathUtils: { profileDir: "/profile", join: (...p) => p.join("/") },
    ChromeUtils: {
      importESModule(url) {
        if (url.endsWith("SessionStore.sys.mjs")) return { SessionStore };
        throw new Error(`unexpected module ${url}`);
      },
    },
    setTimeout: fakeSetTimeout, clearTimeout: fakeClearTimeout,
    Promise, Set, Map, JSON, Math, Date: FakeDate, Error, Array, Object, String,
  };
  vm.createContext(context);
  vm.runInContext(SRC, context, { filename: "arcTabUndo.uc.js" });
  await flush();
  if (!o.noArm) await tick(1600);   // session restored + settle time

  const fire = (map, type, ev) => (map[type] || []).forEach(fn => fn(ev));
  const input = () => fire(winListeners, "mousedown", { isTrusted: true, type: "mousedown" });

  // Firefox: a closed tab goes to the top of the recently-closed list (capped)
  function closeTab(tab) {
    const index = open.indexOf(tab);
    open.splice(index, 1);
    tab.isConnected = false;
    if (tab.url !== "about:blank") {
      closed.unshift({ url: tab.url, index });
      closed.length = Math.min(closed.length, o.maxClosed);
    }
    fire(tcListeners, "TabClose", { target: tab });
  }

  return {
    open, closed, calls, files, warnings, focus, tick, makeTab,
    get urls() { return open.map(t => t.url); },
    /** You close these tabs in one go (one click: Zen's Clear, or a multi-select close). */
    async userCloses(tabs) {
      input();
      for (const t of [].concat(tabs)) closeTab(t);
      await tick(100);              // the step ends
    },
    /** Something other than you closes a tab (a site, Zen itself). */
    async closesByItself(tab) { await tick(5000); closeTab(tab); await tick(100); },
    async userMoves(tabs) {
      input();
      for (const t of [].concat(tabs)) {
        const prev = { tabIndex: open.indexOf(t), tabGroupId: null };
        open.splice(open.indexOf(t), 1); open.push(t);
        fire(tcListeners, "TabMove", { target: t, detail: { previousTabState: prev } });
      }
      await tick(100);
    },
    async userClosesAndMoves(toClose, toMove) {
      input();
      for (const t of toClose) closeTab(t);
      for (const t of toMove) {
        const prev = { tabIndex: open.indexOf(t), tabGroupId: null };
        open.splice(open.indexOf(t), 1); open.push(t);
        fire(tcListeners, "TabMove", { target: t, detail: { previousTabState: prev } });
      }
      await tick(100);
    },
    async userPins(tabs) {
      input();
      for (const t of [].concat(tabs)) { t.pinned = true; fire(tcListeners, "TabPinned", { target: t }); }
      await tick(100);
    },
    addToGroup(tab, id) { tab.group = groupOf(id); groupOf(id).tabs.push(tab); },
    /** Press Cmd+Z; resolves when the undo is done. Returns whether Cmd+Z was taken. */
    async cmdZ() {
      let taken = false;
      fire(winListeners, "keydown", { key: "z", metaKey: true, ctrlKey: false, shiftKey: false, altKey: false,
        preventDefault() { taken = true; }, stopPropagation() {} });
      await flush();
      await tick(600);
      return taken;
    },
  };
}

describe("tab undo: reopening closed tabs", () => {
  test("Cmd+Z reopens a tab you closed, where it was", async () => {
    const z = await load({ tabs: 5 });
    await z.userCloses(z.open[2]);
    assert.equal(z.open.length, 4);
    assert.ok(await z.cmdZ());
    assert.deepEqual(z.urls, [0, 1, 2, 3, 4].map(i => `https://site${i}.test/`));
  });

  test("Cmd+Z after Zen's Clear reopens every tab it closed, more than 5 too", async () => {
    const z = await load({ tabs: 14 });
    const before = z.urls;
    await z.userCloses(z.open.slice(2));          // Clear closes 12 tabs at once
    assert.equal(z.open.length, 2);
    assert.ok(await z.cmdZ());
    assert.deepEqual(z.urls, before);
    assert.equal(z.calls.filter(c => c.startsWith("reopen")).length, 12);
    assert.deepEqual(z.warnings, []);
  });

  test("more than 5 reopened tabs are only reopened: not pinned or put into folders", async () => {
    const z = await load({ tabs: 0 });
    for (let i = 0; i < 7; i++) z.open.push(z.makeTab(`https://pinned${i}.test/`, { pinned: true, group: "work" }));
    await z.userCloses([...z.open]);
    await z.cmdZ();
    assert.equal(z.open.length, 7);
    assert.deepEqual(z.calls.filter(c => !c.startsWith("reopen")), []);
  });

  test("5 or fewer reopened tabs go back pinned and into their folder", async () => {
    const z = await load({ tabs: 0 });
    for (let i = 0; i < 3; i++) z.open.push(z.makeTab(`https://pinned${i}.test/`, { pinned: true, group: "work" }));
    await z.userCloses([...z.open]);
    await z.cmdZ();
    assert.equal(z.calls.filter(c => c.startsWith("pin")).length, 3);
    assert.equal(z.calls.filter(c => c.startsWith("group")).length, 3);
  });

  test("Clear of more tabs than Firefox remembers reopens the ones it still has", async () => {
    const z = await load({ tabs: 32, maxClosed: 25 });
    await z.userCloses(z.open.slice(2));          // 30 closed, Firefox keeps the last 25
    await z.cmdZ();
    assert.equal(z.open.length, 2 + 25);
  });

  test("the session file is backed up before an undo, and only 10 backups are kept", async () => {
    const z = await load({ tabs: 15 });
    for (let i = 0; i < 12; i++) { await z.userCloses(z.open[0]); await z.cmdZ(); await z.tick(1000); }
    const backups = [...z.files.keys()].filter(f => f.includes("zen-sessions-undo-backups/zen-sessions-before-undo-"));
    assert.equal(backups.length, 10);
  });

  test("a big reopen is backed up first too", async () => {
    const z = await load({ tabs: 14 });
    await z.userCloses(z.open.slice(2));
    await z.cmdZ();
    assert.equal(z.files.size, 1);
  });
});

describe("tab undo: the 5-tab limit for moves and pins", () => {
  test("an undo that would move more than 5 tabs is refused, and the history is cleared", async () => {
    const z = await load({ tabs: 10 });
    await z.userCloses(z.open[9]);                 // an earlier, small step
    await z.userMoves(z.open.slice(0, 6));         // 6 tabs moved at once
    const after = z.urls;
    await z.cmdZ();
    assert.deepEqual(z.urls, after);
    assert.match(z.warnings.join("\n"), /refused: undo would change 6 tabs/);
    assert.equal(z.files.size, 0);                 // refused before anything, no backup
    assert.equal(await z.cmdZ(), false);           // and nothing older is undone after it
    assert.equal(z.calls.length, 0);
  });

  test("an undo that would pin or unpin more than 5 tabs is refused", async () => {
    const z = await load({ tabs: 10 });
    await z.userPins(z.open.slice(0, 6));
    await z.cmdZ();
    assert.deepEqual(z.calls, []);
    assert.match(z.warnings.join("\n"), /refused/);
  });

  test("a step that closes and moves tabs counts all of them against the limit", async () => {
    const z = await load({ tabs: 10 });
    // one click that closes 4 tabs and moves 2 others: one step, 6 tabs
    const m = await load({ tabs: 10 });
    await m.userClosesAndMoves(m.open.slice(0, 4), m.open.slice(4, 6));
    await m.cmdZ();
    assert.equal(m.calls.length, 0);
    assert.match(m.warnings.join("\n"), /refused: undo would change 6 tabs/);
  });

  test("undoing up to 5 moves works", async () => {
    const z = await load({ tabs: 8 });
    const before = z.urls;
    await z.userMoves(z.open.slice(0, 5));
    await z.cmdZ();
    assert.deepEqual(z.urls, before);
  });
});

describe("tab undo: what gets recorded", () => {
  test("nothing is recorded until Zen has restored the session", async () => {
    const z = await load({ tabs: 5, noArm: true });
    await z.userCloses(z.open[0]);
    assert.equal(await z.cmdZ(), false);
    assert.equal(z.open.length, 4);
  });

  test("a tab closed without your input (by a site or Zen) isn't recorded", async () => {
    const z = await load({ tabs: 5 });
    await z.closesByItself(z.open[0]);
    assert.equal(await z.cmdZ(), false);
  });

  test("a reopen is refused if the last closed tab isn't the one you closed", async () => {
    const z = await load({ tabs: 5 });
    await z.userCloses(z.open[0]);
    await z.closesByItself(z.open[0]);             // another tab closes on its own afterwards
    await z.cmdZ();
    assert.equal(z.calls.filter(c => c.startsWith("reopen")).length, 0);
    assert.equal(z.open.length, 3);
  });
});

describe("tab undo: typing", () => {
  test("Cmd+Z in a text field is left to the text field", async () => {
    const z = await load({ tabs: 5 });
    await z.userCloses(z.open[0]);
    z.focus.element = { localName: "input" };
    assert.equal(await z.cmdZ(), false);
    assert.equal(z.open.length, 4);
  });

  test("Cmd+Z while typing on a web page is left to the page", async () => {
    const z = await load({ tabs: 5 });
    await z.userCloses(z.open[0]);
    z.focus.ime = true;
    assert.equal(await z.cmdZ(), false);
    z.focus.ime = false;
    assert.ok(await z.cmdZ());
    assert.equal(z.open.length, 5);
  });
});
