"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/lib/importKinds.ts
var importKinds_exports = {};
__export(importKinds_exports, {
  kindForFilename: () => kindForFilename
});
module.exports = __toCommonJS(importKinds_exports);
var EBOOK_EXTS = ["mobi", "azw3", "azw", "fb2", "fbz", "cbz"];
function kindForFilename(name) {
  const ext = String(name || "").split(".").pop()?.toLowerCase() ?? "";
  if (ext === "epub") return "epub";
  if (ext === "html" || ext === "htm") return "html";
  if (ext === "docx") return "word";
  if (ext === "txt") return "txt";
  if (ext === "md" || ext === "markdown") return "markdown";
  if (ext === "pdf") return "pdf";
  if (EBOOK_EXTS.includes(ext)) return "ebook";
  return null;
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  kindForFilename
});
