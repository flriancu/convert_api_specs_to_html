/**
 * Checks that a page keeps its promises: nothing that a strict
 * Content-Security-Policy blocks or that runs, the stylesheet linked, every operation,
 * channel, message and schema of the specification shown, and each operation's badge (which
 * page.mjs makes from the converters' Markdown, so a converter that writes it differently
 * fails here rather than losing the badges quietly).
 */

const FORBIDDEN = [
  [/<script\b/i, 'contains a <script> element'],
  [/<(iframe|object|embed|form|base)\b/i, 'contains an <iframe>, <object>, <embed>, <form> or <base> element'],
  [/<meta\s[^>]*http-equiv/i, 'contains a <meta http-equiv> element'],
  [/<style\b/i, 'contains a <style> element'],
  [/\sstyle\s*=/i, 'contains a style attribute'],
  [/\son[a-z]+\s*=/i, 'contains an event-handler attribute'],
  [/\s(src|href)\s*=\s*"\s*(data|javascript|vbscript):/i, 'contains a data:, javascript: or vbscript: URL'],
  [/\ssrc\s*=/i, 'loads a resource (src attribute)'],
];

/** The page's visible text: tags removed, the five escapes decoded. */
function textOf(html) {
  return html
    .replace(/<[^>]*>/g, ' ')
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'")
    .replaceAll('&amp;', '&');
}

/** Whether the text shows the name as a whole token, not as part of a longer word. */
function shows(text, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^A-Za-z0-9_])${escaped}($|[^A-Za-z0-9_])`).test(text);
}

/** Problems with a page, as sentences; empty when it has every property. */
export function checkPage(html, { cssHref, names, operations }) {
  const problems = FORBIDDEN.filter(([pattern]) => pattern.test(html)).map(([, problem]) => problem);
  if (!html.includes(`<link rel="stylesheet" href="${cssHref}">`)) {
    problems.push(`does not link its stylesheet ${cssHref}`);
  }
  const text = textOf(html);
  const missing = names.filter((name) => !shows(text, name));
  if (missing.length > 0) {
    problems.push(`does not show ${missing.length} of ${names.length} names from the specification: ${missing.slice(0, 10).join(', ')}`);
  }
  const badges = (html.match(/<span class="method method-[a-z]+">/g) ?? []).length;
  if (operations !== undefined && badges !== operations) {
    problems.push(`shows ${badges} operation badges for the specification's ${operations} operations`);
  }
  return problems;
}
