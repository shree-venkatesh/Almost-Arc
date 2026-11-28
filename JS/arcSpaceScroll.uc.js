// ==UserScript==
// @name           Space scrolling stops at the ends, like Arc
// @description    Zen's mouse-wheel space switching (a mouse's horizontal wheel over the
//                 sidebar, or the vertical one with Zen's modifier key) loops: past the
//                 first space it jumps to the last. A trackpad swipe there opens Zen's
//                 Library (spaces, routing, downloads…) instead. This makes the wheel do
//                 the same: past the space next to the Library it opens the Library,
//                 back the other way (over the Library or the sidebar) closes it, back
//                 on that space, and past the other end nothing happens.
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

  // Zen's own numbers (ZenSpaceManager.mjs #setupSidebarHandlers, Zen 1.24.3b): one
  // switch per 200 ms, and only line-based wheel events (a mouse, not a trackpad, whose
  // swipes go through ZenSpacesSwipe).
  const COOLDOWN_MS = 200;
  let last = 0;

  let library = null;
  function Library() {
    if (library === null) {
      try {
        library = ChromeUtils.importESModule("moz-src:///zen/library/ZenLibrary.mjs", { global: "current" }).ZenLibrary || false;
      } catch (e) { library = false; }
    }
    return library || null;
  }

  // Which way Zen would move for this event: -1 (previous space), +1 (next), or 0 for an
  // event Zen's wheel handler ignores. Same checks as Zen's.
  function offsetOf(e, ws) {
    if (e.deltaMode !== 1) return 0;
    const vertical = e.deltaY && !e.deltaX;
    if (vertical) {
      const keys = { ctrl: e.ctrlKey, alt: e.altKey, shift: e.shiftKey, meta: e.metaKey };
      const method = ws.activationMethod ?? "ctrl";
      if (method in keys && !keys[method]) return 0;
    }
    const delta = vertical ? e.deltaY : e.deltaX;
    if (Math.abs(delta) < 1) return 0;
    return (delta > 0 ? 1 : -1) * (ws.naturalScroll ? -1 : 1);
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
    const offset = offsetOf(e, ws);
    if (!offset) return;

    let spaces, index;
    try {
      spaces = ws.getWorkspaces();
      index = spaces.indexOf(ws.getActiveWorkspace());
    } catch (err) { return; }
    if (!Array.isArray(spaces) || index < 0) return;

    const libOnRight = !!lib?.libraryOnRight;
    const towardsLibrary = libOnRight ? offset > 0 : offset < 0;
    const atEnd = index + offset < 0 || index + offset > spaces.length - 1;
    if (!libOpen && !atEnd) {
      // Zen switches spaces: keep our clock in step with its cooldown
      if (Date.now() - last >= COOLDOWN_MS) last = Date.now();
      return;
    }

    // Ours from here: Zen's handler (capture, on the toolbox) never sees it
    e.preventDefault();
    e.stopPropagation();
    const now = Date.now();
    if (now - last < COOLDOWN_MS) return;
    last = now;
    if (ws.isChangingWorkspace) return;

    try {
      if (libOpen) {
        if (!towardsLibrary) lib.close();
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
