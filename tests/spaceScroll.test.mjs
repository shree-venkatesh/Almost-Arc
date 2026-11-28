// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// JS/arcSpaceScroll.uc.js: mouse-wheel space switching stops at the ends; past the
// Library's end it opens the Library.
// Run: node --test 'tests/*.test.mjs'

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const SRC = fs.readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "JS/arcSpaceScroll.uc.js"), "utf8");

/**
 * opts: spaces (count), active (index), prefs, natural (Zen's natural scroll),
 *       right (sidebar on the right: Library on the right), libraryOff, libOpen,
 *       noLibrary (the module isn't there)
 */
function load(opts = {}) {
  const o = { spaces: 2, active: 0, prefs: {}, natural: false, ...opts };
  const prefs = new Map(Object.entries(o.prefs));
  const defaults = new Map();
  const spaces = Array.from({ length: o.spaces }, (_, i) => ({ uuid: `s${i}` }));
  const calls = [];
  const lib = {
    open: !!o.libOpen,
    get isLibraryOpen() { return this.open; },
    get isLibrarySlightlyOpen() { return this.open; },
    get libraryOnRight() { return !!o.right; },
    readySwipeOpenLibrary() {
      return !o.libraryOff && spaces.indexOf(spaces[ws.active]) === (o.right ? spaces.length - 1 : 0);
    },
    toggle() { calls.push("toggle"); this.open = !this.open; },
    close() { calls.push("close"); this.open = false; },
  };
  const ws = {
    active: o.active,
    workspaceEnabled: true,
    privateWindowOrDisabled: false,
    isChangingWorkspace: false,
    activationMethod: "ctrl",
    naturalScroll: o.natural,
    getWorkspaces: () => spaces,
    getActiveWorkspace: () => spaces[ws.active],
    changeWorkspaceShortcut(offset, whileScrolling, disableWrap) {
      const to = disableWrap ? Math.max(0, Math.min(spaces.length - 1, ws.active + offset))
        : (ws.active + offset + spaces.length) % spaces.length;
      ws.active = to;
      calls.push(`switch ${to}`);
    },
  };
  const sidebar = { inside: true, closest: () => null };
  const libraryEl = { closest: sel => (sel === "zen-library" ? libraryEl : null) };
  const toolbox = { contains: t => t === sidebar };
  let wheel = null;
  const window = {
    gZenWorkspaces: ws,
    gNavToolbox: toolbox,
    addEventListener: (type, fn) => { if (type === "wheel") wheel = fn; },
  };
  window.window = window;
  const Services = {
    prefs: {
      getDefaultBranch: () => ({ setBoolPref: (k, v) => defaults.set(k, v) }),
      getBoolPref: (k, d) => (prefs.has(k) ? prefs.get(k) : defaults.has(k) ? defaults.get(k) : d),
    },
  };
  const ChromeUtils = {
    importESModule: () => { if (o.noLibrary) throw new Error("no module"); return { ZenLibrary: lib }; },
  };
  let now = 1000;
  const FakeDate = { now: () => now };
  vm.runInNewContext(SRC, { window, Services, ChromeUtils, Date: FakeDate, console });

  // Zen's own wheel handler on the toolbox: runs only if ours didn't stop the event
  function scroll({ dx = 0, dy = 0, mode = 1, ctrl = false, target = sidebar, wait = 300 } = {}) {
    now += wait;
    const e = {
      deltaX: dx, deltaY: dy, deltaMode: mode, ctrlKey: ctrl, altKey: false, shiftKey: false, metaKey: false,
      target, stopped: false, prevented: false,
      stopPropagation() { this.stopped = true; }, preventDefault() { this.prevented = true; },
    };
    wheel(e);
    if (!e.stopped) zenHandler(e);
    return e;
  }
  let zenLast = 0;
  function zenHandler(e) {   // ZenSpaceManager #setupSidebarHandlers, wrap-around on
    if (e.target !== sidebar || e.deltaMode !== 1) return;
    const vertical = e.deltaY && !e.deltaX;
    if (vertical && !e.ctrlKey) return;
    if (now - zenLast < 200) return;
    const delta = vertical ? e.deltaY : e.deltaX;
    const off = (delta > 0 ? 1 : -1) * (ws.naturalScroll ? -1 : 1);
    ws.active = (ws.active + off + spaces.length) % spaces.length;
    calls.push(`switch ${ws.active}`);
    zenLast = now;
  }
  return { ws, lib, calls, scroll, prefs, libraryEl };
}

// Zen's direction: positive delta = next space (natural scroll off). Ours is reversed:
// scrolling with a negative delta goes to the next space, positive to the previous.
const NEXT = -3, PREV = 3;

describe("mouse wheel over the sidebar", () => {
  test("the direction is reversed from Zen's", () => {
    const z = load({ spaces: 3, active: 1 });
    z.scroll({ dx: NEXT });
    assert.equal(z.ws.active, 2);
    z.scroll({ dx: PREV });
    assert.equal(z.ws.active, 1);
    assert.deepEqual(z.calls, ["switch 2", "switch 1"]);
  });

  test("Zen's natural-scroll setting still flips it", () => {
    const z = load({ spaces: 3, active: 1, natural: true });
    z.scroll({ dx: 3 });
    assert.equal(z.ws.active, 2);
  });

  test("going back from the first space opens the Library, not the last space", () => {
    const z = load({ spaces: 2, active: 0 });
    const e = z.scroll({ dx: PREV });
    assert.ok(e.stopped);
    assert.equal(z.ws.active, 0);
    assert.deepEqual(z.calls, ["toggle"]);
    assert.ok(z.lib.open);
  });

  test("going on from the last space stays there (no loop)", () => {
    const z = load({ spaces: 2, active: 1 });
    z.scroll({ dx: NEXT });
    assert.equal(z.ws.active, 1);
    assert.deepEqual(z.calls, []);
  });

  test("a little less sensitive: under 1.5 lines does nothing, more of the same turn adds up", () => {
    const z = load({ spaces: 3, active: 1 });
    z.scroll({ dx: -1 });
    assert.deepEqual(z.calls, []);
    z.scroll({ dx: -1, wait: 100 });
    assert.deepEqual(z.calls, ["switch 2"]);
  });

  test("a pause or a change of direction starts the count again", () => {
    const z = load({ spaces: 3, active: 1 });
    z.scroll({ dx: -1 });
    z.scroll({ dx: -1, wait: 500 });
    assert.deepEqual(z.calls, []);
    z.scroll({ dx: 1, wait: 100 });
    assert.deepEqual(z.calls, []);
  });

  test("at most one switch per 300 ms", () => {
    const z = load({ spaces: 4, active: 0 });
    z.scroll({ dx: NEXT });
    z.scroll({ dx: NEXT, wait: 150 });
    assert.deepEqual(z.calls, ["switch 1"]);
    z.scroll({ dx: NEXT, wait: 200 });
    assert.deepEqual(z.calls, ["switch 1", "switch 2"]);
  });

  test("one quick flick that reaches the first space doesn't also open the Library", () => {
    const z = load({ spaces: 2, active: 1 });
    z.scroll({ dx: PREV });
    z.scroll({ dx: PREV, wait: 50 });
    assert.deepEqual(z.calls, ["switch 0"]);
    z.scroll({ dx: PREV, wait: 400 });
    assert.deepEqual(z.calls, ["switch 0", "toggle"]);
  });

  test("with the Library open, going on closes it; going further back does nothing more", () => {
    const z = load({ spaces: 2, active: 0, libOpen: true });
    z.scroll({ dx: PREV });
    assert.deepEqual(z.calls, []);
    z.scroll({ dx: NEXT });
    assert.deepEqual(z.calls, ["close"]);
    assert.equal(z.ws.active, 0);
  });

  test("scrolling back over the open Library itself closes it, back on the first space", () => {
    const z = load({ spaces: 2, active: 0 });
    z.scroll({ dx: PREV });
    const e = z.scroll({ dx: NEXT, target: z.libraryEl });
    assert.ok(e.stopped);
    assert.deepEqual(z.calls, ["toggle", "close"]);
    assert.equal(z.ws.active, 0);
  });

  test("wheel over the Library while it's closed (or plain vertical scrolling in it) is left alone", () => {
    const z = load({ spaces: 2, active: 0, libOpen: true });
    assert.equal(z.scroll({ dy: 3, target: z.libraryEl }).stopped, false);
    const y = load({ spaces: 2, active: 0 });
    assert.equal(y.scroll({ dx: 3, target: y.libraryEl }).stopped, false);
    assert.deepEqual([...z.calls, ...y.calls], []);
  });

  test("sidebar on the right: the Library is past the last space", () => {
    const z = load({ spaces: 2, active: 1, right: true });
    z.scroll({ dx: NEXT });
    assert.deepEqual(z.calls, ["toggle"]);
    const y = load({ spaces: 2, active: 0, right: true });
    y.scroll({ dx: PREV });
    assert.deepEqual(y.calls, []);
    assert.equal(y.ws.active, 0);
  });

  test("Library turned off in Zen, or no Library module: stays on the first space", () => {
    for (const opts of [{ libraryOff: true }, { noLibrary: true }]) {
      const z = load({ spaces: 2, active: 0, ...opts });
      z.scroll({ dx: PREV });
      assert.deepEqual(z.calls, []);
      assert.equal(z.ws.active, 0);
    }
  });

  test("vertical wheel needs Zen's modifier key; without it, left alone", () => {
    const z = load({ spaces: 2, active: 0 });
    assert.equal(z.scroll({ dy: PREV }).stopped, false);
    z.scroll({ dy: PREV, ctrl: true });
    assert.deepEqual(z.calls, ["toggle"]);
  });

  test("trackpad (pixel) scrolling and scrolling outside the sidebar are left alone", () => {
    const z = load({ spaces: 2, active: 0 });
    assert.equal(z.scroll({ dx: -3, mode: 0 }).stopped, false);
    assert.equal(z.scroll({ dx: -3, target: { closest: () => null } }).stopped, false);
    assert.deepEqual(z.calls, []);
  });

  test("pref off: Zen's own (its direction, looping)", () => {
    const z = load({ spaces: 2, active: 0, prefs: { "almost-arc.space-scroll-edges": false } });
    z.scroll({ dx: -3 });
    assert.equal(z.ws.active, 1);
  });
});
