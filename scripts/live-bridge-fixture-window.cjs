"use strict";
// Electron fixture for scripts/live-capture-smoke.cjs: a "game" window that paints a live hairline
// (version 6) along the top edge of its client area, 1 CSS px = 1 device px, sRGB, with the heartbeat
// counting up every 0.5s like the addon. Commands (minimize, restore, quit) come through the file
// named by BF_FIXTURE_CTL. Prints "ready <pid>" once painted.
const { app, BrowserWindow, screen, Menu } = require("electron");
const L = require("../src/core/live-bridge.cjs");
Menu.setApplicationMenu(null);
app.commandLine.appendSwitch("force-color-profile", "srgb");
const width = Number(process.env.BF_FIXTURE_W) || 1200, height = Number(process.env.BF_FIXTURE_H) || 300;
function frame(beat) {
  const main = new Array(27).fill(0);
  Object.assign(main, { 0: 6, 1: 9, 2: 1454 >> 8, 3: 1454 & 255, 4: 0x6e, 5: 0x9d, 6: 0xa7, 7: 0x81, 8: 12, 9: 100, 10: 64, 15: 255, 16: 255, 23: 4242 >> 8, 24: 4242 & 255, 25: beat & 255 });
  main[26] = L.crc8(main, 26);
  const log = L.encodePages(1, [{ id: 93739, complete: true }, { id: 812, complete: false }], 4242);
  return L.encodeHairlineCells(L.encodeHairlineFrame(main, log));
}
app.whenReady().then(() => {
  const area = screen.getPrimaryDisplay().workArea, factor = screen.getPrimaryDisplay().scaleFactor;
  const at = { x: area.x + 40, y: area.y + 40 };
  const win = new BrowserWindow({ width: Math.round(width / factor), height: Math.round(height / factor), ...at, show: false, frame: true, backgroundColor: "#6a7f5a", webPreferences: { zoomFactor: 1 / factor, backgroundThrottling: false } });
  const html = `<body style="margin:0;background:linear-gradient(90deg,#5a6f4a,#9fb0c8)"><canvas id=c width=${(L.HAIRLINE.header + L.HAIRLINE.cells) * 2} height=1 style="position:fixed;left:0;top:0;image-rendering:pixelated"></canvas><script>
    const g=document.getElementById('c').getContext('2d');
    window.paint=(cells)=>cells.forEach((c,i)=>{g.fillStyle='rgb('+c.join(',')+')';g.fillRect(i*2,0,2,1);});
  </script></body>`;
  win.loadURL("data:text/html," + encodeURIComponent(html));
  let beat = 0;
  const paint = () => win.webContents.executeJavaScript(`paint(${JSON.stringify(frame(beat))})`).catch(() => {});
  win.webContents.on("did-finish-load", () => {
    win.webContents.setZoomFactor(1 / factor);
    win.showInactive();
    paint();
    setInterval(() => { beat++; paint(); }, 500);
    setTimeout(() => process.stdout.write(`ready ${process.pid}\n`), 800);
  });
  // Electron's main process does not read piped stdin on Windows: commands come through a file.
  const ctl = process.env.BF_FIXTURE_CTL;
  let done = 0;
  if (ctl) setInterval(() => {
    let cmds = [];
    try { cmds = require("node:fs").readFileSync(ctl, "utf8").split(/\s+/).filter(Boolean); } catch {}
    for (const cmd of cmds.slice(done)) {
      done++;
      if (cmd === "minimize") { win.minimize(); process.stdout.write("minimized\n"); }
      else if (cmd === "restore") { win.showInactive(); win.restore(); process.stdout.write("restored\n"); }
      else if (cmd === "quit") app.exit(0);
    }
  }, 150);
});
