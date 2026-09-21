const fs = require('fs');
const src = fs.readFileSync(process.argv[2], 'utf8');

const lines = src.split('\n').map((l) => {
  const i = l.indexOf('//');
  return i >= 0 && /\S/.test(l.slice(0, i)) ? l.slice(0, i) : l;
});

const err = [];
let bal = 0;
lines.forEach((l, n) => {
  const q = l.replace(/"(?:\\.|[^"\\])*"/g, '""');
  for (const c of q) {
    if (c === '{') bal++;
    else if (c === '}') bal--;
  }
  if (bal < 0) err.push(`line ${n + 1}: brace underflow`);
});
if (bal !== 0) err.push(`unbalanced braces, net = ${bal}`);

const decl = new Set();
const reDecl = /^\s*([A-Za-z][A-Za-z0-9_]*)\s*=\s*(person|softwareSystem|container|component|deploymentNode|computeNode)(\s|\{|$)/gm;
let m;
while ((m = reDecl.exec(src))) decl.add(m[1]);

const eps = new Set();
const reRel = /^\s*([A-Za-z][A-Za-z0-9_]*)\s*->\s*([A-Za-z][A-Za-z0-9_]*)(\s|"|\{)/gm;
while ((m = reRel.exec(src))) { eps.add(m[1]); eps.add(m[2]); }

const viewScopes = new Set();
const reScope = /^\s*(?:systemContext|container|component|deploymentView)\s+([A-Za-z][A-Za-z0-9_]*)\s+"/gm;
while ((m = reScope.exec(src))) viewScopes.add(m[1]);

const incRefs = new Set();
const reInc = /^\s*(?:include|exclude)\s+([A-Za-z][A-Za-z0-9_]+)\s*$/gm;
while ((m = reInc.exec(src))) incRefs.add(m[1]);

const undeclared = [...eps, ...viewScopes, ...incRefs].filter((x) => !decl.has(x));
if (undeclared.length) {
  err.push('UNDECLARED ids referenced: ' + [...new Set(undeclared)].join(', '));
}

const keys = [...src.matchAll(/^\s*(?:systemLandscape|systemContext|container|component)\s+"([^"]+)"/gm)].map((x) => x[1]);
const dupKeys = keys.filter((k, i) => keys.indexOf(k) !== i);
if (dupKeys.length) err.push('duplicate view keys: ' + [...new Set(dupKeys)].join(', '));

const relStyles = [...src.matchAll(/^\s*relationship\s+"(\w+)"/gm)].map((x) => x[1]);
const dupStyles = relStyles.filter((k, i) => relStyles.indexOf(k) !== i);
if (dupStyles.length) err.push('duplicate relationship style blocks: ' + [...new Set(dupStyles)].join(', '));

const elStyles = [...src.matchAll(/^\s*element\s+"(\w+)"/gm)].map((x) => x[1]);
const dupEl = elStyles.filter((k, i) => elStyles.indexOf(k) !== i);
if (dupEl.length) err.push('duplicate element style blocks: ' + [...new Set(dupEl)].join(', '));

// tags used vs styled  (DSL positional form: last quoted arg on a declaration line)
const usedTags = new Set();
for (const line of src.split('\n')) {
  const t = line.match(/^\s*[A-Za-z][A-Za-z0-9_]*\s*=\s*(?:person|softwareSystem|container|component)\s+((?:"(?:\\.|[^"\\])*"\s*)+)\{/);
  if (!t) continue;
  const args = [...t[1].matchAll(/"((?:\\.|[^"\\])*)"/g)].map((x) => x[1]);
  if (args.length >= 3) args[args.length - 1].split(',').forEach((s) => s.trim() && usedTags.add(s.trim()));
}
const styledTags = new Set([...elStyles, ...relStyles]);
const unstyled = [...usedTags].filter((t) => !styledTags.has(t));

// positional args must be space-separated, never comma-separated
const commaArgs = src.split('\n').map((l, i) => ({ l, n: i + 1 })).filter((o) => /",\s*"/.test(o.l));
if (commaArgs.length) {
  err.push('comma-separated DSL positional args at lines: ' + commaArgs.map((o) => o.n).join(', '));
}

// arity sanity: declarations need name + description; relationships need >= 1 label
const badDecl = [];
src.split('\n').forEach((l, i) => {
  const m = l.match(/^\s*[A-Za-z][A-Za-z0-9_]*\s*=\s*(person|softwareSystem|container|component)\s+((?:"(?:\\.|[^"\\])*"\s*)+)(\{|$)/);
  if (!m) return;
  const args = [...m[2].matchAll(/"((?:\\.|[^"\\])*)"/g)].map((x) => x[1]);
  if (args.length < 2) badDecl.push(i + 1);
  if (args.some((a) => !a.trim())) badDecl.push((i + 1) + '(empty arg)');
});
if (badDecl.length) err.push('suspicious declaration arity at: ' + badDecl.join(', '));

const relCount = [...src.matchAll(/^\s*[A-Za-z][A-Za-z0-9_]*\s*->\s*[A-Za-z]/gm)].length;
console.log('elements declared   :', decl.size);
console.log('relationship edges  :', relCount);
console.log('view keys          :', keys.join(', '));
console.log('view scopes        :', [...viewScopes].join(', '));
console.log('tags used          :', usedTags.size, '| styled:', styledTags.size);
if (unstyled.length) console.log('tags with no style  :', unstyled.join(', '));

if (err.length) {
  console.log('\nFAIL:\n- ' + err.join('\n- '));
  process.exit(1);
}
console.log('\nOK: braces balanced · all referenced ids declared · view keys unique · style blocks unique');
