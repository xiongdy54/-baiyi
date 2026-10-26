// D223/D224：Mermaid 图表块的实际渲染实现（pele）。
// 本文件由 MermaidDiagram.tsx 懒加载：只有页面里真的出现 mermaid 围栏时才加载 pele，
// 避免全应用的 ReadMarkdown 把 33 种图型解析器拖进首屏 bundle。
// 渲染失败（语法错误等）回落为「提示 + 源码块」，绝不让整卡/整页渲染失效。
import { useMemo } from "react";
import { render } from "pele";
import { useT } from "../../lib/i18n";

/** 实例序号：idPrefix 唯一化用（同一源文多处同屏渲染时 SVG 内部 id 也不相撞） */
let instanceSeq = 0;

/** 应用字体（pele 文本测量基准）：每次渲染读取当前 body 计算样式——
 *  不再做进程级缓存，用户改字体/字号后图表测量基准随之更新（D224）。 */
function readAppFonts(): { sans: string | null; mono: string | null } {
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
  return { sans, mono };
}

/** 纯渲染封装（不含 React）：源码 + 当前字体 → { svg } 或 { error } */
function renderMermaidToSvg(
  code: string,
  idPrefix: string,
  fonts: { sans: string | null; mono: string | null }
): { svg: string } | { error: string } {
  try {
    const { svg } = render(code, {
      idPrefix,
      // D224：离线边界——不渲染远程图片（pele 默认允许 https image，会真实发起网络请求）。
      images: false,
      ...(fonts.sans ? { fontFamily: fonts.sans } : {}),
      ...(fonts.mono ? { fontFamilyMono: fonts.mono } : {})
    });
    return { svg };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

export default function MermaidDiagramImpl({ code }: { code: string }) {
  const T = useT();
  // D224：字体 token 进入依赖——主题/字号改变导致重渲染时，SVG 的测量基准同步重算。
  const fonts = readAppFonts();
  const result = useMemo(
    () => renderMermaidToSvg(code, `pele-${(instanceSeq += 1)}-`, fonts),
    [code, fonts.sans, fonts.mono]
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
