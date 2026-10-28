// BDI（D248）：无依赖 UUIDv7。时间戳在前 48 位（毫秒），其余随机；用于 events.uid / attn_spans.uid。
// 只在本机生成，不参与排序水位（水位用 events.seq AUTOINCREMENT，见设计稿 §5.2 / V1-6）。
"use strict";
const crypto = require("crypto");

const HEX = "0123456789abcdef";

/** 生成 UUIDv7 字符串（小写、带连字符）。nowMs 可注入用于测试。 */
function uuid7(nowMs) {
  const ms = Number.isFinite(nowMs) ? Math.floor(nowMs) : Date.now();
  const b = crypto.randomBytes(16);
  let ts = ms;
  for (let i = 5; i >= 0; i--) {
    b[i] = ts % 256;
    ts = Math.floor(ts / 256);
  }
  b[6] = (b[6] & 0x0f) | 0x70; // version 7
  b[8] = (b[8] & 0x3f) | 0x80; // variant 10xx
  let out = "";
  for (let i = 0; i < 16; i++) {
    if (i === 4 || i === 6 || i === 8 || i === 10) out += "-";
    out += HEX[b[i] >> 4] + HEX[b[i] & 0x0f];
  }
  return out;
}

/** 从 UUIDv7 解出毫秒时间戳；不是合法 v7 时返回 null。 */
function uuid7Time(id) {
  if (typeof id !== "string") return null;
  const m = /^([0-9a-f]{8})-([0-9a-f]{4})-7([0-9a-f]{3})-([89ab][0-9a-f]{3})-([0-9a-f]{12})$/i.exec(id);
  if (!m) return null;
  // 48 位时间戳 = time_low(8 hex) + time_mid(4 hex)；time_hi 的 3 hex 是 rand_a，不属于时间戳。
  return parseInt(m[1] + m[2], 16);
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUuid(id) {
  return typeof id === "string" && UUID_RE.test(id);
}

module.exports = { uuid7, uuid7Time, isUuid };
