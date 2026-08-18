import { useMemo } from 'react';
import { richHtmlToPlainText, sanitizeRichHtml } from '../lib/richText.js';

export default function RichTextDisplay({ html, text = '', className = '' }) {
  const safeHtml = useMemo(() => sanitizeRichHtml(html), [html]);
  const richPlain = safeHtml ? richHtmlToPlainText(safeHtml) : '';
  const expectedPlain = String(text || '').replace(/\r\n?/g, '\n');
  const hasRichText = safeHtml && richPlain.trim() && richPlain === expectedPlain;

  if (!hasRichText) {
    return <div className={`whitespace-pre-wrap break-words ${className}`}>{text}</div>;
  }

  return (
    <div
      className={`break-words [&_div]:min-h-[1em] [&_p]:min-h-[1em] [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 [&_mark]:rounded-sm [&_mark]:bg-yellow-200 [&_mark]:px-0.5 [&_mark]:text-inherit ${className}`}
      dangerouslySetInnerHTML={{ __html: safeHtml }}
    />
  );
}
