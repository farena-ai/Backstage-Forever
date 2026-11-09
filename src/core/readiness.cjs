"use strict";
function invalid() {
  throw Error("Invalid preparation snapshot.");
}
function object(v, keys) {
  if (
    !v ||
    typeof v !== "object" ||
    Array.isArray(v) ||
    Object.keys(v).some((k) => !keys.includes(k))
  )
    invalid();
}
function number(v, min, max) {
  if (!Number.isSafeInteger(v) || v < min || v > max) invalid();
  return v;
}
function validateReadiness(value) {
  if (value === undefined) return undefined;
  object(value, ["equipment", "bags"]);
  const out = {};
  if (value.equipment !== undefined) {
    if (!Array.isArray(value.equipment) || value.equipment.length > 19)
      invalid();
    const seen = new Set();
    out.equipment = value.equipment.map((item) => {
      object(item, ["slot", "itemId", "name", "quality", "itemLevel"]);
      const result = {
        slot: number(item.slot, 1, 19),
        itemId: number(item.itemId, 1, Number.MAX_SAFE_INTEGER),
      };
      if (seen.has(result.slot)) invalid();
      seen.add(result.slot);
      if (item.name !== undefined) {
        if (
          typeof item.name !== "string" ||
          item.name.length > 200 ||
          /[\x00-\x1f\x7f]/.test(item.name)
        )
          invalid();
        result.name = item.name;
      }
      if (item.quality !== undefined)
        result.quality = number(item.quality, 0, 8);
      if (item.itemLevel !== undefined)
        result.itemLevel = number(item.itemLevel, 0, 10000);
      return result;
    });
  }
  if (value.bags !== undefined) {
    object(value.bags, ["free", "total"]);
    out.bags = {
      free: number(value.bags.free, 0, 1000),
      total: number(value.bags.total, 0, 1000),
    };
    if (out.bags.free > out.bags.total) invalid();
  }
  return out;
}
module.exports = { validateReadiness };
