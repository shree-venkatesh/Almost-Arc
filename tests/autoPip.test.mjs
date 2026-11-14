// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// Auto-PiP (JS/arcAutoPip.uc.js): when it must and must not pop a video out.
// Run: node --test tests/

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { loadAutoPip } from "./harness.mjs";

const TOGGLE = "PictureInPictureLauncher:PictureInPicture:AutoToggle";
const popped = env => env.toggles.includes(TOGGLE);
const why = env => `log:\n  ${env.logs.join("\n  ")}`;

describe("pops out when you leave Zen for another app", () => {
  test("clicking another app (Cmd+Tab, Dock click, window click)", async () => {
    const env = await loadAutoPip({ front: "safari" });
    await env.deactivate();
    assert.ok(popped(env), why(env));
  });

  test("switching to another desktop (Space): an app there becomes the front app", async () => {
    const env = await loadAutoPip({ front: "finder" });
    await env.deactivate();
    assert.ok(popped(env), why(env));
  });

  test("macOS reports the new front app late: second look 40 ms later", async () => {
    const env = await loadAutoPip({ front: ["zen", "slack"] });
    await env.deactivate();
    assert.ok(popped(env), why(env));
  });

  test("asks for PiP only once per switch", async () => {
    const env = await loadAutoPip({ front: "safari" });
    await env.deactivate();
    assert.equal(env.toggles.length, 1);
  });
});

describe("does not pop out for system UI (hard constraint 3)", () => {
  for (const app of ["controlCenter", "notifications", "spotlight", "screenshot", "dock",
                     "stageManager", "emojiPicker", "loginWindow", "helper"]) {
    test(app, async () => {
      const env = await loadAutoPip({ front: app });
      await env.deactivate();
      assert.ok(!popped(env), why(env));
    });
    if (app !== "helper") test(`${app}, even when macOS calls it a normal app`, async () => {
      const env = await loadAutoPip({ front: app, allForeground: true });
      await env.deactivate();
      assert.ok(!popped(env), why(env));
    });
  }
});

describe("does not pop out when focus stays in Zen", () => {
  test("Zen is still the front app after the second look", async () => {
    const env = await loadAutoPip({ front: "zen" });
    await env.deactivate();
    assert.ok(!popped(env), why(env));
  });

  test("focus moved to another Zen window", async () => {
    const env = await loadAutoPip({ activeWindow: "zenWindow" });
    await env.deactivate();
    assert.ok(!popped(env), why(env));
    assert.equal(env.calls.lsappinfo.filter(c => c !== "find pid=4242").length, 0, "no lsappinfo lookup needed");
  });

  test("focus moved to the PiP player", async () => {
    const env = await loadAutoPip({ activeWindow: "pip" });
    await env.deactivate();
    assert.ok(!popped(env), why(env));
  });

  test("you came back before the lookup finished", async () => {
    const env = await loadAutoPip({ front: "safari" });
    await env.deactivateThenReturnQuickly();
    assert.ok(!popped(env), why(env));
  });
});

describe("does not pop out when there's nothing to pop", () => {
  const cases = {
    "no sound playing": { tab: { soundplaying: false } },
    "tab muted": { tab: { muted: true } },
    "video already in PiP": { tab: { pictureinpicture: true } },
    "already auto-PiP'd by Firefox": { tab: { autoPipped: true } },
    "video is fullscreen": { win: { fullscreen: true } },
    "Zen minimized (Firefox's own auto-PiP handles it)": { win: { windowState: 2 } },
    "Zen fully covered (Firefox's own auto-PiP handles it)": { win: { isFullyOccluded: true } },
  };
  for (const [name, opts] of Object.entries(cases)) {
    test(name, async () => {
      const env = await loadAutoPip({ front: "safari", ...opts });
      await env.deactivate();
      assert.ok(!popped(env), why(env));
    });
  }
});

describe("closes its PiP when you come back", () => {
  test("closes the PiP it opened", async () => {
    const env = await loadAutoPip({ front: "safari" });
    await env.deactivate();
    assert.equal(env.pipList.length, 1);
    env.activate();
    assert.equal(env.pipList.length, 0, why(env));
  });

  test("closes it through Firefox, so switching tabs still auto-PiPs afterwards", async () => {
    const env = await loadAutoPip({ front: "safari" });
    await env.deactivate();
    env.activate();
    assert.equal(env.pipList.length, 0);
    assert.ok(!env.tabStuckInPip, "Firefox still thinks the tab is in PiP: tab-switch auto-PiP breaks");
  });

  test("older Firefox without closeFromForeground: still closes the window", async () => {
    const env = await loadAutoPip({ front: "safari", oldPlayer: true });
    await env.deactivate();
    env.activate();
    assert.equal(env.pipList.length, 0, why(env));
  });

  test("leaves a PiP that was already open (opened by hand)", async () => {
    const env = await loadAutoPip({ front: "safari", openOnToggle: false });
    const manual = env.existingPip();
    await env.deactivate();
    env.activate();
    assert.ok(!manual.closed, why(env));
  });

  test("leaves another tab's PiP", async () => {
    const env = await loadAutoPip({ front: "safari" });
    await env.deactivate();
    const other = env.existingPip({ another: "tab" });
    env.activate();
    assert.ok(!other.closed, why(env));
    assert.equal(env.pipList.length, 1);
  });

  test("closes nothing when it didn't open a PiP", async () => {
    const env = await loadAutoPip({ front: "spotlight" });
    const manual = env.existingPip();
    await env.deactivate();
    env.activate();
    assert.ok(!manual.closed);
  });

  test("closes it only once (a second return does nothing)", async () => {
    const env = await loadAutoPip({ front: "safari" });
    await env.deactivate();
    env.activate();
    const later = env.existingPip();
    env.activate();
    assert.ok(!later.closed);
  });
});

describe("settings and platform", () => {
  test("off with almost-arc.pip-on-blur = false", async () => {
    const env = await loadAutoPip({ prefs: { "almost-arc.pip-on-blur": false } });
    assert.ok(!env.hasListeners);
  });

  test("macOS only", async () => {
    const env = await loadAutoPip({ platform: "linux" });
    assert.ok(!env.hasListeners);
  });

  test("1.0.0 setting arc-toolbar.pip-on-blur = false is carried over", async () => {
    const env = await loadAutoPip({ prefs: { "arc-toolbar.pip-on-blur": false } });
    assert.ok(!env.hasListeners);
    assert.equal(env.prefs.get("almost-arc.pip-on-blur"), false);
    assert.ok(!env.prefs.has("arc-toolbar.pip-on-blur"));
  });

  test("lsappinfo failing never pops out and never throws", async () => {
    const env = await loadAutoPip({ lsappinfoFails: true });
    await env.deactivate();
    assert.ok(!popped(env), why(env));
  });
});

// Zen's window in the fake is x 0..1512, y 25..945 (the built-in display).
// A second monitor sits to its right (x 1512..3432) or left (negative x).
describe("multiple monitors / Zen still visible", () => {
  const ZEN = { app: "zen", x: 0, y: 25, w: 1512, h: 920 };

  test("clicking an app on another monitor: no PiP, you can still see the video", async () => {
    const env = await loadAutoPip({ front: "safari", windows: [{ app: "safari", x: 1600, y: 40, w: 1600, h: 1000 }, ZEN] });
    await env.deactivate();
    assert.ok(!popped(env), why(env));
    assert.match(env.lastLog(), /still visible/);
  });

  test("monitor on the left (negative coordinates)", async () => {
    const env = await loadAutoPip({ front: "slack", windows: [{ app: "slack", x: -1920, y: 0, w: 1200, h: 900 }, ZEN] });
    await env.deactivate();
    assert.ok(!popped(env), why(env));
  });

  test("Zen fullscreen on one monitor, app on the other", async () => {
    const env = await loadAutoPip({
      front: "safari", win: { screenX: 0, screenY: 0, outerWidth: 1512, outerHeight: 982 },
      windows: [{ app: "safari", x: 1512, y: 0, w: 2560, h: 1440 }, { app: "zen", x: 0, y: 0, w: 1512, h: 982 }],
    });
    await env.deactivate();
    assert.ok(!popped(env), why(env));
  });

  test("clicking the desktop on another monitor (Finder, no windows)", async () => {
    const env = await loadAutoPip({ front: "finder", windows: [ZEN] });
    await env.deactivate();
    assert.ok(!popped(env), why(env));
  });

  test("app side by side with Zen on the same screen, not overlapping", async () => {
    const env = await loadAutoPip({ front: "safari", win: { outerWidth: 900 },
      windows: [{ app: "safari", x: 900, y: 25, w: 612, h: 920 }, { ...ZEN, w: 900 }] });
    await env.deactivate();
    assert.ok(!popped(env), why(env));
  });

  test("smaller app window over part of Zen, same screen and desktop: no PiP", async () => {
    // covers x 1000..1512, y 200..800: about a fifth of the page
    const env = await loadAutoPip({ front: "safari", windows: [{ app: "safari", x: 1000, y: 200, w: 900, h: 600 }, ZEN] });
    await env.deactivate();
    assert.ok(!popped(env), why(env));
    assert.match(env.lastLog(), /still visible/);
  });

  test("app window over most of Zen (not maximized): pops out", async () => {
    const env = await loadAutoPip({ front: "safari", windows: [{ app: "safari", x: 100, y: 80, w: 1300, h: 820 }, ZEN] });
    await env.deactivate();
    assert.ok(popped(env), why(env));
  });

  test("several windows in front of Zen that together cover most of it: pops out", async () => {
    // each covers about a third of the page; overlapping parts count once
    const env = await loadAutoPip({ front: "safari", windows: [
      { app: "safari", x: 0, y: 25, w: 600, h: 920 }, { app: "slack", x: 500, y: 25, w: 600, h: 920 }, ZEN] });
    await env.deactivate();
    assert.ok(popped(env), why(env));
  });

  test("the same windows behind Zen don't count", async () => {
    const env = await loadAutoPip({ front: "safari", windows: [
      ZEN, { app: "safari", x: 0, y: 25, w: 600, h: 920 }, { app: "slack", x: 500, y: 25, w: 600, h: 920 }] });
    await env.deactivate();
    assert.ok(!popped(env), why(env));
  });

  test("app on another monitor but one of its windows also covers most of Zen: pops out", async () => {
    const env = await loadAutoPip({ front: "safari",
      windows: [{ app: "safari", x: 1600, y: 40, w: 800, h: 600 }, { app: "safari", x: 50, y: 60, w: 1400, h: 860 }, ZEN] });
    await env.deactivate();
    assert.ok(popped(env), why(env));
  });

  test("desktop (Space) switch still animating at first look: pops out after the second look", async () => {
    const env = await loadAutoPip({ front: "finder",
      windows: [[{ app: "finder", x: 1600, y: 40, w: 800, h: 600 }, ZEN],   // first look: Zen still on screen
                [{ app: "finder", x: 1600, y: 40, w: 800, h: 600 }]] });    // after the animation: gone
    await env.deactivate();
    assert.ok(popped(env), why(env));
    assert.equal(env.calls.osascript, 2);
  });

  test("desktop (Space) switch: Zen already off screen, pops out right away", async () => {
    const env = await loadAutoPip({ front: "finder", windows: [{ app: "finder", x: 300, y: 40, w: 800, h: 600 }] });
    await env.deactivate();
    assert.ok(popped(env), why(env));
    assert.equal(env.calls.osascript, 1);
  });

  test("window lookup fails: pops out as before", async () => {
    const env = await loadAutoPip({ front: "safari", windows: "fail" });
    await env.deactivate();
    assert.ok(popped(env), why(env));
  });

  test("you come back during the second look: no PiP", async () => {
    const env = await loadAutoPip({ front: "safari", windows: [{ app: "safari", x: 1600, y: 40, w: 800, h: 600 }, ZEN] });
    const p = env.deactivate();
    await new Promise(r => setTimeout(r, 100));
    env.activate();
    await p;
    assert.ok(!popped(env), why(env));
  });

  test("system UI on the other monitor still never triggers it", async () => {
    const env = await loadAutoPip({ front: "controlCenter", windows: [ZEN] });
    await env.deactivate();
    assert.ok(!popped(env), why(env));
    assert.equal(env.calls.osascript, 0, "no window lookup needed");
  });
});
