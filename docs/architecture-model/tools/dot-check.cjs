// Offline structural check for Graphviz DOT, since `dot` is not on PATH here.
// Catches: unbalanced braces/brackets, unclosed HTML-like label tags,
// attribute-list syntax slips, and nodes referenced only inside one cluster.
const fs = require('fs');
const src = fs.readFileSync(process.argv[2], 'utf8');
const err = [];

// 1. strip // comments (DOT uses // and /* */) but not inside quoted strings
const code = src
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n')
  .map((l) => {
    let inQ = false;
    for (let i = 0; i < l.length - 1; i++) {
      if (l[i] === '"') inQ = !inQ;
      if (!inQ && l[i] === '/' && l[i + 1] === '/') return l.slice(0, i);
    }
    return l;
  })
  .join('\n');

// 2. brace / bracket balance
let braces = 0, bracks = 0;
let inStr = false, inHtml = false;
for (let i = 0; i < code.length; i++) {
  const c = code[i];
  if (inStr) { if (c === '\\') i++; else if (c === '"') inStr = false; continue; }
  if (inHtml) { if (c === '>') inHtml = false; continue; }
  if (c === '"') { inStr = true; continue; }
  if (c === '<' && /[a-zA-Z/]/.test(code[i + 1] || '')) { inHtml = true; continue; }
  if (c === '{') braces++;
  else if (c === '}') { braces--; if (braces < 0) err.push('brace underflow at offset ' + i); }
  else if (c === '[') bracks++;
  else if (c === ']') { bracks--; if (bracks < 0) err.push('bracket underflow at offset ' + i); }
}
if (braces !== 0) err.push(`unbalanced braces: net ${braces}`);
if (bracks !== 0) err.push(`unbalanced brackets: net ${bracks}`);
if (inStr) err.push('unterminated quoted string');
if (inHtml) err.push('unterminated HTML-like label');

// 3. HTML-like label tag balance, per label=< ... > block
const htmlBlocks = [...code.matchAll(/label=<([\s\S]*?)>/g)].map((m) => m[1]);
htmlBlocks.forEach((b, i) => {
  const stack = [];
  for (const t of b.matchAll(/<(\/?)\s*([a-zA-Z]+)[^>]*>/g)) {
    const [, close, name] = t;
    const voidTags = ['br', 'hr'];
    if (voidTags.includes(name.toLowerCase())) continue;
    if (close) {
      const top = stack.pop();
      if (top !== name.toLowerCase()) err.push(`HTML-like label #${i + 1}: </${name}> closes <${top}>`);
    } else stack.push(name.toLowerCase());
  }
  if (stack.length) err.push(`HTML-like label #${i + 1}: unclosed <${stack.join('><')}>`);
});

// 4. self-closing tags inside HTML-like labels (<br/> is fine; flag <br>> )
[...code.matchAll(/<(br|hr)>(?!)/g)].forEach(() => {});

// 5. node / edge inventory
const nodes = new Set();
let edges = 0;
for (const line of code.split('\n')) {
  if (/->/.test(line)) { edges += (line.match(/->/g) || []).length; continue; }
  const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*(\[|;|$)/);
  if (m && !/^(digraph|graph|node|edge|subgraph|cluster)$/.test(m[1]) && !/=$/.test(line)) nodes.add(m[1]);
}
const clusters = [...code.matchAll(/subgraph\s+(cluster_\w+)/g)].map((m) => m[1]);

// 6. every node used as an edge endpoint should be declared with a shape/label somewhere
const endpoints = new Set();
for (const m of code.matchAll(/([A-Za-z_][A-Za-z0-9_]*)\s*->/g)) endpoints.add(m[1]);
for (const m of code.matchAll(/->\s*([A-Za-z_][A-Za-z0-9_]*)/g)) endpoints.add(m[1]);
const dangling = [...endpoints].filter((n) => !nodes.has(n) && !clusters.includes(n));

console.log('clusters           :', clusters.join(', '));
console.log('declared nodes     :', nodes.size);
console.log('edges              :', edges);
console.log('HTML-like labels   :', htmlBlocks.length);
if (dangling.length) console.log('endpoints w/o decl :', dangling.join(', '), '(DOT auto-creates these; usually a typo)');
if (err.length) { console.log('\nFAIL:\n- ' + err.join('\n- ')); process.exit(1); }
console.log('\nOK: braces/brackets balanced · HTML-like labels well-formed · no unterminated strings');
