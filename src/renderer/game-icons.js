"use strict";
// Paints item, spell and talent icons read from the player's own game install (never bundled).
// Markup: <canvas class="game-icon" data-game-icon="FILEID" width="40" height="40"></canvas>.
// Icons arrive as PNG bytes over IPC and are drawn onto canvases (the CSP allows no data:/blob: images).
window.GameIcons = (() => {
  const api = window.backstage;
  const cache = new Map(); // fileId -> Promise<ImageBitmap|null>
  function bitmap(id) {
    if (!cache.has(id)) {
      cache.set(id, (async () => {
        try {
          const bytes = await api.gameIcon(id);
          if (!bytes?.length) return null;
          return await createImageBitmap(new Blob([bytes], { type: "image/png" }));
        } catch { return null; }
      })());
      if (cache.size > 400) cache.delete(cache.keys().next().value);
    }
    return cache.get(id);
  }
  async function paintOne(canvas) {
    const id = Number(canvas.dataset.gameIcon);
    if (!Number.isSafeInteger(id) || id <= 0 || canvas.dataset.painted === String(id)) return;
    canvas.dataset.painted = String(id);
    const bmp = await bitmap(id);
    if (!bmp || !canvas.isConnected) { canvas.classList.add("game-icon-missing"); return; }
    const g = canvas.getContext("2d");
    g.clearRect(0, 0, canvas.width, canvas.height);
    // Trim the icon's built-in border a little so it sits cleanly inside our frame.
    const inset = bmp.width * 0.06;
    g.imageSmoothingQuality = "high";
    g.drawImage(bmp, inset, inset, bmp.width - inset * 2, bmp.height - inset * 2, 0, 0, canvas.width, canvas.height);
  }
  function paint(root = document) {
    if (!api?.gameIcon) return;
    for (const c of root.querySelectorAll("canvas[data-game-icon]")) paintOne(c);
  }
  let queued = false;
  const observer = typeof MutationObserver === "function" ? new MutationObserver(() => { if (queued) return; queued = true; requestAnimationFrame(() => { queued = false; paint(); }); }) : null;
  if (observer && document.body) observer.observe(document.body, { childList: true, subtree: true });
  else if (observer) document.addEventListener("DOMContentLoaded", () => observer.observe(document.body, { childList: true, subtree: true }));
  const tag = (fileId, size = 40, cls = "") => (Number.isSafeInteger(fileId) && fileId > 0 ? `<canvas class="game-icon ${cls}" data-game-icon="${fileId}" width="${size}" height="${size}" aria-hidden="true"></canvas>` : "");
  return { paint, tag };
})();
