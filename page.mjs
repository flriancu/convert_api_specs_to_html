/**
 * Markdown as an HTML page that a strict Content-Security-Policy can serve: no
 * scripts, no inline styles, no data: URLs, styles from one stylesheet next to the page.
 *
 * The Markdown comes from the converters, but its descriptions come from whoever wrote the
 * specification, so raw HTML in it is shown as text. The one exception is the converters' own
 * anchors (<a id="..."></a>), which the page's links point to.
 */
import { Marked } from 'marked';

// Markdown passes "<a id="x"></a>" on in pieces (inline HTML), so each tag is allowed on its
// own: an opening tag with only an id, and a closing tag. Neither can carry a link or a script.
const ANCHOR_OPEN = /^\s*<a id="([A-Za-z0-9_.:-]+)">\s*$/;
const ANCHOR_CLOSE = /^\s*<\/a>\s*$/;
const SAFE_URL = /^(https?:\/\/|mailto:|#)/i;

export function escapeHtml(text) {
  return String(text)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

const markdown = new Marked({
  gfm: true,
  renderer: {
    html({ text }) {
      const open = ANCHOR_OPEN.exec(text);
      let html = escapeHtml(text);
      if (open) {
        html = `<a id="${open[1]}">`;
      } else if (ANCHOR_CLOSE.test(text)) {
        html = '</a>';
      }
      return html;
    },
    link({ href, title, tokens }) {
      const text = this.parser.parseInline(tokens);
      const titled = title ? ` title="${escapeHtml(title)}"` : '';
      return SAFE_URL.test(href) ? `<a href="${escapeHtml(href)}"${titled}>${text}</a>` : text;
    },
    image({ href, text }) {
      // Images would need another host or a data: URL; the page links to them instead.
      return SAFE_URL.test(href) ? `<a href="${escapeHtml(href)}">${escapeHtml(text || href)}</a>` : escapeHtml(text);
    },
  },
});

/** The first level-1 heading's text, used as the page title. */
function titleOf(source) {
  const heading = /^#\s+(.+)$/m.exec(source);
  return heading ? heading[1].trim() : 'API reference';
}

/** A complete HTML page for the Markdown, linking the stylesheet at cssHref. */
export function renderPage(source, { cssHref }) {
  const body = markdown.parse(source);
  return [
    '<!DOCTYPE html>',
    '<html lang="en">',
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${escapeHtml(titleOf(source))}</title>`,
    `<link rel="stylesheet" href="${escapeHtml(cssHref)}">`,
    '</head>',
    '<body>',
    '<main>',
    body,
    '</main>',
    '</body>',
    '</html>',
    '',
  ].join('\n');
}
