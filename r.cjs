const fs = require('fs');
const p = 'C:\\Users\\19031\\.openclaw\\extensions\\yaoyao-memory\\src\\utils\\cloud-adapter.ts';
let c = fs.readFileSync(p, 'utf-8');

// Read target area with template literals
const marker = 'private ensureMounted(): string | null {';
const idx = c.indexOf(marker);
const block = c.substring(idx, idx + 600);
console.log('DEBUG BLOCK:', block);
console.log('---');

// Check if esc already there
if (c.includes('const esc = (s)')) {
  console.log('✅ esc already exists, skip');
} else {
  // Add esc function right after the `const driveLetter = "Z:";` line
  const afterDrive = 'const driveLetter = "Z:";';
  const escCode = 'const driveLetter = "Z:";\n    const esc = (s) => s.replace(/"/g, \'""\');\n    ';
  c = c.replace(afterDrive, escCode);
  console.log('✅ esc added');
}

// Escape username in net use call
const netUseIdx = c.indexOf('net use ${driveLetter} ${unc} /user:"${this.username}"');
if (netUseIdx >= 0) {
  const beforeNetUse = c.lastIndexOf('execSync(', netUseIdx);
  const afterNetUse = c.indexOf(')', netUseIdx) + 1;
  const line = c.substring(beforeNetUse, afterNetUse);
  console.log('Found net use line:', line);
  const newLine = line.replace('${this.username}', '${esc(this.username)}');
  c = c.replace(line, newLine);
  console.log('✅ net use username escaped');
} else {
  console.log('❌ net use line not found');
  // Show a search around the area
  const netIdx2 = c.indexOf('net use');
  if (netIdx2 >= 0) console.log('Last net use at', netIdx2, ':', c.substring(netIdx2, netIdx2 + 100));
}

fs.writeFileSync(p, c, 'utf-8');
console.log('✅ Done');
