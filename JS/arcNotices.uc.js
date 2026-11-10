// ==UserScript==
// @name           Almost Arc notices
// @description    Marks the window so chrome.css knows the scripts loaded (it shows a
//                 "scripts aren't running" notice otherwise), and shows a notice when a
//                 newer Almost Arc release is out (install.sh installs only).
// ==/UserScript==

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

(function () {
  // 1. The scripts loaded. chrome.css hides its "scripts aren't running" notice.
  document.documentElement.setAttribute("almost-arc-js", "true");

  // 2. New-release notice.
  const P = "almost-arc.update-notice";
  try { Services.prefs.getDefaultBranch("").setBoolPref(P, true); } catch (e) {}
  if (window.__arcNotices || !Services.prefs.getBoolPref(P, true)) return;
  window.__arcNotices = true;

  const REPO = "shree-venkatesh/Almost-Arc";
  const LAST = "almost-arc.update-last-check";   // seconds since epoch
  const LATEST = "almost-arc.update-latest";     // newest release seen, "1.2.0"
  const SKIP = "almost-arc.update-skip";         // "Skip this version"
  // Default-branch prefs aren't saved, so this lasts one session: one window per session shows it.
  const SHOWN = "almost-arc.update-shown-this-session";

  const parse = v => String(v).replace(/^v/, "").split(".").map(n => parseInt(n, 10) || 0);
  function newer(a, b) {
    const x = parse(a), y = parse(b);
    for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0);
    return false;
  }

  async function check() {
    // install.sh writes this file. Sine installs don't have it (Sine updates mods itself).
    let info;
    try {
      info = await IOUtils.readJSON(PathUtils.join(PathUtils.profileDir, "chrome", "almost-arc-install.json"));
    } catch (e) { return; }
    if (!info?.version) return;

    const now = Math.floor(Date.now() / 1000);
    let latest = Services.prefs.getStringPref(LATEST, "");
    if (now - Services.prefs.getIntPref(LAST, 0) > 86400) {   // at most once a day
      Services.prefs.setIntPref(LAST, now);
      try {
        const r = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`,
                              { headers: { Accept: "application/vnd.github+json" } });
        if (r.ok) {
          const tag = String((await r.json()).tag_name || "").replace(/^v/, "");
          if (/^\d+\.\d+\.\d+$/.test(tag)) { latest = tag; Services.prefs.setStringPref(LATEST, tag); }
        }
      } catch (e) {}
    }
    if (!latest || !newer(latest, info.version)) return;
    if (Services.prefs.getStringPref(SKIP, "") === latest) return;
    if (Services.prefs.getDefaultBranch("").getBoolPref(SHOWN, false)) return;
    Services.prefs.getDefaultBranch("").setBoolPref(SHOWN, true);
    show(latest, info);
  }

  async function show(latest, info) {
    const cmd = info.method === "cli" ? "almost-arc update"
                                      : `cd "${info.dir}" && git pull && ./install.sh`;
    try {
      const box = window.gNotificationBox || gBrowser.getNotificationBox();
      await box.appendNotification("almost-arc-update", {
        label: `Almost Arc ${latest} is out (you have ${info.version}). Quit Zen and run: ${cmd}`,
        priority: box.PRIORITY_INFO_MEDIUM,
      }, [
        { label: "Copy command", callback: () => {
            Cc["@mozilla.org/widget/clipboardhelper;1"].getService(Ci.nsIClipboardHelper).copyString(cmd);
            return true;   // keep the notice open
          } },
        { label: "What's new", callback: () => {
            openTrustedLinkIn(`https://github.com/${REPO}/releases/tag/v${latest}`, "tab");
          } },
        { label: "Skip this version", callback: () => { Services.prefs.setStringPref(SKIP, latest); } },
      ]);
    } catch (e) {}
  }

  setTimeout(() => { check().catch(() => {}); }, 10000);
})();
