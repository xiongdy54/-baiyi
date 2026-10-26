// 全应用统一的 markdown **读态/展示侧**渲染管线（D95 §J.2：抽共享函数，杜绝「同一段
// markdown 两处渲染不同」）。与闪卡面同族（react-markdown 10 / remark-parse ^11）：
// remark-gfm 补表格/删除线/任务列表，rehype-raw+sanitize 渲染原始 HTML，rehype-katex 出公式。
// sanitize schema 与 remarkSoftBreaks 见 markdownOffsetMap.ts（sanitize 先于 katex，公式/任务列表/对齐须存活）。
// remarkSoftBreaks（D95 v1.4）：单换行＝可见换行——摘录取自阅读原文（阅读器的行文自带换行），
// 旧纯文本视图（pre-wrap）按换行显示；markdown 渲染若按 CommonMark 折叠成空格，用户看到的就是
// 「挤成一整段」。读态与编辑态统一为 breaks 语义（编辑态由 Milkdown 的 inline hardbreak 承载，
// theme.css 让它真正断行；序列化仍保源文 \n 不变）。
import ReactMarkdown, { type Components } from "react-markdown";
import { Children, isValidElement, type ReactNode } from "react";
import type { PluggableList } from "unified";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeRaw from "rehype-raw";
import rehypeSanitize from "rehype-sanitize";
import rehypeKatex from "rehype-katex";
import { extractSanitizeSchema, remarkMark, remarkSoftBreaks } from "../../lib/editor/markdownOffsetMap";
import MermaidDiagram from "./MermaidDiagram";

const READ_REMARK_PLUGINS = [remarkGfm, remarkMath, remarkMark, remarkSoftBreaks];
const READ_REHYPE_PLUGINS: PluggableList = [rehypeRaw, [rehypeSanitize, extractSanitizeSchema], rehypeKatex];

/** D223：```mermaid 围栏 → pele 图表。围栏经 sanitize 后是 <pre><code class="language-mermaid">；
 * code 覆写渲染 MermaidDiagram，pre 覆写在 mermaid 时拆壳（避免 <pre><div> 嵌套破坏排版），
 * 其余 code/pre 一律走 react-markdown 默认路径（样式/行为零变化）。 */
const isMermaidLang = (cls: unknown): boolean =>
  typeof cls === "string" && cls.trim().split(/\s+/).includes("language-mermaid");

type HastLike = { type?: string; value?: unknown; children?: unknown };

/** hast 子树纯文本：text 节点按文档顺序直接拼接（元素递归取文本，注释等非文本节点不计） */
function hastText(node: HastLike): string {
  if (node.type === "text") return typeof node.value === "string" ? node.value : "";
  return Array.isArray(node.children) ? node.children.map((c) => hastText(c as HastLike)).join("") : "";
}

/** React children 纯文本（拿不到 hast 节点时的兜底）：数组逐段直接拼接，元素取其 children */
function reactText(children: ReactNode): string {
  if (children === null || children === undefined || typeof children === "boolean") return "";
  if (typeof children === "string" || typeof children === "number") return String(children);
  if (Array.isArray(children)) return children.map((c) => reactText(c as ReactNode)).join("");
  if (isValidElement(children)) return reactText((children.props as { children?: ReactNode }).children);
  return "";
}

/** D238：图表源码＝代码块的完整原文。children 不一定是单个字符串——原始 HTML 的
 *  <pre><code class="language-mermaid"> 里夹注释（净化后剩两段相邻文本）或 <mark> 等行内元素时是数组，
 *  原先 String(数组) 会用逗号把各段拼起来（元素还会变成 [object Object]），图表因此报错或画错。 */
function mermaidSource(node: unknown, children: ReactNode): string {
  if (node && typeof node === "object" && Array.isArray((node as HastLike).children)) return hastText(node as HastLike);
  return reactText(children);
}

/** 静态组件表：身份恒定，react-markdown 不因每次渲染的新对象而重建元素树 */
const MD_COMPONENTS: Components = {
  code({ node, className, children }) {
    if (isMermaidLang(className)) return <MermaidDiagram code={mermaidSource(node, children)} />;
    return <code className={className}>{children}</code>;
  },
  pre({ children }) {
    // 拆壳条件：除首尾空白文本外只有一个 mermaid 代码元素（原始 HTML 的 <pre>\n<code …>…</code>\n</pre> 也算）
    const kids = Children.toArray(children).filter((k) => !(typeof k === "string" && k.trim() === ""));
    const only = kids.length === 1 ? kids[0] : null;
    if (isValidElement(only) && isMermaidLang((only.props as { className?: string }).className)) {
      return <>{only as ReactNode}</>;
    }
    return <pre>{children}</pre>;
  }
};

/** 统一展示侧渲染（摘录卡读态/查看态、日记条目正文等一切 markdown 面共用这一份管线） */
export default function ReadMarkdown({ text }: { text: string }) {
  return (
    <ReactMarkdown remarkPlugins={READ_REMARK_PLUGINS} rehypePlugins={READ_REHYPE_PLUGINS} components={MD_COMPONENTS}>
      {text}
    </ReactMarkdown>
  );
}
