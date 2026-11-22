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

function load(prefs = {}, { protocol = "x11", os = "Darwin" } = {}) {
  const listeners = {};
  const moves = [];
  const sheets = [];
  const resizes = [];
  const captured = new Set();
  let now = 1000;
  let frames = [];   // pending requestAnimationFrame callbacks
  let nextId = 1;
  const window = {
    screen: SCREEN,
    outerWidth: W, outerHeight: H, screenX: 556, screenY: 300,   // middle of the screen
    addEventListener(type, fn) { (listeners[type] ||= []).push(fn); },
    moveTo(x, y) { window.screenX = x; window.screenY = y; moves.push([x, y]); },
    resizeTo(w, h) { window.outerWidth = w; window.outerHeight = h; resizes.push([w, h]); },
    windowUtils: { AGENT_SHEET: 0, USER_SHEET: 1, AUTHOR_SHEET: 2, loadSheetUsingURIString: (uri, type) => sheets.push([decodeURIComponent(uri), type]) },
  };
  // elements whose inline style the script sets: selector -> { prop: [value, priority] }
  const inline = {};
  const el = sel => ({ style: {
    setProperty: (k, v, pri) => { (inline[sel] ||= {})[k] = [v, pri]; },
    getPropertyValue: k => inline[sel]?.[k]?.[0] ?? "",
  } });
  const document = {
    documentElement: { setPointerCapture: id => captured.add(id), releasePointerCapture: id => captured.delete(id),
      attrs: {}, getAttribute(k) { return this.attrs[k] ?? null; }, setAttribute(k, v) { this.attrs[k] = String(v); },
      removeAttribute(k) { delete this.attrs[k]; } },
    querySelectorAll: sel => [el(sel)],
    getElementById: id => el("#" + id),
  };
  const context = {
    window, document, console,
    Services: { appinfo: { OS: os }, prefs: {
      getDefaultBranch: () => ({ setBoolPref() {} }),
      getBoolPref: (k, d) => (k in prefs ? prefs[k] : d),
    } },
    PathUtils: { profileDir: "/p", join: (...p) => p.join("/") },
    IOUtils: { writeUTF8: async () => {} },
    performance: { now: () => now },
    requestAnimationFrame: fn => { const id = nextId++; frames.push({ id, fn }); return id; },
    cancelAnimationFrame: id => { frames = frames.filter(f => f.id !== id); },
    setTimeout, clearTimeout,
    Cc: { "@mozilla.org/gfx/info;1": { getService: () => ({ windowProtocol: protocol }) } },
    Ci: { nsIGfxInfo: {} },
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

  // something outside (macOS) resizes the window
  const shrink = (w, h) => { window.outerWidth = w; window.outerHeight = h; fire("resize", { type: "resize" }); };

  // press at window spot (x, y), move the pointer by each [dx, dy] of `steps`, let go
  function edgeDrag(x, y, steps) {
    let p = [window.screenX + x, window.screenY + y];
    pointer("pointerdown", ...p);
    for (const [dx, dy] of steps) { frame(); p = [p[0] + dx, p[1] + dy]; pointer("pointermove", ...p); }
    pointer("pointerup", ...p);
  }

  return { window, document, moves, resizes, shrink, sheets, inline, captured, fire, pointer, BUTTON, scroll, drag, edgeDrag, frame, settle,
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

  test("drag cancelled by the system: stops following, moves nothing more (no flick, no slide back)", () => {
    const env = load();
    env.drag(line(1000, 300, 30, 0, 12), { cancel: true });   // fast, ends at x 1360, off screen
    const at = env.pos();
    env.settle();
    assert.deepEqual(env.pos(), at);
  });

  test("while the button is held, nothing slides it back, however long it sits off screen", () => {
    const env = load();
    const path = line(1000, 300, 5, 0, 80);   // ends at x 1400, 288 px off screen
    env.pointer("pointerdown", 656, 350);       // 100 px into the window at x 556
    for (const [x, y] of path) { env.frame(); env.pointer("pointermove", x + 100, y + 50); }
    const dragged = env.moves.length;
    for (let i = 0; i < 200; i++) env.frame();   // 3 s, still holding, not moving
    assert.equal(env.moves.length, dragged, "no moves while held");
    assert.deepEqual(env.pos(), [1400, 300]);
    env.pointer("pointerup", 1500, 350);         // let go: now it slides back
    env.settle();
    assert.deepEqual(env.pos(), [RIGHT, 300]);
  });

  // -moz-window-dragging is chrome-only: Firefox drops it from a data: author sheet
  // (1.2.5-1.2.7) and from inline styles (1.2.8 log: inline ""), so macOS kept
  // dragging the window under ours. A user sheet may use it.
  test("macOS's own window dragging is turned off on the video, with a user sheet", () => {
    const env = load();
    assert.ok(env.sheets.some(([css, type]) => type === 1 &&
      /#controls[^{]*\{[^}]*-moz-window-dragging:\s*no-drag\s*!important/.test(css)), JSON.stringify(env.sheets));
  });});

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

describe("Wayland", () => {
  // moveTo does nothing on Wayland: with the system's drag turned off the PiP couldn't move at all
  test("leaves the PiP to the desktop: its own drag stays on, no swipe or fling", async () => {
    const env = load({}, { protocol: "wayland" });
    assert.equal(env.sheets.length, 0, "the system's window drag must stay on");
    for (let i = 0; i < 5; i++) await env.scroll(-12, 0);
    env.drag(line(556, 300, 30, 0, 8));
    env.settle();
    assert.equal(env.moves.length, 0);
    assert.equal(env.window.__arcPipFlick, "off: wayland");
  });
  test("XWayland (Zen run with GDK_BACKEND=x11 on a Wayland desktop) keeps them: windows can be moved there", async () => {
    const env = load({}, { protocol: "xwayland" });
    assert.ok(env.sheets.some(([css]) => css.includes("no-drag")));
    assert.equal(env.window.__arcPipFlick, true);
    for (let i = 0; i < 5; i++) await env.scroll(-12, 0);
    env.settle();
    assert.ok(env.moves.length > 0, "the swipe should move it");
  });
  test("X11 keeps the swipe and the script's drag", () => {
    const env = load({}, { protocol: "x11" });
    assert.ok(env.sheets.some(([css]) => css.includes("no-drag")));
  });
});

describe("Linux: resizing from the edges (the desktop gives the PiP no resize border)", () => {
  const linux = () => load({}, { os: "Linux" });
  const steps = (dx, dy, n = 5) => Array.from({ length: n }, () => [dx, dy]);
  test("bottom right corner pulled out: bigger, same shape, top left stays", () => {
    const env = linux();
    env.edgeDrag(W - 3, H - 3, steps(16, 9));
    const [w, h] = [env.window.outerWidth, env.window.outerHeight];
    assert.equal(w, W + 80);
    assert.ok(Math.abs(w / h - W / H) < 0.01, `shape kept: ${w}x${h}`);
    assert.deepEqual(env.pos(), [556, 300]);
  });
  test("left edge pulled left: wider and taller, its right edge stays put", () => {
    const env = linux();
    env.edgeDrag(2, H / 2, steps(-10, 0));
    assert.equal(env.window.outerWidth, W + 50);
    assert.equal(env.window.screenX + env.window.outerWidth, 556 + W);
    assert.equal(env.window.screenY, 300);
  });
  test("top edge pulled down: smaller, its bottom edge stays put", () => {
    const env = linux();
    env.edgeDrag(W / 2, 2, steps(0, 9));
    assert.equal(env.window.outerHeight, H - 45);
    assert.equal(env.window.screenY + env.window.outerHeight, 300 + H);
  });
  test("never smaller than 200 px wide", () => {
    const env = linux();
    env.edgeDrag(W - 2, H - 2, steps(-100, -60));
    assert.equal(env.window.outerWidth, 200);
  });
  test("a button near the edge (top bar, volume) keeps its click: no resize, no arrow", () => {
    const env = linux(), root = env.document.documentElement;
    env.pointer("pointermove", 556 + W - 10, 300 + 10, { target: env.BUTTON });
    assert.equal(root.getAttribute("arc-resize"), null);
    env.pointer("pointerdown", 556 + W - 10, 300 + 10, { target: env.BUTTON });
    env.pointer("pointermove", 556 + W + 30, 300 - 20, { target: env.BUTTON });
    env.pointer("pointerup", 556 + W + 30, 300 - 20, { target: env.BUTTON });
    assert.equal(env.resizes.length, 0);
    assert.equal(env.moves.length, 0);
  });
  test("a press inside still drags the window, no resize", () => {
    const env = linux();
    env.drag(line(556, 300, 3, 0, 8), { holdMs: 200 });
    assert.equal(env.resizes.length, 0);
    assert.deepEqual(env.pos(), [580, 300]);
  });
  test("the cursor shows a resize arrow near an edge, and goes back inside", () => {
    const env = linux(), root = env.document.documentElement;
    env.pointer("pointermove", 556 + W - 2, 300 + H - 2);
    assert.equal(root.getAttribute("arc-resize"), "nwse");
    env.pointer("pointermove", 556 + 4, 300 + 100);
    assert.equal(root.getAttribute("arc-resize"), "ew");
    env.pointer("pointermove", 556 + 200, 300 + 100);
    assert.equal(root.getAttribute("arc-resize"), null);
    assert.ok(env.sheets.some(([css]) => css.includes("nwse-resize")));
  });
  test("macOS: no edge resizing (macOS resizes it itself); an edge press drags as before", () => {
    const env = load();
    env.edgeDrag(W - 3, H - 3, steps(16, 9));
    assert.equal(env.resizes.length, 0);
    assert.ok(env.moves.length > 0);
    assert.ok(!env.sheets.some(([css]) => css.includes("resize")));
  });
});

// From the owner's log (1.2.7): let go with the cursor at the right screen edge and the
// window mostly past it; as it slid back, macOS shrank it frame by frame to 33 x 19
// at that edge.
describe("mouse: the PiP keeps its size after you let go", () => {
  const offRight = env => env.drag(line(1000, 300, 3, 0, 125), { holdMs: 100 });   // x 1375, 263 px off

  test("macOS shrinks it while it slides back: size restored, placed on screen", () => {
    const env = load();
    offRight(env);
    for (let i = 0; i < 12; i++) env.frame();      // the slide has started
    env.shrink(Math.round(W * 0.9), Math.round(H * 0.9));
    env.shrink(140, 79);
    env.shrink(33, 19);
    env.settle();
    assert.deepEqual([env.window.outerWidth, env.window.outerHeight], [W, H]);
    assert.deepEqual(env.pos(), [RIGHT, 300]);
  });

  // Owner, 2026-11-17: it started about half a second after letting go. It no longer
  // waits 150 ms (that was for when macOS dragged the window itself).
  test("the slide back starts as soon as you let go", () => {
    const env = load();
    offRight(env);
    const n = env.moves.length;
    env.frame();                                    // the first frame after letting go
    assert.ok(env.moves.length > n, "already moving");
    env.settle();
    assert.deepEqual(env.pos(), [RIGHT, 300]);
  });

  // Owner, 2026-11-17: after it snapped back, resizing the window didn't work: for
  // 3 s the guard undid every size change, yours too. Now only macOS's sliver.
  test("resizing it yourself right after it snapped back is kept", () => {
    const env = load();
    offRight(env);
    env.settle();                                   // back on screen
    env.shrink(500, 281);                           // you drag a corner to make it bigger
    env.settle();
    assert.equal(env.resizes.length, 0, JSON.stringify(env.resizes));
    assert.deepEqual([env.window.outerWidth, env.window.outerHeight], [500, 281]);
    env.shrink(200, 113);                           // and then smaller
    env.settle();
    assert.deepEqual([env.window.outerWidth, env.window.outerHeight], [200, 113]);
  });

  test("resizing it while it slides back: kept, and it still ends up on screen", () => {
    const env = load();
    offRight(env);
    env.frame(); env.frame();                       // sliding
    env.shrink(500, 281);
    env.settle();
    assert.deepEqual([env.window.outerWidth, env.window.outerHeight], [500, 281]);
    const s = env.window.screen;
    assert.ok(env.window.screenX + 500 <= s.availLeft + s.availWidth, `on screen: x ${env.window.screenX}`);
  });

  test("a flick keeps its size too", () => {
    const env = load();
    env.drag(line(1100, 300, 40, 0, 8));            // fast, ends past the right edge
    env.frame(); env.frame();
    env.shrink(100, 56);
    env.settle();
    assert.deepEqual([env.window.outerWidth, env.window.outerHeight], [W, H]);
    assert.equal(env.window.screenX, RIGHT);
  });

  test("resizing it yourself later is left alone", () => {
    const env = load();
    offRight(env);
    for (let i = 0; i < 220; i++) env.frame();      // 3.5 s later
    env.shrink(300, 169);
    env.settle();
    assert.equal(env.resizes.length, 0);
    assert.deepEqual([env.window.outerWidth, env.window.outerHeight], [300, 169]);
  });

  test("gives up after 3 tries instead of fighting forever", () => {
    const env = load();
    offRight(env);
    for (let n = 0; n < 6; n++) { env.shrink(33, 19); for (let i = 0; i < 20; i++) env.frame(); }
    assert.equal(env.resizes.length, 3);
  });

  // Owner's 1.2.8 log: macOS shrank it one step per frame for ~300 ms, starting
  // right after release; restoring on each step used up every try in 50 ms.
  test("macOS's shrink animation: waits for it to end, then restores once", () => {
    const env = load();
    offRight(env);
    let w = W;
    while (w > 33) { w = Math.max(33, Math.round(w * 0.8)); env.shrink(w, Math.round(w * H / W)); env.frame(); }
    env.settle();
    assert.equal(env.resizes.length, 1, JSON.stringify(env.resizes));
    assert.deepEqual([env.window.outerWidth, env.window.outerHeight], [W, H]);
    assert.deepEqual(env.pos(), [RIGHT, 300]);
  });
});
