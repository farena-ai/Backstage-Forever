"use strict";
// TOTP (RFC 6238, HMAC-SHA1, 6 digits, 30 s steps) and base32 (RFC 4648)
// using only node:crypto.
const crypto = require("node:crypto");

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const STEP_MS = 30_000;
const DIGITS = 6;

function base32Encode(buf) {
  let bits = 0, value = 0, out = "";
  for (const byte of buf) {
    value = (value << 8) | byte; bits += 8;
    while (bits >= 5) { out += ALPHABET[(value >>> (bits - 5)) & 31]; bits -= 5; }
    value &= (1 << bits) - 1;
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

function base32Decode(text) {
  const clean = String(text).toUpperCase().replace(/[\s=-]/g, "");
  let bits = 0, value = 0;
  const out = [];
  for (const ch of clean) {
    const i = ALPHABET.indexOf(ch);
    if (i < 0) throw new Error("invalid base32");
    value = (value << 5) | i; bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; }
    value &= (1 << bits) - 1;
  }
  return Buffer.from(out);
}

function hotp(secret, counter) {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const mac = crypto.createHmac("sha1", secret).update(msg).digest();
  const off = mac[mac.length - 1] & 15;
  const bin = ((mac[off] & 0x7f) << 24) | (mac[off + 1] << 16) | (mac[off + 2] << 8) | mac[off + 3];
  return String(bin % 10 ** DIGITS).padStart(DIGITS, "0");
}

function stepAt(now) { return Math.floor(now / STEP_MS); }
function totp(secret, now = Date.now()) { return hotp(secret, stepAt(now)); }

// Accepts the current step and one step either side. Returns the matching
// step number, or null. A step at or below `lastStep` is refused (replay).
// Every candidate is compared, in constant time, whatever the outcome.
function verifyTotp(secret, code, now = Date.now(), lastStep = 0) {
  const given = Buffer.from(/^\d{6}$/.test(String(code)) ? String(code) : "xxxxxx");
  const current = stepAt(now);
  let found = null;
  for (const step of [current - 1, current, current + 1]) {
    const same = crypto.timingSafeEqual(Buffer.from(hotp(secret, step)), given);
    if (same && step > lastStep && found === null) found = step;
  }
  return found;
}

function newSecret() { return base32Encode(crypto.randomBytes(20)); }

function otpauthUri(name, secretBase32, issuer = "Backstage Desk") {
  return `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(name)}?secret=${secretBase32}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=${DIGITS}&period=30`;
}

module.exports = { base32Encode, base32Decode, hotp, totp, verifyTotp, newSecret, otpauthUri, stepAt, STEP_MS };
