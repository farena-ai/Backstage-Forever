"use strict";
// BLP2 texture decoder (palettized, DXT1/3/5 and raw BGRA), first mip only -> RGBA.
const zlib = require("node:zlib");

function rgb565(c) { return [((c >> 11) & 31) * 255 / 31 | 0, ((c >> 5) & 63) * 255 / 63 | 0, (c & 31) * 255 / 31 | 0]; }

function dxt(src, w, h, kind) {
  const out = Buffer.alloc(w * h * 4);
  const blockBytes = kind === 1 ? 8 : 16;
  let p = 0;
  for (let by = 0; by < Math.ceil(h / 4); by++) {
    for (let bx = 0; bx < Math.ceil(w / 4); bx++, p += blockBytes) {
      const alpha = new Uint8Array(16).fill(255);
      let cp = p;
      if (kind === 3) {
        for (let i = 0; i < 8; i++) { const v = src[p + i]; alpha[i * 2] = (v & 15) * 17; alpha[i * 2 + 1] = (v >> 4) * 17; }
        cp = p + 8;
      } else if (kind === 5) {
        const a0 = src[p], a1 = src[p + 1];
        const pal = [a0, a1];
        if (a0 > a1) for (let i = 1; i < 7; i++) pal.push(((7 - i) * a0 + i * a1) / 7 | 0);
        else { for (let i = 1; i < 5; i++) pal.push(((5 - i) * a0 + i * a1) / 5 | 0); pal.push(0, 255); }
        let bits = 0n;
        for (let i = 0; i < 6; i++) bits |= BigInt(src[p + 2 + i]) << BigInt(8 * i);
        for (let i = 0; i < 16; i++) alpha[i] = pal[Number((bits >> BigInt(3 * i)) & 7n)];
        cp = p + 8;
      }
      const c0 = src.readUInt16LE(cp), c1 = src.readUInt16LE(cp + 2);
      const k0 = rgb565(c0), k1 = rgb565(c1);
      const cols = [k0, k1];
      if (c0 > c1 || kind !== 1) { cols.push(k0.map((v, i) => (2 * v + k1[i]) / 3 | 0), k0.map((v, i) => (v + 2 * k1[i]) / 3 | 0)); }
      else { cols.push(k0.map((v, i) => (v + k1[i]) / 2 | 0), [0, 0, 0]); }
      const idx = src.readUInt32LE(cp + 4);
      for (let i = 0; i < 16; i++) {
        const x = bx * 4 + (i & 3), y = by * 4 + (i >> 2);
        if (x >= w || y >= h) continue;
        const ci = (idx >>> (2 * i)) & 3;
        const o = (y * w + x) * 4, c = cols[ci];
        out[o] = c[0]; out[o + 1] = c[1]; out[o + 2] = c[2];
        out[o + 3] = kind === 1 && c0 <= c1 && ci === 3 ? 0 : alpha[i];
      }
    }
  }
  return out;
}

function decodeBlp(buf) {
  if (buf.toString("latin1", 0, 4) !== "BLP2") throw Error("Not a BLP2 texture.");
  const compression = buf[8], alphaDepth = buf[9], alphaType = buf[10];
  const w = buf.readUInt32LE(12), h = buf.readUInt32LE(16);
  const off = buf.readUInt32LE(20), size = buf.readUInt32LE(84);
  const data = buf.subarray(off, off + size);
  if (compression === 2) return { width: w, height: h, rgba: dxt(data, w, h, alphaType === 7 ? 5 : alphaType === 1 ? 3 : 1) };
  if (compression === 3) {
    const rgba = Buffer.alloc(w * h * 4);
    for (let i = 0; i < w * h; i++) { rgba[i * 4] = data[i * 4 + 2]; rgba[i * 4 + 1] = data[i * 4 + 1]; rgba[i * 4 + 2] = data[i * 4]; rgba[i * 4 + 3] = data[i * 4 + 3]; }
    return { width: w, height: h, rgba };
  }
  if (compression === 1) {
    const rgba = Buffer.alloc(w * h * 4), n = w * h;
    for (let i = 0; i < n; i++) {
      const c = buf.readUInt32LE(148 + data[i] * 4);
      rgba[i * 4] = (c >> 16) & 255; rgba[i * 4 + 1] = (c >> 8) & 255; rgba[i * 4 + 2] = c & 255;
      let a = 255;
      if (alphaDepth === 8) a = data[n + i];
      else if (alphaDepth === 1) a = (data[n + (i >> 3)] >> (i & 7)) & 1 ? 255 : 0;
      else if (alphaDepth === 4) a = ((data[n + (i >> 1)] >> ((i & 1) * 4)) & 15) * 17;
      rgba[i * 4 + 3] = a;
    }
    return { width: w, height: h, rgba };
  }
  throw Error(`Unsupported BLP compression ${compression}.`);
}

// Minimal RGBA PNG encoder.
const CRC = (() => { const t = new Int32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c; } return t; })();
function crc32(b) { let c = -1; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; }
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, "latin1"), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function encodePng(width, height, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 6;
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw, { level: 6 })), chunk("IEND", Buffer.alloc(0))]);
}

module.exports = { decodeBlp, encodePng, crc32 };
