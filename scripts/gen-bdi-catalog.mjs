#!/usr/bin/env node
// BDI（D248）：从 electron/behavior/registry.js 生成渲染层事件目录 src/lib/behavior/catalog.generated.ts。
// 用法：node scripts/gen-bdi-catalog.mjs   （生成后提交；tests/behavior-catalog-docs.test.cjs 校验逐字一致）
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const OUT = path.join(ROOT, "src", "lib", "behavior", "catalog.generated.ts");

export function buildCatalogTs() {
  const reg = require(path.join(ROOT, "electron", "behavior", "registry.js"));
  const rows = reg.catalog();
  const lines = [];
  lines.push("// 本文件由 scripts/gen-bdi-catalog.mjs 从 electron/behavior/registry.js 生成，禁止手改。");
  lines.push(`// 唯一事实来源：docs/design/BEHAVIOR-DATA-INFRA-D248-v3.md §6；BDI_CATALOG_VERSION = ${reg.CATALOG_VERSION}。`);
  lines.push("");
  lines.push(`export const BDI_CATALOG_VERSION = ${reg.CATALOG_VERSION} as const;`);
  lines.push("");
  lines.push("export type BdiEventName =");
  for (const r of rows) lines.push(`  | ${JSON.stringify(r.type)}`);
  lines[lines.length - 1] += ";";
  lines.push("");
  lines.push('export type BdiEventOwner = "M" | "R" | "B" | "W" | "M+R";');
  lines.push("");
  lines.push("export interface BdiEventMeta {");
  lines.push("  readonly owner: BdiEventOwner;");
  lines.push("  readonly intentOnly: boolean;");
  lines.push("  readonly allowText: boolean;");
  lines.push("}");
  lines.push("");
  lines.push("export const BDI_EVENTS = {");
  for (const r of rows) {
    lines.push(`  ${JSON.stringify(r.type)}: { owner: ${JSON.stringify(r.owner)}, intentOnly: ${r.intentOnly}, allowText: ${r.allowText} },`);
  }
  lines.push("} as const satisfies Record<BdiEventName, BdiEventMeta>;");
  lines.push("");
  lines.push("export const BDI_EVENT_NAMES = [");
  for (const r of rows) lines.push(`  ${JSON.stringify(r.type)},`);
  lines.push("] as const satisfies readonly BdiEventName[];");
  lines.push("");
  lines.push("export function isBdiEventName(value: string): value is BdiEventName {");
  lines.push("  return Object.prototype.hasOwnProperty.call(BDI_EVENTS, value);");
  lines.push("}");
  lines.push("");
  return lines.join("\n");
}

export function writeCatalogTs() {
  const text = buildCatalogTs();
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, text, "utf8");
  return { file: path.relative(ROOT, OUT).replace(/\\/g, "/"), bytes: Buffer.byteLength(text) };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const r = writeCatalogTs();
  console.log(`bdi-catalog: ${r.bytes} B → ${r.file}`);
}
