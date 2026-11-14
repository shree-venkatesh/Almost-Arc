// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// PiP flick (JS/arcPipFlick.uc.js) run in node:vm with the PiP window faked.
//   Trackpad: a two-finger swipe (pixel scrolls) flings it to a corner; mouse wheels
//   that scroll by lines leave it where it is.
//   Mouse: the script drags the window itself (macOS's own drag is turned off: Zen
//   hears nothing during it, and macOS tiles a window dragged against a screen edge).
//   The window follows the pointer. Letting go while moving fast flings it to a
//   corner; letting go slowly leaves it there, unless it's partly off the screen,
//   then it slides back to the nearest edge.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const SRC = readFileSync(new URL("../JS/arcPipFlick.uc.js", import.meta.url), "utf8");

// The screen: 1512 x 920 below a 25 px menu bar. The window: 400 x 225.
const SCREEN = { availLeft: 0, availTop: 25, availWidth: 1512, availHeight: 920 };
const W = 400, H = 225, M = 16;
const LEFT = M, RIGHT = 1512 - W - M, TOP = 25 + M, BOTTOM = 25 + 920 - H - M;
const FRAME = 16;   // ms per animation frame

function load(prefs = {}) {
  const listeners = {};
  const moves = [];
  const sheets = [];
  const captured = new Set();
  let now = 1000;
  let frames = [];   // pending requestAnimationFrame callbacks
  let nextId = 1;
  const window = {
    screen: SCREEN,
    outerWidth: W, outerHeight: H, screenX: 556, screenY: 300,   // middle of the screen
    addEventListener(type, fn) { (listeners[type] ||= []).push(fn); },
    moveTo(x, y) { window.screenX = x; window.screenY = y; moves.push([x, y]); },
    windowUtils: { AUTHOR_SHEET: 2, loadSheetUsingURIString: (uri, type) => sheets.push(decodeURIComponent(uri)) },
  };
  const document = { documentElement: {
    setPointerCapture: id => captured.add(id), releasePointerCapture: id => captured.delete(id),
  } };
  const context = {
    window, document, console,
    Services: { prefs: {
      getDefaultBranch: () => ({ setBoolPref() {} }),
      getBoolPref: (k, d) => (k in prefs ? prefs[k] : d),
    } },
    PathUtils: { profileDir: "/p", join: (...p) => p.join("/") },
    IOUtils: { writeUTF8: async () => {} },
    performance: { now: () => now },
    requestAnimationFrame: fn => { const id = nextId++; frames.push({ id, fn }); return id; },
    cancelAnimationFrame: id => { frames = frames.filter(f => f.id !== id); },
    setTimeout, clearTimeout,
  };
  vm.runInNewContext(SRC, context);
  const fire = (type, ev = {}) => (listeners[type] || []).forEach(fn => fn(ev));

  // one animation frame, `ms` later
  function frame(ms = FRAME) {
    now += ms;
    const run = frames; frames = [];
    for (const f of run) f.fn(now);
  }
  // let any glide finish (it takes 400 ms)
  function settle() { for (let i = 0; i < 60; i++) frame(); }

  async function scroll(deltaX, deltaY, deltaMode = 0) {
    let prevented = false;
    fire("wheel", { deltaX, deltaY, deltaMode, preventDefault() { prevented = true; }, stopPropagation() {} });
    await new Promise(r => setTimeout(r, 5));
    return prevented;
  }

  // Pointer events, as the PiP window gets them. `on`: the element pressed.
  const VIDEO = { closest: () => null };                           // the video area (#controls)
  const BUTTON = { closest: sel => (sel.includes("button") ? BUTTON : null) };
  const pointer = (type, x, y, extra = {}) =>
    fire(type, { type, pointerId: 1, button: 0, screenX: x, screenY: y, target: VIDEO, metaKey: false, ...extra });

  // Mouse drag: press 100 px right / 50 px below the window's top left, move so the
  // window should be at each point of `path` (one point per 16 ms frame), optionally
  // hold still, then let go.
  function drag(path, { holdMs = 0, metaKey = false, on = VIDEO, cancel = false } = {}) {
    // the window moves by what the pointer moves, so pointer = window spot + (100, 50)
    let p = [window.screenX + 100, window.screenY + 50];
    pointer("pointerdown", ...p, { target: on });
    for (const [x, y] of path) { frame(); p = [x + 100, y + 50]; pointer("pointermove", ...p, { target: on }); }
    if (holdMs) for (let t = 0; t < holdMs; t += FRAME) frame();   // still holding, not moving
    pointer(cancel ? "pointercancel" : "pointerup", ...p, { target: on, metaKey });
  }

  return { window, moves, sheets, captured, fire, pointer, BUTTON, scroll, drag, frame, settle,
           pos: () => [window.screenX, window.screenY] };
}

// a straight line from (x0, y0), `step` px per frame in (dx, dy) direction
const line = (x0, y0, dx, dy, n) => Array.from({ length: n }, (_, i) => [x0 + dx * (i + 1), y0 + dy * (i + 1)]);

describe("trackpad swipe", () => {
  test("swipe right: goes to the right side", async () => {
    const env = load();
    for (let i = 0; i < 5; i++) await env.scroll(-12, 0);   // fingers move right
    env.settle();
    assert.equal(env.window.screenX, RIGHT);
  });

  test("swipe up-left: goes to the top left corner", async () => {
    const env = load();
    for (let i = 0; i < 5; i++) await env.scroll(12, 12);
    env.settle();
    assert.deepEqual(env.pos(), [LEFT, TOP]);
  });

  test("mouse wheel scrolling by lines (horizontal): doesn't move it", async () => {
    const env = load();
    for (let i = 0; i < 10; i++) assert.equal(await env.scroll(3, 0, 1), false);
    env.settle();
    assert.equal(env.moves.length, 0);
  });

  test("mouse wheel scrolling by lines (vertical): doesn't move it", async () => {
    const env = load();
    for (let i = 0; i < 10; i++) assert.equal(await env.scroll(0, -3, 1), false);
    env.settle();
    assert.equal(env.moves.length, 0);
  });
});

describe("mouse: flick (let go while moving)", () => {
  test("drag right and let go while moving fast: flicks to the right side", () => {
    const env = load();
    env.drag(line(556, 300, 30, 0, 8));   // 30 px per 16 ms frame, about 1.9 px/ms
    env.settle();
    assert.equal(env.window.screenX, RIGHT);
  });

  test("drag left and let go: flicks to the left side, keeps its top/bottom half", () => {
    const env = load();
    env.drag(line(556, 600, -30, 0, 8));   // lower half of the screen
    env.settle();
    assert.deepEqual(env.pos(), [LEFT, BOTTOM]);
  });

  test("flick up-right: top right corner", () => {
    const env = load();
    env.drag(line(556, 400, 25, -25, 6));
    env.settle();
    assert.deepEqual(env.pos(), [RIGHT, TOP]);
  });

  test("flick down: bottom, keeps its side", () => {
    const env = load();
    env.drag(line(200, 300, 0, 30, 5));
    env.settle();
    assert.deepEqual(env.pos(), [LEFT, BOTTOM]);
  });

  test("a fast drag that stops before you let go isn't a flick", () => {
    const env = load();
    env.drag(line(556, 300, 30, 0, 8), { holdMs: 200 });
    env.settle();
    assert.deepEqual(env.pos(), [556 + 240, 300]);
  });

  test("flick while partly off the screen: still lands in a corner on screen", () => {
    const env = load();
    env.drag(line(1100, 300, 40, 0, 8));   // ends at x 1420: mostly past the right edge
    env.settle();
    assert.equal(env.window.screenX, RIGHT);
  });

  test("grabbing it mid-glide stops the glide and follows the drag", () => {
    const env = load();
    env.drag(line(556, 300, 30, 0, 8));          // flick right
    env.frame(); env.frame();                     // the glide starts
    env.drag(line(env.window.screenX, 300, -2, 0, 10), { holdMs: 200 });   // grab it, move slowly, hold
    const at = env.pos();
    env.settle();
    assert.deepEqual(env.pos(), at);
  });

  test("Cmd+drag is left to Firefox's own corner snap", () => {
    const env = load();
    env.drag(line(556, 300, 30, 0, 8), { metaKey: true });
    const at = env.pos();
    env.settle();
    assert.deepEqual(env.pos(), at);
  });
});

describe("mouse: drag and place (let go slowly)", () => {
  test("slow drag: stays exactly where you let go", () => {
    const env = load();
    env.drag(line(556, 300, 3, 2, 40));   // 3 px per frame, about 0.2 px/ms
    env.settle();
    assert.deepEqual(env.pos(), [556 + 120, 300 + 80]);
  });

  test("drag, then hold still before letting go: stays there", () => {
    const env = load();
    env.drag(line(556, 300, 20, 10, 10), { holdMs: 300 });
    env.settle();
    assert.deepEqual(env.pos(), [756, 400]);
  });

  test("placed against an edge, fully on screen: stays (no margin added)", () => {
    const env = load();
    env.drag(line(556, 300, 2, 0, 278), { holdMs: 200 });   // right edge at x 1512 exactly
    env.settle();
    assert.deepEqual(env.pos(), [1512 - W, 300]);
  });

  test("dropped partly past the right edge (no monitor there): slides back to the edge", () => {
    const env = load();
    env.drag(line(1000, 300, 3, 0, 100), { holdMs: 200 });   // x 1300: 188 px off screen
    env.settle();
    assert.deepEqual(env.pos(), [RIGHT, 300]);
  });

  test("dropped past the left edge: slides back", () => {
    const env = load();
    env.drag(line(100, 300, -3, 0, 60), { holdMs: 200 });   // x -80
    env.settle();
    assert.deepEqual(env.pos(), [LEFT, 300]);
  });

  test("dropped past the bottom: slides back up, keeps its x", () => {
    const env = load();
    env.drag(line(300, 700, 0, 3, 50), { holdMs: 200 });   // y 850: bottom at 1075 > 945
    env.settle();
    assert.deepEqual(env.pos(), [300, BOTTOM]);
  });

  test("dropped off the bottom right corner: back to that corner", () => {
    const env = load();
    env.drag(line(1200, 700, 3, 3, 60), { holdMs: 200 });
    env.settle();
    assert.deepEqual(env.pos(), [RIGHT, BOTTOM]);
  });

  test("a click without moving does nothing", () => {
    const env = load();
    env.drag([], {});
    env.settle();
    assert.equal(env.moves.length, 0);
  });

  test("a pointerup without a press (it started elsewhere) does nothing", () => {
    const env = load();
    env.window.screenX = 1300;   // even if it's off screen
    env.pointer("pointerup", 1400, 350);
    env.settle();
    assert.equal(env.moves.length, 0);
  });

  test("a wobble under 3 px is a click, not a drag", () => {
    const env = load();
    env.drag([[557, 301], [558, 300]]);
    env.settle();
    assert.equal(env.moves.length, 0);
  });

  test("pressing a control (button, slider) doesn't drag the window", () => {
    const env = load();
    env.drag(line(556, 300, 30, 0, 8), { on: env.BUTTON });
    env.settle();
    assert.equal(env.moves.length, 0);
  });

  test("the window follows the pointer while you drag, even past the screen edge", () => {
    const env = load();
    env.drag(line(556, 300, 10, 0, 100).concat([[1700, 300]]), { holdMs: 1 });
    assert.ok(env.moves.some(([x]) => x === 1700), "it went past the right edge while dragging");
  });

  test("keeps the pointer while dragging (pointer capture), lets go of it after", () => {
    const env = load();
    env.pointer("pointerdown", 656, 350);
    assert.ok(env.captured.has(1));
    env.pointer("pointerup", 656, 350);
    assert.equal(env.captured.size, 0);
  });

  test("drag cancelled by the system: no flick, but kept on screen", () => {
    const env = load();
    env.drag(line(1000, 300, 30, 0, 12), { cancel: true });   // fast, ends at x 1360
    env.settle();
    assert.deepEqual(env.pos(), [RIGHT, 300]);
  });

  test("macOS's own window dragging is turned off on the video", () => {
    const env = load();
    assert.ok(env.sheets.some(css => /#controls[^{]*\{[^}]*-moz-window-dragging:\s*no-drag/.test(css)), env.sheets.join("\n"));
  });
});

describe("setting", () => {
  test("off with almost-arc.pip-flick = false: no swipe, no flick, no snapping back", async () => {
    const env = load({ "almost-arc.pip-flick": false });
    for (let i = 0; i < 5; i++) await env.scroll(-12, 0);
    env.drag(line(556, 300, 30, 0, 8));
    env.drag(line(1000, 300, 3, 0, 100), { holdMs: 200 });
    env.settle();
    assert.equal(env.moves.length, 0);
  });
});
