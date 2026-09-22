import { jsPDF } from 'jspdf';
import { safeFilePart, stampForFilename } from './exportRoom.js';
import { loadReportFont } from './sessionPdf.js';

function words(text) {
  return String(text || '').trim().split(/\s+/).filter(Boolean).length;
}

function when(value) {
  if (!value) return '';
  const date = new Date(typeof value === 'string' && /^\d{4}-\d\d-\d\d \d\d:/.test(value) ? value.replace(' ', 'T') + 'Z' : value);
  return Number.isNaN(date.valueOf()) ? String(value) : date.toLocaleString('en-AU');
}

function downloadBlob(filename, blob) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

export function portfolioPdfFilename(roomCode, studentName) {
  return `iboard-${safeFilePart(studentName)}-portfolio-room${roomCode || 'room'}-${stampForFilename()}.pdf`;
}

export function portfolioZipFilename(roomCode) {
  return `iboard-portfolios-room${roomCode || 'room'}-${stampForFilename()}.zip`;
}

export function uniquePortfolioZipNames(students) {
  const used = new Map();
  return (students || []).map((student) => {
    const base = safeFilePart(student?.name);
    const count = (used.get(base) || 0) + 1;
    used.set(base, count);
    return `${count === 1 ? base : `${base}-${count}`}-portfolio.pdf`;
  });
}

/** One student, every saved snapshot. Same report font as the session PDF. */
export function buildPortfolioPdf({ roomCode, student, fontData, generatedAt } = {}) {
  if (!fontData) throw new Error('The report font could not be loaded. Please try again.');
  const name = String(student?.name || 'Student').trim() || 'Student';
  const entries = Array.isArray(student?.entries) ? student.entries : [];
  const aliases = (student?.aliases || []).filter((alias) => alias && alias !== name);
  const totalWords = entries.reduce((sum, entry) => sum + words(entry.text), 0);
  const pdf = new jsPDF({ unit: 'mm', format: 'a4', compress: true, putOnlyUsedFonts: true });
  pdf.addFileToVFS('DejaVuSans.ttf', fontData);
  pdf.addFont('DejaVuSans.ttf', 'Report', 'normal');
  pdf.setFont('Report');
  pdf.setProperties({
    title: `iBoard portfolio — ${name}`,
    subject: 'Student writing portfolio',
    author: 'iBoard',
  });
  const glyphs = pdf.getFont().metadata?.cmap?.unicode?.codeMap;
  function safe(value) {
    return Array.from(String(value ?? '').replace(/\r\n?/g, '\n').replace(/\t/g, '    ')).map((char) => {
      const cp = char.codePointAt(0);
      if (char === '\n' || !glyphs || glyphs[cp]) return char;
      return `[U+${cp.toString(16).toUpperCase()}]`;
    }).join('');
  }
  let y = 24;
  const width = 174;
  function newPage() { pdf.addPage(); y = 24; }
  function space(height) { if (y + height > 278) newPage(); }
  function paragraph(value, { size = 10, colour = [35, 45, 62], gap = 2 } = {}) {
    pdf.setFontSize(size); pdf.setTextColor(...colour);
    const lineHeight = size * 0.42;
    for (const raw of safe(value).split('\n')) {
      const lines = pdf.splitTextToSize(raw || ' ', width);
      for (const line of lines) {
        space(lineHeight);
        pdf.text(line, 18, y); y += lineHeight;
      }
    }
    y += gap;
  }
  function heading(text) { space(14); y += 2; paragraph(text, { size: 12, colour: [29, 74, 116], gap: 2 }); }

  paragraph(name, { size: 22, colour: [25, 59, 89], gap: 4 });
  paragraph('iBoard | Student writing portfolio', { size: 10, colour: [29, 74, 116] });
  paragraph(
    [
      roomCode ? `Room ${roomCode}` : null,
      `${entries.length} saved submission${entries.length === 1 ? '' : 's'}`,
      `${totalWords} words`,
      generatedAt ? `Exported ${when(generatedAt)}` : null,
    ].filter(Boolean).join(' | '),
    { size: 9, colour: [90, 102, 117] }
  );
  if (aliases.length) {
    paragraph(`Also joined as: ${aliases.join(', ')}`, { size: 9, colour: [90, 102, 117] });
  }
  paragraph(
    'Each section is a classroom snapshot of this student’s writing. It is evidence of work saved in the lesson, not a mark or an authorship guarantee.',
    { size: 9, colour: [90, 102, 117] }
  );

  if (!entries.length) {
    heading('Saved writing');
    paragraph('No saved submissions.');
  }

  entries.forEach((entry, index) => {
    heading(`${index + 1}. ${entry.label || 'Saved evidence'}`);
    paragraph(
      [
        when(entry.createdAt) && `Saved ${when(entry.createdAt)}`,
        `${words(entry.text)} words`,
        entry.classGroup && `Group ${entry.classGroup}`,
        aliases.length && entry.sourceName && entry.sourceName !== name ? `as ${entry.sourceName}` : null,
      ].filter(Boolean).join(' | ') || 'Saved writing',
      { size: 9, colour: [90, 102, 117] }
    );
    paragraph(String(entry.text || '').trim() || '(No writing submitted.)');
  });

  for (let page = 1; page <= pdf.getNumberOfPages(); page++) {
    pdf.setPage(page); pdf.setFontSize(8); pdf.setTextColor(90, 102, 117);
    pdf.text(`iBoard | Room ${roomCode || ''}`, 18, 12);
    pdf.text(pdf.splitTextToSize(safe(name), 100)[0], 192, 12, { align: 'right' });
    pdf.setDrawColor(205, 215, 225); pdf.line(18, 284, 192, 284);
    pdf.text('Student portfolio — saved classroom writing', 18, 290);
    pdf.text(`${page} / ${pdf.getNumberOfPages()}`, 192, 290, { align: 'right' });
  }
  return pdf;
}

export async function downloadPortfolioPdf({ roomCode, student }) {
  if (!student) throw new Error('Choose a student first.');
  const fontData = await loadReportFont();
  const pdf = buildPortfolioPdf({ roomCode, student, fontData, generatedAt: new Date().toISOString() });
  pdf.save(portfolioPdfFilename(roomCode, student.name));
}

export async function downloadPortfolioZip({ roomCode, students }) {
  const list = Array.isArray(students) ? students.filter(Boolean) : [];
  if (!list.length) throw new Error('No student portfolios to download yet.');
  const [{ default: JSZip }, fontData] = await Promise.all([import('jszip'), loadReportFont()]);
  const zip = new JSZip();
  const names = uniquePortfolioZipNames(list);
  const generatedAt = new Date().toISOString();
  for (let i = 0; i < list.length; i += 1) {
    const pdf = buildPortfolioPdf({ roomCode, student: list[i], fontData, generatedAt });
    zip.file(names[i], pdf.output('arraybuffer'));
    if (i % 3 === 2) await new Promise((resolve) => setTimeout(resolve, 0));
  }
  const blob = await zip.generateAsync({ type: 'blob', compression: 'STORE' });
  downloadBlob(portfolioZipFilename(roomCode), blob);
  return { count: list.length };
}
