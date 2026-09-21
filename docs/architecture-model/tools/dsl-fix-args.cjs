// One-off fixer: Structurizr DSL container/component positional args were emitted
// in the order (name, description, tags, technology). The grammar wants
// (name, description, technology, tags). Swap args 3 and 4 where arg3 is a bare
// ASCII tag list and arg4 looks like a path.
const fs = require('fs');

const file = process.argv[2];
const lines = fs.readFileSync(file, 'utf8').split('\n');
let swapped = 0;

const out = lines.map((line) => {
  const m = line.match(/^(\s*[A-Za-z][A-Za-z0-9_]*\s*=\s*(?:container|component)\s+)((?:"(?:\\.|[^"\\])*"\s*)+)(.*)$/);
  if (!m) return line;
  const args = [...m[2].matchAll(/"((?:\\.|[^"\\])*)"/g)].map((x) => x[1]);
  if (args.length !== 4) return line;

  const isTagList = /^[A-Za-z][A-Za-z0-9,]*$/.test(args[2]);
  const isPath = /[/.]/.test(args[3]);
  if (!isTagList || !isPath) return line;

  const [name, desc, tag, path] = args;
  swapped += 1;
  const q = (s) => '"' + s.replace(/"/g, '\\"') + '"';
  // containers additionally carry the structural "Container" tag; components keep their own
  const raw = /^(\s*\w+\s*=\s*container)/.test(line) ? tag + ',Container' : tag;
  const finalTag = [...new Set(raw.split(',').map((t) => t.trim()).filter(Boolean))].join(',');
  return m[1] + [q(name), q(desc), q(path), q(finalTag)].join(' ') + m[3];
});

fs.writeFileSync(file, out.join('\n'));
console.log(`swapped technology/tags args on ${swapped} declaration lines`);
