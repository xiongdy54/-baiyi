/**
 * 自定义主 accent 时必须同时给出反白档 --accent-on —— 纯表现层，不涉业务。
 *
 * 用户在「设置 → 强调色」里可以选任意颜色。若选到柠檬黄、浅绿这类**浅色** accent，
 * 而 --accent-on 仍是主题默认的纯白，主按钮就成了白字压浅底（对比 ≈1.2:1，完全不可读）。
 * 瑞士风硬规则写明：浅色 accent 上必须用纯黑，深色 accent 上用纯白。
 * 此前两个调用点都只写 --accent，把这条规则漏掉了。
 *
 * 这里按底色实际亮度自动选黑或白；恢复默认时一并撤销，交还给主题 Token。
 */
const LIGHT_ON = "#0a0a0a"; // 浅底上的文字色（规范：纯黑，不用 #000 大面积）
const DARK_ON = "#ffffff";

function relLum(color: string): number | null {
  const h = color.trim();
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(h);
  if (!m) return null;
  const n = m[1].length === 3 ? 1 : 2;
  const chan = (i: number) => parseInt(h.slice(1 + i * n, 1 + (i + 1) * n), 16) / (n === 1 ? 15 : 255);
  const toLin = (v: number) => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
  return 0.2126 * toLin(chan(0)) + 0.7152 * toLin(chan(1)) + 0.0722 * toLin(chan(2));
}

/** 该 accent 底色上应使用的文字色；无法解析（非 hex）时返回 null，交回主题默认 */
export function accentOnColor(color: string): string | null {
  const l = relLum(color);
  if (l === null) return null;
  // 与黑/白各自的对比度取更高的一侧
  const onLight = (1.05) / (l + 0.05); // 白字对比
  const onDark = (l + 0.05) / 0.05; // 黑字对比
  return onDark >= onLight ? LIGHT_ON : DARK_ON;
}

/** 应用自定义 accent（同时写 --accent-on）；color 为空则恢复主题默认。
 *
 * 为什么必须写 body、而不是只写 documentElement（v48.14 修复的缺陷）：
 * theme.css 的深色档不是挂在 :root 上，而是 `body.theme-dark { --accent: #5b7fe8; --accent-on: … }`
 * —— 声明在 body 上的规则**胜过**从 :root 继承的值，而整个应用都渲染在 body 子树里。
 * 所以只写 :root 时：浅色模式正常（body 不声明 --accent，继承得到自定义色），
 * 深色模式下 :root 拿到了自定义色、body 却把它重新声明回 IKB 蓝，
 * 结果全应用（主按钮 / 导航高亮 / accent-soft / 原生控件 accent-color）全部回落到蓝色。
 * 内联样式优先级高于任何选择器，写在 body 上即可同时压过浅色与深色两套主题声明。
 * 仍保留 :root 一份，供极少数从 documentElement 取值的场景（如独立窗口尚未挂主题类时）。
 */
export function applyAccent(color: string | undefined | null): void {
  const value = (color ?? "").trim();
  const on = value ? accentOnColor(value) : null;
  for (const el of [document.body, document.documentElement]) {
    if (!el) continue;
    const s = el.style;
    if (!value) {
      s.removeProperty("--accent");
      s.removeProperty("--interactive-accent");
      s.removeProperty("--accent-on");
      continue;
    }
    s.setProperty("--interactive-accent", value);
    s.setProperty("--accent", value);
    // 深色主题默认反白是纯黑；若自定义 accent 本身是深色，必须换成纯白，
    // 否则主按钮就成了黑字压深蓝底。取不到亮度（非 hex）时撤销内联，交回主题档。
    if (on) s.setProperty("--accent-on", on);
    else s.removeProperty("--accent-on");
  }
}
