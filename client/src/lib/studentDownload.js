export const WORD_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

// Request the picker before generating the document: it requires a live click.
export async function saveStudentFile(filename, mime, createBlob) {
  let handle;
  if (typeof window.showSaveFilePicker === 'function') {
    try {
      handle = await window.showSaveFilePicker({
        suggestedName: filename,
        types: [{ description: mime === WORD_MIME ? 'Word document' : 'Text file', accept: { [mime]: [filename.endsWith('.docx') ? '.docx' : '.txt'] } }],
      });
    } catch (error) {
      if (error.name === 'AbortError') return 'cancelled';
      if (!['SecurityError', 'NotAllowedError', 'NotSupportedError'].includes(error.name)) throw error;
    }
  }
  const blob = await createBlob();
  if (handle) {
    const writable = await handle.createWritable();
    try {
      await writable.write(blob);
      await writable.close();
    } catch (error) {
      try { await writable.abort(); } catch { /* Preserve the original error. */ }
      throw error;
    }
    return 'saved';
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
  return 'downloaded';
}

export async function buildStudentWord(html, text) {
  const { Document, Paragraph, TextRun, Packer } = await import('docx');
  const root = new DOMParser().parseFromString(html || '', 'text/html').body;
  const paragraphs = [];
  let runs = [];
  const flush = (empty = false) => {
    if (runs.length || empty) paragraphs.push(new Paragraph({ children: runs }));
    runs = [];
  };
  function walk(node, style = {}) {
    if (node.nodeType === 3) {
      if (node.textContent) runs.push(new TextRun({ text: node.textContent, ...style }));
      return;
    }
    if (node.nodeType !== 1 || ['SCRIPT', 'STYLE'].includes(node.tagName)) return;
    if (node.tagName === 'BR') { runs.push(new TextRun({ break: 1 })); return; }
    const block = /^(P|DIV|H[1-6]|LI|BLOCKQUOTE)$/.test(node.tagName);
    if (block) flush();
    const next = { ...style };
    if (/^(B|STRONG|H[1-6])$/.test(node.tagName) || /bold|[6-9]00/.test(node.style.fontWeight)) next.bold = true;
    if (/^(I|EM)$/.test(node.tagName) || node.style.fontStyle === 'italic') next.italics = true;
    if (node.tagName === 'U' || node.style.textDecoration.includes('underline')) next.underline = {};
    if (/^(S|STRIKE|DEL)$/.test(node.tagName)) next.strike = true;
    if (node.tagName === 'MARK') next.highlight = 'yellow';
    if (node.tagName === 'LI') {
      const prefix = node.parentElement.tagName === 'OL' ? `${Array.from(node.parentElement.children).indexOf(node) + 1}. ` : '• ';
      runs.push(new TextRun(prefix));
    }
    for (const child of node.childNodes) walk(child, next);
    if (block) flush(true);
  }
  if (html?.trim()) { for (const child of root.childNodes) walk(child); flush(); }
  else for (const line of String(text || '').split('\n')) paragraphs.push(new Paragraph({ children: [new TextRun(line)] }));
  return Packer.toBlob(new Document({ sections: [{ children: paragraphs.length ? paragraphs : [new Paragraph('')] }] }));
}
