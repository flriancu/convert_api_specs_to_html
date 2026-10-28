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
 * just before a heading becomes its section's id, and a heading without one gets an id made of
 * its parent's and its own text. Each field of a parameter or schema list gets an id from its
 * part and its name the same way, so every part and field can be linked to, by the "#" after
 * it, and the link stays when other parts are added. A response's part says by its class
 * whether the status is a success or an error.
 *
 * An operation's method (or an AsyncAPI operation's action) shows as a badge, examples fold
 * behind a "summary" until asked for, and each tag lists its operations. The page's contents
 * (contents.mjs) come first, in place of the converters' list, then its title and introduction.
 */
import { Marked } from 'marked';

import { contentsHtml, operationListHtml } from './contents.mjs';
import { endpointBadge, escapeHtml } from './html.mjs';

export { escapeHtml };

// Markdown passes "<a id="x"></a>" on in pieces (inline HTML), so each tag is allowed on its
// own: an opening tag with only an id, and a closing tag. Neither can carry a link or a script.
const ANCHOR_OPEN = /^\s*<a id="([A-Za-z0-9_.:-]+)">\s*$/;
const ANCHOR_CLOSE = /^\s*<\/a>\s*$/;
const SAFE_URL = /^(https?:\/\/|mailto:|#)/i;

// The converters' list items for an operation's method, path and tags, and an AsyncAPI action.
const METHOD_ITEM = /^\*\*Method:\*\*\s+`([A-Z]+)`$/;
const PATH_ITEM = /^\*\*Path:\*\*\s+`([^`]+)`$/;
const TAGS_ITEM = /^\*\*Tags:\*\*\s+(.+)$/;
const ACTION_ITEM = /^\*\*action:\*\*\s+`(send|receive)`$/;
// A converter's fact: a bold label with its colon, then the value, on one line ("**name:** `events.reset`").
const FACT_ITEM = /^\*\*[^*`\n]+:\*\*[ \u00a0]+[^\n]+$/;
// The converters' labels before an example's code block: "Example:", "Generated example:",
// "payload:", "Generated payload example:", and a named one, "Example: version".
const EXAMPLE_LABEL = /^([A-Za-z ]*example|payload)(?::\s*(\S.*?))?:?$/i;
// A heading's id part: at most this many words; a response heading starts with its status code.
const SLUG_WORDS = 6;
const STATUS_HEADING = /^([1-5])([0-9X]{2})(\s|$)|^default(\s|$)/i;
// The converters' own parts: their contents list, which the page replaces, and the tags.
const CONTENTS_HEADING = 'Contents';
const TAGS_HEADING = 'Tags';

function selfMark(id) {
  return `<a class="self-mark" href="#${id}" aria-label="Link to this part">#</a>`;
}

/** The facts the list under an operation's heading gives: method and path, action, tags. */
function endpointOf(list) {
  const facts = { method: null, path: null, action: null, tags: [] };
  for (const item of list?.type === 'list' ? list.items : []) {
    const text = item.text.trim();
    facts.method = METHOD_ITEM.exec(text)?.[1] ?? facts.method;
    facts.path = PATH_ITEM.exec(text)?.[1] ?? facts.path;
    facts.action = ACTION_ITEM.exec(text)?.[1] ?? facts.action;
    facts.tags = TAGS_ITEM.test(text) ? TAGS_ITEM.exec(text)[1].split(',').map((t) => t.trim()) : facts.tags;
  }
  return facts;
}

/**
 * A Marked instance for one page; context.operations lists its operations for the tag lists,
 * and context.inline renders a heading's text.
 */
const makeMarked = (context) => new Marked({
  gfm: true,
  renderer: {
    heading({ tokens, depth, sectionId }) {
      const text = this.parser.parseInline(tokens);
      return `<h${depth}>${sectionId ? `${text} ${selfMark(sectionId)}` : text}</h${depth}>\n`;
    },
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
    listitem(item) {
      return `<li${item.fieldId ? ` id="${item.fieldId}"` : ''}>${this.parser.parse(item.tokens)}</li>\n`;
    },
    // A list of the converters' facts (an operation's id and tags, a message's name and content
    // type) is marked as such, wherever it is, so the stylesheet sets it as one line; an
    // operation's method and path, or an AsyncAPI action, become its first item, as a badge.
    // Any other list is rendered as marked renders it.
    list(token) {
      const endpointFacts = [METHOD_ITEM, PATH_ITEM, ACTION_ITEM];
      const endpoint = token.ordered ? null : endpointBadge(endpointOf(token));
      const isFacts = !token.ordered && token.items.every((item) => item.tokens.length === 1 && FACT_ITEM.test(item.text.trim()));
      let html = false;
      if (endpoint !== null) {
        const rest = token.items.filter((item) => !endpointFacts.some((fact) => fact.test(item.text.trim())));
        html = `<ul class="facts">\n<li class="endpoint">${endpoint}</li>\n${rest.map((item) => this.listitem(item)).join('')}</ul>\n`;
      } else if (isFacts) {
        html = `<ul class="facts">\n${token.items.map((item) => this.listitem(item)).join('')}</ul>\n`;
      }
      return html;
    },
  },
  extensions: [
    {
      name: 'sectionOpen',
      renderer: ({ depth, id, status }) => `<section class="s${depth}${status ? ` response-${status}` : ''}"${id ? ` id="${id}"` : ''}>\n`,
    },
    { name: 'sectionClose', renderer: () => '</section>\n' },
    { name: 'selfMark', renderer: ({ id }) => ` ${selfMark(id)}` },
    {
      name: 'example',
      renderer({ label, blocks }) {
        return `<details class="example">\n<summary>${escapeHtml(label)}</summary>\n${this.parser.parse(blocks)}</details>\n`;
      },
    },
    {
      name: 'tagOperations',
      renderer: ({ tag }) => operationListHtml(context.operations.filter((op) => op.tags.includes(tag)), context.inline),
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
  const bold = token?.type === 'paragraph' && token.tokens.length === 1 && token.tokens[0].type === 'strong';
  const match = bold ? EXAMPLE_LABEL.exec(token.tokens[0].text.trim()) : null;
  let label = null;
  if (match && match[2]) {
    label = `${match[1]}: ${match[2]}`;
  } else if (match) {
    label = match[1].toLowerCase() === 'payload' ? 'Example payload' : match[1];
  }
  return label;
}

/** Markdown text as a summary's plain text: no code or bold marks. */
function plain(text) {
  return text.trim().replace(/`|\*\*/g, '');
}

/**
 * Whether the block belongs to the converters' contents list: a list of links within the page,
 * a bold group label ("**Operations**"), or the blank lines between them. The AsyncAPI converter
 * writes the description's introduction after its list, under the same heading, so the list
 * ends at the first other block.
 */
function inContentsList(token) {
  const linksOnly = token.type === 'list'
    && token.items.every((item) => item.tokens.length === 1 && item.tokens[0].tokens?.length === 1
      && item.tokens[0].tokens[0].type === 'link' && item.tokens[0].tokens[0].href.startsWith('#'));
  const label = token.type === 'paragraph' && token.tokens.length === 1 && token.tokens[0].type === 'strong';
  return token.type === 'space' || linksOnly || label;
}

/** The index of the next block after index i, past the blank lines marked keeps as space tokens. */
function nextBlock(tokens, i) {
  let j = i + 1;
  while (tokens[j]?.type === 'space') j += 1;
  return j;
}

/** The labelled code blocks from index i on: [label paragraph, code] pairs, and the index past them. */
function labelledCode(tokens, i) {
  const pairs = [];
  let at = i;
  while (exampleLabel(tokens[at]) !== null && tokens[nextBlock(tokens, at)]?.type === 'code') {
    pairs.push([tokens[at], tokens[nextBlock(tokens, at)]]);
    at = nextBlock(tokens, nextBlock(tokens, at));
  }
  return { pairs, end: at };
}

/**
 * The tokens with each example folded: a label, then its code, with the description a named
 * example carries between them, which becomes its summary; a heading that names an example
 * (an AsyncAPI message's), then its labelled code; inside list items too, where schemas list
 * their properties.
 */
export function foldExamples(tokens) {
  const out = [];
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];
    const label = exampleLabel(token);
    const next = nextBlock(tokens, i);
    const after = nextBlock(tokens, next);
    const described = tokens[next]?.type === 'paragraph' && exampleLabel(tokens[next]) === null && anchorOnly(tokens[next]) === null;
    const named = token.type === 'heading' && token.depth >= 3 ? labelledCode(tokens, next) : { pairs: [] };
    if (label && tokens[next]?.type === 'code') {
      out.push({ type: 'example', label, blocks: [tokens[next]] });
      i = next;
    } else if (label && described && tokens[after]?.type === 'code') {
      out.push({ type: 'example', label: `${label.replace(/:.*$/, '')}: ${plain(tokens[next].text)}`, blocks: [tokens[after]] });
      i = after;
    } else if (named.pairs.length > 0) {
      const blocks = named.pairs.length === 1 ? [named.pairs[0][1]] : named.pairs.flat();
      out.push({ type: 'example', label: `Example: ${token.text.trim()}`, blocks });
      i = named.end - 1;
    } else if (token.type === 'list') {
      out.push({ ...token, items: token.items.map((item) => ({ ...item, tokens: foldExamples(item.tokens) })) });
    } else {
      out.push(token);
    }
  }
  return out;
}

/** Text as an id part: its first words, lower case, joined by hyphens. */
function words(text) {
  const plain = text.replace(/<[^>]*>/g, '').replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/[`*_]/g, '');
  return plain.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w !== '').slice(0, SLUG_WORDS).join('-') || 'part';
}

/** A heading's id part; a response's status code alone ("200 The take." is "200"), so editing its description keeps the id. */
function slug(text) {
  const status = STATUS_HEADING.exec(text.trim());
  return status ? text.trim().split(/\s/)[0].toLowerCase() : words(text);
}

/** "success" for a 2xx heading, "error" for 4xx and 5xx, "other" for 1xx and 3xx; null for any other heading. */
function statusOf(heading) {
  const status = heading.depth >= 4 ? STATUS_HEADING.exec(heading.text.trim()) : null;
  const kinds = { 1: 'other', 2: 'success', 3: 'other', 4: 'error', 5: 'error' };
  return status?.[1] ? kinds[status[1]] : null;
}

/** The field a list item describes: the code in the bold text it starts with ("**`name` (required)**"). */
function fieldName(item) {
  const first = item.tokens[0];
  const strong = (first?.type === 'text' || first?.type === 'paragraph') ? first.tokens?.[0] : null;
  const code = strong?.type === 'strong' ? strong.tokens?.[0] : null;
  return code?.type === 'codespan' ? code.text : null;
}

/** The list with an id and a "#" on each field, made of the part's id and the field's name; nested fields too. */
function nameFields(list, base, unique) {
  const items = list.items.map((item) => {
    const name = fieldName(item);
    if (name === null) return item;
    const fieldId = unique(`${base}--${words(name)}`);
    const [first, ...rest] = item.tokens;
    const marked = { ...first, tokens: [...first.tokens, { type: 'selfMark', id: fieldId }] };
    const tokens = [marked, ...rest].map((t) => (t.type === 'list' ? nameFields(t, fieldId, unique) : t));
    return { ...item, fieldId, tokens };
  });
  return { ...list, items };
}

/**
 * The page's blocks, with examples folded, sections around every heading from level 2 down and
 * ids on fields, without the converters' contents list; and its outline, one entry per
 * section: depth, id, heading text and, for an operation, its method, path, action and tags.
 */
export function structure(tokens) {
  const folded = foldExamples(tokens);
  const blocks = [];
  const outline = [];
  const open = [];
  const used = new Set(folded.map(anchorOnly).filter((id) => id !== null));
  let skipping = false;
  const unique = (base) => {
    let id = base;
    for (let n = 2; used.has(id); n += 1) id = `${base}-${n}`;
    used.add(id);
    return id;
  };
  const closeTo = (depth) => {
    while (open.length > 0 && open.at(-1).depth >= depth) {
      const closing = open.pop();
      if (closing.tag) blocks.push({ type: 'tagOperations', tag: closing.tag });
      blocks.push({ type: 'sectionClose' });
    }
  };
  const openSection = (heading, anchor, following) => {
    closeTo(heading.depth);
    const parent = open.findLast((o) => o.id !== null)?.id;
    const id = anchor ?? unique(parent ? `${parent}--${slug(heading.text)}` : slug(heading.text));
    const inTags = open.some((o) => o.depth === 2 && o.text === TAGS_HEADING);
    const tag = inTags && heading.depth === 3 ? heading.text.trim() : null;
    blocks.push({ type: 'sectionOpen', depth: heading.depth, id, status: statusOf(heading) }, { ...heading, sectionId: id });
    open.push({ depth: heading.depth, id, text: heading.text.trim(), tag });
    outline.push({ depth: heading.depth, id, text: heading.text.trim(), ...endpointOf(following) });
  };
  for (let i = 0; i < folded.length; i += 1) {
    const token = folded[i];
    const j = nextBlock(folded, i);
    const anchor = anchorOnly(token);
    const heading = anchor && folded[j]?.type === 'heading' ? folded[j] : token;
    const isPart = heading.type === 'heading' && heading.depth >= 2;
    if (isPart && heading.depth === 2) {
      skipping = heading.text.trim() === CONTENTS_HEADING;
    } else if (skipping && !inContentsList(token)) {
      skipping = false;
    }
    if (skipping) {
      i = heading === token ? i : j;
    } else if (isPart) {
      const at = heading === token ? i : j;
      openSection(heading, heading === token ? null : anchor, folded[nextBlock(folded, at)]);
      i = at;
    } else if (token.type === 'list' && open.length > 0) {
      blocks.push(nameFields(token, open.at(-1).id, unique));
    } else {
      blocks.push(token);
    }
  }
  closeTo(1);
  return { blocks, outline };
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
  const context = { operations: [], inline: null };
  const markdown = makeMarked(context);
  context.inline = (text) => markdown.parseInline(text);
  const tokens = markdown.lexer(source);
  const { blocks, outline } = structure(tokens);
  context.operations = outline.filter((entry) => endpointBadge(entry) !== null);
  const firstPart = blocks.findIndex((t) => t.type === 'sectionOpen');
  const intro = firstPart === -1 ? blocks : blocks.slice(0, firstPart);
  const parts = firstPart === -1 ? [] : blocks.slice(firstPart);
  intro.links = tokens.links;
  parts.links = tokens.links;
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
    contentsHtml(outline, context.inline),
    '<header>',
    markdown.parser(intro),
    '</header>',
    '<main>',
    markdown.parser(parts),
    '</main>',
    '</body>',
    '</html>',
    '',
  ].join('\n');
}
