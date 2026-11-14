"use strict";
// Live game link panel and status line. Updates its own nodes in place; no page re-render.
(() => {
  let status = { enabled: false, signal: "off", frame: null };
  const esc = (v) => String(v).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const SIGNALS = {
    off: "Off. Turn it on to show your live position on the map and radar.",
    starting: "Starting…",
    nogame: "Waiting for WoW Forever to be running.",
    minimized: "WoW is minimized; restore the game window.",
    small: "The game window is too small to read.",
    "old-addon": "WoW is still running an older Backstage Forever addon. Type /reload in WoW to load the new one and live updates start again.",
    unreadable: "The live strip is on screen but its colours are being changed (HDR, Night light, a colour filter or a remote session). Type /reload in WoW once; if it stays, turn the filter off for WoW.",
    "compact-unreadable": "The compact live strip is on screen but its colours are changed too much to read (remote desktop, HDR or a colour filter). Type /bf live safe in WoW for the larger, sturdier strip.",
    "no-signal": "Game found but no live strip. Keep WoW visible (windowed or borderless fullscreen); if this stays, type /bf live on in WoW once.",
    stale: "Signal paused (game covered or strip hidden).",
    error: "The screen reader stopped; retrying shortly.",
    unsupported: "Live link needs Windows.",
  };
  function line() {
    const f = status.frame;
    if (status.signal === "live" && f) {
      if (f.combat) return "Live · in combat (details pause during combat)";
      const where = f.position ? `${f.zone} ${(f.position.x * 100).toFixed(1)}, ${(f.position.y * 100).toFixed(1)}` : "position unavailable here";
      return `Live · ${where}${f.level ? " · level " + f.level : ""}${f.target ? " · target NPC #" + f.target.npcId : ""}`;
    }
    return SIGNALS[status.signal] || SIGNALS.off;
  }
  const PLACES = { topleft: "top-left", topright: "top-right", bottomleft: "bottom-left", bottomright: "bottom-right" };
  const MODES = { compact: "Compact", safe: "Safe", legacy: "Older addon" };
  const TIP = "Type /bf live safe if the link drops over remote desktop.";
  // Mode, placement and size of the strip the app last read (null until one is seen).
  function stripLine(s = status) {
    const k = s?.strip;
    if (!s?.enabled || !k) return "";
    return `Mode: ${MODES[k.mode] || k.mode} · Placement: ${PLACES[k.corner] || k.corner} · ${k.width}×${k.height} px${k.idle ? " · idle (nothing changing)" : ""}`;
  }
  function paint() {
    for (const n of document.querySelectorAll("[data-live-link-line]")) { n.textContent = line(); n.dataset.signal = status.signal; }
    for (const n of document.querySelectorAll("[data-live-link-strip]")) { n.textContent = stripLine(); n.hidden = !stripLine(); }
    for (const n of document.querySelectorAll("#live-link-toggle")) n.checked = status.enabled;
  }
  window.LiveLink = {
    markup() {
      return `<hr class="rule"><h3>Live game link <span class="tag">On by default</span></h3><label class="check-label"><input type="checkbox" id="live-link-toggle" ${status.enabled ? "checked" : ""}>Read my live position from the game window</label><p>With this on, the addon shows a tiny colour strip (84×4 pixels) in a corner of the game, top-left unless you move it with <code>/bf live pos</code>. Backstage Forever reads only that strip, twice a second, so the companion knows where you are right now without a reload. It sends no input, reads no game memory, stores no screenshots and pauses details during combat.</p><p class="live-link-line" data-live-link-line role="status">${esc(line())}</p><p class="live-link-strip" data-live-link-strip${stripLine() ? "" : " hidden"}>${esc(stripLine())}</p><p class="live-link-tip">${esc(TIP)}</p>`;
    },
    stripLine,
    tip: TIP,
    line() { return `<p class="live-link-line" data-live-link-line role="status">${esc(line())}</p>`; },
    status: () => status,
  };
  const api = window.backstage;
  if (!api?.liveLinkStatus) return;
  api.liveLinkStatus().then((s) => { status = s; paint(); }).catch(() => {});
  api.onLiveLink((s) => { status = s; paint(); });
  setInterval(() => api.liveLinkStatus().then((s) => { status = s; paint(); }).catch(() => {}), 3000);
  document.addEventListener("change", (event) => {
    if (event.target?.id !== "live-link-toggle") return;
    const wanted = event.target.checked;
    api.setLiveLink(wanted).then((s) => { status = s; paint(); }).catch(() => { event.target.checked = !wanted; });
  });
})();
