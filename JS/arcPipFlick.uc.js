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
  const FLING   = 0.5;  // px/ms the window is moving when you let go of a drag = a flick
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
  // macOS moves the window itself (Firefox's drag region); Firefox tells us when it
  // starts (draggableregionleftmousedown) and ends (mouseup). In between, note
  // where the window is each frame, to know how fast it was moving when let go.
  let drag = null;   // { samples: [[time, x, y]], raf }
  function track(now) {
    if (!drag) return;
    drag.samples.push([now, window.screenX, window.screenY]);
    while (drag.samples.length > 2 && drag.samples[1][0] < now - 2 * RECENT) drag.samples.shift();
    drag.raf = requestAnimationFrame(track);
  }
  function onDragStart() {
    if (anim) { cancelAnimationFrame(anim); anim = 0; }   // grabbed mid-glide
    drag = { samples: [[performance.now(), window.screenX, window.screenY]], raf: 0 };
    drag.raf = requestAnimationFrame(track);
  }
  function onDragEnd(e) {
    if (!drag) return;
    const { samples, raf } = drag;
    drag = null;
    cancelAnimationFrame(raf);
    if (e.metaKey) return;                            // Firefox's own Cmd+drag corner snap
    const now = performance.now(), x = window.screenX, y = window.screenY;
    const [, x0, y0] = samples[0];
    if (x === x0 && y === y0 && samples.every(([, sx, sy]) => sx === x0 && sy === y0)) return;   // a click
    // where it was RECENT ms ago (or the newest earlier look, if frames were sparse)
    const ref = samples.find(([t]) => t >= now - RECENT) ?? samples[samples.length - 1];
    const dt = Math.max(now - ref[0], 16);
    const vx = (x - ref[1]) / dt, vy = (y - ref[2]) / dt, speed = Math.hypot(vx, vy);
    log(`drag let go: ${speed.toFixed(2)} px/ms`);
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
  window.addEventListener("draggableregionleftmousedown", onDragStart);
  window.addEventListener("mouseup", onDragEnd, true);
})();
