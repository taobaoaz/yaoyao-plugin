const fs = require('fs');
const path = require('path');

const srcDir = path.resolve('src');
const files = [];

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (entry.name.endsWith('.ts')) files.push(full);
  }
}
walk(srcDir);

let totalAny = 0;

for (const file of files) {
  let content = fs.readFileSync(file, 'utf-8');
  let changed = false;
  
  const catchAny = /catch\s*\(\s*(\w+)\s*:\s*any\s*\)/g;
  content = content.replace(catchAny, (match, name) => {
    changed = true; totalAny++;
    return `catch (${name}: unknown)`;
  });
  
  const argsAny = /\.\.\.args:\s*any\[\]/g;
  content = content.replace(argsAny, () => {
    changed = true; totalAny++;
    return '...args: unknown[]';
  });
  
  const declAny = /(\b(?:let|const|var)\s+\w+)\s*:\s*any\b/g;
  content = content.replace(declAny, (match, prefix) => {
    changed = true; totalAny++;
    return `${prefix}: unknown`;
  });
  
  const paramAny = /(\(\s*\w+\s*:\s*)any\b/g;
  content = content.replace(paramAny, (match, prefix) => {
    changed = true; totalAny++;
    return `${prefix}unknown`;
  });
  
  const returnAnyArr = /(\))\s*:\s*any\[\]/g;
  content = content.replace(returnAnyArr, (match, paren) => {
    changed = true; totalAny++;
    return `${paren}: unknown[]`;
  });
  
  const asAny = /\bas\s+any\b(?!\[)/g;
  content = content.replace(asAny, () => {
    changed = true; totalAny++;
    return 'as unknown';
  });
  
  const asAnyArr = /\bas\s+any\[\]/g;
  content = content.replace(asAnyArr, () => {
    changed = true; totalAny++;
    return 'as unknown[]';
  });
  
  const rawAny = /_raw\??:\s*any\b/g;
  content = content.replace(rawAny, () => {
    changed = true; totalAny++;
    return '_raw?: unknown';
  });
  
  if (changed) {
    fs.writeFileSync(file, content, 'utf-8');
  }
}

console.log(`Replaced ${totalAny} 'any' occurrences`);
