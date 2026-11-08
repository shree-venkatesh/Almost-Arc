// ==UserScript==
// @name           Arc hidden-sidebar layout
// @description    In compact (hidden sidebar) mode with a top toolbar, keep the window
//                 buttons and top buttons inside the pop-out sidebar instead of the
//                 toolbar — like Arc. The toolbar then starts flush with no gap.
// ==/UserScript==

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

(function () {
  if (window.__arcCompactSidebar) return;
  window.__arcCompactSidebar = true;

  function relocate() {
    try {
      const root = document.documentElement;
      const compact = root.getAttribute("zen-compact-mode") === "true";
      const single = root.getAttribute("zen-single-toolbar") === "true";
      if (!compact || single) return;

      const vtm = window.gZenVerticalTabsManager;
      const titlebar = document.getElementById("titlebar");
      const topButtons = document.getElementById("zen-sidebar-top-buttons");
      const windowButtons = vtm?.actualWindowButtons;
      if (!titlebar || !topButtons || !windowButtons) return;
      if (vtm.isWindowsStyledButtons || root.getAttribute("zen-right-side") === "true") return; // macOS, left sidebar only

      if (topButtons.parentElement !== titlebar || titlebar.firstElementChild !== topButtons) {
        titlebar.prepend(topButtons);
      }
      if (windowButtons.parentElement !== topButtons || topButtons.firstElementChild !== windowButtons) {
        topButtons.prepend(windowButtons);
      }
      root.setAttribute("arc-compact-sidebar", "true");
      ensureToolbarToggle();
    } catch (e) {
      console.error("[arcCompactSidebar]", e);
    }
  }

  // Arc also keeps a sidebar button at the start of the toolbar.
  function ensureToolbarToggle() {
    const navBar = document.getElementById("nav-bar");
    if (!navBar || document.getElementById("arc-toolbar-sidebar-toggle")) return;
    const btn = document.createXULElement("toolbarbutton");
    btn.id = "arc-toolbar-sidebar-toggle";
    btn.className = "toolbarbutton-1 chromeclass-toolbar-additional";
    btn.setAttribute("command", "cmd_toggleCompactModeIgnoreHover");
    btn.setAttribute("tooltiptext", "Toggle sidebar");
    navBar.prepend(btn);
  }

  function hook() {
    const vtm = window.gZenVerticalTabsManager;
    if (!vtm?._updateEvent) return false;
    const orig = vtm._updateEvent.bind(vtm);
    vtm._updateEvent = function (...args) {
      const r = orig(...args);
      const root = document.documentElement;
      if (root.getAttribute("zen-compact-mode") !== "true") root.removeAttribute("arc-compact-sidebar");
      relocate();
      return r;
    };
    relocate();
    return true;
  }

  if (!hook()) {
    const t = setInterval(() => { if (hook()) clearInterval(t); }, 250);
    setTimeout(() => clearInterval(t), 15000);
  }
  window.addEventListener("ZenCompactMode:LayoutUpdate", () => setTimeout(relocate, 0));
})();
