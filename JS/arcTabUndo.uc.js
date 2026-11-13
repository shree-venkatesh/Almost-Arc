// ==UserScript==
// @name           Arc-style Cmd+Z for tabs (safe version)
// @description    Cmd+Z (Ctrl+Z elsewhere) undoes YOUR last tab change from this session:
//                 closing tabs, moving tabs (incl. pinned tabs / folders), pin/unpin.
//                 Safeguards:
//                   1. only changes made right after your own click/drag/keypress count
//                      (Zen's own restores/syncs are never recorded)
//                   2. nothing is recorded until Zen has fully restored the session
//                   3. a single undo that would move, pin or unpin more than a few tabs
//                      is refused. Reopening closed tabs only (e.g. after Zen's Clear) has
//                      no limit beyond Firefox's recently-closed list; above the limit
//                      they're only reopened, not moved back into folders or pinned
//                   4. the session file is backed up before every undo
//                 Only this session's actions; a reopened tab must match the one you closed.
//                 Pref: almost-arc.tab-undo (default true)
// ==/UserScript==

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

(function () {
  if (window.__arcTabUndo) return;
  window.__arcTabUndo = true;

  // List this script's settings in about:config with their defaults, and carry over
  // values set under the 1.0.0 names (arc-toolbar.*), then remove those.
  for (const [name, def] of [["tab-undo", true], ["undo-debug", false]]) {
    try {
      const pref = `almost-arc.${name}`, old = `arc-toolbar.${name}`;
      Services.prefs.getDefaultBranch("").setBoolPref(pref, def);
      if (Services.prefs.prefHasUserValue(old)) {
        if (!Services.prefs.prefHasUserValue(pref)) Services.prefs.setBoolPref(pref, Services.prefs.getBoolPref(old, def));
        Services.prefs.clearUserPref(old);
      }
    } catch (e) {}
  }

  if (!Services.prefs.getBoolPref("almost-arc.tab-undo", true)) return;

  const { SessionStore } = ChromeUtils.importESModule("moz-src:///browser/components/sessionstore/SessionStore.sys.mjs");

  const MAX_STEPS = 50;
  const MAX_TABS_PER_UNDO = 5;     // safeguard 3 (steps that move, pin or unpin tabs)
  const INPUT_WINDOW_MS = 1500;    // safeguard 1: change must follow your input this closely
  const SETTLE_MS = 1500;          // safeguard 2: extra quiet time after session restore
  const BATCH_MS = 80;
  const KEEP_BACKUPS = 10;

  const history = [];              // steps (arrays of actions), this session only
  let batch = null, batchTimer = null;
  let armed = false;               // safeguard 2
  let undoing = false;
  let lastUserInput = 0;

  // ---- safeguard 2: arm only after the session is fully restored ----------
  SessionStore.promiseAllWindowsRestored.then(() => {
    setTimeout(() => { armed = true; }, SETTLE_MS);
  });

  // ---- safeguard 1: track real user input in this window ------------------
  const markInput = e => { if (e.isTrusted) lastUserInput = Date.now(); };
  for (const type of ["mousedown", "mouseup", "click", "keydown", "drop", "dragend", "command"]) {
    window.addEventListener(type, markInput, true);
  }
  const userCaused = () => Date.now() - lastUserInput < INPUT_WINDOW_MS;

  function canRecord() {
    return armed && !undoing && userCaused() &&
           !window.gZenFolders?._sessionRestoring && !window.closed;
  }

  function record(action) {
    if (!batch) {
      batch = [];
      history.push(batch);
      if (history.length > MAX_STEPS) history.shift();
    }
    batch.push(action);
    clearTimeout(batchTimer);
    batchTimer = setTimeout(() => { batch = null; }, BATCH_MS);
  }

  // Real URL even for unloaded tabs (Zen keeps pinned tabs unloaded until you open
  // them; their browser then reports about:blank). Session state has the real one.
  function tabURL(tab) {
    try {
      const st = JSON.parse(SessionStore.getTabState(tab));
      const entries = st.entries || [];
      const idx = Math.max(0, (st.index || entries.length) - 1);
      if (entries[idx]?.url) return entries[idx].url;
    } catch (e) {}
    return tab?.linkedBrowser?.currentURI?.spec || "";
  }

  // Optional debug log (pref almost-arc.undo-debug) -> <profile>/almost-arc-undo-debug.log
  const DEBUG = Services.prefs.getBoolPref("almost-arc.undo-debug", false);
  const LOG = PathUtils.join(PathUtils.profileDir, "almost-arc-undo-debug.log");
  const log = msg => DEBUG && IOUtils.writeUTF8(LOG, `${new Date().toISOString().slice(11, 23)}  ${msg}\n`, { mode: "appendOrCreate" }).catch(() => {});

  // Tabs Firefox doesn't keep in "recently closed" (blank pages, Zen previews)
  function isRestorableClose(tab, url) {
    if (tab.hasAttribute("zen-glance-tab") || tab.hasAttribute("zen-empty-tab")) return false;
    if (!url || window.isBlankPageURL?.(url) || url === "about:blank") return false;
    return true;
  }

  // ---- recording ----------------------------------------------------------
  const tc = gBrowser.tabContainer;
  tc.addEventListener("TabClose", e => {
    const tab = e.target;
    const url = tabURL(tab);
    if (!canRecord()) { log(`close NOT recorded (armed=${armed} userCaused=${userCaused()} undoing=${undoing}) ${url}`); return; }
    if (!isRestorableClose(tab, url)) { log(`close skipped (blank/glance) ${url}`); return; }
    log(`close recorded: ${url} pinned=${tab.pinned} folder=${tab.group?.label || tab.group?.id || "-"}`);
    const group = tab.group;
    const siblings = group ? group.tabs : null;
    const i = siblings ? siblings.indexOf(tab) : -1;
    record({
      type: "close",
      url,
      pinned: tab.pinned,
      essential: tab.hasAttribute("zen-essential"),
      groupId: group?.id || null,
      prevTab: i > 0 ? siblings[i - 1] : null,
      nextTab: siblings && i >= 0 && i < siblings.length - 1 ? siblings[i + 1] : null,
    });
  });
  tc.addEventListener("TabMove", e => {
    const prev = e.detail?.previousTabState;
    if (!prev || !canRecord()) return;
    // moves between spaces aren't undone (too risky)
    if (prev.workspaceId && prev.workspaceId !== e.target.getAttribute("zen-workspace-id")) return;
    record({ type: "move", tab: e.target, prev });
  });
  tc.addEventListener("TabPinned", e => { if (canRecord()) record({ type: "pin", tab: e.target }); });
  tc.addEventListener("TabUnpinned", e => { if (canRecord()) record({ type: "unpin", tab: e.target }); });

  // ---- safeguard 4: back up the session file before undoing --------------
  async function backupSession() {
    try {
      const src = PathUtils.join(PathUtils.profileDir, "zen-sessions.jsonlz4");
      const dir = PathUtils.join(PathUtils.profileDir, "zen-sessions-undo-backups");
      await IOUtils.makeDirectory(dir, { ignoreExisting: true });
      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      await IOUtils.copy(src, PathUtils.join(dir, `zen-sessions-before-undo-${stamp}.jsonlz4`));
      const files = (await IOUtils.getChildren(dir)).filter(f => f.includes("before-undo-")).sort();
      for (const f of files.slice(0, Math.max(0, files.length - KEEP_BACKUPS))) await IOUtils.remove(f);
    } catch (e) {
      console.warn("[arcTabUndo] backup failed", e);
    }
  }

  // ---- undo ---------------------------------------------------------------
  const alive = tab => tab && tab.isConnected && !tab.closing;

  function restorePlace(tab, a) {
    if (a.essential && !tab.hasAttribute("zen-essential") && window.gZenPinnedTabManager?.addToEssentials) {
      gZenPinnedTabManager.addToEssentials(tab);
      return;
    }
    if (a.pinned && !tab.pinned) gBrowser.pinTab(tab);
    if (a.groupId) {
      const group = gBrowser.getTabGroupById?.(a.groupId);
      if (group && tab.group !== group) group.addTabs([tab]);
    }
    const sameGroup = t => alive(t) && (t.group?.id || null) === (a.groupId || null);
    if (sameGroup(a.nextTab)) gBrowser.moveTabBefore(tab, a.nextTab);
    else if (sameGroup(a.prevTab)) gBrowser.moveTabAfter(tab, a.prevTab);
  }

  // Only reopen if the most recently closed tab is the one this step closed
  function closedTabMatches(url) {
    try {
      const top = SessionStore.getClosedTabDataForWindow(window)?.[0];
      const entries = top?.state?.entries || [];
      const idx = Math.max(0, (top?.state?.index || entries.length) - 1);
      const ok = entries[idx]?.url === url;
      if (!ok) log(`reopen refused: last closed is ${entries[idx]?.url}, expected ${url}`);
      return ok;
    } catch (e) { log(`closedTabMatches error ${e}`); return false; }
  }

  function undoAction(a, reopenOnly) {
    switch (a.type) {
      case "close": {
        if (!closedTabMatches(a.url)) return false;
        const tab = SessionStore.undoCloseTab(window, 0, window);
        if (!tab) { log("undoCloseTab returned nothing"); return false; }
        if (!reopenOnly) try { restorePlace(tab, a); } catch (e) { log(`restorePlace error ${e}`); }
        log(`reopened ${a.url} -> pinned=${tab.pinned} folder=${tab.group?.label || tab.group?.id || "-"} (wanted folder ${a.groupId || "-"})`);
        return true;
      }
      case "move": {
        if (!alive(a.tab)) return false;
        const p = a.prev;
        if (p.tabGroupId && a.tab.group?.id !== p.tabGroupId) {
          gBrowser.getTabGroupById?.(p.tabGroupId)?.addTabs?.([a.tab]);
        }
        gBrowser.moveTabTo(a.tab, { tabIndex: p.tabIndex, forceUngrouped: !p.tabGroupId });
        return true;
      }
      case "pin":
        if (!alive(a.tab) || !a.tab.pinned) return false;
        gBrowser.unpinTab(a.tab);
        return true;
      case "unpin":
        if (!alive(a.tab) || a.tab.pinned) return false;
        gBrowser.pinTab(a.tab);
        return true;
    }
    return false;
  }

  async function undo() {
    clearTimeout(batchTimer);
    batch = null;
    const step = history.pop();
    if (!step) return;

    // safeguard 3: refuse a step that would move, pin or unpin more than a few tabs.
    // A step that only closed tabs (Zen's Clear, closing several at once) just
    // reopens them through Firefox, so it may be larger; above the limit the tabs
    // are only reopened, not moved back into folders or pinned.
    const touched = new Set(step.map(a => a.tab || a));
    const closesOnly = step.every(a => a.type === "close");
    const big = touched.size > MAX_TABS_PER_UNDO;
    if (big && !closesOnly) {
      console.warn(`[arcTabUndo] refused: undo would change ${touched.size} tabs`);
      log(`refused: step changes ${touched.size} tabs`);
      history.length = 0;      // don't walk further back past a suspicious step
      return;
    }
    if (big) log(`reopening ${touched.size} closed tabs (reopen only)`);

    await backupSession();     // safeguard 4
    undoing = true;
    try {
      for (const a of step.filter(a => a.type === "close").reverse()) {
        try { undoAction(a, big); } catch (e) { console.warn("[arcTabUndo]", e); }
      }
      for (const a of step.filter(a => a.type !== "close").reverse()) {
        try { undoAction(a); } catch (e) { console.warn("[arcTabUndo]", e); }
      }
    } finally {
      setTimeout(() => { undoing = false; }, 500);
    }
  }

  // ---- Cmd+Z --------------------------------------------------------------
  const isMac = AppConstants.platform === "macosx";
  window.addEventListener("keydown", e => {
    if (e.key?.toLowerCase() !== "z" || e.shiftKey || e.altKey) return;
    if (isMac ? (!e.metaKey || e.ctrlKey) : (!e.ctrlKey || e.metaKey)) return;
    // Typing somewhere (web page text field, address bar, rename box…)? Then
    // Cmd+Z belongs to that text. The OS-level input state is accurate for both
    // web pages and Zen's own UI (unlike Firefox's undo-command state).
    let typing = false;
    try { typing = window.windowUtils.IMEStatus !== Ci.nsIDOMWindowUtils.IME_STATUS_DISABLED; } catch (err) {}
    const fe = document.commandDispatcher.focusedElement;
    if (fe && (fe.localName === "input" || fe.localName === "textarea" || fe.isContentEditable)) typing = true;
    if (typing) { log("Cmd+Z: left to the text field you're typing in"); return; }

    if (!history.length || undoing) { log(`Cmd+Z: nothing to undo (history=${history.length} undoing=${undoing})`); return; }
    log(`Cmd+Z: undoing step of ${history.at(-1).length} action(s): ${history.at(-1).map(a => a.type).join(",")}`);
    e.preventDefault();
    e.stopPropagation();
    undo();
  }, true);
})();
