"use strict";
// Electron fixture: paints a known live-link strip at the client origin, 1 CSS px = 1 device px.
const { app, BrowserWindow, screen, Menu } = require("electron");
Menu.setApplicationMenu(null);
const { encodeCells } = require("../src/core/live-bridge.cjs");
const bytes = Uint8Array.from(JSON.parse(process.env.BF_FIXTURE_BYTES));
app.whenReady().then(() => {
  const factor = screen.getPrimaryDisplay().scaleFactor;
  const win = new BrowserWindow({ width: 500, height: 300, x: 120, y: 120, show: true, alwaysOnTop: true, frame: true, webPreferences: { zoomFactor: 1 / factor } });
  const cells = encodeCells(bytes);
  const html = `<body style="margin:0;background:#202020"><canvas id=c width=${cells.length * 4} height=4 style="position:fixed;left:0;top:0;image-rendering:pixelated"></canvas><script>const cells=${JSON.stringify(cells)};const g=document.getElementById('c').getContext('2d');cells.forEach((c,i)=>{g.fillStyle='rgb('+c.join(',')+')';g.fillRect(i*4,0,4,4);});</script></body>`;
  win.loadURL("data:text/html," + encodeURIComponent(html));
  win.webContents.on("did-finish-load", () => { win.webContents.setZoomFactor(1 / factor); process.stdout.write("ready\n"); });
});
