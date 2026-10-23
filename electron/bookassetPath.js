"use strict";
const path = require("path");
const ITEM_ID_RE = /^[A-Za-z0-9_-]{1,128}$/;
const FILE_RE = /^[A-Za-z0-9_-][A-Za-z0-9._-]{0,254}$/;
/** 返回绝对路径；非法返回 null。userData 为 app.getPath("userData")。 */
function resolveBookassetPath(userData, requestUrl) {
  let url;
  try { url = new URL(requestUrl); } catch { return null; }
  const itemId = url.hostname;
  let filename;
  try { filename = decodeURIComponent(url.pathname).replace(/^\//, ""); } catch { return null; }
  if (!ITEM_ID_RE.test(itemId) || !FILE_RE.test(filename)) return null;
  const root = path.resolve(userData, "assets");
  const file = path.resolve(root, itemId, filename);
  if (!file.startsWith(root + path.sep)) return null;
  return file;
}
module.exports = { resolveBookassetPath };
