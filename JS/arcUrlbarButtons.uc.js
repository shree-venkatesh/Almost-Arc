// ==UserScript==
// @name           Arc URL bar buttons
// @description    Move the copy-link button out of the URL pill (just left of it, always
//                 visible) and the site-settings/extensions button out to the right side
//                 of the toolbar, like Arc.
// ==/UserScript==

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

(function () {
  if (window.__arcUrlbarButtons) return;
  window.__arcUrlbarButtons = true;

  function place() {
    const target = document.getElementById("nav-bar-customization-target");
    const urlbarContainer = document.getElementById("urlbar-container");
    const copyBtn = document.getElementById("zen-copy-url-button");
    const siteBtn = document.getElementById("zen-site-data-icon-button");
    if (!target || !urlbarContainer || !copyBtn || !siteBtn) return false;

    for (const el of [copyBtn, siteBtn]) {
      el.setAttribute("skipintoolbarset", "true"); // keep CustomizableUI from touching them
      el.setAttribute("arc-moved", "true");
    }
    // With the static URL pill (arcUrlbarFit.uc.js), the copy button lives inside
    // the URL container so the two are centered together as one unit.
    const pill = document.getElementById("arc-url-pill");
    if (pill && urlbarContainer.contains(pill)) {
      if (pill.previousElementSibling !== copyBtn) pill.before(copyBtn);
    } else if (copyBtn.nextElementSibling !== urlbarContainer) {
      urlbarContainer.before(copyBtn);
    }
    if (siteBtn.parentElement !== target || target.lastElementChild !== siteBtn) target.append(siteBtn);
    return true;
  }

  window.__arcPlaceUrlButtons = () => place();

  // Copy-link confirmation, like Arc: the copy button shows a checkmark for a
  // moment. Covers the button and Cmd+Shift+C (both run cmd_zenCopyCurrentURL).
  // Zen's own "Copied" toast (with Share) still shows.
  let copiedTimer = 0;
  function copied() {
    const btn = document.getElementById("zen-copy-url-button");
    if (!btn) return;
    btn.removeAttribute("arc-copied");
    btn.getBoundingClientRect();   // restart the animation on a quick second copy
    btn.setAttribute("arc-copied", "true");
    clearTimeout(copiedTimer);
    copiedTimer = setTimeout(() => btn.removeAttribute("arc-copied"), 1500);
  }
  document.getElementById("cmd_zenCopyCurrentURL")?.addEventListener("command", copied);

  function run() {
    if (!place()) return false;
    // Re-apply if Zen/CustomizableUI rebuilds the toolbar (layout switch, customize mode)
    const target = document.getElementById("nav-bar-customization-target");
    let pending = false;
    new MutationObserver(() => {
      if (pending) return;
      pending = true;
      setTimeout(() => { pending = false; place(); }, 50);
    }).observe(target, { childList: true });
    window.addEventListener("aftercustomization", () => setTimeout(place, 50));
    return true;
  }

  if (!run()) {
    const t = setInterval(() => { if (run()) clearInterval(t); }, 250);
    setTimeout(() => clearInterval(t), 15000);
  }
})();
