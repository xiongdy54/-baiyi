// D223/D224：Mermaid 图表块的实际渲染实现（pele）。
// 本文件由 MermaidDiagram.tsx 懒加载：只有页面里真的出现 mermaid 围栏时才加载 pele，
// 避免全应用的 ReadMarkdown 把 33 种图型解析器拖进首屏 bundle。
// v49.66（D237）：再细一层——走 pele/lazy（核心 ~37KB），按围栏的图型只装载用到的那一种解析/布局
// （flowchart ≈ 116KB、pie ≈ 23KB…），不再一次装入全部 33 种（原 701KB 单块）。
// 渲染失败（语法错误等）回落为「提示 + 源码块」，绝不让整卡/整页渲染失效。
// v49.67（D238）：①字体快照全模块共用一份（只在可能改字体的 DOM 变化后重读），不再每次渲染 getComputedStyle；
// ②SVG 插入页面前过 DOMPurify（SVG 档）——pele 自身已转义文字、过滤 javascript: 链接，这里是纵深防御。
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import DOMPurify from "dompurify";
import { detectType, load, registered, render, type DiagramType } from "pele/lazy";
import { useT } from "../../lib/i18n";

/** 实例序号：idPrefix 唯一化用（同一源文多处同屏渲染时 SVG 内部 id 也不相撞） */
let instanceSeq = 0;

type AppFonts = { sans: string | null; mono: string | null };

/** 应用字体（pele 文本测量基准）：body 计算样式里的 --font-sans / --font-mono（实读，有样式重算成本） */
function readAppFonts(): AppFonts {
  let sans: string | null = null;
  let mono: string | null = null;
  try {
    if (typeof document !== "undefined" && document.body && typeof getComputedStyle === "function") {
      const cs = getComputedStyle(document.body);
      sans = cs.getPropertyValue("--font-sans").trim() || null;
      mono = cs.getPropertyValue("--font-mono").trim() || null;
    }
  } catch {
    /* 计算样式不可用：省略字体项，pele 用自身默认 */
  }
  return { sans, mono };
}

// ---- D238：字体快照（useSyncExternalStore 外部仓库） ----
// 原先每个图表每次渲染都 getComputedStyle(body)——样式脏时这会强制整页样式重算，页面里图表多、
// 父组件频繁重渲染时代价成倍放大。现在：在场图表共用一份快照；MutationObserver 只盯可能改动字体
// 变量的地方（<head> 里样式表的增删改＝主题插件 / 皮肤 / 开发期热更新；<html>/<body> 自身属性＝
// 主题 class、data-skin、内联变量、字号设置），有变化先标脏、下一帧重读一次，值真变了才通知图表重绘
// （D224 语义保留：改字体 / 字号后图表测量基准随之更新——而且不再依赖「恰好有别的原因重渲染」）。
let fontsSnap: AppFonts | null = null;
/** 快照是否可能过期：无观察者时恒为 true（没人盯着变化，每次都实读） */
let fontsDirty = true;
const fontSubs = new Set<() => void>();
let fontObserver: MutationObserver | null = null;
let recheckPending = false;

/** 当前字体快照：未变化时返回同一对象（useSyncExternalStore 要求快照稳定） */
function getFontsSnapshot(): AppFonts {
  if (fontsSnap === null || fontsDirty || fontObserver === null) {
    const next = readAppFonts();
    if (fontsSnap === null || next.sans !== fontsSnap.sans || next.mono !== fontsSnap.mono) fontsSnap = next;
    fontsDirty = false;
  }
  return fontsSnap;
}

/** 标脏后的合帧重读：同一帧内多次 DOM 变化只读一次计算样式；值变了才通知 */
function scheduleFontsRecheck(): void {
  if (recheckPending) return;
  recheckPending = true;
  const run = () => {
    recheckPending = false;
    if (!fontsDirty || fontSubs.size === 0) return;
    const before = fontsSnap;
    if (getFontsSnapshot() !== before) for (const fn of [...fontSubs]) fn();
  };
  if (typeof requestAnimationFrame === "function") requestAnimationFrame(run);
  else setTimeout(run, 16);
}

function subscribeFonts(onChange: () => void): () => void {
  fontSubs.add(onChange);
  if (fontObserver === null && typeof MutationObserver === "function" && typeof document !== "undefined") {
    fontObserver = new MutationObserver(() => {
      fontsDirty = true;
      scheduleFontsRecheck();
    });
    fontObserver.observe(document.documentElement, { attributes: true });
    if (document.body) fontObserver.observe(document.body, { attributes: true });
    if (document.head) fontObserver.observe(document.head, { childList: true, subtree: true, characterData: true, attributes: true });
    // 首次渲染读快照到这里开始观察之间若有变化无从得知：标脏，React 订阅后的复核会重读一次
    fontsDirty = true;
  }
  return () => {
    fontSubs.delete(onChange);
    if (fontSubs.size === 0 && fontObserver) {
      // 页面上已无图表：停止观察（不常驻 MutationObserver）；下一个图表出现时重新实读
      fontObserver.disconnect();
      fontObserver = null;
      fontsDirty = true;
    }
  };
}

/** D238：DOMPurify SVG 档。pele 输出只用到 SVG 基本元素 / 渐变 / 内联样式 / data-*；
 *  role（根节点 role="img" 无障碍角色）与链接 rel="noopener" 不在 SVG 档白名单里，显式放行；
 *  <image>（会发起网络请求，破离线边界——pele 在 images:false 下本就不产出）与 SVG 内 <style>
 *  （内联 SVG 的样式表作用于整个页面——pele 不产出）显式禁止。 */
const SVG_PURIFY_CONFIG = {
  USE_PROFILES: { svg: true, svgFilters: true },
  ADD_ATTR: ["role", "rel"],
  FORBID_TAGS: ["image", "style"]
};

/** SVG 净化；净化器不可用（无 DOM）时返回 null——宁可回落源码也不插入未净化的标记 */
function sanitizeSvg(svg: string): string | null {
  if (!DOMPurify.isSupported || typeof DOMPurify.sanitize !== "function") return null;
  return DOMPurify.sanitize(svg, SVG_PURIFY_CONFIG);
}

/** 纯渲染封装（不含 React）：源码 + 当前字体 → { svg }（已净化）/ { error }（语法错误等）/ { unsafe }（无法净化） */
function renderMermaidToSvg(code: string, idPrefix: string, fonts: AppFonts): { svg: string } | { error: string } | { unsafe: true } {
  let raw: string;
  try {
    raw = render(code, {
      idPrefix,
      // D224：离线边界——不渲染远程图片（pele 默认允许 https image，会真实发起网络请求）。
      images: false,
      ...(fonts.sans ? { fontFamily: fonts.sans } : {}),
      ...(fonts.mono ? { fontFamilyMono: fonts.mono } : {})
    }).svg;
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
  const svg = sanitizeSvg(raw);
  return svg === null ? { unsafe: true } : { svg };
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
  // D224 / D238：字体快照进入依赖——主题 / 字号改变时快照换新，SVG 的测量基准同步重算。
  const fonts = useSyncExternalStore(subscribeFonts, getFontsSnapshot);
  const result = useMemo(
    () => (ready ? renderMermaidToSvg(code, `pele-${(instanceSeq += 1)}-`, fonts) : null),
    [code, fonts, ready]
  );
  if ((!ready && loadFailed !== null && loadFailed === type) || (result !== null && "unsafe" in result)) {
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
