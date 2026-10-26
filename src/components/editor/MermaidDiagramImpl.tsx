// D223/D224：Mermaid 图表块的实际渲染实现（pele）。
// 本文件由 MermaidDiagram.tsx 懒加载：只有页面里真的出现 mermaid 围栏时才加载 pele，
// 避免全应用的 ReadMarkdown 把 33 种图型解析器拖进首屏 bundle。
// v49.66（D237）：再细一层——走 pele/lazy（核心 ~37KB），按围栏的图型只装载用到的那一种解析/布局
// （flowchart ≈ 116KB、pie ≈ 23KB…），不再一次装入全部 33 种（原 701KB 单块）。
// 渲染失败（语法错误等）回落为「提示 + 源码块」，绝不让整卡/整页渲染失效。
import { useEffect, useMemo, useState } from "react";
import { detectType, load, registered, render, type DiagramType } from "pele/lazy";
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

/** 围栏图型（识别不出＝null：无需装载，直接交给 render 抛「未识别图型」进回落分支） */
function diagramTypeOf(code: string): DiagramType | null {
  try {
    return detectType(code);
  } catch {
    return null;
  }
}

/** D237：该图型的解析/布局模块是否已就绪（未识别图型视为就绪——render 自会报错回落） */
function typeReady(type: DiagramType | null): boolean {
  return type === null || registered(type);
}

export default function MermaidDiagramImpl({ code }: { code: string }) {
  const T = useT();
  const type = diagramTypeOf(code);
  const ready = typeReady(type);
  // 装载失败（分块文件缺失等）：记下图型，回落源码块并给出与语法错误不同的提示
  const [loadFailed, setLoadFailed] = useState<DiagramType | null>(null);
  const [, setLoadedTick] = useState(0);
  useEffect(() => {
    if (ready || type === null) return;
    let alive = true;
    load(type).then(
      () => {
        if (alive) setLoadedTick((n) => n + 1);
      },
      () => {
        if (alive) setLoadFailed(type);
      }
    );
    return () => {
      alive = false;
    };
  }, [type, ready]);
  // D224：字体 token 进入依赖——主题/字号改变导致重渲染时，SVG 的测量基准同步重算。
  const fonts = readAppFonts();
  const result = useMemo(
    () => (ready ? renderMermaidToSvg(code, `pele-${(instanceSeq += 1)}-`, fonts) : null),
    [code, fonts.sans, fonts.mono, ready]
  );
  if (!ready && loadFailed !== null && loadFailed === type) {
    return (
      <div className="mermaid-fallback" data-mermaid-error="load-failed">
        <p className="mermaid-fallback-note">{T("图表组件加载失败，已显示源代码")}</p>
        <pre>
          <code>{code}</code>
        </pre>
      </div>
    );
  }
  if (result === null) {
    return (
      <div className="mermaid-loading" role="status">
        {T("正在绘制图表…")}
      </div>
    );
  }
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
