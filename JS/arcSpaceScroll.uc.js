// ==UserScript==
// @name           Space scrolling with a mouse wheel, like Arc
// @description    Zen's mouse-wheel space switching (a mouse's horizontal wheel over the
//                 sidebar, or the vertical one with Zen's modifier key) loops: past the
//                 first space it jumps to the last. A trackpad swipe there opens Zen's
//                 Library (spaces, routing, downloads…) instead. This script does all
//                 mouse-wheel space switching itself: the other direction from Zen's
//                 (owner, 2026-11-27), a little less sensitive, no loop. Past the space
//                 next to the Library it opens the Library, back the other way (over the
//                 Library or the sidebar) closes it, back on that space, and past the
//                 other end nothing happens. Trackpad swipes are Zen's, unchanged.
//                 Pref: almost-arc.space-scroll-edges (default true)
// ==/UserScript==

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

(function () {
  if (window.__arcSpaceScroll) return;
  window.__arcSpaceScroll = true;

  const PREF = "almost-arc.space-scroll-edges";
  try { Services.prefs.getDefaultBranch("").setBoolPref(PREF, true); } catch (e) {}

  // Zen's (ZenSpaceManager.mjs #setupSidebarHandlers, Zen 1.24.3b): only line-based
  // wheel events (a mouse; a trackpad's swipes go through ZenSpacesSwipe), one switch per
  // event of 1+ lines, then 200 ms of nothing. Slightly less sensitive here (owner,
  // 2026-11-27): the wheel has to turn 1.5 lines the same way (added up while it keeps
  // turning), and 300 ms between switches.
  const COOLDOWN_MS = 300;
  const THRESHOLD = 1.5;
  const IDLE_MS = 400;           // a pause this long starts the count again
  let last = 0;
  let sum = 0, sumAt = 0;

  let library = null;
  function Library() {
    if (library === null) {
      try {
        library = ChromeUtils.importESModule("moz-src:///zen/library/ZenLibrary.mjs", { global: "current" }).ZenLibrary || false;
      } catch (e) { library = false; }
    }
    return library || null;
  }

  // The wheel's delta for space switching (0: not a space-switching event), with the
  // same checks as Zen's.
  function deltaOf(e, ws) {
    if (e.deltaMode !== 1) return 0;
    const vertical = e.deltaY && !e.deltaX;
    if (vertical) {
      const keys = { ctrl: e.ctrlKey, alt: e.altKey, shift: e.shiftKey, meta: e.metaKey };
      const method = ws.activationMethod ?? "ctrl";
      if (method in keys && !keys[method]) return 0;
    }
    return (vertical ? e.deltaY : e.deltaX) || 0;
  }

  function onWheel(e) {
    if (!Services.prefs.getBoolPref(PREF, true)) return;
    const ws = window.gZenWorkspaces, toolbox = window.gNavToolbox;
    if (!ws || !toolbox || ws.privateWindowOrDisabled || !ws.workspaceEnabled) return;
    const target = e.composedTarget || e.target;
    if (!target) return;
    // Over the sidebar, or over the open Library (a separate <zen-library>, outside the
    // sidebar, so Zen's own handler never sees those: scrolling back did nothing)
    const lib = Library();
    const libOpen = !!lib?.isLibraryOpen;
    const overLibrary = libOpen && !!target.closest?.("zen-library");
    if (!toolbox.contains(target) && !overLibrary) return;
    const delta = deltaOf(e, ws);
    if (!delta) return;

    // All ours: Zen's handler (capture, on the toolbox) never sees it
    e.preventDefault();
    e.stopPropagation();

    const now = Date.now();
    if (now - sumAt > IDLE_MS || Math.sign(delta) !== Math.sign(sum)) sum = 0;
    sum += delta;
    sumAt = now;
    if (Math.abs(sum) < THRESHOLD || now - last < COOLDOWN_MS) return;
    // Zen's direction, reversed (Zen's natural-scroll setting still flips it)
    const offset = (sum > 0 ? -1 : 1) * (ws.naturalScroll ? -1 : 1);
    sum = 0;
    last = now;
    if (ws.isChangingWorkspace) return;

    let spaces, index;
    try {
      spaces = ws.getWorkspaces();
      index = spaces.indexOf(ws.getActiveWorkspace());
    } catch (err) { return; }
    if (!Array.isArray(spaces) || index < 0) return;

    const libOnRight = !!lib?.libraryOnRight;
    const towardsLibrary = libOnRight ? offset > 0 : offset < 0;
    try {
      if (libOpen) {
        if (!towardsLibrary) lib.close();
        return;
      }
      const to = index + offset;
      if (to >= 0 && to < spaces.length) {
        ws.changeWorkspaceShortcut(offset, false, true);   // no wrap
        return;
      }
      if (towardsLibrary && lib && lib.readySwipeOpenLibrary?.()) {
        if (!lib.isLibrarySlightlyOpen) lib.toggle();
      }
      // past the other end (or the Library is off): stay on this space
    } catch (err) { console.error("[arcSpaceScroll]", err); }
  }

  window.addEventListener("wheel", onWheel, { capture: true, passive: false });
})();
