import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildPortfolioPdf,
  uniquePortfolioZipNames,
} from '../src/lib/portfolioPdf.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const output = process.argv[2];
if (!output) throw new Error('Provide a temporary output directory for PDF layout checks.');
fs.mkdirSync(output, { recursive: true });
const fontData = fs.readFileSync(path.join(root, 'client/public/fonts/DejaVuSans.ttf')).toString('base64');

const student = {
  name: 'Zoë O’Connor',
  aliases: ['Zoë O’Connor', 'Zoe'],
  entries: [
    { label: 'Persuasive draft', createdAt: '2026-09-06 00:00:00', text: 'Loyalty matters more than pride.', classGroup: '8E', sourceName: 'Zoe' },
    { label: 'Final copy', createdAt: '2026-09-08T02:15:00Z', text: `${'The character returns because family comes first. '.repeat(40)}` },
  ],
};

assert.deepEqual(
  uniquePortfolioZipNames([{ name: 'Alex' }, { name: 'Alex' }, { name: 'Sam Jones' }]),
  ['Alex-portfolio.pdf', 'Alex-2-portfolio.pdf', 'Sam_Jones-portfolio.pdf']
);

const pdf = buildPortfolioPdf({
  roomCode: '2468',
  student,
  fontData,
  generatedAt: '2026-09-22T03:00:00Z',
});
const bytes = Buffer.from(pdf.output('arraybuffer'));
fs.writeFileSync(path.join(output, 'zoe-portfolio.pdf'), bytes);
assert.ok(bytes.length > 1000);
assert.ok(pdf.getNumberOfPages() >= 1);
assert.throws(() => buildPortfolioPdf({ student, fontData: null }), /report font/);
console.log(`zoe-portfolio.pdf: ${pdf.getNumberOfPages()} pages, ${bytes.length} bytes`);
