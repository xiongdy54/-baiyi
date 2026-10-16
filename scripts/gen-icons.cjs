// 图标资产生成器（D187 / v49.14）：从用户设计包 nutation-icon-kit-v2 一次性生成软件全部图标。
// 运行方式：npx electron scripts/gen-icons.cjs（需 Electron 运行时：nativeImage 解码/缩放/反色）。
// 产物入库（electron/ + build/ + public/），本脚本保留供日后换图再生成。零新依赖。
"use strict";

const { app, nativeImage } = require("electron");
const fs = require("fs");
const path = require("path");

const KIT = "C:/Users/xiongdy/Downloads/nutation-icon-kit-v2/out";
const ROOT = path.resolve(__dirname, "..");
const OUT = {
  mainIco: [path.join(ROOT, "build", "icon.ico"), path.join(ROOT, "electron", "icon.ico")],
  iconsDir: path.join(ROOT, "electron", "icons"),
  iconPng: path.join(ROOT, "electron", "icon.png"),
  favicon: path.join(ROOT, "public", "favicon.png")
};

function fail(msg) {
  console.error("[gen-icons] " + msg);
  process.exitCode = 1;
  setImmediate(() => app.exit(1));
  throw new Error(msg);
}

/** 统计「墨绿线」像素占比（G 通道显著高于 B/R，alpha 可见）——上下分布不对称，用作行序判据 */
function greenRatios(img) {
  const { width, height } = img.getSize();
  const b = img.getBitmap();
  const half = Math.floor(height / 2);
  const count = (y0, y1) => {
    let green = 0, n = 0;
    for (let y = y0; y < y1; y++) {
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;
        if (b[i + 3] < 128) continue;
        n++;
        const bb = b[i], gg = b[i + 1], rr = b[i + 2];
        if (gg > 60 && gg > bb * 1.15 && gg > rr * 1.3) green++;
      }
    }
    return green / Math.max(n, 1);
  };
  return { top: count(0, half), bottom: count(half, height) };
}

/** 把若干 PNG 尺寸打包为 ICO（BMP/DIB 条目，32bpp BGRA 底向上 + 双倍高 AND 掩码，兼容性最稳）
 *  flipRows：getBitmap 行序若为底向上则置 true（由回读验证自动判定） */
function packIco(images, flipRows) {
  const entries = images.map(({ size, png }) => {
    const img = nativeImage.createFromBuffer(png);
    if (img.isEmpty()) fail("PNG 解码失败 size=" + size);
    const got = img.getSize();
    if (got.width !== size || got.height !== size) fail("尺寸不符 " + got.width + "x" + got.height + " 期望 " + size);
    return { size, rgba: img.getBitmap(), stride: size * 4 };
  });

  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type=icon
  header.writeUInt16LE(entries.length, 4);

  let offset = 6 + entries.length * 16;
  const dirEntries = [];
  const datas = [];
  for (const { size, rgba, stride } of entries) {
    const biSize = 40;
    const andStride = Math.ceil(size / 32) * 4; // 1bpp 行按 4 字节对齐
    const dib = Buffer.alloc(biSize + stride * size + andStride * size);
    dib.writeUInt32LE(biSize, 0);
    dib.writeInt32LE(size, 4); // width
    dib.writeInt32LE(size * 2, 8); // height = 双倍（XOR+AND）
    dib.writeUInt16LE(1, 12); // planes
    dib.writeUInt16LE(32, 14); // bpp
    // XOR（颜色）：BGRA 底向上；AND 掩码全 0（32bpp 以 alpha 为准，掩码忽略）
    for (let y = 0; y < size; y++) {
      const srcRow = flipRows ? y : size - 1 - y;
      const srcOff = srcRow * stride;
      const dstOff = biSize + y * stride;
      rgba.copy(dib, dstOff, srcOff, srcOff + stride);
    }
    dirEntries.push([size >= 256 ? 0 : size, size >= 256 ? 0 : size, dib.length, offset]);
    datas.push(dib);
    offset += dib.length;
  }

  const dir = Buffer.alloc(entries.length * 16);
  entries.forEach((_, i) => {
    const o = i * 16;
    const [w, h, len, off] = dirEntries[i];
    dir.writeUInt8(w, o);
    dir.writeUInt8(h, o + 1);
    dir.writeUInt16LE(1, o + 4); // planes
    dir.writeUInt16LE(32, o + 6); // bpp
    dir.writeUInt32LE(len, o + 8);
    dir.writeUInt32LE(off, o + 12);
  });
  return Buffer.concat([header, dir, ...datas]);
}

/** 单色 mark 反色：黑→白（保留 alpha；预乘语义下 RGB=alpha） */
function toWhite(img) {
  const { width, height } = img.getSize();
  const bmp = Buffer.from(img.getBitmap());
  for (let i = 0; i < bmp.length; i += 4) {
    const a = bmp[i + 3];
    bmp[i] = a; // B
    bmp[i + 1] = a; // G
    bmp[i + 2] = a; // R
  }
  return nativeImage.createFromBitmap(bmp, { width, height });
}

function isDarkMark(img) {
  const { width, height } = img.getSize();
  const b = img.getBitmap();
  let sum = 0, n = 0;
  for (let y = Math.floor(height / 2) - 20; y < Math.floor(height / 2) + 20; y++) {
    for (let x = Math.floor(width / 2) - 20; x < Math.floor(width / 2) + 20; x++) {
      const i = (y * width + x) * 4;
      if (b[i + 3] > 128) { sum += b[i] + b[i + 1] + b[i + 2]; n++; }
    }
  }
  return n === 0 || sum / n < 384;
}

function resizeSet(src, sizes) {
  return sizes.map((s) => ({ size: s, png: src.resize({ width: s, height: s, quality: "best" }).toPNG() }));
}

function writeAll(buf, files) {
  for (const f of files) {
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, buf);
    console.log("[gen-icons] 写出 " + f + " (" + buf.length + " bytes)");
  }
}

/** 打包 → 写入 → 回读验证行序（与参考图上下墨绿占比对齐）；错向则翻转重打包 */
function packVerified(images, files, refImg) {
  const ref = greenRatios(refImg);
  for (const flip of [false, true]) {
    const buf = packIco(images, flip);
    const probe = path.join(OUT.iconsDir, ".ico-probe.ico");
    fs.mkdirSync(path.dirname(probe), { recursive: true });
    fs.writeFileSync(probe, buf);
    const decodedRaw = nativeImage.createFromPath(probe);
    const decoded = decodedRaw.isEmpty() ? decodedRaw : decodedRaw.resize({ width: refImg.getSize().width, height: refImg.getSize().height });
    fs.unlinkSync(probe);
    if (decodedRaw.isEmpty()) {
      console.warn("[gen-icons] 探针 ICO 解码为空（flipRows=" + flip + "）");
      continue;
    }
    const got = greenRatios(decoded);
    const same = Math.abs(got.top - ref.top) + Math.abs(got.bottom - ref.bottom);
    const swapped = Math.abs(got.top - ref.bottom) + Math.abs(got.bottom - ref.top);
    console.log("[gen-icons] ref=" + JSON.stringify(ref) + " got=" + JSON.stringify(got) +
      " same=" + same.toFixed(5) + " swapped=" + swapped.toFixed(5) + " decodedSize=" + JSON.stringify(decoded.getSize()));
    if (same <= swapped) {
      writeAll(buf, files);
      console.log("[gen-icons] 行序验证通过（flipRows=" + flip + "）top=" + got.top.toFixed(4) + " bottom=" + got.bottom.toFixed(4));
      return;
    }
    console.warn("[gen-icons] 行序相反（flipRows=" + flip + "），翻转重试");
  }
  fail("ICO 行序验证失败（上下墨绿占比无法对齐参考图）");
}

app.whenReady().then(() => {
  try {
    // ---- 源图 ----
    const lightSrc = nativeImage.createFromPath(path.join(KIT, "png", "nutation-icon-light-1024.png"));
    const light256 = nativeImage.createFromPath(path.join(KIT, "png", "nutation-icon-light-256.png"));
    const dark256 = nativeImage.createFromPath(path.join(KIT, "png", "nutation-icon-256.png"));
    const mark = nativeImage.createFromPath(path.join(KIT, "png", "nutation-mark-1024.png"));
    const favicon32 = nativeImage.createFromPath(path.join(KIT, "png", "nutation-favicon-32.png"));
    if (lightSrc.isEmpty() || light256.isEmpty() || dark256.isEmpty() || mark.isEmpty() || favicon32.isEmpty()) {
      fail("设计包 PNG 读取失败（检查 KIT 路径）: " + KIT);
    }

    // ---- 1) 主 ico = 浅色纸底绿线主图标（exe / 安装包 / 静态图标）----
    packVerified(resizeSet(lightSrc, [16, 24, 32, 48, 64, 128, 256]), OUT.mainIco, light256);

    // ---- 2) 窗口图标（按主题热换）+ 通知图标 ----
    fs.mkdirSync(OUT.iconsDir, { recursive: true });
    fs.writeFileSync(path.join(OUT.iconsDir, "icon-light.png"), light256.toPNG());
    fs.writeFileSync(path.join(OUT.iconsDir, "icon-dark.png"), dark256.toPNG());
    fs.writeFileSync(OUT.iconPng, light256.toPNG());
    console.log("[gen-icons] 写出 icon-light / icon-dark / electron/icon.png");

    // ---- 3) 托盘 mono 双色 ico（16/24/32；浅色任务栏用黑，深色任务栏用白）----
    const darkMark = isDarkMark(mark);
    const blackSet = resizeSet(darkMark ? mark : toWhite(mark), [16, 24, 32]);
    const whiteSet = resizeSet(darkMark ? toWhite(mark) : mark, [16, 24, 32]);
    writeAll(packIco(blackSet, false), [path.join(OUT.iconsDir, "tray-black.ico")]);
    writeAll(packIco(whiteSet, false), [path.join(OUT.iconsDir, "tray-white.ico")]);
    console.log("[gen-icons] 托盘 mono 源色=" + (darkMark ? "黑（反白生成）" : "白（反黑生成）"));

    // ---- 4) favicon ----
    fs.mkdirSync(path.dirname(OUT.favicon), { recursive: true });
    fs.writeFileSync(OUT.favicon, favicon32.toPNG());
    console.log("[gen-icons] 写出 " + OUT.favicon);

    // ---- 自检回读：ICO 能被 Chromium 解码且尺寸正确 ----
    const check = nativeImage.createFromPath(OUT.mainIco[0]);
    if (check.isEmpty()) fail("生成的 ICO 无法回读解码");
    const cs = check.getSize();
    if (cs.width !== 256 || cs.height !== 256) fail("ICO 回读尺寸异常 " + JSON.stringify(cs));
    console.log("[gen-icons] 自检回读 OK：ICO 256x256 解码正常，PNG 序列化 " + check.toPNG().length + " bytes");
    setImmediate(() => app.exit(0));
  } catch (err) {
    fail(err && err.stack ? err.stack : String(err));
  }
});
