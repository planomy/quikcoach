import { useEffect, useMemo, useRef, useState } from 'react';
import { richHtmlToPlainText, sanitizeRichHtml } from '../lib/richText.js';

/**
 * Keep plain drafts as one text container. Per-line block &lt;div&gt;s make Chromium
 * expand right-to-left selections to the start of the block (soft-wrap / block boundary).
 */
const BODY = 'iboard-rich-text whitespace-pre-wrap break-words';
const RICH_CLASS = `${BODY} [&_div]:min-h-[1em] [&_p]:min-h-[1em] [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 [&_mark]:rounded-sm [&_mark]:bg-yellow-200 [&_mark]:px-0.5 [&_mark]:text-inherit`;
// The server sends new plain text a moment before the matching formatting.
// Hold the last formatted view through that gap instead of flashing to plain text.
const STALE_RICH_GRACE_MS = 1000;

function PlainTextBlocks({ text = '', className = '' }) {
  const normalised = String(text || '').replace(/\r\n?/g, '\n');
  return (
    <div className={`${BODY} ${className}`}>
      {normalised || '\u00a0'}
    </div>
  );
}

export default function RichTextDisplay({ html, text = '', className = '' }) {
  const safeHtml = useMemo(() => sanitizeRichHtml(html), [html]);
  const richPlain = safeHtml ? richHtmlToPlainText(safeHtml) : '';
  const expectedPlain = String(text || '').replace(/\r\n?/g, '\n');
  const hasRichText = safeHtml && richPlain.trim() && richPlain === expectedPlain;
  const lastRichRef = useRef('');
  const waitingForRich = !hasRichText && !!safeHtml && !!lastRichRef.current;
  const [graceOver, setGraceOver] = useState(false);

  if (hasRichText) lastRichRef.current = safeHtml;

  useEffect(() => {
    setGraceOver(false);
    if (!waitingForRich) return undefined;
    const timer = window.setTimeout(() => setGraceOver(true), STALE_RICH_GRACE_MS);
    return () => window.clearTimeout(timer);
  }, [waitingForRich, safeHtml, expectedPlain]);

  if (!hasRichText && !(waitingForRich && !graceOver)) {
    if (!safeHtml) lastRichRef.current = '';
    return <PlainTextBlocks text={text} className={className} />;
  }

  return (
    <div
      className={`${RICH_CLASS} ${className}`}
      dangerouslySetInnerHTML={{ __html: hasRichText ? safeHtml : lastRichRef.current }}
    />
  );
}
