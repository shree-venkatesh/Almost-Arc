// ==UserScript==
// @name           Arc-style color wheel for Zen's space themes
// @description    Zen's space theme picker, mapped like Arc's: the angle picks the hue,
//                 and the distance from the center goes from near-black, through the
//                 full color, to a light (pastel) version of the same hue at the edge.
//                 Zen's own turns every hue white at the edge (or grey, for a dot from
//                 a preset). Preset swatches still give their exact color. Saved themes
//                 keep their colors (Zen saves the color, not the dot's position). The
//                 wheel itself is left as Zen draws it (a painted one looked bad).
//                 Pref: almost-arc.arc-color-wheel (default true)
// ==/UserScript==

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

(function () {
  if (window.__arcColorWheel) return;
  window.__arcColorWheel = true;

  const PREF = "almost-arc.arc-color-wheel";
  try { Services.prefs.getDefaultBranch("").setBoolPref(PREF, true); } catch (e) {}
  if (!Services.prefs.getBoolPref(PREF, true)) return;

  const PANEL_ID = "PanelUI-zen-gradient-generator";
  const PRESETS_ID = "PanelUI-zen-gradient-generator-color-pages";

  // Arc's map. t = distance from the center, 0 (center) to 1 (edge of the circle the
  // dots can move in). Lightness runs from near-black to a light version of the hue;
  // the curve keeps the dark-to-full-color part wide (full color about 80% of the way
  // out) and the edge only mildly light, never near white (owner, 2026-11-17).
  // Saturation stays high, so the edge keeps its hue.
  const L_CENTER = 6, L_EDGE = 72, CURVE = 1.6, SATURATION = 0.9;
  function hslToRgb(h, s, l) {   // h in degrees, s and l in 0..1
    const k = n => (n + h / 30) % 12;
    const a = s * Math.min(l, 1 - l);
    const f = n => l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1));
    return [f(0), f(8), f(4)].map(v => Math.round(Math.min(255, Math.max(0, v * 255))));
  }
  const arcColor = (hue, t) => hslToRgb(hue, SATURATION, (L_CENTER + (L_EDGE - L_CENTER) * t ** CURVE) / 100);

  // A dot's position (its left/top in the wheel, as Zen stores it) -> hue and distance,
  // with Zen's own geometry: the circle the dots can move in is centered in the wheel,
  // with a radius of half its width (ZenGradientGenerator onDotMouseMove).
  function polar(x, y, w, h) {
    const dx = x - w / 2, dy = y - h / 2;
    let hue = Math.atan2(dy, dx) * 180 / Math.PI;
    if (hue < 0) hue += 360;
    return { hue, t: Math.min(Math.hypot(dx, dy) / (w / 2), 1) };
  }

  const wheelOf = picker => picker?.panel?.querySelector?.(".zen-theme-picker-gradient");
  const sizeOf = el => {
    const r = window.windowUtils.getBoundsWithoutFlushing(el);
    return { w: r.width, h: r.height };
  };

  // A preset swatch keeps its exact color: Zen applies it synchronously in its click
  // handler, so this flag (set before it, cleared after the event) covers just that.
  let applyingPreset = false;
  window.addEventListener("click", e => {
    if (!e.target?.closest?.(`#${PRESETS_ID}`)) return;
    applyingPreset = true;
    setTimeout(() => { applyingPreset = false; }, 0);
  }, true);

  function install(picker) {
    if (!picker || picker.__arcColorWheel) return;
    const zens = picker.getColorFromPosition;
    if (typeof zens !== "function") return;   // Zen changed: leave its picker alone
    picker.__arcColorWheel = true;
    picker.getColorFromPosition = function (x, y, type) {
      // Zen's own first: it also keeps its internal lightness up to date
      const zen = zens.call(this, x, y, type);
      if (applyingPreset) return zen;
      try {
        const el = wheelOf(this);
        const { w, h } = el ? sizeOf(el) : {};
        if (!w || !h) return zen;
        const { hue, t } = polar(x, y, w, h);
        return arcColor(hue, t);
      } catch (e) {
        return zen;
      }
    };
  }

  window.addEventListener("popupshowing", e => {
    if (e.target?.id !== PANEL_ID) return;
    try { install(window.gZenThemePicker); } catch (err) { console.warn("[arcColorWheel]", err); }
  }, true);
})();
