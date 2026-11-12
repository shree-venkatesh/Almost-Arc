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
 *   commands  which almost-arc paths exist (default: /usr/local/bin/almost-arc)
 *   exitCode  what the update command exits with (default 0); "throw": it can't start
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
  const ran = [];          // update commands run: { command, arguments, environment }
  const restarted = [];    // "invalidateCaches", "quit"
  const exists = new Set(o.commands ?? ["/usr/local/bin/almost-arc"]);
  const Subprocess = {
    async call(opts) {
      ran.push(opts);
      if (o.exitCode === "throw") throw new Error("can't start");
      let sent = false;
      return {
        stdout: { readString: async () => (sent ? "" : ((sent = true), "update output\n")) },
        wait: async () => ({ exitCode: o.exitCode ?? 0 }),
        kill() {},
      };
    },
  };
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
    },
    dirsvc: { get: () => ({ path: "/Users/me" }) },
    appinfo: { invalidateCachesOnRestart: () => restarted.push("invalidateCaches") },
    startup: { quit: flags => restarted.push(`quit:${flags}`) },
    },
    PathUtils: { profileDir: "/profile", join: (...p) => p.join("/") },
    IOUtils: {
      readJSON: async () => { if (!o.install) throw new Error("no file"); return o.install; },
      exists: async f => exists.has(f),
      writeUTF8: async () => {},
    },
    ChromeUtils: { importESModule: () => ({ Subprocess }) },
    fetch: async url => {
      fetched.push(url);
      if (o.offline) throw new Error("offline");
      const body = url.includes("/releases/latest") ? { tag_name: o.release }
                 : url.includes("/tags") ? o.tags.map(name => ({ name })) : null;
      return { ok: !!body, json: async () => body };
    },
    gBrowser: { getNotificationBox: () => null },
    Cc: {}, Ci: { nsIFile: {}, nsIAppStartup: { eAttemptQuit: 2, eRestart: 16 } }, openTrustedLinkIn: () => {},
    setTimeout: fn => timers.push(fn), clearTimeout: () => {},
    Math, Date, String, Number, JSON, Promise, parseInt,
  };
  const shown = [];   // notices currently in the bar
  ctx.window.gNotificationBox = {
    PRIORITY_INFO_MEDIUM: 2, PRIORITY_WARNING_MEDIUM: 5,
    getNotificationWithValue: id => shown.find(n => n.id === id) || null,
    removeNotification: n => shown.splice(shown.indexOf(n), 1),
    appendNotification: async (id, n, buttons) => {
      const entry = { id, label: n.label, priority: n.priority, buttons: buttons.map(b => b.label), callbacks: buttons };
      notices.push(entry); shown.push(entry);
    },
  };
  /** Click a button on the notice currently shown; resolves when the work it started is done. */
  async function click(label) {
    const n = shown[shown.length - 1];
    const b = n?.callbacks.find(x => x.label === label);
    assert.ok(b, `no "${label}" button on: ${n?.label}`);
    const kept = b.callback();
    for (let i = 0; i < 20; i++) await new Promise(r => setImmediate(r));
    return kept;
  }
  vm.createContext(ctx);
  vm.runInContext(SRC, ctx, { filename: "arcNotices.uc.js" });
  for (const t of timers.splice(0)) await t();
  await new Promise(r => setImmediate(r));
  return { attrs, notices, fetched, prefs, defaults, ran, restarted, click,
           get current() { return shown[shown.length - 1]; } };
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
    assert.deepEqual([...r.notices[0].buttons], ["Update", "What's new", "Skip this version"]);
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
  test("git install: Update runs git pull and ./install.sh in its folder", async () => {
    const r = await run({ install: { version: "1.1.7", method: "git", dir: "/Users/me/Almost-Arc" } });
    await r.click("Update");
    assert.equal(r.ran[0].command, "/bin/bash");
    assert.match(r.ran[0].arguments[1], /git pull --ff-only && \.\/install\.sh/);
    assert.equal(r.ran[0].arguments[3], "/Users/me/Almost-Arc");
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
    assert.ok(r.fetched.every(u => u.includes("/tags")));
    await r.click("Update");
    assert.deepEqual([...r.ran[0].arguments], ["update", "--beta"]);
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

describe("Update button", () => {
  const older = { install: { version: "1.1.7", method: "cli", channel: "release" } };

  test("runs almost-arc update in the background, with Zen open allowed and no password prompts", async () => {
    const r = await run(older);
    assert.equal(await r.click("Update"), true, "keeps the notice open while it works");
    assert.equal(r.ran.length, 1);
    assert.equal(r.ran[0].command, "/usr/local/bin/almost-arc");
    assert.deepEqual([...r.ran[0].arguments], ["update"]);
    assert.equal(r.ran[0].environment.ALMOST_ARC_FROM_ZEN, "1");
    assert.match(r.ran[0].environment.PATH, /\/opt\/homebrew\/bin/);
  });

  test("shows progress, then offers Restart Zen", async () => {
    const r = await run(older);
    await r.click("Update");
    assert.ok(r.notices.some(n => /Updating Almost Arc to 1\.1\.8/.test(n.label)));
    assert.match(r.current.label, /1\.1\.8 is installed\. Restart Zen/);
    assert.deepEqual([...r.current.buttons], ["Restart Zen", "What's new"]);
  });

  test("Restart Zen clears the startup cache, then restarts", async () => {
    const r = await run(older);
    await r.click("Update");
    await r.click("Restart Zen");
    assert.deepEqual(r.restarted, ["invalidateCaches", "quit:18"]);
  });

  test("Homebrew's almost-arc is preferred when both exist", async () => {
    const r = await run({ ...older, commands: ["/opt/homebrew/bin/almost-arc", "/usr/local/bin/almost-arc"] });
    await r.click("Update");
    assert.equal(r.ran[0].command, "/opt/homebrew/bin/almost-arc");
  });

  test("curl install without the /usr/local/bin link: uses ~/.almost-arc/bin", async () => {
    const r = await run({ ...older, commands: ["/Users/me/.almost-arc/bin/almost-arc"] });
    await r.click("Update");
    assert.equal(r.ran[0].command, "/Users/me/.almost-arc/bin/almost-arc");
  });

  test("update fails: falls back to the Terminal command, with Copy command", async () => {
    const r = await run({ ...older, exitCode: 1 });
    await r.click("Update");
    assert.match(r.current.label, /Couldn't update Almost Arc \(exit code 1/);
    assert.match(r.current.label, /run in Terminal: almost-arc update$/);
    assert.deepEqual([...r.current.buttons], ["Copy command", "What's new"]);
    assert.equal(r.restarted.length, 0);
  });

  test("command can't start: same fallback", async () => {
    const r = await run({ ...older, exitCode: "throw" });
    await r.click("Update");
    assert.match(r.current.label, /Couldn't update Almost Arc \(can't start\)/);
  });

  test("no almost-arc command found: fallback, nothing run", async () => {
    const r = await run({ ...older, commands: [] });
    await r.click("Update");
    assert.equal(r.ran.length, 0);
    assert.match(r.current.label, /wasn't found/);
  });

  test("clicking Update twice runs it once", async () => {
    const r = await run(older);
    const n = r.current;
    n.callbacks[0].callback(); n.callbacks[0].callback();
    for (let i = 0; i < 20; i++) await new Promise(res => setImmediate(res));
    assert.equal(r.ran.length, 1);
  });

  test("only one notice in the bar at a time", async () => {
    const r = await run(older);
    await r.click("Update");
    assert.equal(r.notices.filter(n => n === r.current).length, 1);
  });
});
