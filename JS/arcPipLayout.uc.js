// ==UserScript==
// @name           Arc PiP layout
// @description    Arc's Picture-in-Picture controls: "Back to Tab", the site's domain,
//                 "Minimize" (closes PiP, video keeps playing) and "Close" across the top;
//                 big play/pause with 15 s skips in the middle; a slim progress-bar pill
//                 at the bottom. Keeps Firefox's volume controls (bottom right).
// @include        chrome://global/content/pictureinpicture/player.xhtml
// ==/UserScript==

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

(function () {
  // List the setting in about:config with its default.
  try {
    Services.prefs.getDefaultBranch("").setBoolPref("almost-arc.pip-layout", true);
  } catch (e) {}
  if (!Services.prefs.getBoolPref("almost-arc.pip-layout", true)) return;
  if (window.__arcPipLayout) return;

  const d = document, $ = id => d.getElementById(id);
  const controls = $("controls");
  // Leave Firefox's layout alone if the PiP markup isn't what we expect.
  if (!controls || !$("unpip") || !$("close") || !$("scrubber") || !d.querySelector(".center-controls")) return;
  window.__arcPipLayout = true;

  // ---- settings ----
  const SEEK_SECS = 15;     // skip length for the side buttons
  const SCRIM     = 0.5;    // how dark the video gets on hover (0-1)
  const SHOW_WWW  = true;   // show "www." in the domain, like Arc's screenshot
  const BAR_INSET = 12;     // progress bar gap from the sides and bottom (px)
  const BAR_H     = 5;      // progress bar thickness (px)

  const XHTML = "http://www.w3.org/1999/xhtml", SVGNS = "http://www.w3.org/2000/svg";

  // ---- styles (loaded as a sheet, which the PiP window's CSP allows) ----
  const css = `
    /* hover scrim over the whole video */
    :root #controls-bottom-gradient {
      background: rgba(0,0,0,${Math.min(1, SCRIM / 0.8)}) !important;
      height: calc(100% + 2 * var(--resize-margin)) !important;
    }

    /* any button left loose in the controls (Zen extras) - ours live in the top bar / center */
    :root #controls > button { display: none !important; }

    /* top bar */
    #arc-pip-top {
      position: absolute; top: 6px; left: 6px; right: 6px;
      display: flex; align-items: center; gap: 8px; z-index: 2;
      pointer-events: none;
    }
    #arc-pip-top > * { pointer-events: auto; }
    #arc-pip-host {
      flex: 1; min-width: 0; text-align: center; pointer-events: none !important;
      color: #fff; font: 600 15px/1.2 -apple-system, system-ui, sans-serif;
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
      text-shadow: 0 1px 3px rgba(0,0,0,.4);
    }
    :root #arc-pip-top .arc-pill {
      position: static !important; display: inline-flex !important; align-items: center; gap: 7px;
      width: auto !important; max-width: none !important; min-width: 0 !important; height: 30px !important;
      padding: 0 12px 0 11px !important; border-radius: 9px !important;
      background-color: rgba(255,255,255,.16) !important; background-image: none !important;
      backdrop-filter: blur(14px); transform: none !important;
      color: #fff; font: 600 13.5px/1 -apple-system, system-ui, sans-serif; white-space: nowrap;
    }
    :root #arc-pip-top .arc-pill:hover { background-color: rgba(255,255,255,.26) !important; }
    :root #arc-pip-top .arc-pill > svg { order: -1; width: 14px; height: 14px; flex: none; pointer-events: none; }
    :root #unpip.arc-pill::before { content: "Back to Tab"; }
    :root #arc-pip-min.arc-pill::before { content: "Minimize"; }
    :root #close.arc-pill::before { content: "Close"; }
    @media (width <= 420px) {
      :root #arc-pip-top .arc-pill { padding: 0 !important; width: 30px !important; justify-content: center; }
      :root #arc-pip-top .arc-pill::before { content: none !important; }
    }

    /* no tooltips on the top bar or center buttons */
    :root #arc-pip-top .control-item::after,
    :root .center-controls .control-item::after { content: none !important; display: none !important; }

    /* center: big play/pause with skip buttons */
    :root #controls > .center-controls {
      position: absolute; inset: 0; margin: auto; z-index: 1;
      display: flex !important; align-items: center; justify-content: center; gap: 22px;
      pointer-events: none;
    }
    :root .center-controls > * { pointer-events: auto; }
    :root #seekBackward, :root #seekForward { display: none !important; }
    :root .center-controls:has(#seekForward[hidden]) .arc-seek { display: none !important; }
    :root .center-controls .control-button { background-color: transparent !important; }
    :root #playpause {
      width: 64px !important; height: 64px !important; max-width: none !important;
      background-size: 70% !important;
    }
    :root .arc-seek {
      width: 46px !important; height: 46px !important; max-width: none !important;
      padding: 0 !important; display: grid !important; place-items: center;
    }
    :root .arc-seek > svg { width: 100%; height: 100%; pointer-events: none; }
    :root .arc-seek:hover, :root #playpause:hover { transform: scale(1.06); }

    /* hide what Arc doesn't have (keeps volume) */
    :root #timestamp, :root .start-controls, :root #playbackRate,
    :root #closed-caption, :root #fullscreen { display: none !important; }

    /* progress bar: a long pill, inset from the edges */
    :root #controls-bottom {
      position: absolute !important;
      left: ${BAR_INSET}px !important; right: ${BAR_INSET}px !important;
      bottom: ${BAR_INSET}px !important; width: auto !important;
    }
    :root .controls-bottom-upper { width: 100% !important; margin: 0 !important; height: auto !important; }
    :root .scrubber-no-drag { display: block !important; margin: 0 !important; height: auto !important; }
    :root #scrubber {
      display: block; width: 100%; margin: 0; padding: 0 !important;
      height: ${BAR_H}px !important; border-radius: ${BAR_H}px !important;
      transition: height 120ms ease;
    }
    :root #scrubber:hover { height: ${BAR_H + 3}px !important; }
    :root #scrubber::-moz-range-track {
      background-color: rgba(255,255,255,.3) !important; height: 100% !important; border-radius: 99px !important;
    }
    :root #scrubber::-moz-range-progress {
      background-color: #fff !important; height: 100% !important; border-radius: 99px !important;
    }
    :root #scrubber::-moz-range-thumb { width: 0 !important; height: 0 !important; border: 0 !important; background: transparent !important; }

    /* volume: bottom-right, just above the progress bar */
    :root .controls-bottom-lower {
      position: absolute !important; right: 0; bottom: ${BAR_H + 8}px; margin: 0 !important;
      display: block !important;
    }
    :root .end-controls { display: flex !important; align-items: center; gap: 6px; }
    :root #audio-scrubber { display: inline-block !important; width: 64px; }
  `;
  // The PiP window's CSP blocks <style> elements; a sheet loaded through
  // windowUtils is allowed.
  window.windowUtils.loadSheetUsingURIString(
    "data:text/css;charset=utf-8," + encodeURIComponent(css),
    window.windowUtils.AUTHOR_SHEET
  );

  // ---- helpers ----
  const mk = (tag, id, cls) => {
    let el = $(id);
    if (!el) { el = d.createElementNS(XHTML, tag); el.id = id; }
    if (cls) el.className = cls;
    return el;
  };
  const setIcon = (btn, viewBox, markup) => {
    btn.querySelector(":scope > svg.arc-icon")?.remove();
    const s = d.createElementNS(SVGNS, "svg");
    s.setAttribute("class", "arc-icon");
    s.setAttribute("viewBox", viewBox);
    s.innerHTML = markup;   // SVG-namespace children
    btn.appendChild(s);
  };
  const stroke = 'fill="none" stroke="#fff" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"';

  // ---- top bar: Back to Tab · domain · Minimize · Close ----
  const top = mk("div", "arc-pip-top");
  const host = mk("div", "arc-pip-host", "control-item");
  const minBtn = mk("button", "arc-pip-min", "control-item control-button arc-pill");
  minBtn.type = "button";
  const unpip = $("unpip"), close = $("close");
  unpip.classList.add("arc-pill"); close.classList.add("arc-pill");
  setIcon(unpip, "0 0 16 16", `<path ${stroke} d="M12.5 12.5 3.5 3.5M3.5 9.5v-6h6"/>`);
  setIcon(minBtn, "0 0 16 16", `<path ${stroke} d="M3 8h10"/>`);
  setIcon(close, "0 0 16 16", `<path ${stroke} d="M3.5 3.5l9 9M12.5 3.5l-9 9"/>`);
  top.append(unpip, host, minBtn, close);
  controls.prepend(top);

  // Firefox's PiP module (newer builds use moz-src://, older resource://)
  let PictureInPicture = null;
  for (const url of [
    "moz-src:///toolkit/components/pictureinpicture/PictureInPicture.sys.mjs",
    "resource://gre/modules/PictureInPicture.sys.mjs",
  ]) {
    try { PictureInPicture = ChromeUtils.importESModule(url).PictureInPicture; break; } catch (e) {}
  }
  const updateHost = () => {
    try {
      let name = PictureInPicture?.weakWinToBrowser.get(window)?.currentURI?.host || "";
      if (!SHOW_WWW) name = name.replace(/^www\./, "");
      host.textContent = name;
    } catch (e) {}
  };
  updateHost();

  // ---- center: skips around play/pause ----
  const center = d.querySelector(".center-controls");
  controls.append(center);
  const back = mk("button", "arc-seek-back", "control-item control-button arc-seek");
  const fwd  = mk("button", "arc-seek-fwd",  "control-item control-button arc-seek");
  back.type = fwd.type = "button";
  const seekIcon = flip => `
    <g fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"${flip ? ' transform="translate(40 0) scale(-1 1)"' : ""}>
      <path d="M20 6A14 14 0 1 0 31 11.5"/><path d="M24.5 2 20 6l4.5 4"/>
    </g>
    <text x="20" y="25.5" text-anchor="middle" font-family="-apple-system,system-ui,sans-serif"
          font-size="12.5" font-weight="700" fill="#fff">${SEEK_SECS}</text>`;
  setIcon(back, "0 0 40 40", seekIcon(false));
  setIcon(fwd, "0 0 40 40", seekIcon(true));
  center.prepend(back);
  center.append(fwd);

  const toSecs = t => t.trim().split(":").reduce((a, b) => a * 60 + Number(b), 0);
  const seek = secs => {
    const scrubber = $("scrubber");
    const [cur, dur] = ($("timestamp")?.textContent || "").split("/").map(toSecs);
    if (!(dur > 0) || Number.isNaN(cur)) {           // no timestamp: fall back to Firefox's 5s
      $(secs < 0 ? "seekBackward" : "seekForward").click();
      return;
    }
    scrubber.value = Math.min(1, Math.max(0, (cur + secs) / dur));
    scrubber.dispatchEvent(new Event("input", { bubbles: true }));
    scrubber.dispatchEvent(new Event("change", { bubbles: true }));
  };

  // Minimize = Firefox's Shift+Close: close PiP, keep the video playing in its tab
  const minimize = () => {
    close.dispatchEvent(new MouseEvent("click", { bubbles: true, button: 0, shiftKey: true }));
  };

  // ---- handlers ----
  minBtn.addEventListener("click", e => { e.stopPropagation(); minimize(); });
  back.addEventListener("click", e => { e.stopPropagation(); seek(-SEEK_SECS); });
  fwd.addEventListener("click", e => { e.stopPropagation(); seek(SEEK_SECS); });
  controls.addEventListener("mouseenter", updateHost);
})();
