import React from 'react';

/**
 * Parses WhatsApp-style text markup and renders clean React nodes:
 * - *bold text* -> <strong>
 * - _italic text_ -> <em>
 * - ~strikethrough~ -> <del>
 * - ```code``` -> <code>
 * - Removes isolated unwanted asterisks and cleans raw formatting.
 */
export function renderFormattedText(text: string): React.ReactNode {
  if (!text) return null;

  // Split into lines to preserve newlines cleanly
  const lines = text.split('\n');

  return lines.map((line, lineIdx) => {
    // Process single line formatting
    const formattedLine = parseLineFormatting(line);
    return (
      <React.Fragment key={lineIdx}>
        {formattedLine}
        {lineIdx < lines.length - 1 && <br />}
      </React.Fragment>
    );
  });
}

function parseLineFormatting(line: string): React.ReactNode[] {
  // Regex to match *bold*, _italic_, ~strike~, `code`
  const regex = /(\*([^*]+)\*|_([^_]+)_|~([^~]+)~|`([^`]+)`)/g;
  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(line)) !== null) {
    // Push preceding plain text (clean any stray asterisks if left unclosed)
    if (match.index > lastIndex) {
      const plainText = line.substring(lastIndex, match.index);
      parts.push(cleanPlainText(plainText));
    }

    const fullMatch = match[0];
    // Colours are inherited from the surrounding bubble so the text stays legible
    // in every context (dark WhatsApp bubbles, light chat bubbles, both themes).
    if (fullMatch.startsWith('*') && fullMatch.endsWith('*')) {
      parts.push(
        <strong key={`b-${match.index}`} className="font-bold">
          {match[2]}
        </strong>
      );
    } else if (fullMatch.startsWith('_') && fullMatch.endsWith('_')) {
      parts.push(
        <em key={`i-${match.index}`} className="italic opacity-90">
          {match[3]}
        </em>
      );
    } else if (fullMatch.startsWith('~') && fullMatch.endsWith('~')) {
      parts.push(
        <del key={`s-${match.index}`} className="line-through opacity-70">
          {match[4]}
        </del>
      );
    } else if (fullMatch.startsWith('`') && fullMatch.endsWith('`')) {
      parts.push(
        <code key={`c-${match.index}`} className="px-1.5 py-0.5 rounded bg-black/10 dark:bg-white/15 font-mono text-[0.9em]">
          {match[5]}
        </code>
      );
    }

    lastIndex = regex.lastIndex;
  }

  // Push remaining plain text
  if (lastIndex < line.length) {
    parts.push(cleanPlainText(line.substring(lastIndex)));
  }

  return parts;
}

/** Helper to clean dangling single asterisks */
function cleanPlainText(str: string): string {
  // Replace lone dangling asterisks that were not part of formatting
  return str.replace(/\B\*\b|\b\*\B/g, '');
}

/** Strips all markdown asterisks and returns clean plain text string */
export function stripAsterisks(text?: string | null): string {
  if (!text) return '';
  return text.replace(/\*/g, '').replace(/_/g, '').trim();
}
