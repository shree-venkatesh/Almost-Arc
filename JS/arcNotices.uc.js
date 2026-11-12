// ==UserScript==
// @name           Almost Arc notices
// @description    Marks the window so chrome.css knows the scripts loaded (it shows a
//                 "scripts aren't running" notice otherwise), and shows a notice when a
//                 newer Almost Arc release is out (install.sh installs only; installs
//                 made with --beta also hear about newer betas). Its Update button
//                 runs the update in the background, then offers to restart Zen.
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
  // Release channel: newest Release. Beta channel (installed with --beta): newest tag.
  // Each channel keeps its own cache, so switching channels checks again.
  let LAST = "almost-arc.update-last-check";   // seconds since epoch
  let LATEST = "almost-arc.update-latest";     // newest version seen, "1.2.0"
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
    const beta = info.channel === "beta";
    if (beta) { LAST += "-beta"; LATEST += "-beta"; }

    const now = Math.floor(Date.now() / 1000);
    let latest = Services.prefs.getStringPref(LATEST, "");
    if (now - Services.prefs.getIntPref(LAST, 0) > 86400) {   // at most once a day
      Services.prefs.setIntPref(LAST, now);
      try {
        const headers = { Accept: "application/vnd.github+json" };
        let tag = "";
        if (beta) {
          const r = await fetch(`https://api.github.com/repos/${REPO}/tags?per_page=100`, { headers });
          if (r.ok) {
            for (const t of await r.json()) {
              const v = String(t.name || "").replace(/^v/, "");
              if (/^\d+\.\d+\.\d+$/.test(v) && (!tag || newer(v, tag))) tag = v;
            }
          }
        } else {
          const r = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, { headers });
          if (r.ok) tag = String((await r.json()).tag_name || "").replace(/^v/, "");
        }
        if (/^\d+\.\d+\.\d+$/.test(tag)) { latest = tag; Services.prefs.setStringPref(LATEST, tag); }
      } catch (e) {}
    }
    if (!latest || !newer(latest, info.version)) return;
    if (Services.prefs.getStringPref(SKIP, "") === latest) return;
    if (Services.prefs.getDefaultBranch("").getBoolPref(SHOWN, false)) return;
    Services.prefs.getDefaultBranch("").setBoolPref(SHOWN, true);
    show(latest, info, beta);
  }

  // ---- the notice: Update button runs the update in the background ----
  // The mod lives in the profile, so its files can be replaced while Zen runs;
  // they take effect after a restart (which also clears the startup cache).
  const box = () => window.gNotificationBox || gBrowser.getNotificationBox();
  const ID = "almost-arc-update";
  const terminalCmd = (info, beta) => info.method !== "cli" ? `cd "${info.dir}" && git pull && ./install.sh`
                                    : beta ? "almost-arc update --beta" : "almost-arc update";
  const whatsNew = latest => ({ label: "What's new", callback: () => {
    openTrustedLinkIn(`https://github.com/${REPO}/releases/tag/v${latest}`, "tab");
    return true;
  } });

  async function notice(label, buttons, priority = "PRIORITY_INFO_MEDIUM") {
    try {
      const b = box();
      const old = b.getNotificationWithValue?.(ID);
      if (old) b.removeNotification(old);
      await b.appendNotification(ID, { label, priority: b[priority] }, buttons);
    } catch (e) {}
  }

  function show(latest, info, beta) {
    notice(`Almost Arc ${latest} is out (you have ${info.version}).`, [
      { label: "Update", callback: () => { update(latest, info, beta); return true; } },
      whatsNew(latest),
      { label: "Skip this version", callback: () => { Services.prefs.setStringPref(SKIP, latest); } },
    ]);
  }

  // Which command to run, as { command, arguments }.
  async function updateCommand(info, beta) {
    if (info.method !== "cli") {
      return { command: "/bin/bash", arguments: ["-c", 'cd "$1" && git pull --ff-only && ./install.sh', "almost-arc", info.dir] };
    }
    const home = Services.dirsvc.get("Home", Ci.nsIFile).path;
    for (const c of ["/opt/homebrew/bin/almost-arc", "/usr/local/bin/almost-arc", `${home}/.almost-arc/bin/almost-arc`]) {
      if (await IOUtils.exists(c)) return { command: c, arguments: beta ? ["update", "--beta"] : ["update"] };
    }
    return null;
  }

  let updating = false;
  async function update(latest, info, beta) {
    if (updating) return;
    updating = true;
    const failed = why => notice(
      `Couldn't update Almost Arc (${why}). Quit Zen and run in Terminal: ${terminalCmd(info, beta)}`, [
        { label: "Copy command", callback: () => {
            Cc["@mozilla.org/widget/clipboardhelper;1"].getService(Ci.nsIClipboardHelper)
              .copyString(terminalCmd(info, beta));
            return true;
          } },
        whatsNew(latest),
      ], "PRIORITY_WARNING_MEDIUM");
    try {
      const cmd = await updateCommand(info, beta);
      if (!cmd) { updating = false; return failed("the almost-arc command wasn't found"); }
      await notice(`Updating Almost Arc to ${latest}…`, []);
      const { Subprocess } = ChromeUtils.importESModule("resource://gre/modules/Subprocess.sys.mjs");
      const proc = await Subprocess.call({
        ...cmd,
        stderr: "stdout",
        environmentAppend: true,
        environment: {
          // install.sh: Zen is open on purpose, don't ask for a password (no Terminal to type it in)
          ALMOST_ARC_FROM_ZEN: "1",
          PATH: "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin",
        },
      });
      const killer = setTimeout(() => proc.kill(), 10 * 60 * 1000);
      let out = "", chunk;
      while ((chunk = await proc.stdout.readString())) out += chunk;
      const { exitCode } = await proc.wait();
      clearTimeout(killer);
      updating = false;
      try {   // for troubleshooting
        await IOUtils.writeUTF8(PathUtils.join(PathUtils.profileDir, "almost-arc-update.log"), out);
      } catch (e) {}
      if (exitCode !== 0) return failed(`exit code ${exitCode}; details in almost-arc-update.log in your profile`);
      notice(`Almost Arc ${latest} is installed. Restart Zen to use it.`, [
        { label: "Restart Zen", callback: () => {
            Services.appinfo.invalidateCachesOnRestart();   // = about:support > Clear startup cache
            Services.startup.quit(Ci.nsIAppStartup.eAttemptQuit | Ci.nsIAppStartup.eRestart);
          } },
        whatsNew(latest),
      ]);
    } catch (e) {
      updating = false;
      failed(String(e?.message || e));
    }
  }

  setTimeout(() => { check().catch(() => {}); }, 10000);
})();
