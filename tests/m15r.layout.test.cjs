// v48 批3 M15 重做——确定性布局 + SVG 渲染回归（node 直跑：node tests/m15r.layout.test.cjs）。
// 契约：§4.19-9 + D42——同一 JSON 布局恒等（×100）/ 折叠子树不参与布局 / 无重叠 /
// 正交肘形边 / 渲染快照（tests/fixtures/m15r-render.snapshot.json）/ XML 转义 / 截断。
// node 直跑（esbuild JS API 现场打包——Windows 下 execSync+npx 挂起禁用，pdf.driver 同款纪律）。
const path = require("path");
const fs = require("fs");
const esbuild = require("esbuild");

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}\n      ${JSON.stringify(detail ?? "")}`); }
}

esbuild.buildSync({
  entryPoints: [path.join(__dirname, "m15r.layout.entry.ts")],
  bundle: true,
  platform: "node",
  format: "cjs",
  outfile: path.join(__dirname, "m15r.layout.bundle.cjs"),
  logLevel: "silent"
});
const { layoutMap, nodeWidth, buildMapSvg } = require(path.join(__dirname, "m15r.layout.bundle.cjs"));

// 夹具：root → ch1(a, b(deep)) , ch2
const NODES = [
  { id: "root", parentId: null, title: "从概念到机制", childIds: ["ch1", "ch2"] },
  { id: "ch1", parentId: "root", title: "概念建立", childIds: ["a", "b"] },
  { id: "ch2", parentId: "root", title: "机制解释", childIds: [] },
  { id: "a", parentId: "ch1", title: "定义句", childIds: [] },
  { id: "b", parentId: "ch1", title: "边界讨论", childIds: ["deep"] },
  { id: "deep", parentId: "b", title: "深层节点", childIds: [] }
];
const THEME = {
  paper: "#fafaf8", ink: "#0a0a0a", inkSoft: "#525252", border: "#e0e0e0",
  accent: "#002fa7", accentOn: "#ffffff", accentSoft: "#e8eaf5",
  fontFamily: "system-ui, sans-serif", fontSize: 13
};

console.log("---- M15R-L1 确定性（×100） ----");
{
  const run = () => JSON.stringify({
    layout: layoutMap(NODES, "root", { expandedIds: new Set(["root", "ch1", "ch2"]) }),
    svg: buildMapSvg(layoutMap(NODES, "root", { expandedIds: new Set(["root", "ch1", "ch2"]) }), THEME, { selectedId: "a" })
  });
  const first = run();
  let same = true;
  for (let i = 0; i < 100; i++) if (run() !== first) same = false;
  check("布局+渲染 100 次逐字节一致", same, "");
}

console.log("---- M15R-L2 折叠语义 ----");
{
  const r = layoutMap(NODES, "root", { expandedIds: new Set(["root"]) }); // 只展开 root
  check("可见 = root + 2 章（折叠孙辈）", r.nodes.length === 3, r.nodes.map((n) => n.id));
  const ch1 = r.nodes.find((n) => n.id === "ch1");
  check("ch1 折叠徽标 = 3（a/b/deep）", ch1 && ch1.collapsed && ch1.collapsedCount === 3, ch1);
  const rAll = layoutMap(NODES, "root", { expandedIds: new Set(["root", "ch1", "ch2", "b"]) });
  check("全展开可见 6 节点", rAll.nodes.length === 6, rAll.nodes.length);
  const deep = rAll.nodes.find((n) => n.id === "deep");
  check("深层节点入布局", Boolean(deep), "");
}

console.log("---- M15R-L3 无重叠 ----");
{
  const r = layoutMap(NODES, "root", { expandedIds: new Set(["root", "ch1", "ch2"]) });
  let overlap = false;
  for (let i = 0; i < r.nodes.length; i++) {
    for (let j = i + 1; j < r.nodes.length; j++) {
      const a = r.nodes[i];
      const b = r.nodes[j];
      if (a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h) overlap = true;
    }
  }
  check("可见节点两两矩形无重叠", !overlap, "");
  check("bounds 覆盖全部节点", r.bounds.w >= Math.max(...r.nodes.map((n) => n.x + n.w)) && r.bounds.h >= Math.max(...r.nodes.map((n) => n.y + n.h)), r.bounds);
}

console.log("---- M15R-L4 正交肘形边 ----");
{
  const r = layoutMap(NODES, "root", { expandedIds: new Set(["root", "ch1"]) });
  const e = r.edges.find((e) => e.toId === "ch1");
  check("边存在且为 H-V-H 正交路径", Boolean(e) && /^M \d+(\.\d+)? \d+(\.\d+)? H \d+(\.\d+)? V \d+(\.\d+)? H \d+(\.\d+)?$/.test(e.d), e && e.d);
  check("边数 = 可见节点数 - 1", r.edges.length === r.nodes.length - 1, r.edges.length);
}

console.log("---- M15R-L5 渲染快照 ----");
{
  const layout = layoutMap(NODES, "root", { expandedIds: new Set(["root", "ch1", "ch2", "b"]) });
  const svg = buildMapSvg(layout, THEME, { selectedId: "ch1" });
  const snapPath = path.join(__dirname, "fixtures", "m15r-render.snapshot.json");
  fs.mkdirSync(path.dirname(snapPath), { recursive: true });
  if (!fs.existsSync(snapPath)) {
    fs.writeFileSync(snapPath, JSON.stringify({ svg }, null, 1), "utf-8");
    console.log("      （首次运行：快照已写入）");
    check("快照首次写入", true, "");
  } else {
    const snap = JSON.parse(fs.readFileSync(snapPath, "utf-8"));
    check("SVG 与快照逐字节一致", snap.svg === svg, snap.svg === svg ? "" : "内容漂移——若为有意视觉变更请更新快照");
  }
  check("root 为唯一 accent 填充（仅 1 处 accent 填充矩形）", (svg.match(new RegExp(`fill="${THEME.accent}"`, "g")) || []).length === 1, "");
  check("无阴影/渐变/圆角关键词", !/shadow|gradient|rx=|ry=/.test(svg), "");
}

console.log("---- M15R-L6 转义与截断 ----");
{
  const nasty = [{ id: "r", parentId: null, title: '尖角<b>&"引号</b>', childIds: [] }];
  const svg = buildMapSvg(layoutMap(nasty, "r", { expandedIds: new Set(["r"]) }), THEME, {});
  check("XML 转义", svg.includes("&lt;b&gt;&amp;") && !svg.includes("<b>"), "");
  const long = [{ id: "r", parentId: null, title: "这是一个非常非常非常非常非常非常非常长的标题超出节点宽度", childIds: [] }];
  const svg2 = buildMapSvg(layoutMap(long, "r", { expandedIds: new Set(["r"]) }), THEME, {});
  check("超长标题截断含省略号", svg2.includes("…"), "");
  check("宽度 4px 网格取整", nodeWidth("一二三") % 4 === 0, nodeWidth("一二三"));
}

console.log(`\n==== SUMMARY ${pass}/${pass + fail} ====`);
if (fail) process.exit(1);
