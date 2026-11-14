// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// PiP flick (JS/arcPipFlick.uc.js) run in node:vm with the PiP window faked:
// trackpad swipes (pixel scrolls) fling it to a corner, mouse wheels that scroll
// by lines leave it where it is.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const SRC = readFileSync(new URL("../JS/arcPipFlick.uc.js", import.meta.url), "utf8");

function load(prefs = {}) {
  let wheel = null;
  const moves = [];
  const window = {
    screen: { availLeft: 0, availTop: 25, availWidth: 1512, availHeight: 920 },
    outerWidth: 400, outerHeight: 225, screenX: 556, screenY: 300,   // middle of the screen
    addEventListener(type, fn) { if (type === "wheel") wheel = fn; },
    moveTo(x, y) { window.screenX = x; window.screenY = y; moves.push([x, y]); },
  };
  let now = 0;
  const context = {
    window, console,
    Services: { prefs: {
      getDefaultBranch: () => ({ setBoolPref() {} }),
      getBoolPref: (k, d) => (k in prefs ? prefs[k] : d),
    } },
    PathUtils: { profileDir: "/p", join: (...p) => p.join("/") },
    IOUtils: { writeUTF8: async () => {} },
    performance: { now: () => now },
    // run the whole glide at once: each frame is 100 ms later
    requestAnimationFrame: fn => { now += 100; queueMicrotask(() => fn(now)); return 1; },
    cancelAnimationFrame() {},
    setTimeout, clearTimeout,
  };
  vm.runInNewContext(SRC, context);
  const send = async (deltaX, deltaY, deltaMode = 0) => {
    let prevented = false;
    if (!wheel) return prevented;   // setting off: no listener at all
    wheel({ deltaX, deltaY, deltaMode, preventDefault() { prevented = true; }, stopPropagation() {} });
    await new Promise(r => setTimeout(r, 10));
    return prevented;
  };
  return { window, moves, send };
}

describe("PiP flick", () => {
  test("two-finger swipe right (trackpad, pixels): goes to the right side", async () => {
    const env = load();
    for (let i = 0; i < 5; i++) await env.send(-12, 0);   // fingers move right
    assert.ok(env.moves.length > 0);
    assert.equal(env.window.screenX, 1512 - 400 - 16);
  });

  test("two-finger swipe up-left: goes to the top left corner", async () => {
    const env = load();
    for (let i = 0; i < 5; i++) await env.send(12, 12);
    assert.deepEqual([env.window.screenX, env.window.screenY], [16, 25 + 16]);
  });

  test("mouse wheel scrolling by lines (horizontal): doesn't move it", async () => {
    const env = load();
    for (let i = 0; i < 10; i++) assert.equal(await env.send(3, 0, 1), false);
    assert.equal(env.moves.length, 0);
  });

  test("mouse wheel scrolling by lines (vertical): doesn't move it", async () => {
    const env = load();
    for (let i = 0; i < 10; i++) assert.equal(await env.send(0, -3, 1), false);
    assert.equal(env.moves.length, 0);
  });

  test("off with almost-arc.pip-flick = false", async () => {
    const env = load({ "almost-arc.pip-flick": false });
    for (let i = 0; i < 5; i++) await env.send(-12, 0);
    assert.equal(env.moves.length, 0);
  });
});
