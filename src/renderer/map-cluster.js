"use strict";
// Map clustering for the community layers: at low zoom many shared spots become a few counted
// marks, so the default map stays clean. Pure (no DOM): the World Map draws what this returns,
// and tests/map-cluster.test.cjs runs it in Node.
(() => {
  /**
   * Group screen points into counted clusters.
   * points: [{ sx, sy, ... }] in pixels. cell: the size of one group in pixels.
   * Returns [{ sx, sy, items: [point...] }] with the centre at the mean of its points, largest
   * first. Points fall into a grid first; neighbouring groups whose centres end up closer than
   * 0.6 of a cell are joined, so a spot on a grid line is not drawn as two overlapping marks.
   */
  function grid(points, cell) {
    const size = Number.isFinite(cell) && cell > 0 ? cell : 64;
    const cells = new Map();
    for (const p of points || []) {
      if (!p || !Number.isFinite(p.sx) || !Number.isFinite(p.sy)) continue;
      const key = `${Math.floor(p.sx / size)}:${Math.floor(p.sy / size)}`;
      let c = cells.get(key);
      if (!c) { c = { x: 0, y: 0, items: [] }; cells.set(key, c); }
      c.x += p.sx; c.y += p.sy; c.items.push(p);
    }
    const groups = [...cells.values()].sort((a, b) => b.items.length - a.items.length);
    const out = [], near = (size * 0.6) ** 2;
    for (const g of groups) {
      const cx = g.x / g.items.length, cy = g.y / g.items.length;
      const host = out.find((o) => (o.sx - cx) ** 2 + (o.sy - cy) ** 2 < near);
      if (host) {
        const n = host.items.length + g.items.length;
        host.sx = (host.sx * host.items.length + g.x) / n; host.sy = (host.sy * host.items.length + g.y) / n;
        host.items.push(...g.items);
      } else out.push({ sx: cx, sy: cy, items: [...g.items] });
    }
    return out.sort((a, b) => b.items.length - a.items.length || a.sx - b.sx || a.sy - b.sy);
  }
  /** The cell size for a zoom level: wide when the whole zone shows, none once you are close. */
  function cellFor(zoom) {
    const z = Number.isFinite(zoom) ? zoom : 1;
    if (z >= 3) return 0; // close enough: every spot is drawn on its own
    return Math.round(96 - (z - 1) * 26); // 96px at zoom 1, 44px just below zoom 3
  }
  /** Radius of a cluster mark for its count (px): grows slowly, never large enough to hide the map. */
  const radiusFor = (count) => Math.min(17, 10 + Math.log2(Math.max(1, count)) * 1.6);
  const api = { grid, cellFor, radiusFor };
  if (typeof module === "object" && module.exports) module.exports = api;
  else window.MapCluster = api;
})();
