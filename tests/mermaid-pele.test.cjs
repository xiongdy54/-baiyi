// D223/D224 Mermaid 渲染引擎（pele）+ 教程语料回归。
// @runtime: system-node  @tier: 2  @gui: false  @id: MERMAIDPELE  @timeout: 120
// 覆盖：
//   A 教程母本（docs/tutorial/使用教程.md）中每个 ```mermaid 围栏都能被 pele 渲染为 SVG（教程即语料闸门）；
//   B 33 种图型全覆盖（distinct type 计数；pele 官方 diagrams 目录共 33 类）；
//   C 语法错误确实抛错（读态组件的错误回落分支因此可达）；
//   C2 恶意构造不产生 <script>（pele 安全承诺的下游抽查）；
//   E 离线边界：images:false 不输出远程 <image>；javascript: 链接被过滤；
//   D 工具条起手模板（mermaidStarter.ts，从源码正则提取保单一事实源）可渲染。
//   F（D237）读态走 pele/lazy：图型模块按需装载——装载前未注册、装载后同步 render 可用；
//     教程 33 种图型逐一经 load(detectType) 装载后渲染与全量入口输出逐字相同；读态组件只引 pele/lazy。
const path = require("path");
const fs = require("fs");
const ROOT = path.resolve(__dirname, "..");

let pass = 0, fail = 0;
function check(name, cond, actual) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name} | 实际: ${String(actual).slice(0, 300)}`); }
}

(async () => {
  const { render } = await import("pele");

  console.log("== A 教程语料全量渲染 ==");
  const mdRaw = fs.readFileSync(path.join(ROOT, "docs", "tutorial", "使用教程.md"), "utf8");
  // 「画图三步」演示用的四反引号块里有一个**字面** ```mermaid 围栏（展示写法用，非真图）——剥掉
  const md = mdRaw.replace(/````[\s\S]*?````/g, "");
  const blocks = [...md.matchAll(/```mermaid\n([\s\S]*?)```/g)].map((m) => m[1]);
  check("A0 教程至少 33 个 mermaid 围栏（33 图型各一）", blocks.length >= 33, blocks.length);
  const types = new Set();
  let broken = null;
  for (const b of blocks) {
    try {
      const r = render(b, { idPrefix: "t-" });
      if (!r.svg || !r.svg.startsWith("<svg")) throw new Error("输出不是 <svg> 开头");
      types.add(r.type);
    } catch (e) {
      broken = { head: b.trim().split("\n")[0], err: String(e && e.message).split("\n")[0] };
      break;
    }
  }
  check("A1 每个围栏都渲染为 SVG", broken === null, JSON.stringify(broken));
  check("B 33 种图型全覆盖", types.size === 33, `${types.size}: ${[...types].sort().join(",")}`);

  console.log("== C 错误输入行为 ==");
  let threw = false;
  try { render("flowchart TD\n  A -->", { idPrefix: "t-" }); } catch { threw = true; }
  check("C0 语法错误抛错（读态回落分支可达）", threw === true, threw);
  const evil = render('flowchart TD\n  A["<script>alert(1)</script>"] --> B', { idPrefix: "t-" });
  check("C2 文字注入不产生 <script> 节点", !evil.svg.includes("<script"), evil.svg.slice(0, 120));

  console.log("== E 离线边界 ==");
  const remoteImg = render('flowchart TD\n  A@{ img: "https://example.com/x.png", label: "远程图" }', {
    idPrefix: "t-",
    images: false
  });
  check("E0 images:false 不输出远程 <image>（不发起网络请求）", !remoteImg.svg.includes("<image"), remoteImg.svg.slice(0, 160));
  const jsLink = render('flowchart TD\n  A[点]\n  click A "javascript:alert(1)"', { idPrefix: "t-" });
  check("E1 javascript: 链接被过滤", !jsLink.svg.includes("javascript:"), jsLink.svg.slice(0, 160));
  const implSrc = fs.readFileSync(path.join(ROOT, "src", "components", "editor", "MermaidDiagramImpl.tsx"), "utf8");
  check("E2 读态渲染器固定传 images:false", /images:\s*false/.test(implSrc), implSrc.slice(0, 160));
  const annotSrc = fs.readFileSync(path.join(ROOT, "src", "components", "AnnotationEditor.tsx"), "utf8");
  check("E3 批注编辑器含 Mermaid 实时预览入口", /hasMermaidPreview/.test(annotSrc) && /annot-editor-preview/.test(annotSrc), annotSrc.slice(0, 160));

  console.log("== D 工具条起手模板 ==");
  const src = fs.readFileSync(path.join(ROOT, "src", "components", "editor", "mermaidStarter.ts"), "utf8");
  const m = src.match(/MERMAID_STARTER = "((?:[^"\\]|\\.)*)"/);
  check("D0 模板字面量可从源码提取", !!m, src.slice(0, 0));
  if (m) {
    const starter = m[1].replace(/\\n/g, "\n");
    const r = render(starter, { idPrefix: "t-" });
    check("D1 起手模板渲染为 flowchart SVG", r.type === "flowchart" && r.svg.startsWith("<svg"), r.type);
  }

  console.log("== F 按需图型装载（D237，pele/lazy） ==");
  const lazyMod = await import("pele/lazy");
  check("F0 装载前 flowchart 未注册（核心不含图型）", lazyMod.registered("flowchart") === false, lazyMod.registered("flowchart"));
  let lazyThrew = null;
  try { lazyMod.render("flowchart TD\n  A --> B", { idPrefix: "z-" }); } catch (e) { lazyThrew = e && e.code; }
  check("F1 未装载就同步 render 抛 unsupported-diagram（读态组件因此先 load 再渲染）", lazyThrew === "unsupported-diagram", lazyThrew);
  let mismatch = null;
  const lazyTypes = new Set();
  for (const b of blocks) {
    const ty = lazyMod.detectType(b);
    if (ty) await lazyMod.load(ty);
    try {
      const a = lazyMod.render(b, { idPrefix: "t-" });
      const f = render(b, { idPrefix: "t-" });
      lazyTypes.add(a.type);
      if (a.svg !== f.svg) { mismatch = { head: b.trim().split("\n")[0], why: "svg 不同" }; break; }
    } catch (e) {
      mismatch = { head: b.trim().split("\n")[0], err: String(e && e.message).split("\n")[0] };
      break;
    }
  }
  check("F2 教程每个围栏经按需装载后渲染，与全量入口输出逐字相同", mismatch === null, JSON.stringify(mismatch));
  check("F3 按需装载覆盖 33 种图型", lazyTypes.size === 33, lazyTypes.size);
  check("F4 读态渲染器只引 pele/lazy（不再整包引入 33 种图型）", /from "pele\/lazy"/.test(implSrc) && !/from "pele"/.test(implSrc), implSrc.slice(0, 200));
  check("F5 读态渲染器按图型 load() 后再渲染，装载失败回落源码块", /load\(type\)/.test(implSrc) && /图表组件加载失败，已显示源代码/.test(implSrc), "");

  console.log(`\n${pass} 通过 / ${fail} 失败`);
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error("运行异常：", e && e.stack || e);
  process.exit(1);
});
