// ==UserScript==
// @name           Arc toolbar tint
// @description    Colors the top toolbar to match the top edge of the current page,
//                 like Arc. Transparent pages (new tab) let the space gradient show.
// ==/UserScript==

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

(function () {
  if (window.__arcToolbarTint) return;
  window.__arcToolbarTint = true;

  const SCALE = 0.06;          // snapshot scale (tiny = cheap)
  const SETTLE_MS = [150, 1000, 2500];   // samples after load; the last one sticks
  const EDGE_PX = 4;           // how much of the page's top edge to read (CSS px)
  const EDGE_SCALE = 0.5;
  const cache = new WeakMap(); // browser -> last color, so tab switches don't flicker

  const wrapper = () => document.getElementById("zen-appcontent-navbar-wrapper");

  function apply(c) {
    const w = wrapper();
    if (!w) return;
    if (!c) {                                   // unknown → fall back to CSS default
      w.style.removeProperty("--arc-bar-bg");
      w.removeAttribute("arc-tone");
      return;
    }
    if (c.transparent) {                        // e.g. new tab: tinted glass over the gradient
      // Same translucent tint Zen uses for transparent pages, so the toolbar
      // reads as the top of the page card (like Arc's new tab)
      w.style.setProperty("--arc-bar-bg",
        "light-dark(rgba(255, 255, 255, 0.6), rgba(255, 255, 255, 0.1))");
      w.setAttribute("arc-tone", "theme");
      return;
    }
    const { r, g, b } = c;
    w.style.setProperty("--arc-bar-bg", `rgb(${r} ${g} ${b})`);
    // Relative luminance → pick readable icon/text color
    const lin = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
    const L = 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
    w.setAttribute("arc-tone", L > 0.4 ? "light" : "dark");
  }

  // Pages Zen renders with a see-through background (new tab etc.)
  function isTransparentPage(browser) {
    if (browser.getAttribute("transparent") === "true") return true;
    const spec = browser.currentURI?.spec || "";
    return spec === "about:blank" || spec === "about:newtab" || spec === "about:home" ||
           !!window.isBlankPageURL?.(spec);
  }

  // Most common (quantized) opaque color in a block of RGBA pixels
  function dominant(data) {
    const counts = new Map();
    let opaque = 0, total = 0;
    for (let i = 0; i < data.length; i += 4) {
      total++;
      if (data[i + 3] < 128) continue;
      opaque++;
      const key = ((data[i] >> 3) << 10) | ((data[i + 1] >> 3) << 5) | (data[i + 2] >> 3);
      const e = counts.get(key);
      if (e) { e.n++; e.r += data[i]; e.g += data[i + 1]; e.b += data[i + 2]; }
      else counts.set(key, { n: 1, r: data[i], g: data[i + 1], b: data[i + 2] });
    }
    let best = null;
    for (const e of counts.values()) if (!best || e.n > best.n) best = e;
    return { best, opaque, total };
  }

  async function sample(browser = gBrowser.selectedBrowser, { background = false } = {}) {
    try {
      const wg = browser?.browsingContext?.currentWindowGlobal;
      if (!wg) {
        if (browser === gBrowser.selectedBrowser) apply(cache.get(browser) ?? null);
        return;
      }
      let color;
      if (isTransparentPage(browser)) {
        color = { transparent: true };
      } else {
        // 1) The page's top edge (first few CSS px), like Arc — this is the
        //    page/header background before search boxes, buttons, etc. start.
        const w = Math.max(1, browser.clientWidth || 1000);
        const edge = await wg.drawSnapshot(new DOMRect(0, 0, w, EDGE_PX), EDGE_SCALE, "rgba(0,0,0,0)");
        if (!background && browser !== gBrowser.selectedBrowser) { edge.close?.(); return; }
        {
          const ecv = new OffscreenCanvas(edge.width, edge.height);
          const ectx = ecv.getContext("2d", { willReadFrequently: true });
          ectx.drawImage(edge, 0, 0);
          edge.close?.();
          const d = dominant(ectx.getImageData(0, 0, ecv.width, ecv.height).data);
          if (d.best && d.opaque > d.total / 2) {
            color = { r: Math.round(d.best.r / d.best.n), g: Math.round(d.best.g / d.best.n), b: Math.round(d.best.b / d.best.n) };
          }
        }
      }
      if (!color) {
        // 2) Top edge see-through: scan the low-res viewport downward
        const bmp = await wg.drawSnapshot(null, SCALE, "rgba(0,0,0,0)");
        if (!background && browser !== gBrowser.selectedBrowser) { bmp.close?.(); return; }
        const cv = new OffscreenCanvas(bmp.width, bmp.height);
        const ctx = cv.getContext("2d", { willReadFrequently: true });
        ctx.drawImage(bmp, 0, 0);
        bmp.close?.();

        // Walk down from the top in thin bands until one is mostly painted.
        // (Some sites leave the very top see-through and paint their header
        // inside it, which would otherwise read as "transparent".)
        const band = 2, maxRow = Math.max(band, Math.floor(cv.height * 0.35));
        for (let y = 0; y < maxRow; y += band) {
          const { data } = ctx.getImageData(0, y, cv.width, Math.min(band, cv.height - y));
          const d = dominant(data);
          if (d.best && d.opaque > d.total / 2) {
            color = { r: Math.round(d.best.r / d.best.n), g: Math.round(d.best.g / d.best.n), b: Math.round(d.best.b / d.best.n) };
            break;
          }
        }
        if (!color) {
          // Nothing painted near the top: use the browser's own page background
          const dark = matchMedia("(prefers-color-scheme: dark)").matches;
          color = dark ? { r: 32, g: 32, b: 32 } : { r: 255, g: 255, b: 255 };
        }
      }
      cache.set(browser, color);
      if (browser === gBrowser.selectedBrowser) apply(color);
    } catch (e) {
      // Privileged/unloaded pages can refuse snapshots; keep the last known color.
      if (browser === gBrowser.selectedBrowser) apply(cache.get(browser) ?? null);
    }
  }

  // Sample once per page load (when it finishes loading), then keep that color.
  // Tab switches reuse the stored color; nothing re-samples while you browse.
  const pending = new WeakSet();   // browsers whose new page hasn't been sampled yet

  gBrowser.tabContainer.addEventListener("TabSelect", () => {
    const b = gBrowser.selectedBrowser;
    if (cache.has(b)) apply(cache.get(b));
    else setTimeout(() => sample(b), 60);       // never sampled (e.g. restored tab)
  });

  gBrowser.addTabsProgressListener({
    onLocationChange(browser, webProgress, request, location, flags) {
      if (!webProgress?.isTopLevel) return;
      if (flags & Ci.nsIWebProgressListener.LOCATION_CHANGE_SAME_DOCUMENT) return; // SPA route/hash change
      pending.add(browser);
    },
    onStateChange(browser, webProgress, req, flags) {
      if (!webProgress?.isTopLevel) return;
      if ((flags & Ci.nsIWebProgressListener.STATE_STOP) &&
          (flags & Ci.nsIWebProgressListener.STATE_IS_WINDOW) &&
          pending.has(browser)) {
        pending.delete(browser);
        // Sample a few times while the page settles (apps like Gmail show a
        // loading screen first), then keep the last result for this page.
        for (const ms of SETTLE_MS) {
          setTimeout(() => {
            if (browser === gBrowser.selectedBrowser) sample(browser);
            else sampleInBackground(browser);
          }, ms);
        }
      }
    },
  });

  // Background tabs: sample them too so switching to them shows the right color.
  function sampleInBackground(browser) {
    return sample(browser, { background: true });
  }

  setTimeout(() => sample(), 500);   // current tab at startup
})();
