// ==UserScript==
// @name           Almost Arc settings
// @description    An "Almost Arc" tab in Zen's settings (about:preferences), next to
//                 Zen's Mods, with the same settings as the mod's Sine page.
// @include        chrome://browser/content/browser.xhtml
// ==/UserScript==

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// about:preferences runs in Zen's own process, so its load events reach this
// window's windowRoot. On each load the tab is added the way Zen adds its own:
// a moz-page-nav-button with view="paneAlmostArc", register_module(), and groups
// with data-category="paneAlmostArc" in #mainPrefPane (gotoPref shows them).
// Works for every install method (Sine, install.sh, Homebrew, the .pkg).

(function () {
  if (window.__almostArcSettings) return;
  window.__almostArcSettings = true;

  const PANE = "paneAlmostArc";

  // Same as preferences.json (tests/settings.test.mjs keeps them equal).
  const SETTINGS = [
    {
      "type": "separator",
      "label": "Almost Arc"
    },
    {
      "property": "almost-arc.domain-only",
      "label": "Show only the domain in the URL bar while not typing (restart Zen)",
      "type": "checkbox",
      "defaultValue": false
    },
    {
      "property": "almost-arc.tab-undo",
      "label": "Cmd+Z undoes your tab changes from this session (close, move, pin/unpin), like Arc (restart Zen)",
      "type": "checkbox",
      "defaultValue": true
    },
    {
      "type": "separator",
      "label": "Recommended Zen / Firefox settings"
    },
    {
      "property": "zen.view.use-single-toolbar",
      "label": "Single toolbar — turn **OFF** for the Arc layout",
      "type": "checkbox"
    },
    {
      "property": "zen.view.compact.hide-toolbar",
      "label": "Hide toolbar in compact mode — turn **OFF** so the toolbar stays like Arc",
      "type": "checkbox"
    },
    {
      "property": "zen.urlbar.behavior",
      "label": "Address bar opens as a floating popup — choose **Always** for Arc's command bar",
      "type": "dropdown",
      "options": [
        {
          "label": "Always (Arc)",
          "value": "float"
        },
        {
          "label": "Only when typing (Zen default)",
          "value": "floating-on-type"
        },
        {
          "label": "Never",
          "value": "normal"
        }
      ]
    },
    {
      "property": "browser.urlbar.trimURLs",
      "label": "Trim URLs — on by default, leave **ON** (the URL pill needs it)",
      "type": "checkbox"
    },
    {
      "property": "browser.urlbar.trimHttps",
      "label": "Hide https:// — on by default in Zen, leave **ON**",
      "type": "checkbox"
    },
    {
      "property": "browser.urlbar.trimWww",
      "label": "Hide www. — turn **ON** to show google.com like Arc",
      "type": "checkbox"
    },
    {
      "property": "browser.urlbar.formatting.enabled",
      "label": "Dim the URL path, keep the domain bright — turn **ON**",
      "type": "checkbox"
    },
    {
      "type": "separator",
      "label": "Arc-style auto Picture-in-Picture"
    },
    {
      "property": "media.videocontrols.picture-in-picture.enable-when-switching-tabs.enabled",
      "label": "Auto PiP when switching tabs",
      "type": "checkbox"
    },
    {
      "property": "almost-arc.pip-when-covered",
      "label": "Auto PiP when Zen is minimized or fully covered by other windows — macOS (restart Zen)",
      "type": "checkbox",
      "defaultValue": true
    },
    {
      "property": "almost-arc.pip-on-blur",
      "label": "Arc-style auto PiP when you switch to another app or desktop — macOS (restart Zen)",
      "type": "checkbox",
      "defaultValue": true
    },
    {
      "property": "almost-arc.pip-layout",
      "label": "Arc's PiP controls: Back to Tab, Minimize, Close, 15 s skips, slim progress bar (applies to new PiP windows)",
      "type": "checkbox",
      "defaultValue": true
    },
    {
      "property": "almost-arc.pip-flick",
      "label": "Two-finger swipe over a PiP window sends it to a screen corner, like Arc (applies to new PiP windows)",
      "type": "checkbox",
      "defaultValue": true
    },
    {
      "property": "almost-arc.arc-color-wheel",
      "label": "Arc-style color wheel in Zen's space theme picker (restart Zen)",
      "type": "checkbox",
      "defaultValue": true
    },
    {
      "property": "almost-arc.easel",
      "label": "Easels: \"New Easel\" in the sidebar's + menu, the File menu and the tab menu opens a tab you can draw in (restart Zen)",
      "type": "checkbox",
      "defaultValue": true
    }
  ];

  // "turn **OFF** for ..." -> "turn OFF for ..." (labels are plain text here)
  const plain = s => String(s).replace(/\*\*/g, "");

  function readPref(item) {
    const { property: p, type, defaultValue } = item;
    try {
      if (type === "checkbox") return Services.prefs.getBoolPref(p, defaultValue ?? false);
      return Services.prefs.getStringPref(p, defaultValue ?? "");
    } catch (e) { return type === "checkbox" ? false : ""; }
  }
  function writePref(item, value) {
    try {
      if (item.type === "checkbox") Services.prefs.setBoolPref(item.property, !!value);
      else Services.prefs.setStringPref(item.property, String(value));
    } catch (e) {}
  }

  function control(doc, item) {
    const label = plain(item.label);
    if (item.type === "checkbox") {
      const cb = doc.createXULElement("checkbox");
      cb.setAttribute("label", label);
      cb.setAttribute("tooltiptext", item.property);
      cb.checked = readPref(item);
      cb.addEventListener("command", () => writePref(item, cb.checked));
      return { el: cb, update: () => { cb.checked = readPref(item); } };
    }
    const box = doc.createXULElement("hbox");
    box.setAttribute("align", "center");
    const name = doc.createXULElement("label");
    name.textContent = label;
    name.setAttribute("tooltiptext", item.property);
    if (item.type === "dropdown") {
      const list = doc.createXULElement("menulist");
      const popup = doc.createXULElement("menupopup");
      for (const o of item.options || []) {
        const mi = doc.createXULElement("menuitem");
        mi.setAttribute("label", plain(o.label));
        mi.setAttribute("value", String(o.value));
        popup.appendChild(mi);
      }
      list.appendChild(popup);
      list.value = readPref(item);
      list.addEventListener("command", () => writePref(item, list.value));
      box.append(name, list);
      return { el: box, update: () => { list.value = readPref(item); } };
    }
    // "string"
    const input = doc.createElement("input");
    input.type = "text";
    input.value = readPref(item);
    input.addEventListener("change", () => writePref(item, input.value));
    box.append(name, input);
    return { el: box, update: () => { if (doc.activeElement !== input) input.value = readPref(item); } };
  }

  function build(doc) {
    const nav = doc.getElementById("categories");
    const main = doc.getElementById("mainPrefPane");
    const win = doc.defaultView;
    if (!nav || !main || typeof win.register_module !== "function" || doc.getElementById("category-almost-arc")) return false;

    // the tab, right after Zen's Mods
    const btn = doc.createElement("moz-page-nav-button");
    btn.id = "category-almost-arc";
    btn.setAttribute("view", PANE);
    btn.setAttribute("iconsrc", "chrome://global/skin/icons/settings.svg");
    btn.textContent = "Almost Arc";
    const after = doc.getElementById("category-zen-marketplace");
    if (after?.parentNode === nav) after.after(btn); else nav.appendChild(btn);

    // the page: a heading, then one group per section of the settings list
    const heading = doc.createXULElement("hbox");
    heading.id = "almostArcCategory";
    heading.className = "subcategory";
    heading.setAttribute("data-category", PANE);
    heading.hidden = true;
    const h1 = doc.createElement("h1");
    h1.textContent = "Almost Arc";
    heading.appendChild(h1);
    main.appendChild(heading);

    if (isMac()) appIconGroup(doc, main);   // first: it's the one people look for

    const controls = new Map();   // pref -> [update()]
    let group = null;
    const newGroup = title => {
      group = doc.createXULElement("groupbox");
      group.className = "highlighting-group";
      group.setAttribute("data-category", PANE);
      group.hidden = true;
      if (title) {
        const l = doc.createXULElement("label");
        const h2 = doc.createElement("h2");
        h2.textContent = plain(title);
        l.appendChild(h2);
        group.appendChild(l);
      }
      main.appendChild(group);
    };
    for (const item of SETTINGS) {
      if (item.type === "separator") { newGroup(item.label); continue; }
      if (!group) newGroup("");
      const c = control(doc, item);
      group.appendChild(c.el);
      if (!controls.has(item.property)) controls.set(item.property, []);
      controls.get(item.property).push(c.update);
    }
    const note = doc.createXULElement("description");
    note.className = "description-deemphasized";
    note.textContent = "Settings marked \"restart Zen\" take effect after you quit and reopen Zen.";
    group?.appendChild(note);

    // keep the page in step with changes made elsewhere (about:config, Sine)
    const observer = { observe: (s, t, pref) => controls.get(pref)?.forEach(u => u()) };
    for (const p of controls.keys()) Services.prefs.addObserver(p, observer);
    win.addEventListener("unload", () => {
      for (const p of controls.keys()) Services.prefs.removeObserver(p, observer);
    }, { once: true });

    // Registered before preferences.js's own DOMContentLoaded handler (init_all)
    // runs, since this one listens on windowRoot in the capture phase: its first
    // gotoPref then knows the pane, so about:preferences#almostArc opens on it.
    win.register_module(PANE, { init() {} });
    return true;
  }

  // ---- App icon (macOS): Almost Arc's or Zen's own, in the Dock and Finder ----
  // Runs the copy of app-icon.sh that install.sh puts in <profile>/chrome/almost-arc-app
  // (1.2.11 used the folder install.sh ran from, recorded in almost-arc-install.json,
  // but Homebrew's --beta runs it from a temporary folder that's then deleted; that
  // folder is still tried for installs from before the copy). Sine installs never
  // set the icon and have neither, so the choice is shown but off there.
  const ICON_PREF = "almost-arc.app-icon";
  try { Services.prefs.getDefaultBranch("").setStringPref(ICON_PREF, "almost-arc"); } catch (e) {}
  const isMac = () => { try { return Services.appinfo.OS === "Darwin"; } catch (e) { return false; } };
  const appBundle = () => {
    const res = Services.dirsvc.get("GreD", Ci.nsIFile).path;   // .../Zen.app/Contents/Resources
    return res.replace(/\/Contents\/Resources\/?$/, "");
  };
  async function installDir() {
    const copy = PathUtils.join(PathUtils.profileDir, "chrome", "almost-arc-app");
    try { if (await IOUtils.exists(PathUtils.join(copy, "app-icon.sh"))) return copy; } catch (e) {}
    try {
      const info = await IOUtils.readJSON(PathUtils.join(PathUtils.profileDir, "chrome", "almost-arc-install.json"));
      if (info?.dir && await IOUtils.exists(PathUtils.join(info.dir, "app-icon.sh"))) return info.dir;
    } catch (e) {}
    return null;
  }
  const hasOurIcon = async bundle => { try { return await IOUtils.exists(bundle + "/Icon\r"); } catch (e) { return false; } };

  const ICON_CSS = `
    .arc-icon-choices { gap: 12px; margin-block: 8px 4px; }
    .arc-icon-choice {
      align-items: center; gap: 8px; padding: 12px 18px 10px; cursor: pointer;
      border: 2px solid transparent; border-radius: 14px;
    }
    .arc-icon-choice:hover { background: color-mix(in srgb, currentColor 7%, transparent); }
    .arc-icon-choice[selected] { border-color: var(--in-content-accent-color, AccentColor); }
    .arc-icon-choice:focus-visible { outline: 2px solid var(--in-content-focus-outline-color, AccentColor); outline-offset: 2px; }
    .arc-icon-choice > img { width: 72px; height: 72px; object-fit: contain; box-sizing: border-box; }
    /* Zen's logo fills its square; app-icon.png has macOS's icon margin (824 of 1024) */
    .arc-icon-choice[data-value="zen"] > img { padding: 7px; }
    .arc-icon-choices[disabled] { opacity: .55; }
    .arc-icon-choices[disabled] > .arc-icon-choice { cursor: default; background: none; }
  `;

  function appIconGroup(doc, main) {
    const group = doc.createXULElement("groupbox");
    group.className = "highlighting-group";
    group.setAttribute("data-category", PANE);
    group.hidden = true;
    const l = doc.createXULElement("label");
    const h2 = doc.createElement("h2");
    h2.textContent = "App icon";
    l.appendChild(h2);
    const desc = doc.createXULElement("description");
    desc.className = "description-deemphasized";
    desc.textContent = "Zen's icon in the Dock and Finder.";
    const style = doc.createElement("style");
    style.textContent = ICON_CSS;

    // two tiles side by side, each the icon with its name under it
    const tiles = doc.createXULElement("hbox");
    tiles.className = "arc-icon-choices";
    tiles.setAttribute("role", "radiogroup");
    tiles.setAttribute("aria-label", "App icon");
    const tile = (value, name, src) => {
      const t = doc.createXULElement("vbox");
      t.className = "arc-icon-choice";
      t.dataset.value = value;
      t.setAttribute("role", "radio");
      t.setAttribute("tabindex", "0");
      const img = doc.createElement("img");
      img.alt = "";
      if (src) img.src = src;
      const lab = doc.createXULElement("label");
      lab.textContent = name;
      t.append(img, lab);
      tiles.appendChild(t);
      return { t, img };
    };
    const ours = tile("almost-arc", "Almost Arc", "");
    tile("zen", "Zen", "chrome://branding/content/icon128.png");
    const status = doc.createXULElement("description");
    status.className = "description-deemphasized";
    status.hidden = true;
    group.append(style, l, desc, tiles, status);
    main.appendChild(group);

    const say = text => { status.textContent = text; status.hidden = !text; };
    const show = value => {
      for (const t of tiles.children) {
        const on = t.dataset.value === value;
        t.toggleAttribute("selected", on);
        t.setAttribute("aria-checked", String(on));
      }
    };
    let disabled = true;
    const setDisabled = d => { disabled = d; tiles.toggleAttribute("disabled", d); tiles.setAttribute("aria-disabled", String(d)); };
    setDisabled(true);

    const bundle = appBundle();
    let dir = null, current = "";
    (async () => {
      dir = await installDir();
      // the Almost Arc icon, from the copy install.sh keeps (data: images are allowed here)
      try {
        const png = await IOUtils.read(PathUtils.join(dir || "", "assets", "app-icon.png"));
        let bin = "";
        for (let i = 0; i < png.length; i += 0x8000) bin += String.fromCharCode.apply(null, png.subarray(i, i + 0x8000));
        ours.img.src = "data:image/png;base64," + btoa(bin);
      } catch (e) {}
      current = (await hasOurIcon(bundle)) ? "almost-arc" : "zen";
      show(current);
      if (!dir) { say("Available when Almost Arc is installed with Homebrew, the installer, the curl command or install.sh."); return; }
      setDisabled(false);
    })();

    async function choose(choice) {
      if (disabled || !dir || choice === current) return;
      setDisabled(true);
      show(choice);
      say("Changing Zen's icon…");
      let out = "", exitCode = 1;
      try {
        const { Subprocess } = ChromeUtils.importESModule("resource://gre/modules/Subprocess.sys.mjs");
        const proc = await Subprocess.call({
          command: "/bin/bash",
          arguments: [PathUtils.join(dir, "app-icon.sh"), choice, bundle],
          stderr: "stdout",
          environmentAppend: true,
          environment: { ALMOST_ARC_FROM_ZEN: "1", ALMOST_ARC_ICON_REFRESH: "1", PATH: "/usr/bin:/bin:/usr/sbin:/sbin" },
        });
        let chunk;
        while ((chunk = await proc.stdout.readString())) out += chunk;
        ({ exitCode } = await proc.wait());
      } catch (e) { out = "Error: " + e; }
      const last = out.trim().split("\n").pop() || "";
      if (exitCode === 0) {
        current = choice;
        Services.prefs.setStringPref(ICON_PREF, choice);   // install.sh keeps Zen's own icon on updates
        say("Done. If the Dock still shows the old one, it changes the next time you open Zen.");
      } else {
        show(current);
        const sudo = last.includes("couldn't") ? "sudo " : "";
        say(`${last.replace(/^Error: /, "Couldn't change it: ")} To do it in Terminal: ${sudo}"${PathUtils.join(dir, "app-icon.sh")}" ${choice}`);
      }
      setDisabled(false);
    }
    tiles.addEventListener("click", e => { const t = e.target.closest?.(".arc-icon-choice"); if (t) choose(t.dataset.value); });
    tiles.addEventListener("keydown", e => {
      const t = e.target.closest?.(".arc-icon-choice");
      if (!t) return;
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); choose(t.dataset.value); }
      else if (/^Arrow(Left|Right|Up|Down)$/.test(e.key)) {
        e.preventDefault();
        const other = [...tiles.children].find(x => x !== t);
        other?.focus();
      }
    });
  }

  function onLoad(e) {
    const doc = e.target;
    if (!doc?.documentURI?.startsWith?.("about:preferences") && !doc?.documentURI?.startsWith?.("about:settings")) return;
    try { build(doc); } catch (err) { console.error("Almost Arc settings:", err); }
  }
  window.windowRoot.addEventListener("DOMContentLoaded", onLoad, true);
})();
