// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// JS/arcNotices.uc.js: the "scripts loaded" mark and the new-release notice.
// Run: node --test 'tests/*.test.mjs'

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const SRC = fs.readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "JS/arcNotices.uc.js"), "utf8");

/**
 * opts:
 *   install   contents of chrome/almost-arc-install.json, or null (Sine: no file)
 *   release   tag of the latest full Release ("v1.1.8")
 *   tags      all tags (newest betas included)
 *   prefs     user pref values
 *   offline   true: fetch fails
 */
async function run(opts = {}) {
  const o = { install: { version: "1.1.8", method: "cli", channel: "release", dir: "/x" },
              release: "v1.1.8", tags: ["v1.1.8", "v1.1.7"], prefs: {}, ...opts };
  const prefs = new Map(Object.entries(o.prefs));
  const defaults = new Map();
  const attrs = {};
  const notices = [];
  const fetched = [];
  const timers = [];
  const ctx = {
    window: {},
    document: { documentElement: { setAttribute: (k, v) => { attrs[k] = v; } } },
    Services: { prefs: {
      getDefaultBranch: () => ({
        setBoolPref: (k, v) => defaults.set(k, v),
        getBoolPref: (k, d) => (defaults.has(k) ? defaults.get(k) : d),
      }),
      getBoolPref: (k, d) => (prefs.has(k) ? prefs.get(k) : defaults.has(k) ? defaults.get(k) : d),
      getStringPref: (k, d) => (prefs.has(k) ? prefs.get(k) : d),
      setStringPref: (k, v) => prefs.set(k, v),
      getIntPref: (k, d) => (prefs.has(k) ? prefs.get(k) : d),
      setIntPref: (k, v) => prefs.set(k, v),
    } },
    PathUtils: { profileDir: "/profile", join: (...p) => p.join("/") },
    IOUtils: { readJSON: async () => { if (!o.install) throw new Error("no file"); return o.install; } },
    fetch: async url => {
      fetched.push(url);
      if (o.offline) throw new Error("offline");
      const body = url.includes("/releases/latest") ? { tag_name: o.release }
                 : url.includes("/tags") ? o.tags.map(name => ({ name })) : null;
      return { ok: !!body, json: async () => body };
    },
    gBrowser: { getNotificationBox: () => null },
    Cc: {}, Ci: {}, openTrustedLinkIn: () => {},
    setTimeout: fn => timers.push(fn),
    Math, Date, String, Number, JSON, Promise, parseInt,
  };
  ctx.window.gNotificationBox = {
    PRIORITY_INFO_MEDIUM: 2,
    appendNotification: async (id, n, buttons) => { notices.push({ id, label: n.label, buttons: buttons.map(b => b.label) }); },
  };
  vm.createContext(ctx);
  vm.runInContext(SRC, ctx, { filename: "arcNotices.uc.js" });
  for (const t of timers.splice(0)) await t();
  await new Promise(r => setImmediate(r));
  return { attrs, notices, fetched, prefs, defaults };
}

describe("scripts-loaded mark", () => {
  test("sets [almost-arc-js] so the CSS notice stays hidden", async () => {
    const r = await run();
    assert.equal(r.attrs["almost-arc-js"], "true");
  });
  test("sets it even with the update notice turned off", async () => {
    const r = await run({ prefs: { "almost-arc.update-notice": false } });
    assert.equal(r.attrs["almost-arc-js"], "true");
  });
});

describe("release channel (Homebrew, curl, git)", () => {
  test("newer Release: shows the notice with almost-arc update", async () => {
    const r = await run({ install: { version: "1.1.7", method: "cli", channel: "release" } });
    assert.equal(r.notices.length, 1);
    assert.match(r.notices[0].label, /1\.1\.8 is out \(you have 1\.1\.7\)/);
    assert.match(r.notices[0].label, /run: almost-arc update$/);
    assert.deepEqual([...r.notices[0].buttons], ["Copy command", "What's new", "Skip this version"]);
  });
  test("ignores newer betas (tags without a Release)", async () => {
    const r = await run({ tags: ["v1.1.9", "v1.1.8"] });
    assert.equal(r.notices.length, 0);
    assert.ok(r.fetched.every(u => u.includes("/releases/latest")));
  });
  test("already up to date: no notice", async () => {
    assert.equal((await run()).notices.length, 0);
  });
  test("on a beta newer than the Release: no notice", async () => {
    const r = await run({ install: { version: "1.1.9", method: "cli", channel: "release" } });
    assert.equal(r.notices.length, 0);
  });
  test("compares numerically (1.1.10 is newer than 1.1.9)", async () => {
    const r = await run({ install: { version: "1.1.9", method: "cli" }, release: "v1.1.10" });
    assert.equal(r.notices.length, 1);
  });
  test("git install: shows the git pull command for its folder", async () => {
    const r = await run({ install: { version: "1.1.7", method: "git", dir: "/Users/me/Almost-Arc" } });
    assert.match(r.notices[0].label, /cd "\/Users\/me\/Almost-Arc" && git pull && \.\/install\.sh/);
  });
  test("installs from before 1.1.9 (no channel field) count as release", async () => {
    const r = await run({ install: { version: "1.1.7", method: "cli" }, tags: ["v1.2.0"] });
    assert.match(r.notices[0].label, /1\.1\.8 is out/);
  });
});

describe("beta channel (installed with --beta)", () => {
  const beta = v => ({ version: v, method: "cli", channel: "beta" });
  test("newer beta tag: shows the notice with almost-arc update --beta", async () => {
    const r = await run({ install: beta("1.1.8"), tags: ["v1.1.8", "v1.1.9", "v1.1.7"] });
    assert.equal(r.notices.length, 1);
    assert.match(r.notices[0].label, /1\.1\.9 is out \(you have 1\.1\.8\)/);
    assert.match(r.notices[0].label, /almost-arc update --beta$/);
    assert.ok(r.fetched.every(u => u.includes("/tags")));
  });
  test("picks the highest version, not the first tag listed", async () => {
    const r = await run({ install: beta("1.1.8"), tags: ["v1.1.9", "v1.1.10", "v1.2.0-rc", "latest"] });
    assert.match(r.notices[0].label, /1\.1\.10 is out/);
  });
  test("up to date: no notice", async () => {
    assert.equal((await run({ install: beta("1.1.9"), tags: ["v1.1.9"] })).notices.length, 0);
  });
  test("keeps its own cache, separate from the release channel", async () => {
    const now = Math.floor(Date.now() / 1000);
    const r = await run({ install: beta("1.1.8"), tags: ["v1.1.9"],
      prefs: { "almost-arc.update-last-check": now, "almost-arc.update-latest": "1.1.8" } });
    assert.equal(r.fetched.length, 1, "checks: the release channel's recent check doesn't count");
    assert.equal(r.prefs.get("almost-arc.update-latest-beta"), "1.1.9");
    assert.equal(r.prefs.get("almost-arc.update-latest"), "1.1.8");
  });
});

describe("when it checks and shows", () => {
  test("at most once a day: uses the cached answer", async () => {
    const now = Math.floor(Date.now() / 1000);
    const r = await run({ install: { version: "1.1.7", method: "cli" },
      prefs: { "almost-arc.update-last-check": now - 3600, "almost-arc.update-latest": "1.1.8" } });
    assert.equal(r.fetched.length, 0);
    assert.equal(r.notices.length, 1);
  });
  test("after a day: checks again", async () => {
    const r = await run({ prefs: { "almost-arc.update-last-check": Math.floor(Date.now() / 1000) - 90000 } });
    assert.equal(r.fetched.length, 1);
  });
  test("Skip this version: no notice for that version", async () => {
    const r = await run({ install: { version: "1.1.7", method: "cli" }, prefs: { "almost-arc.update-skip": "1.1.8" } });
    assert.equal(r.notices.length, 0);
  });
  test("turned off: no check at all", async () => {
    const r = await run({ install: { version: "1.1.7", method: "cli" }, prefs: { "almost-arc.update-notice": false } });
    assert.equal(r.fetched.length, 0);
    assert.equal(r.notices.length, 0);
  });
  test("Sine install (no install file): no check", async () => {
    const r = await run({ install: null });
    assert.equal(r.fetched.length, 0);
  });
  test("offline: no notice, no error", async () => {
    const r = await run({ install: { version: "1.1.7", method: "cli" }, offline: true });
    assert.equal(r.notices.length, 0);
  });
});
