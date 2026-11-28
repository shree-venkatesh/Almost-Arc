// ==UserScript==
// @name           Arc-style color wheel for Zen's space themes
// @description    Zen's space theme picker, mapped like Arc's: the angle picks the hue,
//                 and the distance from the center goes from near-black, through the
//                 full color, to a light (pastel) version of the same hue at the edge.
//                 Zen's own turns every hue white at the edge (or grey, for a dot from
//                 a preset). Preset swatches still give their exact color, with their
//                 dots placed where Arc's map has that color. Saved themes
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

  // White text and icons on lighter theme colors (owner, 2026-11-27: go a little further
  // out on the wheel before they turn black). Zen picks dark mode (white text) when white
  // text would contrast more with the theme's main color than black text, with black's
  // opacity lowered by zen.theme.dark-mode-bias (0.3; only where the window can be
  // translucent, e.g. macOS) - ZenGradientGenerator.mjs shouldBeDarkMode, Zen 1.24.3b.
  // This lowers black's opacity by WHITE_BIAS more: 10 (%) moves the switch about 3-8%
  // of the wheel's radius further out. 0 = Zen's own. Applies on every repaint.
  const WHITE_BIAS = "almost-arc.white-text-bias";
  try { Services.prefs.getDefaultBranch("").setIntPref(WHITE_BIAS, 10); } catch (e) {}
  const TEXT_OPACITY = 0.9;      // Zen's kTextOpacity
  function keepWhiteText(picker) {
    if (!picker || picker.__arcWhiteText) return false;
    const zens = picker.shouldBeDarkMode;
    const needed = ["titleColors", "blendColors", "contrastRatio", "compositeOverUnderlay"];
    if (typeof zens !== "function" || needed.some(m => typeof picker[m] !== "function")) return false;
    picker.__arcWhiteText = true;
    picker.shouldBeDarkMode = function (accent, ...rest) {
      const zen = zens.call(this, accent, ...rest);
      try {
        const extra = Math.min(50, Math.max(0, Services.prefs.getIntPref(WHITE_BIAS, 10))) / 100;
        if (zen || !extra || Services.prefs.getBoolPref("zen.theme.use-system-colors", false)) return zen;
        const translucent = !!this.canBeTransparent;
        const bg = translucent ? accent : this.compositeOverUnderlay(accent);
        const titles = this.titleColors(accent);
        const bias = (translucent ? parseFloat(this.darkModeBias) || 0 : 0) + extra;
        const white = this.blendColors(titles.dark, bg, TEXT_OPACITY * 100);
        const black = this.blendColors(titles.light, bg, Math.max(0, TEXT_OPACITY - bias) * 100);
        return this.contrastRatio(bg, white) > this.contrastRatio(bg, black);
      } catch (e) { return zen; }
    };
    return true;
  }
  // At startup (the window's theme is already painted: paint it again with this), and
  // whenever the picker opens, in case Zen made its picker after this script ran.
  function startWhiteText(tries = 0) {
    const picker = window.gZenThemePicker;
    if (!picker) { if (tries < 20) setTimeout(() => startWhiteText(tries + 1), 500); return; }
    if (!keepWhiteText(picker)) return;
    try {
      const ws = window.gZenWorkspaces?.getActiveWorkspace?.();
      if (ws) picker.onWorkspaceChange(ws, true);
    } catch (e) {}
  }
  startWhiteText();
  window.addEventListener("popupshowing", e => {
    if (e.target?.id === "PanelUI-zen-gradient-generator") try { keepWhiteText(window.gZenThemePicker); } catch (err) {}
  }, true);
  Services.prefs.addObserver(WHITE_BIAS, () => {
    try {
      const ws = window.gZenWorkspaces?.getActiveWorkspace?.();
      if (ws) window.gZenThemePicker?.onWorkspaceChange?.(ws, true);
    } catch (e) {}
  });

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

  // Where on Arc's map a color sits: along the given angle, at the distance whose
  // lightness matches the color's (the edge for anything lighter than the edge).
  const lightnessOf = ([r, g, b]) => (Math.max(r, g, b) + Math.min(r, g, b)) / 2 / 255 * 100;
  function arcSpot(hue, rgb, w, h) {
    const l = Math.min(Math.max((lightnessOf(rgb) - L_CENTER) / (L_EDGE - L_CENTER), 0), 1);
    const t = l ** (1 / CURVE), a = hue * Math.PI / 180;
    return { x: w / 2 + t * (w / 2) * Math.cos(a), y: h / 2 + t * (w / 2) * Math.sin(a) };
  }
  const near = (a, b) => a.reduce((sum, v, i) => sum + Math.abs(v - b[i]), 0) <= 24;

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

  // A preset's dots, moved to Arc's spot for their color: the position they'll get -> the
  // position Zen chose (whose color the preset keeps). Only while Zen applies the preset.
  const presetSpots = new Map();
  const spotKey = (x, y) => `${x}|${y}`;

  function install(picker) {
    if (!picker || picker.__arcColorWheel) return;
    const zens = picker.getColorFromPosition;
    if (typeof zens !== "function") return;   // Zen changed: leave its picker alone
    picker.__arcColorWheel = true;
    picker.getColorFromPosition = function (x, y, type) {
      // Zen's own first: it also keeps its internal lightness up to date
      const zen = zens.call(this, ...(presetSpots.get(spotKey(x, y)) || [x, y]), type);
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

    // A preset keeps its exact colors, but its dots go where Arc's map has those colors,
    // so moving a dot afterwards doesn't jump to another color (owner, 2026-11-19).
    const zenPlace = picker.handleColorPositions;
    if (typeof zenPlace === "function") {
      picker.handleColorPositions = function (positions, ...rest) {
        if (!applyingPreset || !Array.isArray(positions)) return zenPlace.call(this, positions, ...rest);
        let moved = positions;
        try {
          const el = wheelOf(this);
          const { w, h } = el ? sizeOf(el) : {};
          if (w && h) {
            moved = positions.map(d => {
              if (!d?.position) return d;
              const { x, y } = d.position;
              const spot = arcSpot(polar(x, y, w, h).hue, zens.call(this, x, y, d.type), w, h);
              presetSpots.set(spotKey(spot.x, spot.y), [x, y]);
              return { ...d, position: spot };
            });
          }
        } catch (e) { moved = positions; presetSpots.clear(); }
        try { return zenPlace.call(this, moved, ...rest); } finally { presetSpots.clear(); }
      };
    }

    // A space's saved dots, drawn again when the picker opens: one whose saved spot has
    // another color on Arc's map (a preset picked before this fix) goes to its color's spot.
    const zenDot = picker.createDot;
    if (typeof zenDot === "function") {
      picker.createDot = function (color, ...rest) {
        try {
          const c = color?.c, pos = color?.position;
          if (!color.isCustom && Array.isArray(c) && pos && Number.isFinite(pos.x) && Number.isFinite(pos.y)) {
            const el = wheelOf(this);
            let { w, h } = el ? sizeOf(el) : {};
            if (!w || !h) w = h = 364;           // not laid out yet: Zen's own size for it
            const { hue, t } = polar(pos.x, pos.y, w, h);
            if (!near(arcColor(hue, t), c)) color = { ...color, position: arcSpot(hue, c, w, h) };
          }
        } catch (e) {}
        return zenDot.call(this, color, ...rest);
      };
    }
  }

  window.addEventListener("popupshowing", e => {
    if (e.target?.id !== PANEL_ID) return;
    try { install(window.gZenThemePicker); } catch (err) { console.warn("[arcColorWheel]", err); }
  }, true);
})();
