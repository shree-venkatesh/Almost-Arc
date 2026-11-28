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
    if (isMac()) appIconGroup(doc, main);

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
    const radios = doc.createXULElement("radiogroup");
    const opt = (value, label) => {
      const r = doc.createXULElement("radio");
      r.setAttribute("value", value);
      r.setAttribute("label", label);
      radios.appendChild(r);
      return r;
    };
    opt("almost-arc", "Almost Arc");
    opt("zen", "Zen");
    const status = doc.createXULElement("description");
    status.className = "description-deemphasized";
    status.hidden = true;
    group.append(l, desc, radios, status);
    main.appendChild(group);

    const say = text => { status.textContent = text; status.hidden = !text; };
    const bundle = appBundle();
    let dir = null, current = "";
    radios.disabled = true;
    (async () => {
      dir = await installDir();
      current = (await hasOurIcon(bundle)) ? "almost-arc" : "zen";
      radios.value = current;
      if (!dir) { say("Available when Almost Arc is installed with Homebrew, the installer, the curl command or install.sh."); return; }
      radios.disabled = false;
    })();

    radios.addEventListener("command", async () => {
      const choice = radios.value;
      if (!dir || choice === current) return;
      radios.disabled = true;
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
        radios.value = current;
        const sudo = last.includes("couldn't") ? "sudo " : "";
        say(`${last.replace(/^Error: /, "Couldn't change it: ")} To do it in Terminal: ${sudo}"${PathUtils.join(dir, "app-icon.sh")}" ${choice}`);
      }
      radios.disabled = false;
    });
  }

  function onLoad(e) {
    const doc = e.target;
    if (!doc?.documentURI?.startsWith?.("about:preferences") && !doc?.documentURI?.startsWith?.("about:settings")) return;
    try { build(doc); } catch (err) { console.error("Almost Arc settings:", err); }
  }
  window.windowRoot.addEventListener("DOMContentLoaded", onLoad, true);
})();
