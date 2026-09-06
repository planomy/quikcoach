import { jsPDF } from 'jspdf';
import { formatLiveAnswer } from './liveResponseUnknown.js';

export function reportStudents(pack) {
  const students = (pack.students || []).map(s => ({ ...s, key: s.exportId,
    trail: (pack.draftTrail?.students || []).find(t => t.exportId === s.exportId) }));
  (pack.draftTrail?.students || []).forEach((trail, index) => {
    if (!students.some(s => s.exportId === trail.exportId)) students.push({ key: `archived-${index}`, name: trail.name, archived: true, trail });
  });
  return students;
}

export function reconstructTrail(events = []) {
  let text = '';
  return events.map(event => {
    const before = text;
    if (['baseline', 'resume', 'gap'].includes(event.type)) text = event.text || '';
    if (['change', 'paste'].includes(event.type)) text = text.slice(0, event.start) + event.inserted + text.slice(event.start + event.removed);
    return { ...event, before, after: text };
  });
}
const labels = { baseline: 'Recording baseline', resume: 'Recording resumed (unrecorded interval)', gap: 'Unrecorded / reconnect interval', stop: 'Recording stopped', feedback: 'Teacher feedback', paste: 'Browser-reported paste', change: 'Writing changed' };
function when(value) {
  if (!value) return 'Time not recorded';
  const date = new Date(typeof value === 'string' && /^\d{4}-\d\d-\d\d \d\d:/.test(value) ? value.replace(' ', 'T') + 'Z' : value);
  return Number.isNaN(date.valueOf()) ? 'Time not recorded' : date.toLocaleString('en-AU');
}
function extract(text, start = 0, length = 0) {
  const from = Math.max(0, start - 100);
  const to = Math.min(text.length, Math.max(start + length, start + 100), from + 600);
  return `${from ? '[Earlier text omitted] ' : ''}${text.slice(from, to)}${to < text.length ? ' [Later text omitted]' : ''}` || '(Empty draft)';
}

/** Same renderer runs in the browser and the PDF layout check. No server upload. */
export function buildSessionPdf(pack, { selectedKeys, detailed = false, fontData } = {}) {
  const people = reportStudents(pack).filter(s => !selectedKeys || selectedKeys.includes(s.key));
  if (!people.length) throw new Error('Select at least one student.');
  const pdf = new jsPDF({ unit: 'mm', format: 'a4', compress: true, putOnlyUsedFonts: true });
  if (!fontData) throw new Error('The report font could not be loaded. Please try again.');
  pdf.addFileToVFS('DejaVuSans.ttf', fontData);
  pdf.addFont('DejaVuSans.ttf', 'Report', 'normal');
  pdf.setFont('Report');
  pdf.setProperties({ title: `iBoard session report - Room ${pack.sourceRoomCode}`, subject: 'Student writing, feedback and Draft Trails', author: 'iBoard' });
  const glyphs = pdf.getFont().metadata?.cmap?.unicode?.codeMap;
  let escapedGlyphs = false;
  function safe(value) {
    return Array.from(String(value ?? '').replace(/\r\n?/g, '\n').replace(/\t/g, '    ')).map(char => {
      const cp = char.codePointAt(0);
      if (char === '\n' || !glyphs || glyphs[cp]) return char;
      escapedGlyphs = true;
      return `[U+${cp.toString(16).toUpperCase()}]`;
    }).join('');
  }
  let y = 24;
  let studentName = '';
  const width = 174;
  function newPage() { pdf.addPage(); y = 24; }
  function space(height) { if (y + height > 278) newPage(); }
  function paragraph(value, { size = 10, colour = [35, 45, 62], gap = 3 } = {}) {
    pdf.setFontSize(size); pdf.setTextColor(...colour);
    const lineHeight = size * 0.48;
    for (const raw of safe(value).split('\n')) {
      const lines = pdf.splitTextToSize(raw || ' ', width);
      for (const line of lines) {
        space(lineHeight);
        pdf.text(line, 18, y); y += lineHeight;
      }
    }
    y += gap;
  }
  function heading(text) { space(19); y += 3; paragraph(text, { size: 13, colour: [29, 74, 116], gap: 3 }); }
  const pageNames = new Map();
  const addPage = pdf.addPage.bind(pdf);
  pdf.addPage = (...args) => { pageNames.set(pdf.getNumberOfPages(), studentName); return addPage(...args); };
  paragraph('iBoard | Session report', { size: 22, colour: [25, 59, 89], gap: 5 });
  paragraph(`Room ${pack.sourceRoomCode || ''} | Captured ${when(pack.exportedAt)}`, { size: 10 });
  paragraph(`${people.length} student${people.length === 1 ? '' : 's'} | ${detailed ? 'Full Draft Trail checkpoints' : 'Draft Trail summary and selected revision extracts'}`, { size: 10 });
  paragraph(`Times shown in ${Intl.DateTimeFormat().resolvedOptions().timeZone}. Writing reflects the latest version received by iBoard when this report was captured; it may not be a final submission.`, { size: 9, colour: [90, 102, 117] });
  heading('Reading this report');
  paragraph('Draft Trails provide evidence of writing development. They do not verify identity or prove independent authorship. Pasted text may be legitimate. Changes after feedback do not establish that the feedback was addressed.');
  paragraph('Recording begins at the baseline. Paused and disconnected intervals are not continuous observation. This PDF is a readable report; retain the .iboard session file to reopen the lesson and explore its trails.');
  if (pack.draftTrail?.reason) paragraph(pack.draftTrail.reason, { colour: [150, 60, 30] });
  heading('Included students');
  people.forEach((s, i) => paragraph(`${i + 1}. ${s.name}${s.archived ? ' (archived trail)' : ''}`, { gap: 1 }));
  for (const student of people) {
    newPage(); studentName = student.name;
    paragraph(student.name || 'Student', { size: 20, colour: [25, 59, 89], gap: 5 });
    paragraph([student.class_group && `Group ${student.class_group}`, student.year_level && `Year ${student.year_level}`, student.archived && 'Archived trail - student card removed'].filter(Boolean).join(' | ') || 'Session writing and learning evidence', { size: 9, colour: [90, 102, 117] });
    const events = reconstructTrail(student.trail?.events);
    heading(student.archived ? 'Last recorded writing' : 'Writing at export');
    paragraph(student.archived ? events.at(-1)?.after || '(No recorded writing)' : student.text || '(No writing received)');
    if (student.image?.base64) {
      heading('Student image / working');
      try {
        const url = `data:${student.image.mime};base64,${student.image.base64}`;
        const props = pdf.getImageProperties(url);
        const imageWidth = Math.min(width, 170 * props.width / props.height);
        const imageHeight = imageWidth * props.height / props.width;
        space(imageHeight + 5);
        pdf.addImage(url, props.fileType, 18, y, imageWidth, imageHeight); y += imageHeight + 5;
      } catch { paragraph('Image could not be included. It remains in the .iboard session file.'); }
    }
    const notes = pack.teacherNotesByExportId?.[student.exportId] || [];
    const annotations = pack.annotationsByExportId?.[student.exportId] || [];
    if (notes.length || annotations.length) {
      heading('Teacher feedback');
      for (const note of notes) { paragraph(when(note.createdAt || note.created_at), { size: 9, gap: 1 }); paragraph(note.text); }
      for (const note of annotations) {
        paragraph(`${when(note.created_at)} | Inline comment`, { size: 9, gap: 1 });
        paragraph(`Selected writing: ${note.quote}\nTeacher: ${note.note}`);
      }
    }
    const responses = (pack.live?.lessonPulse?.cells || []).filter(r => r.exportStudentId === student.exportId && student.exportId);
    if (responses.length) {
      heading('Thinking and check-in responses');
      for (const response of responses) {
        const question = pack.live.lessonPulse.questions?.find(q => q.activity_id === response.activity_id);
        paragraph(`Question ${response.question_number} | ${when(response.submitted_at)}`, { size: 9, gap: 1 });
        if (question?.prompt) paragraph(question.prompt);
        paragraph(formatLiveAnswer(response.value) || '(No answer text)');
      }
    }
    heading('Draft Trail');
    if (!events.length) { paragraph('No Draft Trail was captured for this student. This does not indicate misconduct.'); continue; }
    const revisions = events.filter(e => ['change', 'paste'].includes(e.type));
    paragraph(`${events.length} recorded events | ${revisions.length} text-change checkpoints | ${events.filter(e => e.type === 'paste').length} browser-reported pastes | ${events.filter(e => ['gap', 'resume'].includes(e.type)).length} unrecorded intervals`);
    paragraph(`First record: ${when(events[0].at)}\nLatest record: ${when(events.at(-1).at)}`, { size: 9 });
    const timeline = detailed ? events : events.filter(e => e.type !== 'change').slice(-12);
    paragraph(detailed ? 'Complete event timeline' : 'Timeline: up to 12 most recent baseline, pause, paste and feedback events', { size: 11 });
    for (const event of timeline) paragraph(`${when(event.at)} | ${labels[event.type] || event.type}`, { size: 9, gap: 1 });
    const extracts = detailed ? events : [...new Set([revisions[0], revisions[Math.floor(revisions.length / 2)], revisions.at(-1)].filter(Boolean))];
    heading(detailed ? 'Complete checkpoints' : 'Selected revision extracts');
    if (!extracts.length) paragraph('No text revisions were recorded after the baseline.');
    for (const event of extracts) {
      space(25);
      paragraph(`${when(event.at)} | ${labels[event.type]}`, { size: 10, colour: [29, 74, 116] });
      if (event.type === 'feedback') { paragraph(event.text); continue; }
      if (event.type === 'stop') { paragraph('Capture stopped. Later work is outside this recording segment.'); continue; }
      const isChange = ['change', 'paste'].includes(event.type);
      if (isChange) {
        paragraph('Before', { size: 9, colour: [148, 45, 45], gap: 1 });
        paragraph(detailed ? event.before || '(Empty draft)' : extract(event.before, event.start, event.removed));
      }
      paragraph(isChange ? 'After' : 'Recorded baseline', { size: 9, colour: [28, 105, 83], gap: 1 });
      paragraph(detailed ? event.after || '(Empty draft)' : extract(event.after, event.start, event.inserted?.length));
    }
  }
  if (escapedGlyphs) paragraph('Characters unsupported by the report font are shown as Unicode code points [U+...]. The original text remains in the .iboard file.', { size: 9 });
  pageNames.set(pdf.getNumberOfPages(), studentName);
  for (let page = 1; page <= pdf.getNumberOfPages(); page++) {
    pdf.setPage(page); pdf.setFontSize(8); pdf.setTextColor(90, 102, 117);
    pdf.text(`iBoard | Room ${pack.sourceRoomCode || ''}`, 18, 12);
    const name = safe(pageNames.get(page) || 'Session overview');
    pdf.text(pdf.splitTextToSize(name, 100)[0], 192, 12, { align: 'right' });
    pdf.setDrawColor(205, 215, 225); pdf.line(18, 284, 192, 284);
    pdf.text('Drafting evidence - not an authorship guarantee', 18, 290);
    pdf.text(`${page} / ${pdf.getNumberOfPages()}`, 192, 290, { align: 'right' });
  }
  return pdf;
}

let fontPromise;
export async function downloadSessionPdf(pack, options) {
  if (!fontPromise) fontPromise = fetch('/fonts/DejaVuSans.ttf').then(async response => {
    if (!response.ok) throw new Error('Could not load the report font. Check your connection and retry.');
    const bytes = new Uint8Array(await response.arrayBuffer());
    let binary = '';
    for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
    return btoa(binary);
  }).catch(error => { fontPromise = null; throw error; });
  const fontData = await fontPromise;
  const pdf = buildSessionPdf(pack, { ...options, fontData });
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  pdf.save(`iBoard-session-${pack.sourceRoomCode || 'report'}-${stamp}.pdf`);
}
