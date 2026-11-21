// ==UserScript==
// @name           Almost Arc easels
// @description    Arc-style easels: a tab you draw in. "New Easel" (Zen's + button
//                 at the bottom of the sidebar, File menu, tab context menu) opens one; it saves as you draw and comes back with the
//                 tab (pin it, put it in a folder, restart Zen: the drawing is still
//                 there). Select (drag a box; move, delete, restyle), pen, text boxes, shapes
//                 (rectangle, ellipse, arrow; Shift constrains), eraser,
//                 colors, sizes, undo/redo (Cmd+Z / Cmd+Shift+Z),
//                 two-finger scroll to move around. Drawings are saved in the profile
//                 folder, <profile>/almost-arc-easels/<id>.json. Zen's top toolbar hides
//                 while an easel tab is selected.
//                 Pref: almost-arc.easel (default true)
// ==/UserScript==

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// The easel page is a chrome:// page of our own (chrome://almostarc-easel/content/),
// written into <profile>/chrome/almost-arc-easel/ by this script and registered with a
// chrome manifest, so it works the same whatever loaded this script (install.sh's
// fx-autoconfig or Sine). It only ever draws strokes on a canvas: no web content, no
// HTML from the saved file.

(function () {
  if (window.__arcEasel) return;
  window.__arcEasel = true;

  const PREF = "almost-arc.easel";
  try { Services.prefs.getDefaultBranch("").setBoolPref(PREF, true); } catch (e) {}
  if (!Services.prefs.getBoolPref(PREF, true)) return;

  const HOST = "almostarc-easel";
  const PREFIX = `chrome://${HOST}/content/`;
  const DIR = PathUtils.join(PathUtils.profileDir, "chrome", "almost-arc-easel");
  const MANIFEST = PathUtils.join(DIR, "easel.manifest");

  // ---- the page ------------------------------------------------------------
  // Runs inside the easel tab (a privileged page: IOUtils / PathUtils are there).
  // Written out as easel.js from this function's source, so it must not use
  // anything from the script around it.
  function easelPage() {
    "use strict";
    const VALID_ID = /^[a-z0-9]{8,32}$/;
    const COLORS = ["ink", "#e5484d", "#f76b15", "#ffc53d", "#30a46c", "#0090ff", "#8e4ec6"];
    const SIZES = [2, 5, 10];
    const TEXT_SIZES = { 2: 16, 5: 24, 10: 40 };   // font size (px) for each size button
    const LINE = 1.25;                              // text line height
    const FONT = '-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif';
    const SAVE_MS = 400;
    const $ = id => document.getElementById(id);

    const id = location.hash.slice(1);
    if (!VALID_ID.test(id)) {
      $("broken").hidden = false;
      $("bar").hidden = true;
      return;
    }
    const dir = PathUtils.join(PathUtils.profileDir, "almost-arc-easels");
    const file = PathUtils.join(dir, `${id}.json`);

    const canvas = $("ink");
    const ctx = canvas.getContext("2d");
    const nameEl = $("name");
    const editor = $("editor");
    // items, bottom to top: lines {c, w, p: [[x, y]…]}, text boxes {k: "text", c, f, x, y, v},
    // shapes {k: "rect" | "ellipse" | "arrow", c, w, x0, y0, x1, y1}
    let doc = { v: 2, name: "", items: [] };
    let loaded = false;
    let tool = "pen", color = COLORS[0], size = SIZES[1];
    let view = { x: 0, y: 0 };            // how far you've scrolled the drawing
    let current = null;                  // the line being drawn
    let erasing = null;                  // [[index, item]] removed by this eraser drag
    let selected = new Set();            // select tool
    let drag = null;                     // select tool: {kind: "move", last, dx, dy} or {kind: "box", from, to, base}
    let editing = null;                  // text box being typed in: {item, isNew, before}
    const undoStack = [], redoStack = [];
    const isText = s => s.k === "text";
    const SHAPES = ["rect", "ellipse", "arrow"];   // {k, c, w, x0, y0, x1, y1}: drag start to end
    const isShape = s => SHAPES.includes(s.k);

    // ---- saved file ----
    const num = v => typeof v === "number" && Number.isFinite(v);
    const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);
    function clean(data) {
      const out = { v: 2, name: "", items: [] };
      if (typeof data?.name === "string") out.name = data.name.slice(0, 200);
      // v1 files (lines only) called the list "strokes"
      const list = Array.isArray(data?.items) ? data.items : Array.isArray(data?.strokes) ? data.strokes : [];
      for (const s of list) {
        if (!COLORS.includes(s?.c)) continue;
        if (SHAPES.includes(s.k)) {
          if (!num(s.w) || ![s.x0, s.y0, s.x1, s.y1].every(num)) continue;
          out.items.push({ k: s.k, c: s.c, w: clamp(s.w, 1, 40), x0: s.x0, y0: s.y0, x1: s.x1, y1: s.y1 });
          continue;
        }
        if (s.k === "text") {
          if (typeof s.v !== "string" || !s.v.trim() || !num(s.x) || !num(s.y) || !num(s.f)) continue;
          out.items.push({ k: "text", c: s.c, f: clamp(s.f, 8, 120), x: s.x, y: s.y, v: s.v.slice(0, 5000) });
          continue;
        }
        if (!num(s.w) || !Array.isArray(s.p)) continue;
        const p = s.p.filter(q => Array.isArray(q) && num(q[0]) && num(q[1])).map(q => [q[0], q[1]]);
        if (p.length) out.items.push({ c: s.c, w: clamp(s.w, 1, 40), p });
      }
      return out;
    }
    let saveTimer = null;
    let stamp = null;      // the file's lastModified when this page last read or wrote it
    let writing = false;
    async function fileStamp() {
      try { return (await IOUtils.stat(file)).lastModified ?? null; } catch (e) { return null; }
    }
    function save() {
      if (!loaded) return;
      clearTimeout(saveTimer);
      saveTimer = setTimeout(writeNow, SAVE_MS);
    }
    async function writeNow() {
      saveTimer = null;
      writing = true;
      try {
        await IOUtils.makeDirectory(dir, { ignoreExisting: true });
        await IOUtils.writeJSON(file, doc, { tmpPath: `${file}.tmp` });
        stamp = await fileStamp();
      } catch (e) { console.error("[easel] save failed", e); }
      finally { writing = false; }
    }
    // With several Zen windows, each shows its own copy of this page (arcEasel.uc.js):
    // a copy that's on screen picks up what another one saved, unless you're mid-change.
    let refreshing = false;
    const busy = () => !loaded || writing || saveTimer || editing || current || drag || erasing
      || document.activeElement === nameEl;
    async function refresh() {
      if (refreshing || busy()) return;
      refreshing = true;
      try {
        const now = await fileStamp();
        if (now === null || now === stamp) return;
        let data;
        try { data = await IOUtils.readJSON(file); } catch (e) { return; }   // mid-write elsewhere: next time
        if (busy()) return;
        stamp = now;
        doc = clean(data);
        undoStack.length = 0;      // the steps were about the old drawing
        redoStack.length = 0;
        selected = new Set();
        nameEl.value = doc.name;
        showName();
        updateButtons();
        draw();
      } finally { refreshing = false; }
    }
    async function load() {
      stamp = await fileStamp();
      try {
        if (await IOUtils.exists(file)) {
          try { doc = clean(await IOUtils.readJSON(file)); }
          catch (e) {
            // unreadable: keep it aside rather than overwrite it
            console.error("[easel] couldn't read", file, e);
            await IOUtils.move(file, `${file}.broken-${Date.now()}`).catch(() => {});
          }
        }
      } catch (e) { console.error("[easel] load failed", e); }
      loaded = true;
      nameEl.value = doc.name;
      showName();
      updateButtons();
      draw();
    }

    // ---- shapes ----
    function inkColor(c) {
      if (c !== "ink") return c;
      return getComputedStyle(document.documentElement).getPropertyValue("--ink").trim() || "#1d1c1a";
    }
    const cssVar = (name, fallback) => getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
    const lines = s => s.v.split("\n");
    function textWidth(s) {
      ctx.font = `${s.f}px ${FONT}`;
      return Math.max(s.f * 0.3, ...lines(s).map(l => ctx.measureText(l).width));
    }
    // the arrowhead: two short lines back from the tip
    const headLen = s => Math.max(10, s.w * 3);
    function headLines(s) {
      const a = Math.atan2(s.y1 - s.y0, s.x1 - s.x0), L = headLen(s), tip = [s.x1, s.y1];
      return [-0.5, 0.5].map(d => [tip, [s.x1 - L * Math.cos(a + d), s.y1 - L * Math.sin(a + d)]]);
    }
    function bbox(s) {
      if (isShape(s)) {
        const r = s.w / 2 + (s.k === "arrow" ? headLen(s) : 0);
        return { x0: Math.min(s.x0, s.x1) - r, y0: Math.min(s.y0, s.y1) - r, x1: Math.max(s.x0, s.x1) + r, y1: Math.max(s.y0, s.y1) + r };
      }
      if (isText(s)) return { x0: s.x, y0: s.y, x1: s.x + textWidth(s), y1: s.y + lines(s).length * s.f * LINE };
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const [x, y] of s.p) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
      const r = s.w / 2;
      return { x0: x0 - r, y0: y0 - r, x1: x1 + r, y1: y1 + r };
    }
    function distToSegment(px, py, a, b) {
      const dx = b[0] - a[0], dy = b[1] - a[1];
      const len = dx * dx + dy * dy;
      const t = len ? Math.max(0, Math.min(1, ((px - a[0]) * dx + (py - a[1]) * dy) / len)) : 0;
      return Math.hypot(px - (a[0] + t * dx), py - (a[1] + t * dy));
    }
    function hit(s, x, y, r) {
      if (isShape(s)) {                       // on the outline (or the arrow), not inside
        const R = r + s.w / 2;
        const x0 = Math.min(s.x0, s.x1), x1 = Math.max(s.x0, s.x1), y0 = Math.min(s.y0, s.y1), y1 = Math.max(s.y0, s.y1);
        if (s.k === "arrow") {
          return [[[s.x0, s.y0], [s.x1, s.y1]], ...headLines(s)].some(([a, b]) => distToSegment(x, y, a, b) <= R);
        }
        const rx = (x1 - x0) / 2, ry = (y1 - y0) / 2;
        if (s.k === "ellipse" && rx > 1 && ry > 1) {
          const d = Math.hypot((x - x0 - rx) / rx, (y - y0 - ry) / ry);
          return Math.abs(d - 1) * Math.min(rx, ry) <= R;
        }
        const c = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
        return c.some((a, i) => distToSegment(x, y, a, c[(i + 1) % 4]) <= R);
      }
      if (isText(s)) {
        const b = bbox(s);
        return x >= b.x0 - r && x <= b.x1 + r && y >= b.y0 - r && y <= b.y1 + r;
      }
      const p = s.p;
      for (let j = 0; j < p.length; j++) {
        if (distToSegment(x, y, p[j], p[Math.min(j + 1, p.length - 1)]) <= r + s.w / 2) return true;
      }
      return false;
    }
    function topAt(x, y) {
      for (let i = doc.items.length - 1; i >= 0; i--) if (hit(doc.items[i], x, y, 6)) return doc.items[i];
      return null;
    }
    function shift(s, dx, dy) {
      if (isShape(s)) { s.x0 += dx; s.x1 += dx; s.y0 += dy; s.y1 += dy; }
      else if (isText(s)) { s.x += dx; s.y += dy; }
      else for (const q of s.p) { q[0] += dx; q[1] += dy; }
    }

    // ---- drawing ----
    function strokePath(s) {
      const p = s.p;
      ctx.beginPath();
      ctx.lineWidth = s.w;
      ctx.strokeStyle = ctx.fillStyle = inkColor(s.c);
      if (p.length === 1) {
        ctx.arc(p[0][0] + view.x, p[0][1] + view.y, s.w / 2, 0, Math.PI * 2);
        ctx.fill();
        return;
      }
      ctx.moveTo(p[0][0] + view.x, p[0][1] + view.y);
      for (let i = 1; i < p.length - 1; i++) {   // smooth: curve through the midpoints
        const mx = (p[i][0] + p[i + 1][0]) / 2, my = (p[i][1] + p[i + 1][1]) / 2;
        ctx.quadraticCurveTo(p[i][0] + view.x, p[i][1] + view.y, mx + view.x, my + view.y);
      }
      const last = p[p.length - 1];
      ctx.lineTo(last[0] + view.x, last[1] + view.y);
      ctx.stroke();
    }
    function drawShape(s) {
      ctx.beginPath();
      ctx.lineWidth = s.w;
      ctx.strokeStyle = inkColor(s.c);
      const x0 = Math.min(s.x0, s.x1) + view.x, y0 = Math.min(s.y0, s.y1) + view.y;
      const w = Math.abs(s.x1 - s.x0), h = Math.abs(s.y1 - s.y0);
      if (s.k === "rect") {
        if (ctx.roundRect) ctx.roundRect(x0, y0, w, h, Math.min(6, w / 2, h / 2));
        else ctx.rect(x0, y0, w, h);
      } else if (s.k === "ellipse") {
        ctx.ellipse(x0 + w / 2, y0 + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
      } else {
        ctx.moveTo(s.x0 + view.x, s.y0 + view.y);
        ctx.lineTo(s.x1 + view.x, s.y1 + view.y);
        for (const [a, b] of headLines(s)) { ctx.moveTo(a[0] + view.x, a[1] + view.y); ctx.lineTo(b[0] + view.x, b[1] + view.y); }
      }
      ctx.stroke();
    }
    const paint = s => (isText(s) ? drawText(s) : isShape(s) ? drawShape(s) : strokePath(s));
    function drawText(s) {
      ctx.font = `${s.f}px ${FONT}`;
      ctx.fillStyle = inkColor(s.c);
      ctx.textBaseline = "top";
      const pad = (s.f * LINE - s.f) / 2;   // the same line box as the text field
      lines(s).forEach((l, i) => ctx.fillText(l, s.x + view.x, s.y + view.y + i * s.f * LINE + pad));
    }
    let frame = 0;
    function draw() {
      // the size buttons show text sizes (A) for the text tool, a text box or selected text
      const textSizes = tool === "text" || !!editing || (selected.size > 0 && [...selected].every(isText));
      document.documentElement.dataset.sizes = textSizes ? "text" : "line";
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        const dpr = window.devicePixelRatio || 1;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, canvas.width / dpr, canvas.height / dpr);
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        for (const s of doc.items) {
          if (editing?.item === s) continue;          // the text field shows it
          paint(s);
        }
        if (current) paint(current);
        // selection
        const accent = cssVar("--select", "#0090ff");
        ctx.lineWidth = 1;
        ctx.strokeStyle = accent;
        ctx.setLineDash?.([4, 3]);
        for (const s of selected) {
          const b = bbox(s);
          ctx.strokeRect(b.x0 - 4 + view.x, b.y0 - 4 + view.y, b.x1 - b.x0 + 8, b.y1 - b.y0 + 8);
        }
        ctx.setLineDash?.([]);
        if (drag?.kind === "box") {
          const r = rect(drag.from, drag.to);
          ctx.globalAlpha = 0.08;
          ctx.fillStyle = accent;
          ctx.fillRect(r.x0 + view.x, r.y0 + view.y, r.x1 - r.x0, r.y1 - r.y0);
          ctx.globalAlpha = 1;
          ctx.strokeRect(r.x0 + view.x, r.y0 + view.y, r.x1 - r.x0, r.y1 - r.y0);
        }
      });
    }
    function resize() {
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.round(window.innerWidth * dpr);
      canvas.height = Math.round(window.innerHeight * dpr);
      if (editing) placeEditor();
      draw();
    }

    // ---- history ----
    function done(step) {
      undoStack.push(step);
      redoStack.length = 0;
      updateButtons();
      save();
    }
    function apply(step, back) {
      if (step.t === "add") {
        if (back) doc.items.splice(doc.items.lastIndexOf(step.s), 1);
        else doc.items.push(step.s);
      } else if (step.t === "erase") {
        if (back) for (const [i, s] of [...step.items].sort((a, b) => a[0] - b[0])) doc.items.splice(i, 0, s);
        else for (const [, s] of step.items) doc.items.splice(doc.items.indexOf(s), 1);
      } else if (step.t === "clear") {
        doc.items = back ? step.items.slice() : [];
      } else if (step.t === "move") {
        for (const s of step.list) shift(s, back ? -step.dx : step.dx, back ? -step.dy : step.dy);
      } else if (step.t === "set") {
        for (const [s, before, after] of step.changes) Object.assign(s, back ? before : after);
      }
    }
    function history(from, to, back) {
      finishEdit();
      const step = from.pop();
      if (!step) return;
      apply(step, back);
      to.push(step);
      selected = new Set([...selected].filter(s => doc.items.includes(s)));
      updateButtons(); save(); draw();
    }
    const undo = () => history(undoStack, redoStack, true);
    const redo = () => history(redoStack, undoStack, false);
    function updateButtons() {
      $("undo").disabled = !undoStack.length;
      $("redo").disabled = !redoStack.length;
      $("clear").disabled = !doc.items.length;
    }
    // removes items as one step (eraser drag, Delete), keeping where each was
    function removeItems(list) {
      const items = list.map(s => [doc.items.indexOf(s), s]).filter(([i]) => i >= 0).sort((a, b) => a[0] - b[0]);
      if (!items.length) return;
      for (const [, s] of items) doc.items.splice(doc.items.indexOf(s), 1);
      done({ t: "erase", items });
    }

    // ---- eraser: removes whole lines and text boxes it touches ----
    function eraseAt(x, y) {
      for (let i = doc.items.length - 1; i >= 0; i--) {
        const s = doc.items[i];
        if (!hit(s, x, y, 8)) continue;
        // index among the items as they were before this drag
        let original = i;
        for (const [k] of [...erasing].sort((a, b) => a[0] - b[0])) if (k <= original) original++;
        erasing.push([original, s]);
        doc.items.splice(i, 1);
        draw();
      }
    }

    // ---- text boxes ----
    function placeEditor() {
      const s = editing.item;
      editor.style.left = `${s.x + view.x}px`;
      editor.style.top = `${s.y + view.y}px`;
      editor.style.font = `${s.f}px/${LINE} ${FONT}`;
      editor.style.color = inkColor(s.c);
      editor.style.width = `${Math.ceil(textWidth(s) + s.f)}px`;
      editor.style.height = `${Math.ceil(lines(s).length * s.f * LINE)}px`;
    }
    function startEdit(item, isNew) {
      finishEdit();
      selected = new Set();
      editing = { item, isNew, before: { v: item.v, c: item.c, f: item.f } };
      editor.value = item.v;
      editor.hidden = false;
      placeEditor();
      editor.focus();
      setTimeout(() => { if (editing?.item === item) editor.focus(); }, 0);
      draw();
    }
    function finishEdit() {
      if (!editing) return;
      const { item, isNew, before } = editing;
      editing = null;
      editor.hidden = true;
      item.v = item.v.replace(/\s+$/, "");
      const empty = !item.v.trim();
      if (isNew) {
        if (!empty) { doc.items.push(item); done({ t: "add", s: item }); }
      } else if (empty) {
        Object.assign(item, before);            // so undo brings the text back
        removeItems([item]);
      } else {
        const after = { v: item.v, c: item.c, f: item.f };
        if (JSON.stringify(after) !== JSON.stringify(before)) done({ t: "set", changes: [[item, before, after]] });
      }
      draw();
    }
    editor.addEventListener("input", () => {
      if (!editing) return;
      editing.item.v = editor.value.slice(0, 5000);
      placeEditor();
    });
    editor.addEventListener("keydown", e => {
      if (e.key === "Escape" || (e.key === "Enter" && (e.metaKey || e.ctrlKey))) { e.preventDefault(); finishEdit(); }
    });
    editor.addEventListener("blur", () => finishEdit());

    // ---- select tool ----
    function rect(a, b) {
      return { x0: Math.min(a[0], b[0]), y0: Math.min(a[1], b[1]), x1: Math.max(a[0], b[0]), y1: Math.max(a[1], b[1]) };
    }
    function inBox(s, r) {
      if (isText(s) || isShape(s)) {
        const b = bbox(s);
        return b.x0 <= r.x1 && b.x1 >= r.x0 && b.y0 <= r.y1 && b.y1 >= r.y0;
      }
      return s.p.some(([x, y]) => x >= r.x0 && x <= r.x1 && y >= r.y0 && y <= r.y1);
    }
    function selectAll() {
      finishEdit();
      setTool("select");
      selected = new Set(doc.items);
      draw();
    }

    // ---- pointer ----
    const at = e => [Math.round((e.clientX - view.x) * 10) / 10, Math.round((e.clientY - view.y) * 10) / 10];
    // keep the text field focused when you click the canvas (the click itself ends the edit)
    canvas.addEventListener("mousedown", e => e.preventDefault());
    canvas.addEventListener("pointerdown", e => {
      if (e.button !== 0 || !loaded) return;
      const q = at(e);
      if (tool === "text") {
        const wasEditing = !!editing;
        finishEdit();
        const t = topAt(...q);
        if (t && isText(t)) { startEdit(t, false); return; }
        if (wasEditing) return;                  // a click away from a text box just ends it
        const f = TEXT_SIZES[size];
        startEdit({ k: "text", c: color, f, x: q[0], y: Math.round((q[1] - f * LINE / 2) * 10) / 10, v: "" }, true);
        return;
      }
      finishEdit();
      canvas.setPointerCapture?.(e.pointerId);
      if (tool === "select") {
        const t = topAt(...q);
        if (t && e.shiftKey) {
          if (selected.has(t)) selected.delete(t); else selected.add(t);
        } else if (t) {
          if (!selected.has(t)) selected = new Set([t]);
          drag = { kind: "move", last: q, dx: 0, dy: 0 };
        } else {
          const base = e.shiftKey ? new Set(selected) : new Set();
          drag = { kind: "box", from: q, to: q, base };
          selected = new Set(base);
        }
        draw();
      } else if (tool === "eraser") {
        erasing = [];
        eraseAt(...q);
      } else if (SHAPES.includes(tool)) {
        current = { k: tool, c: color, w: size, x0: q[0], y0: q[1], x1: q[0], y1: q[1] };
      } else {
        current = { c: color, w: size, p: [q] };
        draw();
      }
    });
    canvas.addEventListener("pointermove", e => {
      if (!current && !erasing && !drag) return;
      const events = e.getCoalescedEvents?.() || [e];
      for (const ev of events.length ? events : [e]) {
        const q = at(ev);
        if (drag?.kind === "move") {
          const dx = q[0] - drag.last[0], dy = q[1] - drag.last[1];
          for (const s of selected) shift(s, dx, dy);
          drag.dx += dx; drag.dy += dy; drag.last = q;
        } else if (drag?.kind === "box") {
          drag.to = q;
          const r = rect(drag.from, q);
          selected = new Set([...drag.base, ...doc.items.filter(s => inBox(s, r))]);
        } else if (erasing) {
          eraseAt(...q);
        } else if (current && isShape(current)) {
          shapeTo(current, q, ev.shiftKey);
        } else if (current) {
          const last = current.p[current.p.length - 1];
          if (Math.hypot(q[0] - last[0], q[1] - last[1]) >= 1) current.p.push(q);
        }
      }
      draw();
    });
    // Shift: a square, a circle, or an arrow at a multiple of 45 degrees
    function shapeTo(s, [x, y], constrain) {
      const dx = x - s.x0, dy = y - s.y0;
      if (constrain && s.k === "arrow") {
        const a = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4), len = Math.hypot(dx, dy);
        x = s.x0 + len * Math.cos(a); y = s.y0 + len * Math.sin(a);
      } else if (constrain) {
        const m = Math.max(Math.abs(dx), Math.abs(dy));
        x = s.x0 + (dx < 0 ? -m : m); y = s.y0 + (dy < 0 ? -m : m);
      }
      s.x1 = Math.round(x * 10) / 10; s.y1 = Math.round(y * 10) / 10;
    }
    function finish() {
      if (current && isShape(current) && Math.abs(current.x1 - current.x0) < 3 && Math.abs(current.y1 - current.y0) < 3) {
        current = null;                       // a click, not a drag: no shape
      } else if (current) {
        const s = current;
        current = null;
        doc.items.push(s);
        done({ t: "add", s });
      } else if (erasing) {
        const items = erasing;
        erasing = null;
        if (items.length) done({ t: "erase", items });
      } else if (drag) {
        const d = drag;
        drag = null;
        const dx = Math.round(d.dx * 10) / 10, dy = Math.round(d.dy * 10) / 10;
        if (d.kind === "move" && (dx || dy)) done({ t: "move", list: [...selected], dx: d.dx, dy: d.dy });
      }
      draw();
    }
    canvas.addEventListener("pointerup", finish);
    canvas.addEventListener("pointercancel", finish);
    // double-click a text box with the select tool: edit it
    canvas.addEventListener("dblclick", e => {
      if (tool !== "select") return;
      const t = topAt(...at(e));
      if (t && isText(t)) startEdit(t, false);
    });

    // two-finger scroll moves the drawing
    canvas.addEventListener("wheel", e => {
      e.preventDefault();
      const k = e.deltaMode === 1 ? 16 : 1;
      view = { x: view.x - e.deltaX * k, y: view.y - e.deltaY * k };
      if (editing) placeEditor();
      draw();
    }, { passive: false });

    // ---- toolbar ----
    // clicking the toolbar doesn't take the focus from a text box you're typing in
    $("bar").addEventListener("mousedown", e => e.preventDefault());
    function press(group, attr, value) {
      for (const b of $(group).querySelectorAll(`[${attr}]`)) {
        b.setAttribute("aria-pressed", String(b.getAttribute(attr) === String(value)));
      }
    }
    function setTool(t) {
      if (t !== tool) finishEdit();
      tool = t;
      if (t !== "select") selected = new Set();
      document.documentElement.dataset.tool = t;
      press("tools", "data-tool", t);
      draw();
    }
    // a color or size picked with something selected (or a text box open) restyles it
    function restyle(change) {
      if (editing) {
        Object.assign(editing.item, change(editing.item));
        placeEditor();
        editor.focus();
        return true;
      }
      if (!selected.size) return false;
      const changes = [...selected].map(s => {
        const after = change(s);
        const before = Object.fromEntries(Object.keys(after).map(k => [k, s[k]]));
        return [s, before, after];
      }).filter(([, b, a]) => JSON.stringify(b) !== JSON.stringify(a));
      if (changes.length) {
        for (const [s, , a] of changes) Object.assign(s, a);
        done({ t: "set", changes });
        draw();
      }
      return true;
    }
    $("tools").addEventListener("click", e => {
      const b = e.target.closest?.("[data-tool]");
      if (b) setTool(b.getAttribute("data-tool"));
    });
    $("colors").addEventListener("click", e => {
      const b = e.target.closest?.("[data-color]");
      if (!b) return;
      color = b.getAttribute("data-color");
      press("colors", "data-color", color);
      if (!restyle(() => ({ c: color })) && (tool === "eraser" || tool === "select")) setTool("pen");
    });
    $("sizes").addEventListener("click", e => {
      const b = e.target.closest?.("[data-size]");
      if (!b) return;
      size = Number(b.getAttribute("data-size"));
      press("sizes", "data-size", size);
      restyle(s => (isText(s) ? { f: TEXT_SIZES[size] } : { w: size }));
    });
    $("undo").addEventListener("click", undo);
    $("redo").addEventListener("click", redo);
    $("clear").addEventListener("click", () => {
      finishEdit();
      if (!doc.items.length) return;
      const items = doc.items.slice();
      doc.items = [];
      selected = new Set();
      done({ t: "clear", items });
      draw();
    });

    // ---- name ----
    function showName() {
      document.title = doc.name.trim() || "Untitled Easel";
    }
    nameEl.addEventListener("input", () => {
      doc.name = nameEl.value.slice(0, 200);
      showName();
      save();
    });
    nameEl.addEventListener("keydown", e => {
      if (e.key === "Enter" || e.key === "Escape") nameEl.blur();
    });

    // ---- keys ----
    const isMac = /Mac/.test(navigator.platform);
    document.addEventListener("keydown", e => {
      if (e.target === nameEl || e.target === editor) return;   // typing: its own undo, select all, delete
      // you last clicked outside the easel (the sidebar…): keys are Zen's (arcEasel.uc.js sets this)
      if (document.documentElement.dataset.keys === "browser") return;
      const mod = isMac ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey;
      const key = e.key?.toLowerCase();
      const take = () => { e.preventDefault(); e.stopPropagation(); };
      if (mod && !e.altKey && key === "z") {
        take();
        if (e.shiftKey) redo(); else undo();
      } else if (mod && !e.altKey && !e.shiftKey && key === "y" && !isMac) {
        take(); redo();
      } else if (mod && !e.altKey && !e.shiftKey && key === "a") {
        take(); selectAll();
      } else if (!mod && (e.key === "Backspace" || e.key === "Delete") && selected.size) {
        take();
        const list = [...selected];
        selected = new Set();
        removeItems(list);
        draw();
      } else if (!mod && e.key === "Escape" && selected.size) {
        take();
        selected = new Set();
        draw();
      }
    }, true);

    window.addEventListener("resize", resize);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") refresh(); });
    setInterval(() => { if (document.visibilityState === "visible") refresh(); }, 1000);
    window.matchMedia?.("(prefers-color-scheme: dark)").addEventListener?.("change", draw);
    // a last save when the tab closes or reloads
    window.addEventListener("pagehide", () => {
      finishEdit();
      if (saveTimer) { clearTimeout(saveTimer); writeNow(); }
    });

    setTool("pen");
    press("colors", "data-color", color);
    press("sizes", "data-size", size);
    updateButtons();
    resize();
    load();
  }

  const CSS = `
:root {
  --paper: #fbfaf8; --ink: #1d1c1a; --bar: rgba(255,255,255,.92); --bar-line: rgba(0,0,0,.09);
  --muted: #6f6c66; --hover: rgba(0,0,0,.06); --on: rgba(0,0,0,.1); --select: #0084e8;
  color-scheme: light;
}
@media (prefers-color-scheme: dark) {
  :root {
    --paper: #1b1b1d; --ink: #eceae6; --bar: rgba(44,44,48,.92); --bar-line: rgba(255,255,255,.1);
    --muted: #a3a09a; --hover: rgba(255,255,255,.08); --on: rgba(255,255,255,.14); --select: #4aa8ff;
    color-scheme: dark;
  }
}
* { box-sizing: border-box; }
[hidden] { display: none !important; }
html, body { margin: 0; height: 100%; overflow: hidden; background: var(--paper); color: var(--ink);
  font: 13px/1.3 -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif; }
#ink { position: fixed; inset: 0; width: 100%; height: 100%; touch-action: none; cursor: crosshair; }
:root[data-tool="eraser"] #ink { cursor: cell; }
:root[data-tool="select"] #ink { cursor: default; }
:root[data-tool="text"] #ink { cursor: text; }
#editor { position: fixed; margin: 0; padding: 0; border: 0; background: transparent; resize: none; overflow: hidden;
  white-space: pre; outline: 1px dashed var(--select); outline-offset: 4px; border-radius: 0; z-index: 1;
  caret-color: var(--select); }
#name { position: fixed; top: 14px; left: 16px; width: min(360px, calc(100% - 32px)); padding: 6px 8px;
  border: 0; border-radius: 8px; background: transparent; color: var(--ink);
  font-family: inherit; font-size: 15px; font-weight: 600; line-height: 1.2; outline: none; }
#name::placeholder { color: var(--muted); }
#name:hover { background: var(--hover); }
#name:focus { background: var(--bar); box-shadow: 0 0 0 1px var(--bar-line); }
#bar { position: fixed; left: 0; right: 0; bottom: 18px; margin: 0 auto; width: max-content;
  display: flex; align-items: center; gap: 4px; padding: 6px; max-width: calc(100% - 24px); flex-wrap: wrap;
  justify-content: center; background: var(--bar); border: 1px solid var(--bar-line); border-radius: 14px;
  box-shadow: 0 6px 24px rgba(0,0,0,.12); backdrop-filter: blur(12px); }
.group { display: flex; align-items: center; gap: 2px; }
.sep { width: 1px; height: 20px; background: var(--bar-line); margin: 0 4px; }
button { all: unset; display: grid; place-items: center; width: 30px; height: 30px; border-radius: 8px;
  color: var(--ink); cursor: default; }
button:hover:not(:disabled) { background: var(--hover); }
button[aria-pressed="true"] { background: var(--on); }
button:disabled { opacity: .35; }
button:focus-visible { box-shadow: 0 0 0 2px var(--muted); }
button svg { width: 18px; height: 18px; fill: none; stroke: currentColor; stroke-width: 1.7;
  stroke-linecap: round; stroke-linejoin: round; }
.dot { width: 16px; height: 16px; border-radius: 50%; background: var(--c); box-shadow: inset 0 0 0 1px rgba(0,0,0,.12); }
[data-color="ink"] .dot { background: var(--ink); }
[data-size] .dot { background: var(--ink); box-shadow: none; }
[data-size] .a { display: none; font-weight: 600; line-height: 1; color: var(--ink); }
:root[data-sizes="text"] [data-size] .dot { display: none; }
:root[data-sizes="text"] [data-size] .a { display: block; }
#broken { position: fixed; inset: 0; display: grid; place-items: center; color: var(--muted); font-size: 14px; }
`;

  const svg = d => `<svg viewBox="0 0 24 24" aria-hidden="true">${d}</svg>`;
  const ICONS = {
    select: svg('<path d="M6 4l12 7.5-5.2 1.3L10 18z"/>'),
    rect: svg('<rect x="4.5" y="6" width="15" height="12" rx="2"/>'),
    ellipse: svg('<ellipse cx="12" cy="12" rx="8" ry="6.5"/>'),
    arrow: svg('<path d="M5 19L19 5"/><path d="M10.5 5H19v8.5"/>'),
    text: svg('<path d="M6 7V5h12v2"/><path d="M12 5v14"/><path d="M9.5 19h5"/>'),
    pen: svg('<path d="M4 20l1-4L16 5a2.1 2.1 0 0 1 3 3L8 19z"/><path d="M14 7l3 3"/>'),
    eraser: svg('<path d="M8 20h12"/><path d="M5.5 15.5l9-9a2 2 0 0 1 2.8 0l1.2 1.2a2 2 0 0 1 0 2.8L11 18H7.5z"/><path d="M10 11l4 4"/>'),
    undo: svg('<path d="M9 14L4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>'),
    redo: svg('<path d="M15 14l5-5-5-5"/><path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13"/>'),
    clear: svg('<path d="M5 7h14"/><path d="M10 7V5h4v2"/><path d="M7 7l1 12h8l1-12"/>'),
  };
  const COLOR_NAMES = { ink: "Ink", "#e5484d": "Red", "#f76b15": "Orange", "#ffc53d": "Yellow",
    "#30a46c": "Green", "#0090ff": "Blue", "#8e4ec6": "Purple" };
  const SIZE_NAMES = { 2: "Thin", 5: "Medium", 10: "Thick" };
  const TEXT_BUTTON_PX = { 2: 11, 5: 14, 10: 18 };   // the "A" on each size button for text

  // tiny hash so a changed file gets a new URL (no stale cached copy after an update)
  const hash = s => { let h = 5381; for (let i = 0; i < s.length; i++) h = (h * 33 + s.charCodeAt(i)) >>> 0; return h.toString(36); };

  function files() {
    const js = `// Almost Arc easel page. Written by arcEasel.uc.js; edits here are overwritten.\n(${easelPage.toString()})();\n`;
    const colors = Object.entries(COLOR_NAMES).map(([c, n]) =>
      `<button data-color="${c}" title="${n}" aria-label="${n}"><span class="dot" style="--c:${c === "ink" ? "var(--ink)" : c}"></span></button>`).join("");
    const sizes = Object.entries(SIZE_NAMES).map(([s, n]) =>
      `<button data-size="${s}" title="${n}" aria-label="${n}"><span class="dot" style="width:${Number(s) + 3}px;height:${Number(s) + 3}px"></span><span class="a" style="font-size:${TEXT_BUTTON_PX[s]}px">A</span></button>`).join("");
    const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src chrome:; style-src chrome: 'unsafe-inline'; img-src chrome: data:">
<title>Untitled Easel</title>
<link rel="icon" href="icon.svg">
<link rel="stylesheet" href="easel.css?${hash(CSS)}">
</head>
<body>
<canvas id="ink"></canvas>
<input id="name" type="text" placeholder="Untitled Easel" aria-label="Easel name" spellcheck="false" autocomplete="off">
<div id="bar" role="toolbar" aria-label="Drawing tools">
  <div class="group" id="tools">
    <button data-tool="select" title="Select: drag a box, or click; then drag to move, Delete to remove" aria-label="Select">${ICONS.select}</button>
    <button data-tool="pen" title="Pen" aria-label="Pen">${ICONS.pen}</button>
    <button data-tool="text" title="Text: click to type" aria-label="Text">${ICONS.text}</button>
    <button data-tool="rect" title="Rectangle (Shift: square)" aria-label="Rectangle">${ICONS.rect}</button>
    <button data-tool="ellipse" title="Ellipse (Shift: circle)" aria-label="Ellipse">${ICONS.ellipse}</button>
    <button data-tool="arrow" title="Arrow (Shift: straight or 45 degrees)" aria-label="Arrow">${ICONS.arrow}</button>
    <button data-tool="eraser" title="Eraser" aria-label="Eraser">${ICONS.eraser}</button>
  </div>
  <div class="sep"></div>
  <div class="group" id="colors">${colors}</div>
  <div class="sep"></div>
  <div class="group" id="sizes">${sizes}</div>
  <div class="sep"></div>
  <div class="group">
    <button id="undo" title="Undo (Cmd+Z)" aria-label="Undo">${ICONS.undo}</button>
    <button id="redo" title="Redo (Cmd+Shift+Z)" aria-label="Redo">${ICONS.redo}</button>
    <button id="clear" title="Clear (Cmd+Z brings it back)" aria-label="Clear">${ICONS.clear}</button>
  </div>
</div>
<textarea id="editor" hidden wrap="off" spellcheck="false" aria-label="Text"></textarea>
<div id="broken" hidden>This easel's address is broken, so there's nothing to show.</div>
<script src="easel.js?${hash(js)}"></script>
</body>
</html>
`;
    const icon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><rect x="1.5" y="1.5" width="13" height="13" rx="3" fill="none" stroke="#8a8780" stroke-width="1.4"/><path d="M4.5 10.5c1.5-3 3-4 4-2.5s2 .5 3-2" fill="none" stroke="#8a8780" stroke-width="1.4" stroke-linecap="round"/></svg>\n`;
    return {
      "easel.html": html,
      "easel.css": CSS,
      "easel.js": js,
      "icon.svg": icon,
      // for Zen's + menu: drawn in the menu's text color, like Zen's own icons there
      "menu-icon.svg": `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="none" stroke="context-fill" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><path d="M2.75 13.25l.75-3 7.75-7.75a1.4 1.4 0 0 1 2 2L5.5 12.25z"/><path d="M9.75 4l2 2"/></svg>\n`,
      "easel.manifest": `content ${HOST} ./\n`,
    };
  }

  // ---- registering chrome://almostarc-easel/ ----------------------------------
  function registered() {
    try {
      Cc["@mozilla.org/chrome/chrome-registry;1"].getService(Ci.nsIChromeRegistry)
        .convertChromeURL(Services.io.newURI(`${PREFIX}easel.html`));
      return true;
    } catch (e) { return false; }
  }
  function register() {
    if (registered()) return true;
    const f = Cc["@mozilla.org/file/local;1"].createInstance(Ci.nsIFile);
    f.initWithPath(MANIFEST);
    if (!f.exists()) return false;
    Components.manager.QueryInterface(Ci.nsIComponentRegistrar).autoRegister(f);
    return registered();
  }

  const isEasel = uri => String(uri || "").startsWith(PREFIX);

  async function setup() {
    // Right away if the files are there from last time: a restored easel tab may load soon.
    try { register(); } catch (e) { console.warn("[arcEasel]", e); }
    let changed = false;
    await IOUtils.makeDirectory(DIR, { ignoreExisting: true });
    for (const [name, text] of Object.entries(files())) {
      const path = PathUtils.join(DIR, name);
      let old = null;
      try { old = await IOUtils.readUTF8(path); } catch (e) {}
      if (old !== text) { await IOUtils.writeUTF8(path, text, { tmpPath: `${path}.tmp` }); changed = true; }
    }
    if (!register()) throw new Error("couldn't register the easel page");
    // An easel tab that loaded before the page was there shows an error page: load it again.
    for (const tab of gBrowser.tabs) {
      const b = tab.linkedBrowser;
      if (!b || tab.hasAttribute("pending") || !isEasel(b.currentURI?.spec)) continue;
      const shown = b.documentURI?.spec;
      if (shown && !isEasel(shown)) b.reload();
    }
    return changed;
  }

  // ---- New Easel -----------------------------------------------------------
  function newId() {
    const bytes = crypto.getRandomValues(new Uint8Array(8));
    return Array.from(bytes, x => x.toString(16).padStart(2, "0")).join("");
  }
  let ready = null;
  async function openEasel() {
    try { await ready; } catch (e) { console.warn("[arcEasel]", e); return; }
    const tab = gBrowser.addTab(`${PREFIX}easel.html#${newId()}`, {
      triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal(),
    });
    gBrowser.selectedTab = tab;
  }

  // ref: the item to put it after (before, with before: true); not there: at the top
  function menuItem(id, popup, ref, { before = false, image = null } = {}) {
    if (!popup || document.getElementById(id)) return;
    const item = document.createXULElement("menuitem");
    item.id = id;
    item.setAttribute("label", "New Easel");
    if (image) item.setAttribute("image", image);
    item.addEventListener("command", openEasel);
    const at = ref && popup.querySelector(ref);
    if (at) before ? at.before(item) : at.after(item);
    else popup.prepend(item);
  }
  // Zen's + button at the bottom of the sidebar: just above its New Tab
  const PLUS_POPUP = "zenCreateNewPopup";
  const addToPlus = () => menuItem("almost-arc-new-easel-plus", document.getElementById(PLUS_POPUP),
    'menuitem[command="cmd_newNavigatorTab"]', { before: true, image: `${PREFIX}menu-icon.svg` });

  ready = setup().catch(e => { console.warn("[arcEasel]", e); throw e; });
  ready.catch(() => {});
  try {
    menuItem("almost-arc-new-easel", document.getElementById("menu_FilePopup"), "#menu_newNavigatorTab");
    menuItem("almost-arc-new-easel-tab", document.getElementById("tabContextMenu"), "#context_openANewTab");
    addToPlus();
  } catch (e) { console.warn("[arcEasel]", e); }
  // in case Zen builds the + menu later
  window.addEventListener("popupshowing", e => {
    if (e.target?.id === PLUS_POPUP) try { addToPlus(); } catch (err) { console.warn("[arcEasel]", err); }
  }, true);
  // Keys in an easel tab: after a click in the easel, its own (Cmd+Z undoes the drawing);
  // after a click anywhere else in Zen (the sidebar…), Zen's (Cmd+Z undoes tab changes,
  // arcTabUndo.uc.js), even though the easel page keeps the keyboard focus (owner, 2026-11-19).
  // The page reads <html data-keys="easel|browser">; switching to an easel tab starts as Zen's.
  const easelDocOf = t => { const d = t?.ownerDocument || t; return isEasel(d?.documentURI) ? d : null; };
  function keysTo(doc, who) { try { if (doc?.documentElement) doc.documentElement.dataset.keys = who; } catch (e) {} }
  function selectedEaselDoc() {
    try { const d = gBrowser.selectedBrowser?.contentDocument; return isEasel(d?.documentURI) ? d : null; } catch (e) { return null; }
  }
  try {
    const root = window.windowRoot;   // sees events in Zen's window and in easel pages (in-process)
    root.addEventListener("pointerdown", e => {
      const d = easelDocOf(e.target);
      if (d) keysTo(d, "easel");
      else keysTo(selectedEaselDoc(), "browser");
    }, true);
    root.addEventListener("DOMContentLoaded", e => {
      const d = easelDocOf(e.target);
      if (d && d === selectedEaselDoc()) keysTo(d, "browser");
    }, true);
    gBrowser.tabContainer.addEventListener("TabSelect", () => keysTo(selectedEaselDoc(), "browser"));
  } catch (e) { console.warn("[arcEasel]", e); }

  // ---- several windows ----------------------------------------------------
  // Zen keeps a copy of every tab in each window (zen.window-sync, same tab.id) and shows
  // a tab's page in the window where you select it by swapping docshells between them.
  // That doesn't work for an easel (a page in Zen's own process): 1.2.8 showed a blank page
  // in the other windows, and 1.2.9, which let Zen move it, left a window broken until
  // Zen restarted (owner, 2026-11-20). So Zen never moves an easel: each window shows its
  // own copy of the page (the same drawing file; a copy on screen picks up what another
  // saved), and Zen is told its copy here is already showing (tab._zenContentsVisible,
  // what ZenWindowSync.sys.mjs checks before swapping).
  const EASEL_URL = /^chrome:\/\/almostarc-easel\/content\/easel\.html#[a-z0-9]{8,32}$/;   // PREFIX + easel.html#<id>
  function browserWindows() {
    const out = [];
    try {
      for (const w of Services.wm.getEnumerator("navigator:browser")) if (!w.closed && w.gBrowser) out.push(w);
    } catch (e) {}
    return out;
  }
  // the easel this tab itself shows, or will show when it restores
  function ownEasel(tab) {
    const spec = tab?.linkedPanel && tab.linkedBrowser?.currentURI?.spec;
    if (EASEL_URL.test(spec || "")) return spec;
    if (tab?.hasAttribute?.("pending")) {
      try {
        const state = JSON.parse(SessionStore.getTabState(tab));
        const url = state.entries?.[(state.index || state.entries.length) - 1]?.url;
        if (EASEL_URL.test(url || "")) return url;
      } catch (e) {}
    }
    return null;
  }
  // the easel this tab is (itself, or Zen's copy of one in another window)
  function easelOf(tab) {
    if (!tab) return null;
    const own = ownEasel(tab);
    if (own || !tab.id) return own;
    for (const w of browserWindows()) {
      if (w === tab.ownerGlobal) continue;
      const other = w.document.getElementById(tab.id);
      const url = other?.localName === "tab" ? ownEasel(other) : null;
      if (url) return url;
    }
    return null;
  }
  // a selected easel tab here: shows its own page, and Zen leaves it alone
  const loading = new WeakSet();
  function showHere(tab) {
    const url = easelOf(tab);
    if (!url) return;
    tab._zenContentsVisible = true;
    if (ownEasel(tab)) return;
    // Zen's blank copy: load the easel in it (after Zen's own handling of this switch)
    setTimeout(() => {
      try {
        const b = tab.linkedBrowser;
        if (!tab.selected || tab.closing || tab.hasAttribute("pending") || !b || ownEasel(tab) || loading.has(tab)) return;
        loading.add(tab);
        setTimeout(() => loading.delete(tab), 2000);   // until the load shows in currentURI
        b.loadURI(Services.io.newURI(url), {
          triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal(),
          loadFlags: Ci.nsIWebNavigation?.LOAD_FLAGS_REPLACE_HISTORY ?? 0,
        });
      } catch (e) { console.warn("[arcEasel]", e); }
    }, 0);
  }
  // Zen swaps after TabSelect (in a promise callback, so after these listeners), and only
  // tabs marked visible: a switch away from an easel unmarks it, so Zen doesn't move it into
  // another window that has the same easel selected.
  function onSelect(e) {
    try {
      const prev = e?.detail?.previousTab;
      if (prev && easelOf(prev)) delete prev._zenContentsVisible;
      showHere(gBrowser.selectedTab);
    } catch (err) { console.warn("[arcEasel]", err); }
  }
  function showSelected() { try { showHere(gBrowser.selectedTab); } catch (e) { console.warn("[arcEasel]", e); } }
  // Closing a window, Zen moves the tabs it shows into another window: not easels.
  function closing() {
    try { for (const t of gBrowser.tabs) if (easelOf(t)) delete t._zenContentsVisible; } catch (e) {}
  }

  // Zen's top toolbar hides while an easel tab is selected (chrome.css, :root[almost-arc-easel])
  function syncToolbar() {
    document.documentElement.toggleAttribute("almost-arc-easel",
      isEasel(gBrowser.selectedBrowser?.currentURI?.spec) || !!easelOf(gBrowser.selectedTab));
  }
  try {
    gBrowser.tabContainer.addEventListener("TabSelect", onSelect);
    gBrowser.tabContainer.addEventListener("TabSelect", syncToolbar);
    gBrowser.addTabsProgressListener({
      onLocationChange(browser) { if (browser === gBrowser.selectedBrowser) syncToolbar(); },
    });
    gBrowser.addProgressListener?.({
      onLocationChange() {
        syncToolbar();
        keysTo(selectedEaselDoc(), "browser");
      },
    });
    window.addEventListener("activate", showSelected, true);
    window.addEventListener("DOMWindowClose", closing, true);
    window.addEventListener("close", closing, true);
    syncToolbar();
    setTimeout(showSelected, 0);
  } catch (e) { console.warn("[arcEasel]", e); }
  window.__arcEaselOpen = openEasel;
})();
