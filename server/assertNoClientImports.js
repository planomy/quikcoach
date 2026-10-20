import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Production ships server/ plus client/dist only. An import of client source
// crashes the process on boot and takes the class offline.
const serverRoot = path.dirname(fileURLToPath(import.meta.url));
const specifierPatterns = [
  /\bfrom\s+['"](\.[^'"]+)['"]/g,
  /\bimport\s+['"](\.[^'"]+)['"]/g,
  /\bimport\s*\(\s*['"](\.[^'"]+)['"]\s*\)/g,
];

function javascriptFiles(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'data') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) javascriptFiles(full, out);
    else if (entry.name.endsWith('.js') && entry.name !== 'assertNoClientImports.js') out.push(full);
  }
  return out;
}

const escapes = [];
for (const file of javascriptFiles(serverRoot)) {
  const text = fs.readFileSync(file, 'utf8');
  for (const pattern of specifierPatterns) {
    for (const match of text.matchAll(pattern)) {
      const spec = match[1];
      const resolved = path.resolve(path.dirname(file), spec);
      const rel = path.relative(serverRoot, resolved);
      if (rel.startsWith('..') || path.isAbsolute(rel)) {
        escapes.push(`${path.relative(serverRoot, file)} imports ${spec}`);
      }
    }
  }
}

if (escapes.length) {
  console.error('Refusing to start. The live image only includes server/ and client/dist.');
  console.error('A server import outside server/ crashes the class:');
  for (const line of escapes) console.error(`  ${line}`);
  process.exit(1);
}
