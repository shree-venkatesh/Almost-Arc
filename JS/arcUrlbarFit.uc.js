// ==UserScript==
// @name           Arc URL pill
// @description    The toolbar pill is a static label showing the current URL (domain
//                 bright, path dimmed), sized to its text. Clicking it just opens
//                 Zen's floating address bar — the pill itself never changes.
// ==/UserScript==

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

(function () {
  if (window.__arcUrlPill) return;
  window.__arcUrlPill = true;

  const XHTML = "http://www.w3.org/1999/xhtml";
  let pill, hostEl, pathEl;

  function build() {
    const container = document.getElementById("urlbar-container");
    if (!container || !gURLBar?.inputField) return false;
    pill = document.getElementById("arc-url-pill");
    if (!pill) {
      pill = document.createElementNS(XHTML, "div");
      pill.id = "arc-url-pill";
      pill.setAttribute("role", "button");
      pill.setAttribute("tabindex", "-1");
      hostEl = document.createElementNS(XHTML, "span");
      hostEl.className = "arc-host";
      pathEl = document.createElementNS(XHTML, "span");
      pathEl.className = "arc-path";
      pill.append(hostEl, pathEl);
      pill.addEventListener("mousedown", e => {
        if (e.button !== 0) return;
        e.preventDefault();
        e.stopPropagation();
        toggleFloating();
      });
    } else {
      hostEl = pill.querySelector(".arc-host");
      pathEl = pill.querySelector(".arc-path");
    }
    // [copy][pill] live in a group that CSS pins to the toolbar's center
    let group = document.getElementById("arc-url-group");
    if (!group) {
      group = document.createElementNS(XHTML, "div");
      group.id = "arc-url-group";
    }
    if (group.parentElement !== container) container.append(group);
    if (pill.parentElement !== group) group.append(pill);
    document.documentElement.setAttribute("arc-url-pill", "true");
    window.__arcPlaceUrlButtons?.();   // pull the copy button in next to the pill
    return true;
  }

  // Click the pill again (while the floating bar is open) to close it
  function toggleFloating() {
    if (gURLBar.hasAttribute("zen-floating-urlbar") || gURLBar.hasAttribute("breakout-extend")) {
      try { gURLBar.handleRevert(); } catch (e) {}
      try { gURLBar.view.close(); } catch (e) {}
      gBrowser.selectedBrowser.focus();
      return;
    }
    openFloating();
  }

  function openFloating() {
    // Same as Cmd+L: opens Zen's floating address bar with the URL selected
    const cmd = document.getElementById("Browser:OpenLocation");
    if (cmd) cmd.doCommand();
    else { gURLBar.focus(); gURLBar.select(); }
  }

  // Firefox/Zen's own trimming of the current page URL for display
  function displayText() {
    const uri = gBrowser.currentURI;
    let spec = "";
    try {
      if (uri && !gBrowser.selectedBrowser?.isBlank?.() &&
          !["about:blank", "about:newtab", "about:home"].includes(uri.spec) &&
          !(window.isBlankPageURL?.(uri.spec))) {
        spec = uri.displaySpec || uri.spec;
      }
    } catch (e) {}
    if (!spec) return "";
    try { return gURLBar._trimValue ? gURLBar._trimValue(spec) : spec; }
    catch (e) { return spec; }
  }

  function update() {
    if (!pill && !build()) return;
    const text = displayText();
    pill.toggleAttribute("empty", !text);
    if (!text) {
      hostEl.textContent = gURLBar.inputField.placeholder || "Search or enter address";
      pathEl.textContent = "";
    } else {
      const m = text.match(/^([^/?#]*)(.*)$/);
      hostEl.textContent = m[1];
      pathEl.textContent = m[2];
    }
    try { pill.style.font = getComputedStyle(gURLBar.inputField).font; } catch (e) {}
    pill.title = gBrowser.currentURI?.spec || "";
  }

  // Keep the centered [copy][pill] group inside the free space between the
  // buttons on the left and the right (it's centered, so the narrower side wins).
  function fitSpace() {
    const navbar = document.getElementById("nav-bar");
    const container = document.getElementById("urlbar-container");
    const group = document.getElementById("arc-url-group");
    if (!navbar || !container || !group) return;
    const nb = navbar.getBoundingClientRect();
    if (!nb.width) return;
    const center = nb.left + nb.width / 2;
    const items = [];
    for (const el of navbar.children) {
      if (el.id === "nav-bar-customization-target") items.push(...el.children);
      else items.push(el);
    }
    let left = nb.left, right = nb.right, after = false;
    for (const el of items) {
      if (el === container) { after = true; continue; }
      const r = el.getBoundingClientRect();
      if (!r.width) continue;
      if (!after) left = Math.max(left, r.right);
      else right = Math.min(right, r.left);
    }
    const GAP = 10;   // breathing room next to the buttons
    const avail = Math.max(60, Math.floor(2 * Math.min(center - left, right - center) - 2 * GAP));
    group.style.setProperty("--arc-url-avail", `${avail}px`);
  }
  let fitRaf = 0;
  const scheduleFit = () => { if (!fitRaf) fitRaf = requestAnimationFrame(() => { fitRaf = 0; fitSpace(); }); };

  const later = () => { update(); scheduleFit(); setTimeout(() => { update(); scheduleFit(); }, 150); };

  function init() {
    if (!build()) return false;
    gBrowser.tabContainer.addEventListener("TabSelect", later);
    const ro = new ResizeObserver(scheduleFit);
    ro.observe(document.getElementById("nav-bar"));
    const target = document.getElementById("nav-bar-customization-target");
    if (target) {
      ro.observe(target);
      new MutationObserver(scheduleFit).observe(target, { childList: true, subtree: true, attributes: true, attributeFilter: ["hidden", "collapsed"] });
    }
    window.addEventListener("resize", scheduleFit);
    gBrowser.addTabsProgressListener({
      onLocationChange(browser) { if (browser === gBrowser.selectedBrowser) later(); },
    });
    later();
    return true;
  }

  if (!init()) {
    const t = setInterval(() => { if (init()) clearInterval(t); }, 250);
    setTimeout(() => clearInterval(t), 15000);
  }
})();
