// ==UserScript==
// @name           Arc domain-only URL
// @description    Show just the domain (no www., no path) in the URL bar while you're
//                 not typing, like Arc. Full URL comes back when you click into it.
//                 Zen only does this in Single Toolbar mode; this enables it everywhere.
// ==/UserScript==

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

(function () {
  // Off by default (Arc shows the full URL). Toggle in the mod settings or set
  // almost-arc.domain-only = true in about:config.
  // List the setting in about:config with its default, and carry over a value set
  // under the 1.0.0 name (arc-toolbar.domain-only), then remove that.
  try {
    const pref = "almost-arc.domain-only", old = "arc-toolbar.domain-only";
    Services.prefs.getDefaultBranch("").setBoolPref(pref, false);
    if (Services.prefs.prefHasUserValue(old)) {
      if (!Services.prefs.prefHasUserValue(pref)) Services.prefs.setBoolPref(pref, Services.prefs.getBoolPref(old, false));
      Services.prefs.clearUserPref(old);
    }
  } catch (e) {}

  const ENABLED = Services.prefs.getBoolPref("almost-arc.domain-only", false);

  if (!ENABLED || window.__arcDomainOnly) return;
  window.__arcDomainOnly = true;

  function domainOnly(url) {
    if (!/^https?:\/\//.test(url)) return null;          // leave about:, file:, etc. alone
    let host = url.split("/")[2] || url;
    if (host.startsWith("www.")) host = host.slice(4);
    return host;
  }

  function install() {
    const original = gURLBar?._zenTrimURL;
    if (!original) return false;
    gURLBar._zenTrimURL = function (url) {
      if (gURLBar.hasAttribute("breakout-extend") || gURLBar.focused) return url;
      return domainOnly(url) ?? original(url);
    };
    try { gURLBar.setURI(); } catch (e) {}
    return true;
  }

  if (!install()) {
    const t = setInterval(() => { if (install()) clearInterval(t); }, 250);
    setTimeout(() => clearInterval(t), 15000);
  }
})();
