// 全应用统一的 markdown **读态/展示侧**渲染管线（D95 §J.2：抽共享函数，杜绝「同一段
// markdown 两处渲染不同」）。与闪卡面同族（react-markdown 10 / remark-parse ^11）：
// remark-gfm 补表格/删除线/任务列表，rehype-raw+sanitize 渲染原始 HTML，rehype-katex 出公式。
// sanitize schema 与 remarkSoftBreaks 见 markdownOffsetMap.ts（sanitize 先于 katex，公式/任务列表/对齐须存活）。
// remarkSoftBreaks（D95 v1.4）：单换行＝可见换行——摘录取自阅读原文（阅读器的行文自带换行），
// 旧纯文本视图（pre-wrap）按换行显示；markdown 渲染若按 CommonMark 折叠成空格，用户看到的就是
// 「挤成一整段」。读态与编辑态统一为 breaks 语义（编辑态由 Milkdown 的 inline hardbreak 承载，
// theme.css 让它真正断行；序列化仍保源文 \n 不变）。
import ReactMarkdown from "react-markdown";
import type { PluggableList } from "unified";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeRaw from "rehype-raw";
import rehypeSanitize from "rehype-sanitize";
import rehypeKatex from "rehype-katex";
import { extractSanitizeSchema, remarkSoftBreaks } from "../../lib/editor/markdownOffsetMap";

const READ_REMARK_PLUGINS = [remarkGfm, remarkMath, remarkSoftBreaks];
const READ_REHYPE_PLUGINS: PluggableList = [rehypeRaw, [rehypeSanitize, extractSanitizeSchema], rehypeKatex];

/** 统一展示侧渲染（摘录卡读态/查看态、日记条目正文等一切 markdown 面共用这一份管线） */
export default function ReadMarkdown({ text }: { text: string }) {
  return (
    <ReactMarkdown remarkPlugins={READ_REMARK_PLUGINS} rehypePlugins={READ_REHYPE_PLUGINS}>
      {text}
    </ReactMarkdown>
  );
}
