// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// The Almost Arc tab in Zen's settings (JS/arcSettings.uc.js) shows the same
// settings as the Sine page (preferences.json). The script carries its own copy
// of the list (install.sh doesn't install preferences.json); this keeps them equal.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const SRC = readFileSync(new URL("../JS/arcSettings.uc.js", import.meta.url), "utf8");
const PREFS = JSON.parse(readFileSync(new URL("../preferences.json", import.meta.url), "utf8"));
const THEME = JSON.parse(readFileSync(new URL("../theme.json", import.meta.url), "utf8"));

test("the settings tab lists exactly what preferences.json lists", () => {
  const m = SRC.match(/const SETTINGS = (\[[\s\S]*?\n  \]);/);
  assert.ok(m, "SETTINGS list not found in arcSettings.uc.js");
  assert.deepEqual(JSON.parse(m[1]), PREFS, "update SETTINGS in JS/arcSettings.uc.js to match preferences.json");
});

test("Sine loads it into Zen's main window", () => {
  assert.deepEqual(THEME.scripts.JS["arcSettings.uc.js"]?.include, ["chrome://browser/content/browser.xhtml"]);
});
