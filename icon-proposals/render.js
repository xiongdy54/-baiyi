const { Resvg } = require("@resvg/resvg-js");
const fs = require("fs");
const path = require("path");

const dir = path.join(__dirname);
const files = fs.readdirSync(dir).filter((f) => f.endsWith(".svg"));

for (const f of files) {
  const svg = fs.readFileSync(path.join(dir, f), "utf8");
  for (const size of [512, 256, 64]) {
    const r = new Resvg(svg, {
      fitTo: { mode: "width", value: size },
      background: "rgba(255,255,255,0)", // SVG 自带底色，无需外补
    });
    const png = r.render().asPng();
    const out = path.join(dir, f.replace(".svg", "") + `@${size}.png`);
    fs.writeFileSync(out, png);
  }
  console.log("rendered:", f);
}

// 拼一张总览对比图：6 方案 × 512/256/64 三档 + 深色底小图测试
const names = files
  .map((f) => f.replace(".svg", ""))
  .sort();
const CELL = 560;
const ROWS = names.length;
const cols = ["@512", "@256", "@64"];
const W = CELL * cols.length + 40;
const H = ROWS * CELL + 80;
let composite = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><rect width="${W}" height="${H}" fill="#e8e8e4"/>`;
names.forEach((n, i) => {
  cols.forEach((c, j) => {
    const b64 = fs
      .readFileSync(path.join(dir, n + c + ".png"))
      .toString("base64");
    const scale = c === "@512" ? 480 : c === "@256" ? 240 : 64;
    const x = 20 + j * CELL + (CELL - scale - 20) / 2;
    const y = 20 + i * CELL;
    composite += `<image x="${x}" y="${y}" width="${scale}" height="${scale}" href="data:image/png;base64,${b64}"/>`;
    composite += `<text x="${x}" y="${y + scale + 28}" font-size="22" font-family="Segoe UI" fill="#0a0a0a">${n.replace(/-\d+/, (m) => " " + m.replace("-", "."))} ${c.replace("@", "")}px</text>`;
  });
});
composite += "</svg>";

const r2 = new Resvg(composite, { fitTo: { mode: "width", value: 1700 } });
fs.writeFileSync(
  path.join(dir, "overview.png"),
  r2.render().asPng()
);
console.log("overview.png done");
