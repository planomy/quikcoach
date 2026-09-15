import { useMemo } from 'react';
import { richHtmlToPlainText, sanitizeRichHtml } from '../lib/richText.js';

/**
 * Keep plain drafts as one text container. Per-line block &lt;div&gt;s make Chromium
 * expand right-to-left selections to the start of the block (soft-wrap / block boundary).
 */
function PlainTextBlocks({ text = '', className = '' }) {
  const normalised = String(text || '').replace(/\r\n?/g, '\n');
  return (
    <div className={`whitespace-pre-wrap break-words ${className}`}>
      {normalised || '\u00a0'}
    </div>
  );
}

export default function RichTextDisplay({ html, text = '', className = '' }) {
  const safeHtml = useMemo(() => sanitizeRichHtml(html), [html]);
  const richPlain = safeHtml ? richHtmlToPlainText(safeHtml) : '';
  const expectedPlain = String(text || '').replace(/\r\n?/g, '\n');
  const hasRichText = safeHtml && richPlain.trim() && richPlain === expectedPlain;

  if (!hasRichText) {
    return <PlainTextBlocks text={text} className={className} />;
  }

  return (
    <div
      className={`whitespace-pre-wrap break-words leading-relaxed [&_div]:min-h-[1em] [&_div+div]:mt-2 [&_p]:min-h-[1em] [&_p+p]:mt-2 [&_li+li]:mt-1 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 [&_mark]:rounded-sm [&_mark]:bg-yellow-200 [&_mark]:px-0.5 [&_mark]:text-inherit ${className}`}
      dangerouslySetInnerHTML={{ __html: safeHtml }}
    />
  );
}
