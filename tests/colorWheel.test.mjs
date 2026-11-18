// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// JS/arcColorWheel.uc.js: Zen's space theme picker mapped like Arc's.
// Run: node --test 'tests/*.test.mjs'

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const SRC = fs.readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "JS/arcColorWheel.uc.js"), "utf8");

const PANEL_ID = "PanelUI-zen-gradient-generator";

/**
 * A fake Zen window with the theme picker. opts:
 *   prefs     user pref values
 *   size      the wheel's width and height in CSS px (default 300)
 *   noPicker  true: Zen has no getColorFromPosition (Zen changed)
 */
function load(opts = {}) {
  const o = { prefs: {}, size: 300, ...opts };
  const prefs = new Map(Object.entries(o.prefs));
  const defaults = new Map();
  const Services = {
    prefs: {
      getDefaultBranch: () => ({ setBoolPref: (k, v) => defaults.set(k, v) }),
      getBoolPref: (k, d) => (prefs.has(k) ? prefs.get(k) : defaults.has(k) ? defaults.get(k) : d),
    },
  };
  // the wheel: a square element, with inline styles recorded
  const style = new Map();
  const wheel = { style: { setProperty: (k, v) => style.set(k, v) } };
  const panel = { id: PANEL_ID, querySelector: sel => (sel === ".zen-theme-picker-gradient" ? wheel : null) };
  const zenCalls = [];
  // Zen's own mapping, simplified: white at the edge whatever the hue
  const ZEN_WHITE = [255, 255, 255];
  const picker = { panel };
  if (!o.noPicker) picker.getColorFromPosition = function (x, y, type) { zenCalls.push([x, y, type]); return ZEN_WHITE; };

  const listeners = {};
  const timers = [];
  const window = {
    gZenThemePicker: picker,
    devicePixelRatio: 1,
    addEventListener: (type, fn) => (listeners[type] ||= []).push(fn),
    windowUtils: { getBoundsWithoutFlushing: () => ({ width: o.size, height: o.size }) },
  };
  const context = {
    window, Services,
    console: { warn() {} },
    setTimeout: fn => timers.push(fn),
    Math, JSON, Error, Number, Array,
  };
  vm.createContext(context);
  vm.runInContext(SRC, context, { filename: "arcColorWheel.uc.js" });

  const fire = (type, ev) => (listeners[type] || []).forEach(fn => fn(ev));
  return {
    picker, wheel, style, zenCalls, ZEN_WHITE,
    openPicker() { fire("popupshowing", { target: panel }); fire("popupshown", { target: panel }); },
    /** You click a preset swatch: Zen applies it while the click runs. */
    clickPreset(apply) {
      fire("click", { target: { closest: sel => (sel === "#PanelUI-zen-gradient-generator-color-pages" ? {} : null) } });
      const result = apply();
      timers.splice(0).forEach(fn => fn());   // the click is over
      return result;
    },
    colorAt(x, y) { return [...picker.getColorFromPosition(x, y, undefined)]; },
  };
}

// a color still has a hue (not white, grey or black)
const hued = ([r, g, b]) => Math.max(r, g, b) - Math.min(r, g, b) > 40;
const brightness = ([r, g, b]) => (r + g + b) / 3;

describe("Arc's color map", () => {
  // the wheel is 300 x 300: center (150, 150), the dots move within a radius of 150
  test("the center is near-black", () => {
    const z = load();
    z.openPicker();
    assert.ok(brightness(z.colorAt(150, 150)) < 25, String(z.colorAt(150, 150)));
  });

  // Owner, 2026-11-17: stretch the inner (dark to full color) part out
  test("the full color is about 80% of the way out (red at 0 degrees)", () => {
    const z = load();
    z.openPicker();
    const [r, g, b] = z.colorAt(150 + 0.8 * 150, 150);
    assert.ok(r > 220 && g < 50 && b < 50, String([r, g, b]));
    const half = z.colorAt(150 + 0.5 * 150, 150);
    assert.ok(half[0] < 170, `still darker halfway: ${half}`);
  });

  // Owner, 2026-11-17: less white at the edges
  test("the edge is a light version of the hue, nowhere near white or grey", () => {
    const z = load();
    z.openPicker();
    const edge = [[300, 150], [150, 300], [0, 150], [150, 0]].map(([x, y]) => z.colorAt(x, y));
    for (const c of edge) {
      assert.ok(hued(c) && Math.max(...c) - Math.min(...c) > 100, `strongly hued: ${c}`);
      assert.ok(brightness(c) > 130 && Math.min(...c) < 180, `light, not white: ${c}`);
    }
    assert.equal(new Set(edge.map(String)).size, 4, "a different color in each direction");
  });

  test("going out along one angle only gets lighter", () => {
    const z = load();
    z.openPicker();
    let last = -1;
    for (let d = 0; d <= 150; d += 15) {
      const b = brightness(z.colorAt(150 + d, 150));
      assert.ok(b > last, `at ${d}px: ${b} after ${last}`);
      last = b;
    }
  });

  test("Zen's own mapping still runs first (it keeps Zen's lightness bookkeeping)", () => {
    const z = load();
    z.openPicker();
    z.colorAt(10, 20);
    assert.deepEqual(z.zenCalls, [[10, 20, undefined]]);
  });

  test("a preset swatch keeps its exact color; the wheel is Arc's again right after", () => {
    const z = load();
    z.openPicker();
    assert.deepEqual(z.clickPreset(() => z.colorAt(300, 150)), z.ZEN_WHITE);
    assert.notDeepEqual(z.colorAt(300, 150), z.ZEN_WHITE);
  });
});

describe("the wheel itself", () => {
  // Owner, 2026-11-17: a painted wheel looked bad. Zen draws its own, untouched.
  test("is left as Zen draws it", () => {
    const z = load();
    z.openPicker();
    assert.equal(z.style.size, 0);
  });
});

describe("switched off", () => {
  test("pref almost-arc.arc-color-wheel off: Zen's picker untouched", () => {
    const z = load({ prefs: { "almost-arc.arc-color-wheel": false } });
    z.openPicker();
    assert.deepEqual(z.colorAt(150, 150), z.ZEN_WHITE);
    assert.equal(z.style.size, 0);
  });

  test("Zen changed its picker: nothing breaks", () => {
    const z = load({ noPicker: true });
    assert.doesNotThrow(() => z.openPicker());
    assert.equal(z.picker.getColorFromPosition, undefined);
  });
});
