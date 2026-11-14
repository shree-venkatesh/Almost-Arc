// ==UserScript==
// @name           Arc PiP flick
// @description    Two-finger swipe over the Picture-in-Picture window sends it to a
//                 screen corner in the swipe's direction, like Arc. One swipe = one
//                 move; click and drag still places it anywhere. Mouse wheels that
//                 scroll by lines (a normal wheel, MX Master without smooth
//                 scrolling) don't move it.
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

  window.__arcPipFlick = true;
  window.addEventListener("wheel", onWheel, { capture: true, passive: false });
})();
