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
  // Wayland doesn't let an app place its own windows (moveTo does nothing there), so
  // the script couldn't move the PiP, and with the system's own drag turned off it
  // couldn't be moved at all. There, leave the PiP to Firefox and the desktop:
  // dragging works as usual, no swipe or fling.
  try {
    const gfx = Cc["@mozilla.org/gfx/info;1"].getService(Ci.nsIGfxInfo);
    // "wayland" only: on "xwayland" (Zen run with GDK_BACKEND=x11) windows can be moved
    if (/^wayland/i.test(gfx.windowProtocol || "")) { window.__arcPipFlick = "off: wayland"; return; }
  } catch (e) {}

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
  function onScreenSpot(w = window.outerWidth, h = window.outerHeight) {
    const s = window.screen, x = window.screenX, y = window.screenY;
    const minX = s.availLeft, maxX = s.availLeft + s.availWidth - w;
    const minY = s.availTop,  maxY = s.availTop + s.availHeight - h;
    return [x < minX ? minX + MARGIN : x > maxX ? maxX - MARGIN : x,
            y < minY ? minY + MARGIN : y > maxY ? maxY - MARGIN : y];
  }
  function settle() {
    const [tx, ty] = onScreenSpot();
    if (tx !== window.screenX || ty !== window.screenY) slideTo(tx, ty);
  }

  // Keep the PiP's size around letting go of a drag. When a window is let go of
  // with the cursor at a screen edge, macOS (window tiling) can shrink it to a
  // sliver at that edge while it slides back (owner's log, 1.2.7). If the size
  // changes then, put it back and place the window on screen in one jump.
  const KEEP_MS = 3000;                 // how long after letting go to guard the size
  const STILL_MS = 200;                 // restore once the size has stopped changing this long
  const SLIVER = 100;                   // px: macOS's squash leaves a side this small (33 x 58);
                                        // a size you set yourself is left alone
  let keep = null;                      // { w, h, until, fixes, timer }
  // macOS animates the shrink over ~300 ms; resizing during it is undone by the next
  // animation frame (1.2.8 log: 3 tries used up in 50 ms). So wait for it to stop,
  // then restore once.
  function onResizeGuard() {
    if (!keep || drag || performance.now() > keep.until) return;
    if (window.outerWidth === keep.w && window.outerHeight === keep.h) return;
    if (anim) { cancelAnimationFrame(anim); anim = 0; }   // a slide can't win against it
    if (keep.timer) cancelAnimationFrame(keep.timer);
    const k = keep, changed = performance.now();
    const tick = now => {
      if (keep !== k || drag) return;
      if (now - changed < STILL_MS) { k.timer = requestAnimationFrame(tick); return; }
      k.timer = 0;
      if (window.outerWidth === k.w && window.outerHeight === k.h) return;
      // resized by you (or anything that isn't macOS's squash): keep it, stop guarding
      if (Math.min(window.outerWidth, window.outerHeight) >= SLIVER) {
        log(`size: now ${window.outerWidth}x${window.outerHeight}, kept (not a squash)`);
        keep = null;
        settle();   // finish putting it on screen if the resize stopped a slide back
        return;
      }
      if (k.fixes++ >= 3) { log("size: gave up restoring"); keep = null; return; }
      log(`size: changed to ${window.outerWidth}x${window.outerHeight} after letting go, restoring ${k.w}x${k.h}`);
      own(); window.resizeTo(k.w, k.h);
      window.moveTo(...onScreenSpot(k.w, k.h));
    };
    k.timer = requestAnimationFrame(tick);
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
  // A user sheet: -moz-window-dragging is a chrome-only property. Firefox drops
  // it from author sheets that aren't chrome:// (1.2.5-1.2.7 used a data: author
  // sheet) and from inline styles (1.2.8), so macOS kept dragging the window
  // under ours (jitter, and tiling squashed it on release at a screen edge).
  // User and agent sheets may use chrome-only properties, and a user !important
  // rule beats player.css's `-moz-window-dragging: drag`.
  try {
    window.windowUtils.loadSheetUsingURIString("data:text/css;charset=utf-8," + encodeURIComponent(
      "#controls, #controls-bottom-gradient, body { -moz-window-dragging: no-drag !important; }"),
      window.windowUtils.USER_SHEET);
    if (DEBUG) log("no native drag: user sheet loaded");
  } catch (e) { log(`no native drag: sheet failed: ${e}`); }

  // ---- Resizing from the edges (Linux) ----
  // The PiP has no title bar or frame. macOS still resizes it from its edges; on
  // Linux in X11 / XWayland the desktop gives such a window no resize border
  // (owner, GNOME, 2026-11-21: resizing did nothing). Firefox's own resize border
  // takes the outer ~15 px before any script hears of it (it worked under twm, not
  // on GNOME in X11 mode), so a press within EDGE px of an edge or corner (in
  // practice the band just inside Firefox's) resizes it here, keeping the video's
  // shape; the cursor shows it.
  const LINUX = (() => { try { return Services.appinfo.OS === "Linux"; } catch (e) { return false; } })();
  const EDGE = 24;       // px from the window's edge that resize
  const MIN_W = 200;     // px: smallest width
  const CURSORS = { n: "ns", s: "ns", e: "ew", w: "ew", nw: "nwse", se: "nwse", ne: "nesw", sw: "nesw" };
  let resize = null;     // { id, edge, px, py, wx, wy, w, h }
  if (LINUX) {
    try {
      window.windowUtils.loadSheetUsingURIString("data:text/css;charset=utf-8," + encodeURIComponent(
        ["ns", "ew", "nwse", "nesw"].map(c => `:root[arc-resize="${c}"], :root[arc-resize="${c}"] * { cursor: ${c}-resize !important; }`).join("\n")),
        window.windowUtils.USER_SHEET);
    } catch (e) { log(`resize cursors: sheet failed: ${e}`); }
  }
  function edgeAt(e) {
    if (!LINUX) return "";
    const x = e.screenX - window.screenX, y = e.screenY - window.screenY, w = window.outerWidth, h = window.outerHeight;
    if (x < 0 || y < 0 || x > w || y > h) return "";
    return (y < EDGE ? "n" : y > h - EDGE ? "s" : "") + (x < EDGE ? "w" : x > w - EDGE ? "e" : "");
  }
  function showCursor(edge) {
    const root = document.documentElement, c = CURSORS[edge] || "";
    if ((root.getAttribute?.("arc-resize") || "") === c) return;
    if (c) root.setAttribute?.("arc-resize", c); else root.removeAttribute?.("arc-resize");
  }
  function resizeTo(e) {
    const r = resize, ratio = r.w / r.h, dx = e.screenX - r.px, dy = e.screenY - r.py;
    let w = r.w + (r.edge.includes("e") ? dx : r.edge.includes("w") ? -dx : 0);
    let h = r.h + (r.edge.includes("s") ? dy : r.edge.includes("n") ? -dy : 0);
    // keep the video's shape: a side edge sets the width, top/bottom the height,
    // a corner whichever you pulled further
    if (!/[ew]/.test(r.edge) || (/[ns]/.test(r.edge) && Math.abs(h - r.h) * ratio > Math.abs(w - r.w))) w = h * ratio;
    w = Math.max(MIN_W, Math.round(w));
    h = Math.round(w / ratio);
    const x = r.edge.includes("w") ? r.wx + r.w - w : r.wx;
    const y = r.edge.includes("n") ? r.wy + r.h - h : r.wy;
    if (w !== window.outerWidth || h !== window.outerHeight) { own(); window.resizeTo(w, h); }
    if (x !== window.screenX || y !== window.screenY) window.moveTo(x, y);
  }

  // ---- Keeping the video's shape (Linux) ----
  // macOS keeps the PiP at the video's aspect ratio while you resize it; GTK
  // desktops don't, so the window took any shape and the video got black bars
  // (owner's GNOME log, 2026-11-21: every resize came from the desktop, none from
  // the edge band). Once a resize by anything else has been still for SHAPE_MS,
  // the window is snapped back to the video's shape, following the side you
  // changed more. The shape: the window's at open, then each size Firefox gives it
  // for a new video (resizeToVideo).
  const SHAPE_MS = 250;
  let ratio = window.outerWidth / window.outerHeight || 16 / 9;
  let ownUntil = 0;          // our own resizes (and Firefox's resizeToVideo) until then
  let shapeFrom = null, shapeAt = 0, shapeTimer = 0;
  const own = (ms = 300) => { ownUntil = performance.now() + ms; };
  if (LINUX && typeof window.resizeToVideo === "function") {
    const orig = window.resizeToVideo;
    window.resizeToVideo = function (rect) {
      if (rect?.width > 0 && rect?.height > 0) ratio = rect.width / rect.height;
      own(500);
      return orig.apply(this, arguments);
    };
  }
  let lastSize = [window.outerWidth, window.outerHeight];
  function onShape() {
    const before = lastSize;
    lastSize = [window.outerWidth, window.outerHeight];
    if (!LINUX || resize || document.fullscreenElement || performance.now() < ownUntil) { shapeFrom = null; return; }
    // resized by the desktop from a press that hasn't become a drag: it's the
    // desktop's resize, not ours to follow
    if (drag && !drag.moved) { log("drag: the desktop is resizing it, stepping aside"); drag = null; }
    if (!shapeFrom) shapeFrom = before;
    shapeAt = performance.now();
    if (shapeTimer) return;
    const tick = now => {
      if (now - shapeAt < SHAPE_MS) { shapeTimer = requestAnimationFrame(tick); return; }
      shapeTimer = 0;
      const from = shapeFrom; shapeFrom = null;
      if (!from || resize || drag?.moved) return;
      let w = window.outerWidth, h = window.outerHeight;
      if (Math.abs(w / h - ratio) < 0.02) return;
      if (Math.abs(w - from[0]) >= Math.abs(h - from[1]) * ratio) h = Math.round(w / ratio);
      else w = Math.round(h * ratio);
      // too big for the screen: fit it
      const s = window.screen;
      if (s?.availWidth && w > s.availWidth) { w = s.availWidth; h = Math.round(w / ratio); }
      if (s?.availHeight && h > s.availHeight) { h = s.availHeight; w = Math.round(h * ratio); }
      w = Math.max(MIN_W, w); h = Math.round(w / ratio);
      log(`shape: ${window.outerWidth}x${window.outerHeight} -> ${w}x${h} (video ${ratio.toFixed(3)})`);
      own();
      window.resizeTo(w, h);
      lastSize = [w, h];
    };
    shapeTimer = requestAnimationFrame(tick);
  }

  // controls keep their clicks; anywhere else on the video drags the window
  const INTERACTIVE = "button, input, select, textarea, a, label, [role], #scrubber, .control-item";
  let drag = null;   // { id, px, py, wx, wy, moved, samples: [[time, px, py]] }
  let seenButtons = false;
  const where = el => el ? `${el.localName}${el.id ? "#" + el.id : ""}` : "?";
  function onDown(e) {
    if (e.button !== 0 || drag?.moved || resize || e.target?.closest?.(INTERACTIVE)) return;   // controls keep their clicks
    const edge = edgeAt(e);
    if (edge) {
      resize = { id: e.pointerId, edge, px: e.screenX, py: e.screenY, wx: window.screenX, wy: window.screenY,
                 w: window.outerWidth, h: window.outerHeight };
      if (anim) { cancelAnimationFrame(anim); anim = 0; }
      if (keep?.timer) cancelAnimationFrame(keep.timer);
      keep = null;
      try { document.documentElement.setPointerCapture(e.pointerId); } catch (err) {}
      log(`resize: from ${edge} at ${window.outerWidth}x${window.outerHeight}`);
      return;
    }
    drag = { id: e.pointerId, px: e.screenX, py: e.screenY, wx: window.screenX, wy: window.screenY,
             w: window.outerWidth, h: window.outerHeight,
             moved: false, last: null, samples: [[performance.now(), e.screenX, e.screenY]] };
    if (keep?.timer) cancelAnimationFrame(keep.timer);
    keep = null;
    // Linux: take the pointer only once it's a drag. GNOME starts its own resize from
    // a press near the edge; holding the pointer from the press fought it and the PiP
    // froze until you let go (owner, 2026-11-21: "lost pointer capture" ~0.1 s after
    // each press, nothing moved).
    if (!LINUX) try { document.documentElement.setPointerCapture(e.pointerId); } catch (err) {}
    if (DEBUG) log(`drag: press on ${where(e.target)} at window ${window.screenX},${window.screenY} ${window.outerWidth}x${window.outerHeight}`);
  }
  function onMove(e) {
    if (resize) { if (e.pointerId === resize.id) resizeTo(e); return; }
    if (!drag) { if (LINUX) showCursor(e.target?.closest?.(INTERACTIVE) ? "" : edgeAt(e)); return; }
    if (e.pointerId !== drag.id) return;
    // the button is up (the desktop had the pointer, so no pointerup reached us).
    // Only once moves have reported a held button: synthetic moves (tests) never do.
    if (e.buttons) seenButtons = true;
    if (!drag.moved && seenButtons && e.buttons === 0) { drag = null; return; }
    const dx = e.screenX - drag.px, dy = e.screenY - drag.py;
    // something else moved the window since our last move (macOS's own drag, a constraint)?
    if (DEBUG && drag.last && (Math.abs(window.screenX - drag.last[0]) > 1 || Math.abs(window.screenY - drag.last[1]) > 1))
      log(`drag: window is at ${window.screenX},${window.screenY}, not where we put it (${drag.last})`);
    if (!drag.moved) {
      if (Math.hypot(dx, dy) < DRAG_MIN) return;
      drag.moved = true;
      if (LINUX) try { document.documentElement.setPointerCapture(e.pointerId); } catch (err) {}
      if (DEBUG) log("drag: started");
      if (anim) { cancelAnimationFrame(anim); anim = 0; }   // grabbed mid-glide
      drag.wx = window.screenX; drag.wy = window.screenY;   // where it is now, if a glide moved it
    }
    const now = performance.now();
    drag.samples.push([now, e.screenX, e.screenY]);
    while (drag.samples.length > 2 && drag.samples[1][0] < now - 2 * RECENT) drag.samples.shift();
    drag.last = [Math.round(drag.wx + (e.screenX - drag.px)), Math.round(drag.wy + (e.screenY - drag.py))];
    window.moveTo(...drag.last);
  }
  function onUp(e) {
    if (resize && e.pointerId === resize.id) {
      resize = null;
      try { document.documentElement.releasePointerCapture(e.pointerId); } catch (err) {}
      log(`resize: now ${window.outerWidth}x${window.outerHeight}`);
      return;
    }
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
    const sc = window.screen;
    log(`drag let go: ${speed.toFixed(2)} px/ms, cursor ${Math.round(e.screenX)},${Math.round(e.screenY)}, window ${window.screenX},${window.screenY} ${window.outerWidth}x${window.outerHeight}, screen ${sc.availLeft},${sc.availTop} ${sc.availWidth}x${sc.availHeight}`);
    keep = { w: d.w, h: d.h, until: performance.now() + KEEP_MS, fixes: 0 };
    if (e.metaKey) return;                             // Firefox's own Cmd+drag corner snap
    if (speed >= FLING) {
      const dirX = Math.abs(vx) >= AXIS * speed ? Math.sign(vx) : 0;
      const dirY = Math.abs(vy) >= AXIS * speed ? Math.sign(vy) : 0;
      glide(dirX, dirY);
    } else {
      settle();   // right away (it waited 150 ms while macOS still dragged the window itself)
    }
  }

  window.__arcPipFlick = true;
  window.addEventListener("wheel", onWheel, { capture: true, passive: false });
  window.addEventListener("pointerdown", onDown, true);
  window.addEventListener("pointermove", onMove, true);
  window.addEventListener("pointerup", onUp, true);
  window.addEventListener("pointercancel", onUp, true);
  window.addEventListener("resize", onResizeGuard);
  window.addEventListener("resize", onShape);
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
