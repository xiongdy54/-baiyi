// 全应用统一的 markdown **读态/展示侧**渲染管线（D95 §J.2：抽共享函数，杜绝「同一段
// markdown 两处渲染不同」）。与闪卡面同族（react-markdown 10 / remark-parse ^11）：
// remark-gfm 补表格/删除线/任务列表，rehype-raw+sanitize 渲染原始 HTML，rehype-katex 出公式。
// sanitize schema 与 remarkSoftBreaks 见 markdownOffsetMap.ts（sanitize 先于 katex，公式/任务列表/对齐须存活）。
// remarkSoftBreaks（D95 v1.4）：单换行＝可见换行——摘录取自阅读原文（阅读器的行文自带换行），
// 旧纯文本视图（pre-wrap）按换行显示；markdown 渲染若按 CommonMark 折叠成空格，用户看到的就是
// 「挤成一整段」。读态与编辑态统一为 breaks 语义（编辑态由 Milkdown 的 inline hardbreak 承载，
// theme.css 让它真正断行；序列化仍保源文 \n 不变）。
import ReactMarkdown, { type Components } from "react-markdown";
import { isValidElement, type ReactNode } from "react";
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

/** 静态组件表：身份恒定，react-markdown 不因每次渲染的新对象而重建元素树 */
const MD_COMPONENTS: Components = {
  code({ className, children }) {
    if (isMermaidLang(className)) return <MermaidDiagram code={String(children ?? "")} />;
    return <code className={className}>{children}</code>;
  },
  pre({ children }) {
    if (isValidElement(children) && isMermaidLang((children.props as { className?: string }).className)) {
      return <>{children as ReactNode}</>;
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
