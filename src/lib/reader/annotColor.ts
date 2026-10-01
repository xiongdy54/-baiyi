// 批注色的渲染取值（批 4 修正：规格 §5.4「颜色对应」一处实现）。
// 用户 2026-09-28 指出：文中高亮必须与栏内竖线/色点/角标**同色**——此前阅读器把
// 所有标记都按 accent 画（样张的 `.q` 是 `--qcol`/`--qline` 按条取色），
// 结果「角标跟色、高亮不跟色」自相矛盾。
//
// 色值两种来源：色板 id（red/orange/…）→ 取 `--annot-<id>` Token 族；
// `#hex`（设置里的自定义色）→ 原样用实色，透明档用 color-mix 现场算。
// 透明档比例与 Token 族保持一致：浅档 12%、深档 26%（由 Token 族自带；#hex 走中间档 16%）。
const HEX_RE = /^#[0-9a-fA-F]{3,8}$/;

/** 该批注色的**实色**（栏内竖线、色点、角标、文中的左缘条） */
export function annotSolid(color?: string | null, fallback = "var(--accent)"): string {
  const c = String(color ?? "").trim();
  if (!c) return fallback;
  return HEX_RE.test(c) ? c : `var(--annot-${c})`;
}

/** 该批注色的**透明档**（文中高亮底色） */
export function annotSoft(color?: string | null, fallback = "var(--accent-soft)"): string {
  const c = String(color ?? "").trim();
  if (!c) return fallback;
  return HEX_RE.test(c) ? `color-mix(in srgb, ${c} 16%, transparent)` : `var(--annot-${c}-soft)`;
}

/** 参与 CSS 名字/键的稳定标识（同一色恒同键，便于按色分组注册高亮） */
export function annotKey(color?: string | null): string {
  const c = String(color ?? "").trim();
  if (!c) return "default";
  return HEX_RE.test(c) ? `hex-${c.slice(1).toLowerCase()}` : c;
}
