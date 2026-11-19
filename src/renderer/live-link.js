"use strict";
// Live game link panel and status line. Updates its own nodes in place; no page re-render.
(() => {
  let status = { enabled: false, signal: "checking", frame: null };
  const showControls = () => !["checking", "unsupported"].includes(status.signal);
  const esc = (v) => String(v).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const SIGNALS = {
    off: "Off. Turn it on to show your live position on the map and radar.",
    starting: "Starting…",
    nogame: "WoW window not found — live updates are paused and resume when the game is back.",
    minimized: "WoW is minimized — live updates are paused and resume when you bring it back.",
    small: "The game window is too small to read.",
    "old-addon": "WoW is still running an older Backstage Forever addon. Type /reload in WoW to load the new one and live updates start again.",
    unreadable: "The live strip is on screen but its colours are being changed (HDR, Night light, a colour filter or a remote session). Type /reload in WoW once; if it stays, turn the filter off for WoW.",
    "compact-unreadable": "The compact live strip is on screen but its colours are changed too much to read (remote desktop, HDR or a colour filter). Type /bf live safe in WoW for the larger, sturdier strip.",
    "hairline-unreadable": "WoW is there but the thin live line along the top of the game can't be read (remote desktop, HDR or a colour filter changes its shades). Type /bf live safe in WoW for the larger, sturdier strip.",
    "no-signal": "Game found but no live line. Type /bf live on in WoW once; if WoW shows a thin dark line along its top edge and this stays, type /bf live safe.",
    stale: "Signal paused (the live line is hidden or the game stopped drawing it).",
    error: "The screen reader stopped; retrying shortly.",
    checking: "Checking live link availability…",
    unsupported: "Saved-only: the live link is Windows-only. Screen Recording is not needed. Play and log out normally to update your desktop journal.",
  };
  // "3 min ago" from a time in milliseconds (the app and its window share one clock).
  function ago(at, now = Date.now()) {
    const s = Math.max(0, Math.round((now - at) / 1000));
    return s < 60 ? `${s} s ago` : s < 3600 ? `${Math.floor(s / 60)} min ago` : s < 172800 ? `${Math.floor(s / 3600)} hr ago` : `${Math.floor(s / 86400)} days ago`;
  }
  // The last live state while updates are paused (WoW minimized, closed or the line hidden).
  function lastLine(s = status, now = Date.now()) {
    const l = s?.last;
    if (!s?.enabled || !l?.receivedAt || !["minimized", "nogame", "stale", "no-signal"].includes(s.signal)) return "";
    const where = l.position ? `${l.position.zone} ${(l.position.x * 100).toFixed(1)}, ${(l.position.y * 100).toFixed(1)}` : "position unknown";
    return `Last live: ${where}${l.level ? " · level " + l.level : ""} · ${ago(l.receivedAt, now)}`;
  }
  function line(s = status, now = Date.now()) {
    const f = s.frame;
    if (s.signal === "live" && f) {
      if (f.combat) return "Live · in combat (details pause during combat)";
      const where = f.position ? `${f.zone} ${(f.position.x * 100).toFixed(1)}, ${(f.position.y * 100).toFixed(1)}` : "position unavailable here";
      return `Live · ${where}${f.level ? " · level " + f.level : ""}${f.target ? " · target NPC #" + f.target.npcId : ""}`;
    }
    const last = lastLine(s, now);
    return (SIGNALS[s.signal] || SIGNALS.off) + (last ? ` ${last}.` : "");
  }
  const PLACES = { topleft: "top-left", topright: "top-right", bottomleft: "bottom-left", bottomright: "bottom-right" };
  const MODES = { hairline: "Hairline", compact: "Compact", safe: "Safe", legacy: "Older addon" };
  const CAPTURE = { window: " · read from the game window (works behind other windows)", screen: " · read from the screen (keep WoW uncovered)" };
  const TIP = "Type /bf live safe if the link drops over remote desktop.";
  function recovery(s = status) {
    if (s.signal === "unsupported" || s.signal === "checking") return "";
    if (!s.enabled) return "Keep using saved progress without turning on the live link. Play and log out normally to update the desktop journal.";
    if (s.signal === "minimized") return "Restore the game window to resume live updates; no reload is needed.";
    if (s.signal === "nogame") return "Open WoW Forever from your usual launcher, or keep using the last saved progress.";
    if (s.signal === "stale") return "Bring WoW back into view. If the line is hidden, type /bf live on in WoW. The desktop journal can still use saved progress.";
    return "";
  }
  // Mode, placement and size of the strip the app last read (null until one is seen).
  function stripLine(s = status) {
    const k = s?.strip;
    if (!s?.enabled || !k) return "";
    const place = k.mode === "hairline" ? "top edge" : PLACES[k.corner] || k.corner;
    return `Mode: ${MODES[k.mode] || k.mode} · Placement: ${place} · ${k.width}×${k.height} px${k.idle ? " · idle (nothing changing)" : ""}${CAPTURE[k.capture] || ""}`;
  }
  function paint() {
    for (const n of document.querySelectorAll("[data-live-link-controls]")) n.hidden = !showControls();
    for (const n of document.querySelectorAll("[data-live-link-line]")) { n.textContent = line(); n.dataset.signal = status.signal; }
    const step = recovery();
    for (const n of document.querySelectorAll("[data-live-link-recovery]")) {
      if (n.textContent !== step) n.textContent = step;
      n.hidden = !step;
    }
    for (const n of document.querySelectorAll("[data-live-link-strip]")) { n.textContent = stripLine(); n.hidden = !stripLine(); }
    for (const n of document.querySelectorAll("#live-link-toggle")) n.checked = status.enabled;
  }
  window.LiveLink = {
    markup() {
      return `<hr class="rule"><h3>Live game link</h3><div data-live-link-controls${showControls() ? "" : " hidden"}><span class="tag">On by default</span><label class="check-label"><input type="checkbox" id="live-link-toggle" ${status.enabled ? "checked" : ""}>Read my live position from the game window</label><p>With this on, the addon draws a thin dark line, one pixel tall, along the top edge of the game. Backstage Forever reads only that line, twice a second, from the game window itself (so it keeps working when another window covers WoW), and the companion knows where you are right now without a reload. While WoW is minimized nothing can be read: live updates pause and resume when you bring it back. It sends no input, reads no game memory, stores no screenshots and pauses details during combat. Over remote desktop, <code>/bf live safe</code> draws a larger, sturdier strip in a corner (<code>/bf live pos</code> moves it); <code>/bf live compact</code> is the small 84×4 corner strip.</p><p class="live-link-tip">${esc(TIP)}</p></div><p class="live-link-line" data-live-link-line role="status">${esc(line())}</p><p class="live-link-strip" data-live-link-strip${stripLine() ? "" : " hidden"}>${esc(stripLine())}</p><p class="corner-note" data-live-link-recovery${recovery() ? "" : " hidden"}>${esc(recovery())}</p>`;
    },
    stripLine,
    lastLine,
    text: line,
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
    if (event.target?.id !== "live-link-toggle" || !showControls()) return;
    const wanted = event.target.checked;
    api.setLiveLink(wanted).then((s) => { status = s; paint(); }).catch(() => { event.target.checked = !wanted; });
  });
})();
