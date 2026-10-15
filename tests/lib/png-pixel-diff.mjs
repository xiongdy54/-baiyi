// 零依赖 PNG 像素对比器（皮肤引擎 v2 · P0 基线设施）
// 用法：node tests/lib/png-pixel-diff.mjs <dirA> <dirB> [--max-diff N]
// 逐文件解码 RGBA（8bit/通道，支持颜色类型 2/6、无隔行），报告：逐像素相等（字节级 RGBA 相等即算）。
// 返回码：0 = 全部一致；1 = 存在差异或文件缺失；2 = 解码失败。
// 若两图字节数相同且字节完全一致，直接判定相等（快速路径）；否则解像素比较。
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

/** 解码 PNG → { width, height, data:Uint8Array(RGBA) }；仅支持 8bit truecolor/truecolor+alpha、无隔行 */
export function decodePng(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error("not a PNG");
  let pos = 8, width = 0, height = 0, bitDepth = 0, colorType = 0, interlace = 0;
  const idat = [];
  let palette = null, trns = null;
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString("ascii", pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === "IHDR") {
      width = data.readUInt32BE(0); height = data.readUInt32BE(4);
      bitDepth = data[8]; colorType = data[9]; interlace = data[12];
    } else if (type === "PLTE") palette = Buffer.from(data);
    else if (type === "tRNS") trns = Buffer.from(data);
    else if (type === "IDAT") idat.push(data);
    else if (type === "IEND") break;
    pos += 12 + len;
  }
  if (bitDepth !== 8) throw new Error(`unsupported bitDepth ${bitDepth}`);
  if (interlace !== 0) throw new Error("interlaced PNG unsupported");
  const channels = { 2: 3, 6: 4, 3: 1 }[colorType];
  if (!channels) throw new Error(`unsupported colorType ${colorType}`);
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const out = new Uint8Array(width * height * 4);
  const prev = new Uint8Array(stride);
  const cur = new Uint8Array(stride);
  let p = 0;
  const paeth = (a, b, c) => {
    const pa = Math.abs(b - c), pb = Math.abs(a - c), pc = Math.abs(a + b - 2 * c);
    return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
  };
  for (let y = 0; y < height; y++) {
    const filter = raw[p++];
    for (let i = 0; i < stride; i++) {
      const x = raw[p++];
      const left = i >= channels ? cur[i - channels] : 0;
      const up = prev[i];
      const ul = i >= channels ? prev[i - channels] : 0;
      let v;
      switch (filter) {
        case 0: v = x; break;
        case 1: v = x + left; break;
        case 2: v = x + up; break;
        case 3: v = x + ((left + up) >> 1); break;
        case 4: v = x + paeth(left, up, ul); break;
        default: throw new Error(`bad filter ${filter}`);
      }
      cur[i] = v & 0xff;
    }
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4;
      if (colorType === 6) {
        out[o] = cur[x * 4]; out[o + 1] = cur[x * 4 + 1]; out[o + 2] = cur[x * 4 + 2]; out[o + 3] = cur[x * 4 + 3];
      } else if (colorType === 2) {
        out[o] = cur[x * 3]; out[o + 1] = cur[x * 3 + 1]; out[o + 2] = cur[x * 3 + 2]; out[o + 3] = 255;
      } else {
        const idx = cur[x];
        out[o] = palette[idx * 3]; out[o + 1] = palette[idx * 3 + 1]; out[o + 2] = palette[idx * 3 + 2];
        out[o + 3] = trns && idx < trns.length ? trns[idx] : 255;
      }
    }
    prev.set(cur);
  }
  return { width, height, data: out };
}

/** 逐像素比较（tol：抗锯齿容忍，Δ≤tol 记软噪声不算差异）；返回 { same, diffPixels, softPixels, maxDelta, firstBad } */
export function comparePixels(a, b, tol = 0) {
  if (a.width !== b.width || a.height !== b.height) return { same: false, diffPixels: -1, softPixels: 0, maxDelta: 255, firstBad: { x: 0, y: 0, reason: `size ${a.width}x${a.height} vs ${b.width}x${b.height}` } };
  let diffPixels = 0, softPixels = 0, maxDelta = 0, firstBad = null;
  const n = a.data.length;
  for (let i = 0; i < n; i += 4) {
    const d = Math.max(
      Math.abs(a.data[i] - b.data[i]),
      Math.abs(a.data[i + 1] - b.data[i + 1]),
      Math.abs(a.data[i + 2] - b.data[i + 2]),
      Math.abs(a.data[i + 3] - b.data[i + 3])
    );
    if (d > 0) {
      if (d > maxDelta) maxDelta = d;
      if (d <= tol) { softPixels++; continue; }
      diffPixels++;
      if (!firstBad) {
        const px = i / 4;
        firstBad = { x: px % a.width, y: Math.floor(px / a.width), delta: d };
      }
    }
  }
  return { same: diffPixels === 0, diffPixels, softPixels, maxDelta, firstBad };
}

export function comparePngFiles(fileA, fileB, tol = 0) {
  const da = decodePng(fs.readFileSync(fileA));
  const db = decodePng(fs.readFileSync(fileB));
  return comparePixels(da, db, tol);
}

// ---- CLI：目录对比 ----
if (import.meta.url === `file://${process.argv[1].replace(/\\/g, "/")}` || process.argv[1]?.endsWith("png-pixel-diff.mjs")) {
  const rawArgs = process.argv.slice(2);
  const args = rawArgs.filter((a) => !a.startsWith("--"));
  const opt = (name, dflt) => Number(rawArgs.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? dflt);
  // --tol：抗锯齿容忍（Δ≤tol 记软噪声）；--max-bad：硬差异像素上限（0=零容忍）
  const tol = opt("tol", 2);
  const maxBad = opt("max-bad", 0);
  // --skip=next,stats：时间敏感/动画敏感视图，只报告不判失败（人工核对面）
  const skip = new Set((rawArgs.find((a) => a.startsWith("--skip="))?.slice(7) ?? "").split(",").filter(Boolean).flatMap((s) => [`${s}-light.png`, `${s}-dark.png`]));
  const dirA = args[0], dirB = args[1];
  if (!dirA || !dirB) { console.error("用法: node tests/lib/png-pixel-diff.mjs <dirA> <dirB> [--tol=2] [--max-bad=0] [--skip=next,stats]"); process.exit(2); }
  const listA = fs.readdirSync(dirA).filter((f) => f.endsWith(".png")).sort();
  const listB = new Set(fs.readdirSync(dirB).filter((f) => f.endsWith(".png")));
  let same = 0, diff = 0, missing = 0, skipped = 0;
  for (const f of listA) {
    const a = path.join(dirA, f), b = path.join(dirB, f);
    if (!listB.has(f)) { console.log(`  ✗ ${f}  缺失于 B`); missing++; continue; }
    const ba = fs.readFileSync(a), bb = fs.readFileSync(b);
    if (ba.equals(bb)) { same++; console.log(`  ✓ ${f}`); continue; }
    try {
      const r = comparePngFiles(a, b, tol);
      if (skip.has(f)) {
        skipped++;
        console.log(`  ~ ${f}  [人工核对] 硬差异=${r.diffPixels} 软噪声=${r.softPixels} maxΔ=${r.maxDelta} 首差=${JSON.stringify(r.firstBad)}`);
        continue;
      }
      if (r.diffPixels <= maxBad) { same++; console.log(`  ✓ ${f}  软噪声=${r.softPixels}${r.diffPixels ? ` 硬差异=${r.diffPixels}(≤${maxBad})` : ""} maxΔ=${r.maxDelta}`); }
      else { diff++; console.log(`  ✗ ${f}  硬差异=${r.diffPixels} 软噪声=${r.softPixels} maxΔ=${r.maxDelta} 首差=${JSON.stringify(r.firstBad)}`); }
    } catch (e) { console.log(`  ! ${f}  解码失败: ${e.message}`); diff++; }
  }
  for (const f of listB) if (!listA.includes(f)) { console.log(`  ! B 独有: ${f}`); missing++; }
  console.log(`\nPNG-DIFF(tol=${tol}, maxBad=${maxBad}, skip=[${[...skip].join(",")}]): ${same} 相同 / ${diff} 差异 / ${skipped} 人工核对 / ${missing} 缺失`);
  process.exit(diff + missing > 0 ? 1 : 0);
}
