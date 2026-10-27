/**
 * Markdown as an HTML page that a strict Content-Security-Policy can serve: no
 * scripts, no inline styles, no data: URLs, styles from one stylesheet next to the page.
 *
 * The Markdown comes from the converters, but its descriptions come from whoever wrote the
 * specification, so raw HTML in it is shown as text. The one exception is the converters' own
 * anchors (<a id="..."></a>), which the page's links point to.
 *
 * So a reader sees where each part starts and ends, every heading from level 2 down opens a
 * <section class="sN"> that closes before the next heading of its level or above; the anchor
 * just before a heading becomes its section's id. An operation's method (or an AsyncAPI
 * operation's action) shows as a badge, and examples fold behind a "summary" until asked for.
 */
import { Marked } from 'marked';

// Markdown passes "<a id="x"></a>" on in pieces (inline HTML), so each tag is allowed on its
// own: an opening tag with only an id, and a closing tag. Neither can carry a link or a script.
const ANCHOR_OPEN = /^\s*<a id="([A-Za-z0-9_.:-]+)">\s*$/;
const ANCHOR_CLOSE = /^\s*<\/a>\s*$/;
const SAFE_URL = /^(https?:\/\/|mailto:|#)/i;

// The converters' list items for an operation's method and path, and an AsyncAPI action.
const METHOD_ITEM = /^\*\*Method:\*\*\s+`([A-Z]+)`$/;
const PATH_ITEM = /^\*\*Path:\*\*\s+`([^`]+)`$/;
const ACTION_ITEM = /^\*\*action:\*\*\s+`(send|receive)`$/;
// The converters' labels before an example's code block: "Example:", "Generated example:",
// "payload:", "Generated payload example:".
const EXAMPLE_LABEL = /^(?:[A-Za-z ]*example|payload):$/i;

export function escapeHtml(text) {
  return String(text)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function badge(kind, label) {
  return `<span class="method method-${kind}">${escapeHtml(label)}</span>`;
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
    // An operation's method and path, or an AsyncAPI action, become the list's first item,
    // as a badge; any other list is rendered as marked renders it.
    list(token) {
      const method = token.items.find((item) => METHOD_ITEM.test(item.text.trim()));
      const path = token.items.find((item) => PATH_ITEM.test(item.text.trim()));
      const action = token.items.find((item) => ACTION_ITEM.test(item.text.trim()));
      let endpoint = null;
      if (method && path) {
        const verb = METHOD_ITEM.exec(method.text.trim())[1];
        endpoint = `${badge(verb.toLowerCase(), verb)} <code>${escapeHtml(PATH_ITEM.exec(path.text.trim())[1])}</code>`;
      } else if (action) {
        const direction = ACTION_ITEM.exec(action.text.trim())[1];
        endpoint = badge(direction, direction.toUpperCase());
      }
      if (endpoint === null || token.ordered) {
        return false;
      }
      const rest = token.items.filter((item) => item !== method && item !== path && item !== action);
      return `<ul>\n<li class="endpoint">${endpoint}</li>\n${rest.map((item) => this.listitem(item)).join('')}</ul>\n`;
    },
  },
  extensions: [
    { name: 'sectionOpen', renderer: ({ depth, id }) => `<section class="s${depth}"${id ? ` id="${id}"` : ''}>\n` },
    { name: 'sectionClose', renderer: () => '</section>\n' },
    {
      name: 'example',
      renderer({ label, code }) {
        return `<details class="example">\n<summary>${escapeHtml(label)}</summary>\n${this.parser.parse([code])}</details>\n`;
      },
    },
  ],
});

/** The id of a paragraph that holds nothing but a converter's anchor; null otherwise. */
function anchorOnly(token) {
  if (token?.type !== 'paragraph') return null;
  const parts = token.tokens.filter((t) => !(t.type === 'text' && t.text.trim() === ''));
  const open = parts.length === 2 && parts[0].type === 'html' && ANCHOR_OPEN.exec(parts[0].text);
  return open && parts[1].type === 'html' && ANCHOR_CLOSE.test(parts[1].text) ? open[1] : null;
}

/**
 * The summary for a paragraph that is only a bold example label, without its colon ("payload"
 * alone says "Example payload"); null for any other paragraph.
 */
function exampleLabel(token) {
  if (token?.type !== 'paragraph' || token.tokens.length !== 1 || token.tokens[0].type !== 'strong') return null;
  const text = token.tokens[0].text.trim();
  if (!EXAMPLE_LABEL.test(text)) return null;
  const label = text.slice(0, -1);
  return label.toLowerCase() === 'payload' ? 'Example payload' : label;
}

/**
 * The tokens with sections around every heading from level 2 down, the anchor before a heading
 * moved onto its section, and each example's label and code folded together.
 */
export function structure(tokens) {
  const out = [];
  const open = [];
  const closeTo = (depth) => {
    while (open.length > 0 && open.at(-1) >= depth) {
      open.pop();
      out.push({ type: 'sectionClose' });
    }
  };
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];
    // The next block, past the blank lines marked keeps as space tokens.
    let j = i + 1;
    while (tokens[j]?.type === 'space') j += 1;
    const next = tokens[j];
    const id = anchorOnly(token);
    const label = exampleLabel(token);
    if (id && next?.type === 'heading' && next.depth >= 2) {
      closeTo(next.depth);
      out.push({ type: 'sectionOpen', depth: next.depth, id }, next);
      open.push(next.depth);
      i = j;
    } else if (token.type === 'heading' && token.depth >= 2) {
      closeTo(token.depth);
      out.push({ type: 'sectionOpen', depth: token.depth, id: null }, token);
      open.push(token.depth);
    } else if (label && next?.type === 'code') {
      out.push({ type: 'example', label, code: next });
      i = j;
    } else {
      out.push(token);
    }
  }
  closeTo(1);
  return out;
}

/** The first level-1 heading's text, used as the page title. */
function titleOf(source) {
  const heading = /^#\s+(.+)$/m.exec(source);
  return heading ? heading[1].trim() : 'API reference';
}

/**
 * A complete HTML page for the Markdown, linking the stylesheet at cssHref. kind ('openapi' or
 * 'asyncapi') becomes the body's class: the stylesheet tells their heading levels apart.
 */
export function renderPage(source, { cssHref, kind }) {
  const tokens = markdown.lexer(source);
  const structured = structure(tokens);
  structured.links = tokens.links;
  const body = markdown.parser(structured);
  return [
    '<!DOCTYPE html>',
    '<html lang="en">',
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${escapeHtml(titleOf(source))}</title>`,
    `<link rel="stylesheet" href="${escapeHtml(cssHref)}">`,
    '</head>',
    kind ? `<body class="${escapeHtml(kind)}">` : '<body>',
    '<main>',
    body,
    '</main>',
    '</body>',
    '</html>',
    '',
  ].join('\n');
}
