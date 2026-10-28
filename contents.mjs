/**
 * The page's contents, built from its outline (page.mjs): each level-2 part with the parts one
 * level down. Operations are grouped under their first tag, each group led by a link to the
 * tag's part, and the converters' "Tags" part is then left out, its tags being the groups. A
 * part with more than FOLD_OVER entries keeps its name as a link and folds its entries under
 * it, behind their count, so the list stays short enough to scan; the stylesheet shows it as a
 * column beside the page on a wide screen and folds the whole list behind "Contents" on a
 * narrow one.
 */
import { endpointBadge, escapeHtml } from './html.mjs';

const FOLD_OVER = 12;
const TAGS_HEADING = 'Tags';

/** A heading's text without its links, so the entry can be one link. */
function unlinked(text) {
  return text.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1');
}

function entryHtml(entry, inline, children = '') {
  const action = endpointBadge(entry, { withPath: false });
  return `<li><a href="#${entry.id}">${action ? `${action} ` : ''}${inline(unlinked(entry.text))}</a>${children}</li>`;
}

function listHtml(items) {
  return items.length > 0 ? `\n<ul>\n${items.join('\n')}\n</ul>\n` : '';
}

/** The outline as level-2 parts, each with the entries one level down. */
function partsOf(outline) {
  const parts = [];
  for (const entry of outline) {
    if (entry.depth === 2) {
      parts.push({ entry, children: [] });
    } else if (entry.depth === 3 && parts.length > 0) {
      parts.at(-1).children.push(entry);
    }
  }
  return parts;
}

/** A part's operations grouped by their first tag, in the order the tags part declares them. */
function byTag(children, tagEntries, inline) {
  const tags = [...new Set([...tagEntries.map((t) => t.text), ...children.flatMap((c) => c.tags.slice(0, 1))])];
  const groups = tags.flatMap((tag) => {
    const members = children.filter((c) => c.tags[0] === tag);
    const target = tagEntries.find((t) => t.text === tag);
    const label = target ? `<a href="#${target.id}">${escapeHtml(tag)}</a>` : escapeHtml(tag);
    return members.length > 0 ? [`<li class="group">${label}${listHtml(members.map((m) => entryHtml(m, inline)))}</li>`] : [];
  });
  return [...groups, ...children.filter((c) => c.tags.length === 0).map((c) => entryHtml(c, inline))];
}

export function contentsHtml(outline, inline) {
  const parts = partsOf(outline);
  const tagsPart = parts.find((p) => p.entry.text === TAGS_HEADING);
  const tagged = tagsPart !== undefined && outline.some((e) => e.tags.length > 0);
  const items = parts
    .filter((part) => !(tagged && part === tagsPart))
    .map((part) => {
      const grouped = tagged && part.children.some((c) => c.tags.length > 0);
      const children = grouped ? byTag(part.children, tagsPart.children, inline) : part.children.map((c) => entryHtml(c, inline));
      const folded = `\n<details>\n<summary>${children.length} entries</summary>${listHtml(children)}</details>\n`;
      return entryHtml(part.entry, inline, children.length > FOLD_OVER ? folded : listHtml(children));
    });
  return items.length > 0
    ? `<nav class="contents" aria-label="Contents">\n<details>\n<summary>Contents</summary>${listHtml(items)}</details>\n</nav>`
    : '';
}

/** A tag's operations, each a link with its badge, path and heading. */
export function operationListHtml(operations, inline) {
  const items = operations.map((op) => `<li><a href="#${op.id}">${endpointBadge(op)} ${inline(unlinked(op.text))}</a></li>`);
  return items.length > 0 ? `<ul class="operations">\n${items.join('\n')}\n</ul>\n` : '';
}
