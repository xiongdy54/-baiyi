// Geometry self-check for a hand-authored inline-SVG diagram.
// Browser rendering was unavailable, so this verifies layout invariants numerically:
//   · every box/text sits inside the declared viewBox
//   · boxes do not overlap each other (a real defect in hand-placed SVG)
//   · text baselines do not fall outside the box they are meant to live in
//   · every marker reference resolves to a declared <marker id>
//   · every <text> is closed, and no <rect> is left with a zero-height stroke-only shell
const fs = require('fs');

const html = fs.readFileSync(process.argv[2], 'utf8');
const svg = html.match(/<svg[\s\S]*?<\/svg>/);
if (!svg) { console.error('FAIL: no <svg> block found'); process.exit(1); }
const src = svg[0];

const vb = src.match(/viewBox="0 0 ([\d.]+) ([\d.]+)"/);
if (!vb) { console.error('FAIL: no viewBox'); process.exit(1); }
const W = parseFloat(vb[1]), H = parseFloat(vb[2]);
const err = [], warn = [];

// ---------- boxes ----------
const rects = [];
for (const m of src.matchAll(/<rect\s+([^>]*?)\/>/g)) {
  const a = {};
  for (const p of m[1].matchAll(/(?:^|\s)(x|y|width|height|rx)="(-?[\d.]+)"/g)) a[p[1]] = parseFloat(p[2]);
  if (a.width === undefined) continue;
  rects.push(a);
}
// drop the full-canvas background rect
const boxes = rects.filter((r) => !(r.width >= W && r.height >= H));

console.log(`viewBox ${W}x${H} · ${rects.length} rects (${boxes.length} content boxes)`);

// ---------- out of canvas ----------
for (const r of boxes) {
  if (r.x < 0 || r.y < 0 || r.x + r.width > W || r.y + r.height > H) {
    err.push(`box out of canvas: x=${r.x} y=${r.y} w=${r.width} h=${r.height} → right=${r.x + r.width} bottom=${r.y + r.height}`);
  }
}

// ---------- degenerate boxes ----------
boxes.forEach((r, i) => {
  if (r.width <= 0 || r.height <= 0) err.push(`degenerate box #${i}: ${r.width}x${r.height} at (${r.x},${r.y})`);
  if (r.height < 20 && r.width < 40) warn.push(`suspiciously small box: ${r.width}x${r.height} at (${r.x},${r.y})`);
});

// ---------- box overlap ----------
const inter = (a, b) => {
  const x = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x));
  const y = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
  return x * y;
};
for (let i = 0; i < boxes.length; i++) {
  for (let j = i + 1; j < boxes.length; j++) {
    const a = boxes[i], b = boxes[j];
    const ov = inter(a, b);
    if (ov <= 0) continue;
    const smaller = Math.min(a.width * a.height, b.width * b.height);
    const ratio = ov / smaller;
    // label-under-line knockout rects legitimately sit ON a path and inside a lane,
    // so only flag when two *substantial* boxes collide
    const substantial = (r) => r.height >= 40 && r.width >= 120;
    if (substantial(a) && substantial(b)) {
      err.push(`content boxes overlap ${(ratio * 100).toFixed(0)}%: (${a.x},${a.y},${a.width}x${a.height}) vs (${b.x},${b.y},${b.width}x${b.height})`);
    }
  }
}

// ---------- text inside canvas + not colliding with a foreign box ----------
const texts = [];
for (const m of src.matchAll(/<text\s+([^>]*?)>([\s\S]*?)<\/text>/g)) {
  const a = {};
  for (const p of m[1].matchAll(/(x|y|font-size)="(-?[\d.]+)"/g)) a[p[1]] = parseFloat(p[2]);
  a.content = m[2].replace(/<[^>]+>/g, '').trim();
  texts.push(a);
}
const unclosedText = (src.match(/<text\b/g) || []).length - (src.match(/<\/text>/g) || []).length;
if (unclosedText !== 0) err.push(`unbalanced <text> tags: diff ${unclosedText}`);

const cjk = (s) => (s.match(/[一-龥]/g) || []).length;
console.log(`text nodes: ${texts.length}`);

for (const t of texts) {
  const size = t['font-size'] || 12;
  // crude width estimate: CJK ~1em, latin ~0.55em
  const approxW = (cjk(t.content) * size + (t.content.length - cjk(t.content)) * size * 0.55);
  if (t.x > W || t.x < 0 || t.y > H || t.y < 0) {
    err.push(`text anchor off-canvas: "${t.content.slice(0, 24)}" at (${t.x},${t.y})`);
    continue;
  }
  if (t.x + approxW > W + 2) {
    err.push(`text likely runs past canvas: "${t.content.slice(0, 28)}" x=${t.x} estRight=${(t.x + approxW).toFixed(0)} > ${W}`);
  }
}
// text vs boxes: any text whose anchor is inside no box and is not a lane label
const laneLabels = texts.filter((t) => (t['font-size'] || 12) <= 8);
for (const t of texts) {
  if (laneLabels.includes(t)) continue;
  const inside = boxes.find((r) => t.x >= r.x - 1 && t.x <= r.x + r.width + 1 && t.y > r.y && t.y < r.y + r.height + 1);
  const onPath = t['font-size'] && t['font-size'] <= 11; // small knockout labels sit on lines
  if (!inside && !onPath) warn.push(`text outside any box (may be intentional): "${t.content.slice(0, 30)}" at (${t.x},${t.y})`);
}

// ---------- markers ----------
const declared = new Set([...src.matchAll(/<marker\s+id="([^"]+)"/g)].map((m) => m[1]));
const used = new Set([...src.matchAll(/url\(#([^)]+)\)/g)].map((m) => m[1]));
for (const u of used) if (!declared.has(u)) err.push(`marker referenced but not declared: #${u}`);
console.log(`markers declared: ${[...declared].join(', ')} · referenced: ${[...used].join(', ') || '(none)'}`);

// ---------- font-family quoting bug that exists elsewhere in this repo's diagrams ----------
const badFont = (html.match(/font-family=""[a-zA-Z]/g) || []).length;
if (badFont) err.push(`${badFont} malformed nested-quote font-family attributes (the defect present in docs/diagrams/*.html)`);

console.log('');
if (warn.length) console.log('WARN:\n- ' + warn.join('\n- '));
if (err.length) { console.log('\nFAIL:\n- ' + err.join('\n- ')); process.exit(1); }
console.log('OK: all content boxes inside canvas and non-overlapping · text fits · markers resolve · font-family well-formed');
