import { jsPDF } from 'jspdf';

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
const labels = { baseline: 'Starting draft', resume: 'Recording resumed (new starting point)', gap: 'Unrecorded / reconnect interval', stop: 'Recording stopped', feedback: 'Teacher feedback', paste: 'Updated draft after browser-reported paste', change: 'Updated draft' };
function when(value) {
  if (!value) return 'Time not recorded';
  const date = new Date(typeof value === 'string' && /^\d{4}-\d\d-\d\d \d\d:/.test(value) ? value.replace(' ', 'T') + 'Z' : value);
  return Number.isNaN(date.valueOf()) ? 'Time not recorded' : date.toLocaleString('en-AU');
}
function extract(text, start = 0, length = 0) {
  const from = Math.max(0, start - 80);
  const to = Math.min(text.length, Math.max(start + length, start + 80), from + 360);
  return `${from ? '[Earlier text omitted] ' : ''}${text.slice(from, to)}${to < text.length ? ' [Later text omitted]' : ''}` || '(Empty draft)';
}

function truncateDraft(text, limit = 1200) {
  const raw = String(text || '');
  if (!raw) return '(Empty draft)';
  if (raw.length <= limit) return raw;
  return `${raw.slice(0, limit)} [Writing continues — full text is in Writing at export / the .iboard file]`;
}

/** Prefer evidence of revision while keeping each report compact. */
function sampleRevisions(revisions, detailed) {
  const limit = detailed ? 20 : 3;
  const score = e => (e.inlineComments?.length ? 100 : 0)
    + (e.removed > 0 && e.inserted ? 30 : e.removed > 0 ? 20 : 0)
    + Math.min(10, (e.removed + String(e.inserted || '').length) / 50);
  const selected = new Set([...revisions].sort((a, b) => score(b) - score(a)).slice(0, limit));
  return revisions.filter(e => selected.has(e));
}

function timestamp(value) {
  const raw = typeof value === 'string' && /^\d{4}-\d\d-\d\d \d\d:/.test(value)
    ? value.replace(' ', 'T') + 'Z' : value;
  return new Date(raw).getTime();
}

/** Match only a unique quoted passage; never infer a link across a recording gap. */
export function linkInlineRevisions(events, annotations = []) {
  const result = events.map(e => ({ ...e, inlineComments: [] }));
  for (const note of annotations) {
    const at = timestamp(note.created_at);
    const quote = String(note.quote || '');
    if (!Number.isFinite(at) || !quote || !note.note) continue;
    let start = null, end = null;
    for (const event of result) {
      if (event.at <= at) continue;
      if (['baseline', 'gap', 'resume', 'stop'].includes(event.type)) break;
      if (!['change', 'paste'].includes(event.type)) continue;
      if (start === null) {
        start = event.before.indexOf(quote);
        if (start < 0 || event.before.indexOf(quote, start + 1) !== -1) break;
        end = start + quote.length;
      }
      const editEnd = event.start + event.removed;
      const touches = event.removed > 0
        ? event.start < end && editEnd > start
        : event.start > start && event.start < end;
      if (touches) {
        event.inlineComments.push(note);
        break;
      }
      if (editEnd <= start) {
        const shift = String(event.inserted || '').length - event.removed;
        start += shift; end += shift;
      }
    }
  }
  return result;
}
function yearLabel(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const match = raw.match(/(?:year|yr)?\s*(\d{1,2})/i);
  return match ? `Year ${match[1]}` : raw;
}
function changeDescription(event) {
  const removed = String(event.before || '').slice(event.start, event.start + event.removed);
  const added = String(event.inserted || '');
  if (event.type === 'paste') return added ? `Inserted text: “${extract(added, 0, 0)}”` : 'Inserted text was removed again.';
  if (removed && added) return `Replaced: “${extract(removed, 0, 0)}” → “${extract(added, 0, 0)}”`;
  if (removed) return `Removed: “${extract(removed, 0, 0)}”`;
  if (added) return `Added: “${extract(added, 0, 0)}”`;
  return 'No visible text change.';
}

function buildJourneyEvents(events, detailed) {
  const revisions = events.filter((e) => ['change', 'paste'].includes(e.type));
  const selected = new Set(sampleRevisions(revisions, detailed));
  const milestones = new Set(['baseline', 'resume', 'gap', 'stop']);
  return events.filter((event) => milestones.has(event.type) || selected.has(event));
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
  const pageNames = new Map();
  const addPage = pdf.addPage.bind(pdf);
  pdf.addPage = (...args) => { pageNames.set(pdf.getNumberOfPages(), studentName); return addPage(...args); };
  paragraph('iBoard | Session report', { size: 22, colour: [25, 59, 89], gap: 5 });
  paragraph(`Room ${pack.sourceRoomCode || ''} | Captured ${when(pack.exportedAt)}`, { size: 10 });
  paragraph(`${people.length} student${people.length === 1 ? '' : 's'} | ${detailed ? 'Sampled Draft Trail checkpoints (up to 20 text changes)' : 'Draft Trail summary (3 revision extracts)'}`, { size: 10 });
  paragraph(`Times shown in ${Intl.DateTimeFormat().resolvedOptions().timeZone}. Writing reflects the latest version received by iBoard when this report was captured; it may not be a final submission.`, { size: 9, colour: [90, 102, 117] });
  heading('Reading this report');
  paragraph('Draft Trails provide evidence of writing development. They do not verify identity or prove independent authorship. Pasted text may be legitimate. Inline comments appear only when a later recorded edit overlaps their uniquely matched passage. This shows sequence, not proof that feedback caused or successfully guided the change.');
  paragraph('Recording begins at the baseline. Paused and disconnected intervals are not continuous observation. This PDF is a readable report; retain the .iboard session file to reopen the lesson and explore its trails.');
  if (pack.draftTrail?.reason) paragraph(pack.draftTrail.reason, { colour: [150, 60, 30] });
  heading('Included students');
  people.forEach((s, i) => paragraph(`${i + 1}. ${s.name}${s.archived ? ' (archived trail)' : ''}`, { gap: 1 }));
  for (const student of people) {
    newPage(); studentName = student.name;
    paragraph(student.name || 'Student', { size: 20, colour: [25, 59, 89], gap: 5 });
    paragraph([student.class_group && `Group ${student.class_group}`, yearLabel(student.year_level), student.archived && 'Archived trail - student card removed'].filter(Boolean).join(' | ') || 'Session writing and learning evidence', { size: 9, colour: [90, 102, 117] });
    const events = linkInlineRevisions(reconstructTrail(student.trail?.events), pack.annotationsByExportId?.[student.exportId] || []);
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
    heading('Draft Trail');
    if (!events.length) { paragraph('No Draft Trail was captured for this student. This does not indicate misconduct.'); continue; }
    const revisions = events.filter(e => ['change', 'paste'].includes(e.type));
    const pastes = events.filter(e => e.type === 'paste');
    paragraph(`${events.length} recorded events | ${revisions.length} text-change checkpoints | ${pastes.length} browser-reported pastes | ${events.filter(e => ['gap', 'resume'].includes(e.type)).length} unrecorded intervals`);
    paragraph(`First record: ${when(events[0].at)}\nLatest record: ${when(events.at(-1).at)}`, { size: 9 });
    const journeyEvents = buildJourneyEvents(events, detailed);
    const shownRevisions = journeyEvents.filter(e => ['change', 'paste'].includes(e.type)).length;
    heading(detailed ? 'Writing journey (sampled)' : 'Writing journey');
    paragraph(
      detailed
        ? `Showing ${shownRevisions} of ${revisions.length} text changes plus milestones. Meaningful revisions are prioritised. Each entry shows the edit, not a full reprint of the draft (full writing is above).`
        : 'Up to three selected revision extracts plus recording milestones. Rewording, deletions and revisions following inline feedback are prioritised. Full writing is above; the .iboard file keeps the complete trail.'
    );
    if (!journeyEvents.length) paragraph('No Draft Trail events were recorded after the baseline.');
    for (const event of journeyEvents) {
      space(12);
      paragraph(`${when(event.at)} | ${labels[event.type]}`, { size: 9, colour: [29, 74, 116], gap: 1 });

      if (event.type === 'stop') { paragraph('Capture stopped. Later work is outside this recording segment.', { size: 9 }); continue; }
      if (['change', 'paste'].includes(event.type)) {
        for (const note of event.inlineComments) {
          paragraph('Revision following feedback', { size: 9, colour: [29, 74, 116], gap: 1 });
          paragraph(`${when(note.created_at)} | Inline comment: ${note.note}`, { size: 8 });
          paragraph(`Commented passage: “${extract(note.quote)}”`, { size: 8 });
        }
        paragraph(changeDescription(event), { size: 8, colour: [28, 105, 83], gap: 1 });
        paragraph(extract(event.after, event.start, event.inserted?.length), { size: 8, colour: [35, 45, 62], gap: 2 });
        continue;
      }
      if (['baseline', 'resume', 'gap'].includes(event.type)) {
        paragraph(truncateDraft(event.after || event.text || '', detailed ? 900 : 500), { size: 8, colour: [35, 45, 62], gap: 2 });
      }
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
