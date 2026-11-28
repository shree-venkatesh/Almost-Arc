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
  };
  const sidebar = { inside: true };
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
  return { ws, lib, calls, scroll, prefs };
}

describe("mouse wheel over the sidebar", () => {
  test("scrolling left from the first space opens the Library, not the last space", () => {
    const z = load({ spaces: 2, active: 0 });
    const e = z.scroll({ dx: -3 });
    assert.ok(e.stopped);
    assert.equal(z.ws.active, 0);
    assert.deepEqual(z.calls, ["toggle"]);
    assert.ok(z.lib.open);
  });

  test("scrolling right from the last space stays there (no loop)", () => {
    const z = load({ spaces: 2, active: 1 });
    z.scroll({ dx: 3 });
    assert.equal(z.ws.active, 1);
    assert.deepEqual(z.calls, []);
  });

  test("between the ends Zen still switches spaces", () => {
    const z = load({ spaces: 3, active: 1 });
    z.scroll({ dx: -3 });
    assert.equal(z.ws.active, 0);
    z.scroll({ dx: 3 });
    z.scroll({ dx: 3 });
    assert.equal(z.ws.active, 2);
    assert.deepEqual(z.calls, ["switch 0", "switch 1", "switch 2"]);
  });

  test("one quick flick that reaches the first space doesn't also open the Library", () => {
    const z = load({ spaces: 2, active: 1 });
    z.scroll({ dx: -3 });                 // Zen moves to space 0
    z.scroll({ dx: -3, wait: 50 });       // the same flick, within Zen's 200 ms
    assert.deepEqual(z.calls, ["switch 0"]);
    z.scroll({ dx: -3, wait: 300 });      // a new scroll
    assert.deepEqual(z.calls, ["switch 0", "toggle"]);
  });

  test("with the Library open, scrolling back closes it; scrolling into it does nothing more", () => {
    const z = load({ spaces: 2, active: 0, libOpen: true });
    z.scroll({ dx: -3 });
    assert.deepEqual(z.calls, []);
    z.scroll({ dx: 3 });
    assert.deepEqual(z.calls, ["close"]);
    assert.equal(z.ws.active, 0);
  });

  test("sidebar on the right: the Library is past the last space", () => {
    const z = load({ spaces: 2, active: 1, right: true });
    z.scroll({ dx: 3 });
    assert.deepEqual(z.calls, ["toggle"]);
    const y = load({ spaces: 2, active: 0, right: true });
    y.scroll({ dx: -3 });
    assert.deepEqual(y.calls, []);
    assert.equal(y.ws.active, 0);
  });

  test("natural scrolling flips the direction like Zen's", () => {
    const z = load({ spaces: 2, active: 0, natural: true });
    z.scroll({ dx: 3 });
    assert.deepEqual(z.calls, ["toggle"]);
  });

  test("Library turned off in Zen: stays on the first space", () => {
    const z = load({ spaces: 2, active: 0, libraryOff: true });
    z.scroll({ dx: -3 });
    assert.deepEqual(z.calls, []);
    assert.equal(z.ws.active, 0);
  });

  test("no Library module (older Zen): still no loop", () => {
    const z = load({ spaces: 2, active: 0, noLibrary: true });
    z.scroll({ dx: -3 });
    assert.deepEqual(z.calls, []);
    assert.equal(z.ws.active, 0);
  });

  test("vertical wheel with Zen's modifier key behaves the same; without it, left to Zen", () => {
    const z = load({ spaces: 2, active: 0 });
    const plain = z.scroll({ dy: -3 });
    assert.equal(plain.stopped, false);
    z.scroll({ dy: -3, ctrl: true });
    assert.deepEqual(z.calls, ["toggle"]);
  });

  test("trackpad (pixel) scrolling and scrolling outside the sidebar are left alone", () => {
    const z = load({ spaces: 2, active: 0 });
    assert.equal(z.scroll({ dx: -3, mode: 0 }).stopped, false);
    assert.equal(z.scroll({ dx: -3, target: {} }).stopped, false);
    assert.deepEqual(z.calls, []);
  });

  test("pref off: Zen's own looping", () => {
    const z = load({ spaces: 2, active: 0, prefs: { "almost-arc.space-scroll-edges": false } });
    z.scroll({ dx: -3 });
    assert.equal(z.ws.active, 1);
  });
});
