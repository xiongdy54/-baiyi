// D95 §G.2 验收 1：源偏移 ↔ 渲染 DOM 双向映射金样例（node 直跑：node tests/markdown-offset-map.test.cjs）
// @runtime: node  @tier: 1  @gui: false  @id: MDOMAP  @timeout: 300
// 契约：①语料集往返——渲染文本与源一致（去语法符号）；②已知区间 srcToRange 的 Range 文本 = 源区间解码文本；
//       ③domToSrc(srcToRange(s,e)) 端点回写一致；④缝隙端点吸附（**bold** 整段区间 → 绘制文本 = bold）。
// 渲染路径：node 环境用 react-dom/server 把**真实读态组件管线**（react-markdown + remark-gfm + remark-math +
// rehype-raw + rehype-sanitize(同款 schema) + rehype-katex）渲染成 HTML，再进 jsdom——DOM 结构与生产一致。
// TS 模块按仓内纪律用 esbuild JS API 现场打包（产物写临时目录，不留仓库文件）。
const path = require("path");
const os = require("os");
const fs = require("fs");
const esbuild = require("esbuild");
const { JSDOM } = require("jsdom");

const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(os.tmpdir(), `mdomap-bundle-${process.pid}.cjs`);

esbuild.buildSync({
  stdin: { contents: `export * from "./src/lib/editor/markdownOffsetMap";`, resolveDir: ROOT, loader: "ts" },
  bundle: true,
  platform: "node",
  format: "cjs",
  outfile: OUT,
  logLevel: "silent"
});
const M = require(OUT);

let pass = 0;
let fail = 0;
function check(name, cond, expected, actual) {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.log(`  ✗ ${name}\n      期望: ${JSON.stringify(expected)}\n      实际: ${JSON.stringify(actual)}`);
  }
}
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/**
 * 读态渲染（与 ExtractCardFace 读态同一插件链与 sanitize schema）→ hast → jsdom 文档。
 * hast→DOM 用与 React 客户端渲染同构的逐节点装配（renderToStaticMarkup 的 HTML 串会在块级元素间
 * 插入客户端渲染不存在的 "\n" 文本节点，不能当生产 DOM 用——逐节点装配保证两侧结构一致）。
 */
async function makeRenderer() {
  const [
    { default: remarkGfm },
    { default: remarkMath },
    { default: rehypeRaw },
    { default: rehypeSanitize },
    { default: rehypeKatex },
    { unified },
    { default: remarkRehype }
  ] = await Promise.all([
    import("remark-gfm"),
    import("remark-math"),
    import("rehype-raw"),
    import("rehype-sanitize"),
    import("rehype-katex"),
    import("unified"),
    import("remark-rehype")
  ]);
  // 与 react-markdown 10 内部一致的次序：remarkParse（react-markdown 内置）→ remark 插件 →
  // remarkRehype（allowDangerousHtml，rehype-raw 的前提）→ rehype 插件
  const { default: remarkParse } = await import("remark-parse");
  const pipeline = unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkMath)
    .use(M.remarkSoftBreaks)
    .use(remarkRehype, { allowDangerousHtml: true })
    .use(rehypeRaw)
    .use(rehypeSanitize, M.extractSanitizeSchema)
    .use(rehypeKatex);

  const renderHast = (node, parent) => {
    if (node.type === "text") parent.appendChild(parent.ownerDocument.createTextNode(node.value));
    else if (node.type === "element") {
      const el = parent.ownerDocument.createElement(node.tagName);
      for (const [k, v] of Object.entries(node.properties || {})) {
        if (v == null || v === false) continue;
        if (k === "className") el.setAttribute("class", Array.isArray(v) ? v.join(" ") : String(v));
        else if (k === "htmlFor") el.setAttribute("for", String(v));
        else if (v === true) el.setAttribute(k, "");
        else el.setAttribute(k, String(v));
      }
      for (const c of node.children || []) renderHast(c, el);
      parent.appendChild(el);
    }
    // comment / raw：React 客户端不渲染（rehype-raw 已展开 raw）
  };
  return (md) => {
    const hast = pipeline.runSync(pipeline.parse(md), { value: md }); // file 必须带上：remarkSoftBreaks 的源切片基准是 file.value
    const dom = new JSDOM("<!doctype html><html><body></body></html>");
    const root = dom.window.document.body;
    for (const child of hast.children) renderHast(child, root);
    return { dom, win: dom.window, root, html: "" };
  };
}

/**
 * 渲染后的可见文本（跳过 KaTeX 输出子树——那是绘制结果不是源文文字）。
 * 两项归一（均为 mdast-util-to-hast 的已知惯例，映射层同步适配）：
 * ① 块级元素之间的纯空白文本节点（remark-rehype 会插入，React 客户端照渲染）不参与比对；
 * ② 代码块 value 尾部补的那个 \n 不参与比对。
 */
function domText(root) {
  let out = "";
  const walk = (n) => {
    for (const c of Array.from(n.childNodes)) {
      if (c.nodeType === 3) {
        const inCode = c.parentElement && c.parentElement.closest("code");
        let data = c.data;
        if (inCode && data.endsWith("\n")) data = data.slice(0, -1);
        // br 后注入的 "\n" / 任务复选框后注入的 " "（经 rehype-raw 合并进本节点）：非源文文字
        const prev = c.previousSibling;
        if (prev && prev.nodeType === 1) {
          const tg = prev.tagName;
          if ((tg === "BR" && data.startsWith("\n")) || (tg === "INPUT" && data.startsWith(" "))) data = data.slice(1);
        }
        if (data.trim() !== "") out += data;
      } else if (c.nodeType === 1 && !c.classList.contains("katex")) walk(c);
    }
  };
  walk(root);
  return out;
}

/** KaTeX 输出子树里的首个文本节点（unmappable 代表样本） */
function firstKatexText(root) {
  const el = root.querySelector(".katex");
  if (!el) return null;
  const w = root.ownerDocument.createTreeWalker(el, 4);
  return w.nextNode();
}

/** 映射段在 DOM 序下的拼接文本（全部叶配对成功时 = 渲染文本；归一同 domText） */
function mappedText(map) {
  return [...map.byNode.values()]
    .filter((s) => s.runs)
    .sort((a, b) => a.sStart - b.sStart)
    .map((s) => {
      const inCode = s.textNode.parentElement && s.textNode.parentElement.closest("code");
      let data = s.textNode.data;
      if (inCode && data.endsWith("\n")) data = data.slice(0, -1);
      return data;
    })
    .join("");
}

async function main() {
  const render = await makeRenderer();
  const B = (md) => {
    const r = render(md);
    const map = M.buildOffsetMap(md, r.root);
    return { ...r, map };
  };

  console.log("== M1 纯段落 ==");
  {
    const md = "寻常的一段文字，用于验证纯段落映射。";
    const { map } = B(md);
    check("M1.1 渲染文本 = 源文本（去语法符号＝全文）", domText(map.root) === md, md, domText(map.root));
    const r = M.srcToRange(map, 0, md.length);
    check("M1.2 srcToRange 全文", r && r.toString() === md, md, r && r.toString());
    check("M1.3 端点回写", r && M.domToSrc(map, r.startContainer, r.startOffset) === 0 && M.domToSrc(map, r.endContainer, r.endOffset) === md.length, [0, md.length], r && [M.domToSrc(map, r.startContainer, r.startOffset), M.domToSrc(map, r.endContainer, r.endOffset)]);
    check("M1.4 无 unmappable", map.boundaries.size === 0, 0, map.boundaries.size);
    check("M1.5 块索引", M.blockIndexForSrc(map, 3) === 0, 0, M.blockIndexForSrc(map, 3));
  }

  console.log("== M2 标题层级 ==");
  {
    const md = "# 大标题\n\n## 小标题正文";
    const { map } = B(md);
    check("M2.1 渲染文本", domText(map.root) === "大标题小标题正文", "大标题小标题正文", domText(map.root));
    const s1 = md.indexOf("大标题");
    const s2 = md.indexOf("小标题正文");
    const r1 = M.srcToRange(map, s1, s1 + 3);
    const r2 = M.srcToRange(map, s2, s2 + 5);
    check("M2.2 一级标题文本", r1 && r1.toString() === "大标题", "大标题", r1 && r1.toString());
    check("M2.3 二级标题文本", r2 && r2.toString() === "小标题正文", "小标题正文", r2 && r2.toString());
    check("M2.4 端点回写", r2 && M.domToSrc(map, r2.startContainer, r2.startOffset) === s2 && M.domToSrc(map, r2.endContainer, r2.endOffset) === s2 + 5, [s2, s2 + 5], r2 && [M.domToSrc(map, r2.startContainer, r2.startOffset), M.domToSrc(map, r2.endContainer, r2.endOffset)]);
    check("M2.5 块索引：标题 # 缝隙归本块", M.blockIndexForSrc(map, 0) === 0 && M.blockIndexForSrc(map, 2) === 0, [0, 0], [M.blockIndexForSrc(map, 0), M.blockIndexForSrc(map, 2)]);
    check("M2.6 块索引：第二块", M.blockIndexForSrc(map, s2) === 1, 1, M.blockIndexForSrc(map, s2));
  }

  console.log("== M3 加粗/斜体/行内代码 + 缝隙吸附 ==");
  {
    const md = "这是 **加粗** 与 *斜体* 与 `code x` 混排。";
    const { map } = B(md);
    check("M3.1 渲染文本", domText(map.root) === "这是 加粗 与 斜体 与 code x 混排。", "这是 加粗 与 斜体 与 code x 混排。", domText(map.root));
    const sBold = md.indexOf("加粗");
    const rAll = M.srcToRange(map, 3, 8); // **加粗**（含星号语法缝隙）
    check("M3.2 缝隙吸附：**加粗** 区间 → 绘制文本 = 加粗", rAll && rAll.toString() === "加粗", "加粗", rAll && rAll.toString());
    const rBold = M.srcToRange(map, sBold, sBold + 2);
    check("M3.3 精确区间", rBold && rBold.toString() === "加粗", "加粗", rBold && rBold.toString());
    const sCode = md.indexOf("code x");
    const rCode = M.srcToRange(map, sCode, sCode + 6);
    check("M3.4 行内代码（position 含反引号，段位自动内收）", rCode && rCode.toString() === "code x", "code x", rCode && rCode.toString());
    check("M3.5 端点回写（精确区间逐字节；缝隙区间落在吸附边界 5/7）", rAll && rBold && rCode && M.domToSrc(map, rAll.startContainer, rAll.startOffset) === sBold && M.domToSrc(map, rAll.endContainer, rAll.endOffset) === sBold + 2 && M.domToSrc(map, rBold.startContainer, rBold.startOffset) === sBold && M.domToSrc(map, rCode.startContainer, rCode.startOffset) === sCode, true, [M.domToSrc(map, rAll.startContainer, rAll.startOffset), M.domToSrc(map, rAll.endContainer, rAll.endOffset)]);
  }

  console.log("== M4 软换行/硬换行（v1.4：软换行＝可见换行，remark-breaks 语义） ==");
  {
    const mdSoft = "上行文字\n下行文字";
    const a = B(mdSoft);
    check("M4.1 软换行渲染为 br（breaks 语义；渲染文本无换行符）", domText(a.map.root) === "上行文字下行文字" && a.root.querySelectorAll("br").length === 1, "上行文字下行文字 + br×1", domText(a.map.root) + " br=" + a.root.querySelectorAll("br").length);
    const rSoft = M.srcToRange(a.map, 0, mdSoft.length);
    // 与 M4.6 同口径：mdast-util-to-hast 在 br 后注入 "\n"（rehype-raw 并入相邻叶），
    // 跨 br 区间的 toString 含该注入换行——decShift 保证端点回写仍逐字对齐
    check("M4.2 软换行全文区间（含 br 后注入换行，同 M4.6 口径）", rSoft && rSoft.toString() === "上行文字\n下行文字", "上行文字\\n下行文字", rSoft && JSON.stringify(rSoft.toString()));

    const mdHard = "甲行  \n乙行\\\n丙行";
    const b = B(mdHard);
    check("M4.3 硬换行渲染文本（两个 br，DOM 文本无换行符）", domText(b.map.root) === "甲行乙行丙行", "甲行乙行丙行", domText(b.map.root));
    check("M4.4 br 数量", b.root.querySelectorAll("br").length === 2, 2, b.root.querySelectorAll("br").length);
    const sB = mdHard.indexOf("乙行");
    const rB = M.srcToRange(b.map, sB, sB + 2);
    check("M4.5 跨 br 区段精确绘制", rB && rB.toString() === "乙行", "乙行", rB && rB.toString());
    const rAll = M.srcToRange(b.map, 0, mdHard.length);
    // Range.toString 拼接的是 DOM 文本原样：br 后注入的换行符（mdast-util-to-hast 惯例）会在其中
    check("M4.6 全文区间跨 br 串联", rAll && rAll.toString() === "甲行\n乙行\n丙行", "甲行\n乙行\n丙行", rAll && rAll.toString());
    check("M4.7 端点回写（br 前后）", rB && M.domToSrc(b.map, rB.startContainer, rB.startOffset) === sB, sB, rB && M.domToSrc(b.map, rB.startContainer, rB.startOffset));
  }

  console.log("== M5 三种列表（含任务列表 sanitize 证明） ==");
  {
    const md = ["- 甲项", "- 乙项", "", "1. 第一", "2. 第二", "", "- [ ] 待办事项", "- [x] 已办事项"].join("\n");
    const { map, root } = B(md);
    check("M5.1 渲染文本", domText(map.root) === "甲项乙项第一第二待办事项已办事项", "甲项乙项第一第二待办事项已办事项", domText(map.root));
    check("M5.2 任务列表 checkbox 存活（sanitize schema）", root.querySelectorAll("input[type=checkbox]").length === 2, 2, root.querySelectorAll("input[type=checkbox]").length);
    check("M5.3 第二项已勾选", root.querySelectorAll("input[type=checkbox]")[1].checked === true, true, root.querySelectorAll("input[type=checkbox]")[1].checked);
    const items = ["甲项", "乙项", "第一", "第二", "待办事项", "已办事项"];
    let okRanges = true;
    let okRound = true;
    const detail = [];
    for (const t of items) {
      const s = md.indexOf(t);
      const r = M.srcToRange(map, s, s + t.length);
      if (!r || r.toString() !== t) {
        okRanges = false;
        detail.push([t, r && r.toString()]);
      }
      if (r && (M.domToSrc(map, r.startContainer, r.startOffset) !== s || M.domToSrc(map, r.endContainer, r.endOffset) !== s + t.length)) {
        okRound = false;
        detail.push([t, "roundtrip"]);
      }
    }
    check("M5.4 各项精确区间", okRanges, "全部命中", detail);
    check("M5.5 各项端点回写", okRound, "全部一致", detail);
  }

  console.log("== M6 表格（对齐属性 sanitize 证明） ==");
  {
    const md = ["| 左对齐列 | 右对齐列 |", "|:--|--:|", "| a 单元 | b 单元 |"].join("\n");
    const { map, root } = B(md);
    check("M6.1 渲染文本", domText(map.root) === "左对齐列右对齐列a 单元b 单元", "左对齐列右对齐列a 单元b 单元", domText(map.root));
    const th = root.querySelectorAll("th");
    const td = root.querySelectorAll("td");
    check("M6.2 表头对齐存活", th.length === 2 && th[0].getAttribute("align") === "left" && th[1].getAttribute("align") === "right", ["left", "right"], [th[0].getAttribute("align"), th[1].getAttribute("align")]);
    check("M6.3 单元格对齐存活", td.length === 2 && td[1].getAttribute("align") === "right", "right", td[1].getAttribute("align"));
    const sA = md.indexOf("a 单元");
    const rA = M.srcToRange(map, sA, sA + 4);
    check("M6.4 单元格精确区间 + 回写", rA && rA.toString() === "a 单元" && M.domToSrc(map, rA.startContainer, rA.startOffset) === sA, "a 单元", rA && rA.toString());
  }

  console.log("== M7 引用（嵌套） ==");
  {
    const md = "> 引用一句\n> > 嵌套引用";
    const { map } = B(md);
    check("M7.1 渲染文本", domText(map.root) === "引用一句嵌套引用", "引用一句嵌套引用", domText(map.root));
    check("M7.2 blockquote 嵌套结构", map.root.querySelectorAll("blockquote").length === 2, 2, map.root.querySelectorAll("blockquote").length);
    const sN = md.indexOf("嵌套引用");
    const rN = M.srcToRange(map, sN, sN + 4);
    check("M7.3 嵌套层精确区间", rN && rN.toString() === "嵌套引用", "嵌套引用", rN && rN.toString());
    // 外层 blockquote 是唯一的顶层块：两层文字同属块 0
    check("M7.4 嵌套同属顶层块 0", M.blockIndexForSrc(map, sN) === 0, 0, M.blockIndexForSrc(map, sN));
  }

  console.log("== M8 围栏与缩进代码块 ==");
  {
    const md = ["前文段落", "", "```js", "let x = 1;", "```", "", "    缩进代码行", "", "后文段落"].join("\n");
    const { map } = B(md);
    check("M8.1 渲染文本", domText(map.root) === "前文段落let x = 1;缩进代码行后文段落", "前文段落let x = 1;缩进代码行后文段落", domText(map.root));
    const sFence = md.indexOf("let x = 1;");
    const rF = M.srcToRange(map, sFence, sFence + 10);
    check("M8.2 围栏代码内容精确区间（围栏语法为缝隙）", rF && rF.toString() === "let x = 1;", "let x = 1;", rF && rF.toString());
    const sInd = md.indexOf("缩进代码行");
    const rI = M.srcToRange(map, sInd, sInd + 5);
    check("M8.3 缩进代码内容精确区间（4 空格缩进为缝隙）", rI && rI.toString() === "缩进代码行", "缩进代码行", rI && rI.toString());
    check("M8.4 端点回写", rF && M.domToSrc(map, rF.startContainer, rF.startOffset) === sFence && M.domToSrc(map, rF.endContainer, rF.endOffset) === sFence + 10, true, rF && [M.domToSrc(map, rF.startContainer, rF.startOffset), M.domToSrc(map, rF.endContainer, rF.endOffset)]);
    // 块索引：0 段落 / 1 围栏代码 / 2 缩进代码 / 3 段落
    check("M8.5 块索引（代码文本归代码块）", M.blockIndexForSrc(map, sFence) === 1 && M.blockIndexForSrc(map, sInd) === 2, [1, 2], [M.blockIndexForSrc(map, sFence), M.blockIndexForSrc(map, sInd)]);
  }

  console.log("== M8b 围栏 info 串与内容首行撞车（审查 P2-4：indexOf 必须从围栏行后起搜） ==");
  {
    // info 串 "javascript live" 内含内容首行 "live"——从头 indexOf 会命中 info 区造成源坐标错位
    const md = ["前文", "", "```javascript live", "live", "```", "", "后文"].join("\n");
    const { map } = B(md);
    check("M8b.1 渲染文本", domText(map.root) === "前文live后文", "前文live后文", domText(map.root));
    const sLive = md.lastIndexOf("live"); // 内容区的 live（info 串里还有一个同名前缀，lastIndexOf 落在内容区）
    const rLive = M.srcToRange(map, sLive, sLive + 4);
    check("M8b.2 内容区 live 精确绘制（锚到代码本体而非 info 串）", rLive && rLive.toString() === "live", "live", rLive && rLive.toString());
    check("M8b.3 端点回写落在内容区", rLive && M.domToSrc(map, rLive.startContainer, rLive.startOffset) === sLive, sLive, rLive && M.domToSrc(map, rLive.startContainer, rLive.startOffset));
  }

  console.log("== M9 行内与块级公式（KaTeX unmappable + 边界判） ==");
  {
    const md = "行内 $x^2$ 公式与块公式：\n\n$$\nE=mc^2\n$$\n\n尾部文字。";
    const { map, root } = B(md);
    check("M9.1 公式在读态渲染（sanitize schema 放行后由 rehype-katex 替换）", root.querySelectorAll(".katex").length >= 2, ">=2", root.querySelectorAll(".katex").length);
    const sTail = md.indexOf("尾部文字");
    const rT = M.srcToRange(map, sTail, sTail + 4);
    check("M9.2 公式后文字照常映射", rT && rT.toString() === "尾部文字", "尾部文字", rT && rT.toString());
    const sLead = md.indexOf("行内");
    const rL = M.srcToRange(map, sLead, sLead + 2);
    check("M9.3 公式前文字照常映射", rL && rL.toString() === "行内", "行内", rL && rL.toString());
    const katexText = root.querySelector(".katex-mathml annotation") || root.querySelector(".katex");
    const kt = katexText && (katexText.textContent || "").length ? katexText : null;
    check("M9.4 KaTeX 子树整体 unmappable（无段可换算，走最近边界）", kt && M.domToSrc(map, firstKatexText(root), 0) !== null, "非null", kt && M.domToSrc(map, firstKatexText(root), 0));
    check("M9.5 块级公式整体为缝隙：跨块公式区间不产生假高亮", M.srcToRange(map, md.indexOf("$"), md.indexOf("尾部文字")) !== null, "吸附到边界或null", M.srcToRange(map, md.indexOf("$"), md.indexOf("尾部文字")));
  }

  console.log("== M10 转义与字符引用（raw↔decoded 逐 run 对齐） ==");
  {
    const md = "星号 \\* 不强调，与号 &amp; 和 &lt; 标签，数字 &#65;。";
    const { map } = B(md);
    const decoded = "星号 * 不强调，与号 & 和 < 标签，数字 A。";
    check("M10.1 渲染文本 = 解码文本", domText(map.root) === decoded, decoded, domText(map.root));
    const seg = [...map.byNode.values()].find((s) => s.runs && s.runs.length > 1);
    check("M10.2 段内 run 表构造（转义+引用混排）", !!seg, ">1 run", seg && seg.runs.length);
    const node = seg && seg.textNode;
    const decA = decoded.indexOf("A");
    const rawA = md.indexOf("&#65;");
    check("M10.3 decoded→raw：A 落在 &#65; 起点", node && M.domToSrc(map, node, decA) === rawA, rawA, node && M.domToSrc(map, node, decA));
    const decAmp = decoded.indexOf("&");
    const rawAmp = md.indexOf("&amp;");
    check("M10.4 decoded→raw：& 落在 &amp; 起点；其后一字落在引用尾", node && M.domToSrc(map, node, decAmp) === rawAmp && M.domToSrc(map, node, decAmp + 1) === rawAmp + 5, [rawAmp, rawAmp + 5], node && [M.domToSrc(map, node, decAmp), M.domToSrc(map, node, decAmp + 1)]);
    const r = M.srcToRange(map, 0, md.length);
    check("M10.5 全段区间绘制文本 = 解码文本（raw→decoded 正向）", r && r.toString() === decoded, decoded, r && r.toString());
    check("M10.6 端点回写（raw 端点→decoded→raw 一致）", r && M.domToSrc(map, r.startContainer, r.startOffset) === 0 && M.domToSrc(map, r.endContainer, r.endOffset) === md.length, true, r && [M.domToSrc(map, r.startContainer, r.startOffset), M.domToSrc(map, r.endContainer, r.endOffset)]);
    // 非法引用原样保留（1:1）
    const mdBad = "伪引用 &notanentity; 保留。";
    const b = B(mdBad);
    check("M10.7 非法引用不解码、1:1 映射", domText(b.map.root) === mdBad, mdBad, domText(b.map.root));
  }

  console.log("== M11 行内原始 HTML ==");
  {
    const md = "前置 <b>粗体HTML</b> 与 <em>斜体</em>，尾段。";
    const { map, root } = B(md);
    check("M11.1 渲染文本", domText(map.root) === "前置 粗体HTML 与 斜体，尾段。", "前置 粗体HTML 与 斜体，尾段。", domText(map.root));
    check("M11.2 原始 HTML 成元素（rehype-raw + sanitize 放行）", !!root.querySelector("b") && !!root.querySelector("em"), true, [!!root.querySelector("b"), !!root.querySelector("em")]);
    const sB = md.indexOf("粗体HTML");
    const rB = M.srcToRange(map, sB, sB + 6);
    check("M11.3 HTML 标签为缝隙、内文精确映射", rB && rB.toString() === "粗体HTML", "粗体HTML", rB && rB.toString());
    check("M11.4 端点回写", rB && M.domToSrc(map, rB.startContainer, rB.startOffset) === sB && M.domToSrc(map, rB.endContainer, rB.endOffset) === sB + 6, true, rB && [M.domToSrc(map, rB.startContainer, rB.startOffset), M.domToSrc(map, rB.endContainer, rB.endOffset)]);
  }

  console.log("== M12 综合语料（块索引全表 + 全覆盖） ==");
  {
    const md = [
      "# 综合标题",
      "",
      "开头段落，含 **粗体** 一处。",
      "",
      "- 列表甲",
      "- 列表乙",
      "",
      "> 引用内容",
      "",
      "```",
      "围栏内容",
      "```",
      "",
      "| 表头 | 列 |",
      "|--|--|",
      "| 格一 | 格二 |",
      "",
      "结尾段落。"
    ].join("\n");
    const { map } = B(md);
    const expectedText = "综合标题开头段落，含 粗体 一处。列表甲列表乙引用内容围栏内容表头列格一格二结尾段落。";
    check("M12.1 全语料渲染文本", domText(map.root) === expectedText, expectedText, domText(map.root));
    check("M12.2 全叶配对成功（映射段文本 = 渲染文本）", mappedText(map) === expectedText, expectedText, mappedText(map));
    const marks = [
      ["综合标题", 0],
      ["开头段落", 1],
      ["列表甲", 2],
      ["引用内容", 3],
      ["围栏内容", 4],
      ["格一", 5],
      ["结尾段落", 6]
    ];
    const detail = [];
    let ok = true;
    for (const [t, bi] of marks) {
      const s = md.indexOf(t);
      const got = M.blockIndexForSrc(map, s);
      if (got !== bi) {
        ok = false;
        detail.push([t, bi, got]);
      }
    }
    check("M12.3 块索引逐块命中", ok, "全命中", detail);
    const sBold = md.indexOf("粗体");
    const rB = M.srcToRange(map, sBold - 2, sBold + 4); // **粗体** 含语法
    check("M12.4 综合语料缝隙吸附", rB && rB.toString() === "粗体", "粗体", rB && rB.toString());
  }

  console.log("== M13 纯公式卡（全缝隙）与退化行为 ==");
  {
    const md = "$$\nE=mc^2\n$$";
    const { map } = B(md);
    check("M13.1 全缝隙时 srcToRange 返回 null（不画假高亮）", M.srcToRange(map, 0, md.length) === null, null, M.srcToRange(map, 0, md.length));
    const kt = firstKatexText(map.root);
    check("M13.2 unmappable 点击不炸（无边界 → null）", M.domToSrc(map, kt, 0) === null, null, M.domToSrc(map, kt, 0));
    const empty = M.buildOffsetMap("", null);
    check("M13.3 空内容/空 root 不炸", M.srcToRange(empty, 0, 1) === null && M.domToSrc(empty, null, 0) === null && M.blockIndexForSrc(empty, 0) === 0, true, true);
  }

  console.log("== M14 resolveCaret（点击/选区端点归一） ==");
  {
    const md = "甲段落 **加粗段** 乙段落。";
    const { map, root } = B(md);
    const p = root.querySelector("p");
    const strong = root.querySelector("strong");
    const kids = Array.from(p.childNodes);
    const si = kids.indexOf(strong);
    // 点击落在 strong 元素上（元素容器 offset＝第 si 个子节点之前）
    const c1 = M.resolveCaret(p, si);
    check("M14.1 元素容器落点 → 子树首文本", c1 && c1.node.nodeType === 3 && c1.node.data === "加粗段" && c1.off === 0, ["加粗段", 0], c1 && [c1.node.data, c1.off]);
    // 点击在末尾（offset = 子节点数）
    const c2 = M.resolveCaret(p, kids.length);
    check("M14.2 容器末尾落点 → 末文本尾", c2 && c2.node.data === " 乙段落。" && c2.off === 5, 5, c2 && c2.off);
    const c3 = M.resolveCaret(p, 0);
    check("M14.3 容器开头落点 → 首文本头", c3 && c3.node.data === "甲段落 " && c3.off === 0, 0, c3 && c3.off);
    const src = c1 && M.domToSrc(map, c1.node, c1.off);
    check("M14.4 落点→源偏移落在加粗内文", src === md.indexOf("加粗段"), md.indexOf("加粗段"), src);
  }

  console.log(`\n通过 ${pass} 项，失败 ${fail} 项`);
  try {
    fs.unlinkSync(OUT);
  } catch {}
  process.exitCode = fail ? 1 : 0;
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
