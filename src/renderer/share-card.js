"use strict";
// Share cards (S9): one painted picture for a level-up, a badge, the badge case, a dungeon run,
// a personal best, a finished quest story or zone, and the story so far. The picture is drawn
// here on a canvas with the app's own badge paintings (no game art). It leaves the app only when
// you press Copy picture or Save picture. Name and realm are on it only when you tick them.
window.ShareCard = (() => {
  const api = window.backstage, M = window.ShareCardModel;
  const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const W = 1200, H = 630, PAD = 28;
  const INK = "#3d220c", SOFT = "#5a3e1c", BRASS = "#a5823e", GOLD = "#c79a4a";
  let open = null;

  async function artFor(keys) {
    const unique = [...new Set(keys.filter(Boolean))], found = new Map();
    // badgeArt accepts at most 60 keys per request.
    for (let start = 0; start < unique.length; start += 60) {
      const batch = unique.slice(start, start + 60);
      const bytes = await api.badgeArt(batch).catch(() => []);
      for (let i = 0; i < batch.length; i++) {
        if (!bytes?.[i]) continue;
        try { found.set(batch[i], await createImageBitmap(new Blob([bytes[i]], { type: "image/png" }))); } catch { /* Painted without this one. */ }
      }
    }
    return found;
  }
  function frame(g, w, h) {
    const leather = g.createLinearGradient(0, 0, 0, h); leather.addColorStop(0, "#2a1208"); leather.addColorStop(1, "#120804");
    g.fillStyle = leather; g.fillRect(0, 0, w, h);
    const paper = g.createLinearGradient(0, PAD, 0, h - PAD); paper.addColorStop(0, "#f1e3c0"); paper.addColorStop(1, "#d8c292");
    g.fillStyle = paper; g.fillRect(PAD, PAD, w - 2 * PAD, h - 2 * PAD);
    // A worn edge: a soft dark glow inside the parchment.
    const edge = g.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.35, w / 2, h / 2, Math.max(w, h) * 0.72);
    edge.addColorStop(0, "rgba(120,80,30,0)"); edge.addColorStop(1, "rgba(120,80,30,0.38)");
    g.fillStyle = edge; g.fillRect(PAD, PAD, w - 2 * PAD, h - 2 * PAD);
    g.strokeStyle = GOLD; g.lineWidth = 5; g.strokeRect(PAD, PAD, w - 2 * PAD, h - 2 * PAD);
    g.strokeStyle = "rgba(90,50,15,0.55)"; g.lineWidth = 1.5; g.strokeRect(PAD + 12, PAD + 12, w - 2 * PAD - 24, h - 2 * PAD - 24);
    for (const [x, y] of [[PAD, PAD], [w - PAD, PAD], [PAD, h - PAD], [w - PAD, h - PAD]]) {
      const stud = g.createRadialGradient(x - 3, y - 3, 1, x, y, 13); stud.addColorStop(0, "#fff0b8"); stud.addColorStop(0.5, GOLD); stud.addColorStop(1, "#6b4a12");
      g.fillStyle = stud; g.beginPath(); g.arc(x, y, 12, 0, Math.PI * 2); g.fill();
    }
  }
  function star(g, x, y, r) {
    g.beginPath();
    for (let i = 0; i < 16; i++) { const a = (Math.PI / 8) * i - Math.PI / 2, d = i % 2 ? r * 0.45 : r; g.lineTo(x + Math.cos(a) * d, y + Math.sin(a) * d); }
    g.closePath(); g.fill();
  }
  function medallion(g, x, y, r, bitmap) {
    const ring = g.createRadialGradient(x - r * 0.3, y - r * 0.3, r * 0.2, x, y, r); ring.addColorStop(0, "#fff0b8"); ring.addColorStop(0.55, GOLD); ring.addColorStop(1, "#6b4a12");
    g.fillStyle = ring; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
    const well = g.createRadialGradient(x, y - r * 0.2, r * 0.1, x, y, r * 0.86); well.addColorStop(0, "#5a2a12"); well.addColorStop(1, "#200c05");
    g.fillStyle = well; g.beginPath(); g.arc(x, y, r * 0.86, 0, Math.PI * 2); g.fill();
    if (bitmap) g.drawImage(bitmap, x - r * 0.78, y - r * 0.78, r * 1.56, r * 1.56);
    else { g.fillStyle = "#f6dc9a"; star(g, x, y, r * 0.5); }
  }
  // Text that never leaves its box: shrink the size, then cut with an ellipsis.
  function fit(g, text, x, y, max, size, min, font) {
    let px = size;
    for (; px > min; px -= 2) { g.font = font(px); if (g.measureText(text).width <= max) break; }
    g.font = font(px);
    let shown = text;
    while (shown.length > 2 && g.measureText(shown).width > max) shown = `${shown.slice(0, -2)}…`;
    g.fillText(shown, x, y);
    return px;
  }
  function footer(g, card, w, h) {
    g.textBaseline = "alphabetic"; g.letterSpacing = "0px";
    g.textAlign = "right"; g.fillStyle = "#6b4e26"; g.font = "700 20px Cinzel, Georgia, serif"; g.fillText(card.footer, w - PAD - 30, h - PAD - 24);
    if (card.who) {
      g.textAlign = "left"; g.fillStyle = INK;
      fit(g, card.sub ? `${card.who}  ·  ${card.sub}` : card.who, PAD + 30, h - PAD - 24, w - 2 * PAD - 320, 22, 14, (px) => `600 ${px}px Georgia, serif`);
    }
  }
  function header(g, card, x, top, max) {
    g.textAlign = "left"; g.textBaseline = "alphabetic";
    g.fillStyle = "#8a5a18"; g.font = "700 22px Cinzel, Georgia, serif"; g.letterSpacing = "4px";
    g.fillText(card.kicker.toUpperCase(), x, top, max);
    g.letterSpacing = "0px"; g.fillStyle = INK;
    fit(g, card.title, x, top + 66, max, 60, 30, (px) => `700 ${px}px Cinzel, Georgia, serif`);
    const rule = g.createLinearGradient(x, 0, x + max, 0); rule.addColorStop(0, BRASS); rule.addColorStop(1, "rgba(165,130,62,0)");
    g.fillStyle = rule; g.fillRect(x, top + 86, max, 3);
    return top + 86;
  }

  /** Paint one card on a new canvas. art: Map key -> ImageBitmap. */
  function paint(card, art = new Map()) {
    const grid = card.grid && card.grid.length ? card.grid : null;
    const cols = 6, cell = 176, rows = grid ? Math.ceil(grid.length / cols) : 0;
    const c = document.createElement("canvas"); c.width = W; c.height = grid ? 250 + rows * 170 + 90 : H;
    const g = c.getContext("2d"), h = c.height;
    frame(g, W, h);
    if (grid) {
      header(g, card, PAD + 44, PAD + 66, W - 2 * PAD - 88);
      const left = (W - cols * cell) / 2;
      grid.forEach((b, i) => {
        const x = left + (i % cols) * cell + cell / 2, y = 250 + Math.floor(i / cols) * 170;
        medallion(g, x, y + 56, 56, art.get(b.art) || null);
        g.textAlign = "center"; g.fillStyle = INK;
        fit(g, b.name, x, y + 140, cell - 14, 17, 12, (px) => `700 ${px}px Georgia, serif`);
      });
      footer(g, card, W, h);
      return c;
    }
    const hasArt = true, textX = hasArt ? 380 : PAD + 60, max = W - textX - PAD - 50;
    medallion(g, 206, 268, 138, art.get(card.art) || null);
    let y = header(g, card, textX, PAD + 84, max) + 50;
    g.fillStyle = "#4a3218"; g.font = "26px Georgia, serif"; g.textAlign = "left";
    const room = card.stats.length ? 398 : 520;
    for (const line of card.lines) {
      for (const row of M.wrap(line, max, (t) => g.measureText(t).width, 2)) { if (y > room) break; g.fillText(row, textX, y); y += 36; }
      y += 6;
    }
    if (card.stats.length) {
      const gap = 16, tile = Math.min(240, (W - textX - PAD - 50 - gap * (card.stats.length - 1)) / card.stats.length), top = 428;
      card.stats.forEach((s, i) => {
        const x = textX + i * (tile + gap);
        g.fillStyle = "rgba(60,40,18,0.13)"; g.fillRect(x, top, tile, 96);
        g.strokeStyle = "rgba(138,90,24,0.55)"; g.lineWidth = 1.5; g.strokeRect(x, top, tile, 96);
        g.textAlign = "center"; g.fillStyle = INK;
        fit(g, s.value, x + tile / 2, top + 50, tile - 20, 38, 20, (px) => `700 ${px}px Georgia, serif`);
        g.fillStyle = SOFT; g.letterSpacing = "2px";
        fit(g, s.label.toUpperCase(), x + tile / 2, top + 80, tile - 16, 15, 11, (px) => `700 ${px}px Cinzel, Georgia, serif`);
        g.letterSpacing = "0px";
      });
    }
    footer(g, card, W, h);
    return c;
  }
  async function render(card) {
    const keys = card.grid ? card.grid.map((b) => b.art) : [card.art];
    return paint(card, await artFor(keys));
  }
  const bytesOf = async (canvas) => { const blob = await new Promise((r) => canvas.toBlob(r, "image/png")); return blob ? new Uint8Array(await blob.arrayBuffer()) : null; };

  function close() { if (!open) return; const { dialog } = open; open = null; dialog.close(); dialog.remove(); }
  /** Open the share window for one card. request: { kind, data, profileId? }. */
  async function show(request) {
    close();
    let character = null;
    try { character = await api.shareCharacter(request.profileId ?? null); } catch { /* The card still works without a name. */ }
    const options = { name: false, realm: false };
    const build = () => M.shareCard(request.kind, request.data, character, options);
    if (!build()) { window.toast?.("There is nothing to put on a picture yet."); return; }
    const dialog = document.createElement("dialog");
    dialog.className = "share-dialog"; dialog.setAttribute("aria-labelledby", "share-dialog-title");
    // Static labels only; the picture itself is drawn on the canvas.
    dialog.innerHTML = `<h2 id="share-dialog-title">Share picture</h2>
      <div class="share-preview" data-share-preview><p class="share-wait">Painting…</p></div>
      <fieldset class="share-who"><legend>On the picture</legend>
        <label><input type="checkbox" data-share-name${character?.name ? "" : " disabled"}> Show character name</label>
        <label><input type="checkbox" data-share-realm${character?.realm ? "" : " disabled"}> Show realm</label>
        <p>Both are off until you tick them. The picture leaves the app only when you copy or save it.</p></fieldset>
      <p class="share-status" role="status" data-share-status></p>
      <div class="share-actions"><button type="button" data-share-copy>Copy picture</button><button type="button" data-share-save>Save picture</button><button type="button" class="share-close" data-share-close>Close</button></div>`;
    document.body.append(dialog);
    const mine = { dialog, canvas: null, seq: 0 };
    open = mine;
    const status = (text) => { const el = dialog.querySelector("[data-share-status]"); if (el) el.textContent = text; };
    async function repaint() {
      const seq = ++mine.seq, card = build();
      const canvas = await render(card);
      if (open !== mine || seq !== mine.seq) return;
      canvas.className = "share-canvas"; canvas.setAttribute("role", "img");
      canvas.setAttribute("aria-label", `${card.kicker}: ${card.title}${card.who ? `, ${card.who}` : ""}`);
      mine.canvas = canvas;
      dialog.querySelector("[data-share-preview]").replaceChildren(canvas);
    }
    dialog.addEventListener("change", (ev) => {
      if (ev.target.matches("[data-share-name]")) options.name = ev.target.checked;
      else if (ev.target.matches("[data-share-realm]")) options.realm = ev.target.checked;
      else return;
      void repaint();
    });
    dialog.addEventListener("click", async (ev) => {
      if (ev.target.closest("[data-share-close]")) { close(); return; }
      const copy = ev.target.closest("[data-share-copy]"), save = ev.target.closest("[data-share-save]");
      if ((!copy && !save) || !mine.canvas) return;
      try {
        const bytes = await bytesOf(mine.canvas);
        if (!bytes) throw Error("The picture could not be made.");
        if (copy) { await api.copySharePicture(bytes); status("Picture copied. Paste it where you want to share it."); }
        else { const saved = await api.saveSharePicture(bytes, request.kind); if (saved) status("Picture saved."); }
      } catch (e) { status(e.message || "That did not work. Try again."); }
    });
    dialog.addEventListener("close", () => { if (open === mine) { open = null; dialog.remove(); } });
    dialog.showModal();
    await repaint();
  }
  /** A button that opens the share window; the card's facts ride on the button. */
  const button = (kind, data, label = "Share picture", profileId = null) =>
    `<button type="button" class="share-btn" data-share-card="${esc(JSON.stringify({ kind, data, profileId }))}">${esc(label)}</button>`;
  document.addEventListener("click", (ev) => {
    const b = ev.target.closest?.("[data-share-card]");
    if (!b) return;
    let request = null;
    try { request = JSON.parse(b.dataset.shareCard); } catch { return; }
    if (request && M.KINDS.includes(request.kind)) void show(request);
  });
  return { open: show, close, button, paint, render };
})();
