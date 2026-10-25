// D223：Mermaid 图表块（读态）——把 ```mermaid 围栏源码用 pele（obsidianmd/pele，纯本地零网络）
// 同步渲染为 SVG，注入 ReadMarkdown 管线（一切 markdown 显示面因此都能画图：摘录卡/复习卡面/
// 卡片浏览器/AI 面板/日记/粘贴书/批注/EditableField）。渲染失败（语法错误等）回落为
// 「提示 + 源码块」，绝不让整卡/整页渲染失效。
// 主题：pele 全部取色/字体/圆角走 --pele-* CSS 变量（theme.css 映射既有主题 Token），
// 浅深主题随动、换肤零重渲染。idPrefix 逐实例唯一（SVG 内部 defs id 不跨图串染）。
import { useMemo } from "react";
import { render } from "pele";
import { useT } from "../../lib/i18n";

/** 实例序号：idPrefix 唯一化用（同一源文多处同屏渲染时 SVG 内部 id 也不相撞） */
let instanceSeq = 0;

/** 应用字体（pele 文本测量基准）：从 body 的计算样式读一次并缓存；读不到（测试环境）则省略 */
let cachedFonts: { sans: string | null; mono: string | null } | null = null;
function readAppFonts(): { sans: string | null; mono: string | null } {
  if (cachedFonts) return cachedFonts;
  let sans: string | null = null;
  let mono: string | null = null;
  try {
    if (typeof document !== "undefined" && typeof getComputedStyle === "function") {
      const cs = getComputedStyle(document.body);
      sans = cs.getPropertyValue("--font-sans").trim() || null;
      mono = cs.getPropertyValue("--font-mono").trim() || null;
    }
  } catch {
    /* 计算样式不可用：省略字体项，pele 用自身默认 */
  }
  cachedFonts = { sans, mono };
  return cachedFonts;
}

/** 教程/测试共用的最小模板（工具条「插入图表」同款；见 MarkdownEditor） */
export const MERMAID_STARTER = "flowchart TD\n    A[开始] --> B[进行中]\n    B --> C[完成]";

/** 纯渲染封装（不含 React）：源码 → { svg } 或 { error }；测试与 HTML 生成脚本共用同一口径 */
export function renderMermaidToSvg(code: string, idPrefix: string): { svg: string } | { error: string } {
  try {
    const fonts = readAppFonts();
    const { svg } = render(code, {
      idPrefix,
      ...(fonts.sans ? { fontFamily: fonts.sans } : {}),
      ...(fonts.mono ? { fontFamilyMono: fonts.mono } : {})
    });
    return { svg };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

export default function MermaidDiagram({ code }: { code: string }) {
  const T = useT();
  const result = useMemo(
    () => renderMermaidToSvg(code, `pele-${(instanceSeq += 1)}-`),
    [code]
  );
  if ("error" in result) {
    return (
      <div className="mermaid-fallback" data-mermaid-error={result.error.slice(0, 200)}>
        <p className="mermaid-fallback-note">{T("图表语法有误，已显示源代码")}</p>
        <pre>
          <code>{code}</code>
        </pre>
      </div>
    );
  }
  return <div className="mermaid-diagram" dangerouslySetInnerHTML={{ __html: result.svg }} />;
}
