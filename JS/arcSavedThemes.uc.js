// ==UserScript==
// @name           Saved space themes
// @description    A "Saved themes" row in Zen's space theme picker, under the preset
//                 colors: + saves the theme of the space you're editing (its colors,
//                 opacity and grain) under a name, a click on a saved one puts it on
//                 that space, and right-click renames, updates or deletes it. Kept in
//                 <profile>/almost-arc-themes.json, shared by every window and space.
//                 Pref: almost-arc.saved-themes (default true; restart Zen)
// ==/UserScript==

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

(function () {
  if (window.__arcSavedThemes) return;
  window.__arcSavedThemes = true;

  const PREF = "almost-arc.saved-themes";
  try { Services.prefs.getDefaultBranch("").setBoolPref(PREF, true); } catch (e) {}
  if (!Services.prefs.getBoolPref(PREF, true)) return;

  const PANEL_ID = "PanelUI-zen-gradient-generator";
  const PRESETS_ID = "PanelUI-zen-gradient-generator-color-pages";
  const ROW_ID = "arc-saved-themes";
  const MAX_THEMES = 40;
  const MAX_NAME = 40;
  const HTML = "http://www.w3.org/1999/xhtml";
  const file = () => PathUtils.join(PathUtils.profileDir, "almost-arc-themes.json");

  // ---- the saved file ----
  // { v: 1, themes: [{ id, name, theme: Zen's space theme }] }. Zen's theme:
  // { type: "gradient", gradientColors: [{ c, isCustom, algorithm, isPrimary,
  // lightness, position, type }], opacity, texture, textureType }
  // (ZenGradientGenerator.mjs getTheme / updateCurrentWorkspace, Zen 1.24.3b).
  // Only those fields are kept, with the types Zen gives them.
  const CSS_COLOR = /^(#[0-9a-f]{3,8}|(rgba?|hsla?)\([0-9.,%\s/-]{1,60}\))$/i;
  const num = (v, d) => (typeof v === "number" && Number.isFinite(v) ? v : d);
  const str = (v, max = 40) => (typeof v === "string" && v.length <= max ? v : undefined);
  function cleanColor(d) {
    if (!d || typeof d !== "object") return null;
    let c;
    if (Array.isArray(d.c) && d.c.length >= 3 && d.c.slice(0, 3).every(n => typeof n === "number" && Number.isFinite(n))) {
      c = d.c.slice(0, 3).map(n => Math.round(Math.min(255, Math.max(0, n))));
    } else if (d.isCustom && typeof d.c === "string" && CSS_COLOR.test(d.c.trim())) {
      c = d.c.trim();
    } else return null;
    const out = { c, isCustom: typeof c === "string", isPrimary: d.isPrimary === true };
    const algorithm = str(d.algorithm); if (algorithm !== undefined) out.algorithm = algorithm;
    if (typeof d.lightness === "number" || typeof d.lightness === "string") {
      const l = Number(d.lightness);
      if (Number.isFinite(l)) out.lightness = d.lightness;
    }
    const p = d.position;
    if (p && Number.isFinite(p.x) && Number.isFinite(p.y)) out.position = { x: p.x, y: p.y };
    const type = str(d.type); if (type !== undefined) out.type = type;
    return out;
  }
  function cleanTheme(t) {
    if (!t || typeof t !== "object") return null;
    const colors = Array.isArray(t.gradientColors) ? t.gradientColors.slice(0, 8).map(cleanColor).filter(Boolean) : [];
    return {
      type: "gradient",
      gradientColors: colors,
      opacity: Math.min(1, Math.max(0, num(t.opacity, 0.5))),
      texture: Math.min(1, Math.max(0, num(t.texture, 0))),
      ...(str(t.textureType) !== undefined ? { textureType: t.textureType } : {}),
    };
  }
  const cleanName = n => (typeof n === "string" ? n.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, MAX_NAME) : "");
  function clean(data) {
    const themes = [];
    const ids = new Set();
    for (const s of Array.isArray(data?.themes) ? data.themes : []) {
      const theme = cleanTheme(s?.theme);
      const id = typeof s?.id === "string" && /^[a-z0-9]{8,32}$/.test(s.id) ? s.id : newId();
      if (!theme || ids.has(id)) continue;
      ids.add(id);
      themes.push({ id, name: cleanName(s.name) || "Theme", theme });
      if (themes.length >= MAX_THEMES) break;
    }
    return { v: 1, themes };
  }
  function newId() {
    let s = "";
    for (let i = 0; i < 16; i++) s += Math.floor(Math.random() * 16).toString(16);
    return s;
  }

  // Two themes are the same if they look the same: colors, opacity, grain. Dot
  // positions and lightness don't count (Zen and the color wheel move dots around
  // when the picker opens, without changing their colors).
  const colorKey = c => (Array.isArray(c) ? c.join(",") : String(c).toLowerCase().replace(/\s/g, ""));
  function looksSame(a, b) {
    a = cleanTheme(a); b = cleanTheme(b);
    if (!a || !b) return false;
    return a.gradientColors.map(d => colorKey(d.c)).join("|") === b.gradientColors.map(d => colorKey(d.c)).join("|")
      && Math.abs(a.opacity - b.opacity) < 0.002
      && Math.abs(a.texture - b.texture) < 0.002
      && (a.textureType ?? "") === (b.textureType ?? "");
  }

  // A swatch's background: the theme's colors, laid out like Zen's 3-dot presets.
  function preview(theme) {
    const cols = (cleanTheme(theme)?.gradientColors || []).map(d => (Array.isArray(d.c) ? `rgb(${d.c.join(", ")})` : d.c));
    if (!cols.length) return "";
    if (cols.length === 1) return cols[0];
    if (cols.length === 2) return `linear-gradient(135deg, ${cols[0]}, ${cols[1]})`;
    return `radial-gradient(circle at 0% 0%, ${cols[0]}, transparent 100%), radial-gradient(circle at 100% 0%, ${cols[1]}, transparent 100%), linear-gradient(to top, ${cols[2]} 0%, ${cols[2]} 100%)`;
  }

  let store = { v: 1, themes: [] };
  let writing = Promise.resolve();
  let broken = false;             // the file couldn't be read: never write over it
  async function load() {
    await writing;
    try {
      if (!(await IOUtils.exists(file()))) { store = { v: 1, themes: [] }; return; }
      try {
        store = clean(await IOUtils.readJSON(file()));
        broken = false;
      } catch (e) {
        // unreadable: keep it aside rather than overwrite it
        console.error("[arcSavedThemes] couldn't read", file(), e);
        broken = true;
        await IOUtils.move(file(), `${file()}.broken-${Date.now()}`).then(() => { broken = false; store = { v: 1, themes: [] }; }, () => {});
      }
    } catch (e) { console.error("[arcSavedThemes] load failed", e); }
  }
  function save() {
    if (broken) return writing;
    const data = JSON.parse(JSON.stringify(store));
    writing = writing.then(() => IOUtils.writeJSON(file(), data, { tmpPath: `${file()}.tmp` }))
      .catch(e => console.error("[arcSavedThemes] couldn't save", e));
    return writing;
  }

  // ---- the space being edited ----
  const picker = () => window.gZenThemePicker;
  const space = () => { try { return picker()?.workspaceBeingEdited || null; } catch (e) { return null; } };

  // Put a saved theme on the space, the way Zen's own picker does (updateCurrentWorkspace)
  // and tab undo does: set it, save the space, repaint and redraw the picker's dots.
  function apply(saved) {
    const ws = space(), p = picker();
    if (!ws || !p) return;
    const theme = cleanTheme(saved.theme);
    if (!theme) return;
    ws.theme = JSON.parse(JSON.stringify(theme));
    try { const algo = theme.gradientColors[0]?.algorithm; if (algo) p.useAlgo = algo; } catch (e) {}
    try { window.gZenWorkspaces?.saveWorkspace?.(ws); } catch (e) { console.error("[arcSavedThemes]", e); }
    try { p.onWorkspaceChange?.(ws); } catch (e) { console.error("[arcSavedThemes]", e); }
    try {
      if (ws.uuid !== window.gZenWorkspaces?.activeWorkspace) {
        p.invalidateGradientCache?.(ws.uuid);
        Services.obs.notifyObservers(null, "zen-space-gradient-update");
      }
    } catch (e) {}
    render();
  }

  // ---- the row ----
  let row = null, list = null, nameLabel = null, nameInput = null, menu = null;
  let menuFor = null;             // the saved theme the context menu is about
  let renaming = null;            // the saved theme being renamed

  function el(tag, attrs = {}, html = false) {
    const e = html ? document.createElementNS(HTML, tag) : document.createXULElement(tag);
    for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
    return e;
  }

  function build(panel) {
    const pages = panel.querySelector(`#${PRESETS_ID}`);
    const pagesRow = pages?.parentNode;
    if (!pagesRow?.parentNode) return false;   // Zen changed: leave its picker alone

    row = el("vbox", { id: ROW_ID });
    const head = el("hbox", { class: "arc-saved-themes-head", align: "center" });
    const title = el("label", { class: "arc-saved-themes-title", value: "Saved themes" });
    nameLabel = el("label", { class: "arc-saved-themes-name", crop: "end", flex: "1" });
    nameInput = el("input", { class: "arc-saved-themes-rename", type: "text", maxlength: String(MAX_NAME), hidden: "true" }, true);
    head.append(title, nameLabel, nameInput);
    list = el("div", { class: "arc-saved-themes-list", role: "listbox", "aria-label": "Saved themes" }, true);
    row.append(head, list);
    pagesRow.after(row);

    menu = el("menupopup", { id: "arc-saved-themes-menu" });
    const item = (id, label, fn) => {
      const m = el("menuitem", { id, label });
      m.addEventListener("command", () => { if (menuFor) fn(menuFor); });
      menu.append(m);
    };
    item("arc-saved-themes-apply", "Use this theme", apply);
    item("arc-saved-themes-rename", "Rename…", startRename);
    item("arc-saved-themes-update", "Replace with current colors", replaceWithCurrent);
    menu.append(el("menuseparator"));
    item("arc-saved-themes-delete", "Delete", remove);
    row.append(menu);
    // Zen listens for popupshowing / popuphidden on the whole panel without checking
    // the target, so the menu's own would look like the picker opening and closing
    // (which saves the space and forgets which one is being edited): keep them in here.
    for (const t of ["popupshowing", "popupshown", "popuphiding", "popuphidden"]) {
      menu.addEventListener(t, e => { if (e.target === menu) e.stopPropagation(); });
    }

    list.addEventListener("click", onListClick);
    list.addEventListener("contextmenu", onContextMenu);
    list.addEventListener("keydown", onListKey);
    list.addEventListener("mouseover", e => showName(swatchTheme(e.target)));
    list.addEventListener("mouseout", () => showName(null));
    nameInput.addEventListener("keydown", e => {
      if (e.key === "Enter") { e.preventDefault(); endRename(true); }
      else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); endRename(false); }
    });
    nameInput.addEventListener("blur", () => endRename(true));
    return true;
  }

  const swatchOf = t => t?.closest?.(".arc-saved-theme");
  const swatchTheme = t => {
    const id = swatchOf(t)?.getAttribute("data-id");
    return id ? store.themes.find(s => s.id === id) || null : null;
  };
  const current = () => store.themes.find(s => looksSame(s.theme, space()?.theme)) || null;

  function showName(saved) {
    if (!nameLabel) return;
    const s = saved || current();
    nameLabel.setAttribute("value", s ? s.name : "");
  }

  function render() {
    if (!list) return;
    while (list.firstChild) list.firstChild.remove();
    const cur = current();
    for (const s of store.themes) {
      const b = el("button", { class: "arc-saved-theme", "data-id": s.id, title: s.name, "aria-label": s.name, role: "option" }, true);
      const bg = preview(s.theme);
      if (bg) b.style.setProperty("background", bg);
      else b.setAttribute("default", "true");   // no colors: Zen's default theme
      b.setAttribute("aria-selected", s === cur ? "true" : "false");
      if (s === cur) b.setAttribute("selected", "true");
      list.append(b);
    }
    if (store.themes.length < MAX_THEMES) {
      const add = el("button", { class: "arc-saved-themes-add", title: "Save this theme", "aria-label": "Save this theme" }, true);
      add.textContent = "+";
      list.append(add);
    }
    showName(null);
  }

  function onListClick(e) {
    if (e.button !== 0) return;
    if (e.target?.closest?.(".arc-saved-themes-add")) { saveCurrent(); return; }
    const s = swatchTheme(e.target);
    if (s) apply(s);
  }
  function onContextMenu(e) {
    const s = swatchTheme(e.target);
    if (!s) return;
    e.preventDefault();
    e.stopPropagation();
    menuFor = s;
    menu.openPopupAtScreen(e.screenX, e.screenY, true, e);
  }
  function onListKey(e) {
    const s = swatchTheme(e.target);
    if (!s) return;
    if (e.key === "Delete" || e.key === "Backspace") { e.preventDefault(); remove(s); }
    else if (e.key === "F2") { e.preventDefault(); startRename(s); }
  }

  function nextName() {
    const used = new Set(store.themes.map(s => s.name));
    for (let n = store.themes.length + 1; ; n++) if (!used.has(`Theme ${n}`)) return `Theme ${n}`;
  }

  async function saveCurrent() {
    const theme = cleanTheme(space()?.theme);
    if (!theme) return;
    await load();                    // another window may have saved some since
    const same = store.themes.find(s => looksSame(s.theme, theme));
    if (same) { render(); startRename(same); return; }
    if (store.themes.length >= MAX_THEMES) { render(); return; }
    const s = { id: newId(), name: nextName(), theme };
    store.themes.push(s);
    save();
    render();
    startRename(s);                  // type a name right away (Enter keeps it)
  }

  async function replaceWithCurrent(saved) {
    const theme = cleanTheme(space()?.theme);
    if (!theme) return;
    await load();
    const s = store.themes.find(t => t.id === saved.id);
    if (!s) { render(); return; }
    s.theme = theme;
    save();
    render();
  }

  async function remove(saved) {
    await load();
    const i = store.themes.findIndex(t => t.id === saved.id);
    if (i < 0) { render(); return; }
    store.themes.splice(i, 1);
    save();
    render();
  }

  function startRename(saved) {
    if (!nameInput) return;
    renaming = saved.id;
    nameLabel.setAttribute("hidden", "true");
    nameInput.removeAttribute("hidden");
    nameInput.value = saved.name;
    nameInput.focus();
    nameInput.select();
  }
  async function endRename(keep) {
    if (!renaming) return;
    const id = renaming;
    renaming = null;
    const name = cleanName(nameInput.value);
    nameInput.setAttribute("hidden", "true");
    nameLabel.removeAttribute("hidden");
    if (keep && name) {
      await load();
      const s = store.themes.find(t => t.id === id);
      if (s && s.name !== name) { s.name = name; save(); }
    }
    render();
  }

  window.addEventListener("popupshowing", e => {
    if (e.target?.id !== PANEL_ID) return;
    try {
      if (!row && !build(e.target)) return;
      render();                      // what this window knows, then the file's
      load().then(render, () => {});
    } catch (err) { console.error("[arcSavedThemes]", err); }
  }, true);
  window.addEventListener("popuphidden", e => {
    if (e.target?.id === PANEL_ID && renaming) endRename(true);
  }, true);
  // Zen redraws the picker on every change to the space: keep the selected swatch right
  window.addEventListener("mouseup", e => {
    if (row && e.target?.closest?.(`#${PANEL_ID}`)) setTimeout(render, 250);
  }, true);
})();
