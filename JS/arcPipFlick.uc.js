// ==UserScript==
// @name           Arc PiP flick
// @description    Like Arc: a two-finger swipe over the Picture-in-Picture window, or
//                 letting go of it while dragging it fast, sends it to a screen corner
//                 in that direction. Let go slowly and it stays where you put it;
//                 dropped partly off the screen, it slides back to the nearest edge.
//                 One swipe = one move. Mouse wheels that scroll by lines (a normal
//                 wheel, MX Master without smooth scrolling) don't move it.
// @include        chrome://global/content/pictureinpicture/player.xhtml
// ==/UserScript==

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

(function () {
  // List the setting in about:config with its default.
  try {
    Services.prefs.getDefaultBranch("").setBoolPref("almost-arc.pip-flick", true);
  } catch (e) {}
  if (!Services.prefs.getBoolPref("almost-arc.pip-flick", true)) return;
  if (window.__arcPipFlick) return;

  const TRIGGER = 40;   // swipe distance (px of scroll) before it moves
  const AXIS    = 0.4;  // how diagonal a swipe must be to change both side and top/bottom (0-1)
  const MARGIN  = 16;   // gap from the screen edge (px)
  const DUR     = 400;  // glide length (ms)
  const IDLE    = 120;  // ms without scroll events = swipe over
  const FLING   = 0.5;  // px/ms the pointer is moving when you let go of a drag = a flick
  const RECENT  = 100;  // ms before letting go that count for that speed

  // almost-arc.pip-debug: log each scroll's kind and deltas, to tell mice from trackpads
  const DEBUG = Services.prefs.getBoolPref("almost-arc.pip-debug", false);
  const log = msg => {
    if (!DEBUG) return;
    try {
      IOUtils.writeUTF8(PathUtils.join(PathUtils.profileDir, "almost-arc-pip-debug.log"),
        `${new Date().toISOString().slice(11, 23)}  [pipFlick] ${msg}\n`, { mode: "appendOrCreate" }).catch(() => {});
    } catch (e) {}
  };

  let state = "idle", sumX = 0, sumY = 0, prevMag = 0, idle = 0, anim = 0;

  // starts promptly, settles gently into the corner
  const ease = t => 1 - Math.pow(1 - t, 3);

  function glide(dirX, dirY) {
    const s = window.screen, w = window.outerWidth, h = window.outerHeight;
    const left = s.availLeft + MARGIN, right = s.availLeft + s.availWidth - w - MARGIN;
    const top = s.availTop + MARGIN,  bottom = s.availTop + s.availHeight - h - MARGIN;
    // an axis the swipe didn't pick keeps the side it's on now
    const onLeft = window.screenX + w / 2 < s.availLeft + s.availWidth / 2;
    const onTop  = window.screenY + h / 2 < s.availTop + s.availHeight / 2;
    const tx = dirX < 0 ? left : dirX > 0 ? right : (onLeft ? left : right);
    const ty = dirY < 0 ? top  : dirY > 0 ? bottom : (onTop ? top : bottom);
    slideTo(tx, ty);
  }

  // Dropped partly off the screen (no monitor there): slide back to the nearest edge.
  function settle() {
    const s = window.screen, w = window.outerWidth, h = window.outerHeight;
    const x = window.screenX, y = window.screenY;
    const minX = s.availLeft, maxX = s.availLeft + s.availWidth - w;
    const minY = s.availTop,  maxY = s.availTop + s.availHeight - h;
    const tx = x < minX ? minX + MARGIN : x > maxX ? maxX - MARGIN : x;
    const ty = y < minY ? minY + MARGIN : y > maxY ? maxY - MARGIN : y;
    if (tx !== x || ty !== y) slideTo(tx, ty);
  }

  function slideTo(tx, ty) {
    log(`slide to ${tx},${ty} from ${window.screenX},${window.screenY}${drag ? " (while dragging!)" : ""}`);
    if (anim) cancelAnimationFrame(anim);
    const sx = window.screenX, sy = window.screenY, t0 = performance.now();
    const step = now => {
      const t = Math.min(1, (now - t0) / DUR), e = ease(t);
      window.moveTo(Math.round(sx + (tx - sx) * e), Math.round(sy + (ty - sy) * e));
      anim = t < 1 ? requestAnimationFrame(step) : 0;
    };
    anim = requestAnimationFrame(step);
  }

  function onWheel(e) {
    log(`wheel mode=${e.deltaMode} dx=${e.deltaX} dy=${e.deltaY}`);
    // A mouse wheel scrolling by lines: not a swipe, leave the window where it is.
    // macOS sends a trackpad's (and a Magic Mouse's) scrolls in pixels.
    if (e.deltaMode !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    let dx = e.deltaX, dy = e.deltaY;
    dx = -dx; dy = -dy;                              // direction the fingers moved
    const mag = Math.hypot(dx, dy);

    // a fresh swipe while the last one's momentum is still fading
    if (state === "done" && mag > 4 && mag > 2 * prevMag) state = "idle";
    prevMag = mag;

    clearTimeout(idle);
    idle = setTimeout(() => { state = "idle"; }, IDLE);
    if (state === "done") return;                    // rest of this swipe / momentum

    if (state === "idle") { state = "swipe"; sumX = sumY = 0; }
    sumX += dx; sumY += dy;
    const dist = Math.hypot(sumX, sumY);
    if (dist < TRIGGER) return;

    const dirX = Math.abs(sumX) >= AXIS * dist ? Math.sign(sumX) : 0;
    const dirY = Math.abs(sumY) >= AXIS * dist ? Math.sign(sumY) : 0;
    state = "done";
    glide(dirX, dirY);
  }

  // ---- Click and drag ----
  // We move the window ourselves instead of letting macOS drag it: during a native
  // drag Zen hears nothing (no speed, no release), and macOS tiles a window dragged
  // with the cursor at a screen edge, which squashes the PiP. So the video area is
  // made non-draggable and the window follows the pointer.
  const DRAG_MIN = 3;   // px the pointer moves before a press becomes a drag (else it's a click)
  try {
    window.windowUtils.loadSheetUsingURIString("data:text/css;charset=utf-8," + encodeURIComponent(
      "#controls, #controls-bottom-gradient, body { -moz-window-dragging: no-drag !important; }"),
      window.windowUtils.AUTHOR_SHEET);
  } catch (e) { log(`drag sheet failed: ${e}`); }

  // controls keep their clicks; anywhere else on the video drags the window
  const INTERACTIVE = "button, input, select, textarea, a, label, [role], #scrubber, .control-item";
  let drag = null;   // { id, px, py, wx, wy, moved, samples: [[time, px, py]] }
  const where = el => el ? `${el.localName}${el.id ? "#" + el.id : ""}` : "?";
  const dragging = el => { try { return getComputedStyle(el).getPropertyValue("-moz-window-dragging"); } catch (e) { return "?"; } };
  function onDown(e) {
    if (e.button !== 0 || drag || e.target?.closest?.(INTERACTIVE)) return;
    drag = { id: e.pointerId, px: e.screenX, py: e.screenY, wx: window.screenX, wy: window.screenY,
             moved: false, last: null, samples: [[performance.now(), e.screenX, e.screenY]] };
    try { document.documentElement.setPointerCapture(e.pointerId); } catch (err) {}
    if (DEBUG) log(`drag: press on ${where(e.target)} (window dragging there: ${dragging(e.target)}, #controls: ${dragging(document.getElementById?.("controls"))}) at window ${window.screenX},${window.screenY} ${window.outerWidth}x${window.outerHeight}`);
  }
  function onMove(e) {
    if (!drag || e.pointerId !== drag.id) return;
    const dx = e.screenX - drag.px, dy = e.screenY - drag.py;
    // something else moved the window since our last move (macOS's own drag, a constraint)?
    if (DEBUG && drag.last && (window.screenX !== drag.last[0] || window.screenY !== drag.last[1]))
      log(`drag: window is at ${window.screenX},${window.screenY}, not where we put it (${drag.last})`);
    if (!drag.moved) {
      if (Math.hypot(dx, dy) < DRAG_MIN) return;
      drag.moved = true;
      if (DEBUG) log("drag: started");
      if (anim) { cancelAnimationFrame(anim); anim = 0; }   // grabbed mid-glide
      drag.wx = window.screenX; drag.wy = window.screenY;   // where it is now, if a glide moved it
    }
    const now = performance.now();
    drag.samples.push([now, e.screenX, e.screenY]);
    while (drag.samples.length > 2 && drag.samples[1][0] < now - 2 * RECENT) drag.samples.shift();
    drag.last = [drag.wx + (e.screenX - drag.px), drag.wy + (e.screenY - drag.py)];
    window.moveTo(...drag.last);
  }
  function onUp(e) {
    if (!drag || e.pointerId !== drag.id) return;
    const d = drag;
    drag = null;
    try { document.documentElement.releasePointerCapture(e.pointerId); } catch (err) {}
    if (!d.moved) return;                              // a click
    // Cancelled (the system took the pointer): stop following, move nothing. Sliding
    // back on screen only ever happens when you let go of the mouse button.
    if (e.type !== "pointerup") { log(`drag: ${e.type}, stopped following (window at ${window.screenX},${window.screenY})`); return; }
    // how fast the pointer moved over the last RECENT ms (0 if it was held still)
    const now = performance.now();
    const ref = d.samples.find(([t]) => t >= now - RECENT);
    let vx = 0, vy = 0;
    if (ref) {
      const dt = Math.max(now - ref[0], 16);
      vx = (e.screenX - ref[1]) / dt; vy = (e.screenY - ref[2]) / dt;
    }
    const speed = Math.hypot(vx, vy);
    log(`drag let go: ${speed.toFixed(2)} px/ms`);
    if (e.metaKey) return;                             // Firefox's own Cmd+drag corner snap
    if (speed >= FLING) {
      const dirX = Math.abs(vx) >= AXIS * speed ? Math.sign(vx) : 0;
      const dirY = Math.abs(vy) >= AXIS * speed ? Math.sign(vy) : 0;
      glide(dirX, dirY);
    } else {
      settle();
    }
  }

  window.__arcPipFlick = true;
  window.addEventListener("wheel", onWheel, { capture: true, passive: false });
  window.addEventListener("pointerdown", onDown, true);
  window.addEventListener("pointermove", onMove, true);
  window.addEventListener("pointerup", onUp, true);
  window.addEventListener("pointercancel", onUp, true);
  if (DEBUG) {
    window.addEventListener("lostpointercapture", () => log(`drag: lost pointer capture${drag ? " while dragging" : ""}`), true);
    let size = `${window.outerWidth}x${window.outerHeight}`;
    window.addEventListener("resize", () => {
      const now = `${window.outerWidth}x${window.outerHeight}`;
      if (now !== size) log(`window resized ${size} -> ${now}${drag ? " while dragging" : ""} at ${window.screenX},${window.screenY}`);
      size = now;
    });
  }
})();
