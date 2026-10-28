/**
 * Scalar's Markdown, adjusted where the converters' choices read poorly on a page. Each rule
 * works on the Markdown as text, so check_page.mjs and the tests catch a converter that writes
 * it differently.
 *
 * OpenAPI:
 * - a field whose type is a named primitive schema (written as a link to it, inlinePrimitives
 *   off) shows that schema's type and constraints before the link, and the schema's description
 *   is dropped when the field has a description of its own: the link leads to it;
 * - lines saying an operation uses the document's servers and authentication are dropped;
 *   those are documented once, at the top;
 * - a request body's "Required" line joins its content type: "(required)" or "(optional)".
 *
 * AsyncAPI: the messages and schemas, which the converter writes as level-2 parts one after
 * another, are grouped under "Messages" and "Schemas", one level down.
 */

// The converters put a no-break space after a label's colon ("**Type:** `string`").
const SCHEMA_ANCHOR = /^<a id="(scalar-schema-[^"]+)"><\/a>$/;
const TYPE_LINE = /^\*\*Type:\*\*[  ]+(`(?:string|integer|number|boolean|null)`.*)$/;
// A paragraph line, not a list, a code fence, a label or the next part's anchor or heading.
const PROSE_LINE = /^(?!<a id=|\*\*|- |```|#)\S/;
const FIELD_TITLE = /^(\s*)- \*\*`/;
const SCHEMA_LINK = /\[([^\]]+)\]\(#(scalar-schema-[^)]+)\)/g;

const INHERITED = [
  /^\*\*Servers:\*\*[  ]+\[Inherited servers\]\(#scalar-context-global-servers\)\n\n/gm,
  /^\*\*Authentication:\*\*[  ]+\[Global authentication\]\(#scalar-context-global-authentication\)\n\n/gm,
];
const REQUIRED_BODY = /^\*\*Required:\*\*[  ]+`(true|false)`\n\n(\*\*Content type:\*\*[  ]+`[^`\n]*`)$/gm;

/**
 * The named schemas whose type is a primitive, by anchor: their summary ("`string`, pattern:
 * ...") and the first paragraph of their description.
 */
function primitiveSchemas(lines) {
  const schemas = new Map();
  lines.forEach((line, i) => {
    const anchor = SCHEMA_ANCHOR.exec(line);
    const type = anchor && lines[i + 2]?.startsWith('### ') ? TYPE_LINE.exec(lines[i + 4] ?? '') : null;
    if (type) {
      const description = PROSE_LINE.test(lines[i + 6] ?? '') ? lines[i + 6] : null;
      schemas.set(anchor[1], { summary: type[1], description });
    }
  });
  return schemas;
}

/** The index past a list item's lines: its title at index start, then lines indented deeper. */
function itemEnd(lines, start, indent) {
  let end = start + 1;
  while (end < lines.length && (lines[end] === '' || lines[end].startsWith(' '.repeat(indent)))) end += 1;
  while (end > start + 1 && lines[end - 1] === '') end -= 1;
  return end;
}

/** OpenAPI: named primitive types written out before their links, their descriptions said once. */
function writeOutPrimitives(markdown) {
  const lines = markdown.split('\n');
  const schemas = primitiveSchemas(lines);
  const out = [];
  for (let i = 0; i < lines.length; i += 1) {
    const title = FIELD_TITLE.exec(lines[i]);
    if (title) {
      const linked = [];
      out.push(lines[i].replace(SCHEMA_LINK, (link, name, id) => {
        const schema = schemas.get(id);
        if (schema) linked.push(schema);
        return schema ? `${schema.summary} (${link})` : link;
      }));
      const indent = title[1].length + 2;
      const end = itemEnd(lines, i, indent);
      const body = lines.slice(i + 1, end);
      const own = body.filter((line) => line.startsWith(' '.repeat(indent)) && PROSE_LINE.test(line.slice(indent)));
      const repeated = new Set(linked.map((s) => s.description).filter((d) => d !== null && own.length > 1));
      for (let j = 0; j < body.length; j += 1) {
        const dropped = repeated.has(body[j].slice(indent)) && body[j].startsWith(' '.repeat(indent));
        if (dropped && out.at(-1) === '') out.pop();
        if (!dropped) out.push(body[j]);
      }
      i = end - 1;
    } else {
      out.push(lines[i]);
    }
  }
  return out.join('\n');
}

export function tidyOpenApi(markdown) {
  let tidied = writeOutPrimitives(markdown);
  for (const pattern of INHERITED) {
    tidied = tidied.replace(pattern, '');
  }
  return tidied.replace(REQUIRED_BODY, (line, required, contentType) => `${contentType} (${required === 'true' ? 'required' : 'optional'})`);
}

/**
 * AsyncAPI: the level-2 parts after the last channel, up to the first schema, are messages; they
 * and the schemas ("Schema: Name") move one level down under "Messages" and "Schemas".
 */
export function tidyAsyncApi(markdown, channelNames) {
  const lines = markdown.split('\n');
  const parts = lines.flatMap((line, i) => (/^## /.test(line) ? [{ i, text: line.slice(3) }] : []));
  const lastChannel = parts.findLastIndex((p) => channelNames.includes(p.text));
  const firstSchema = parts.findIndex((p) => p.text.startsWith('Schema: '));
  const schemasFrom = firstSchema === -1 ? lines.length : parts[firstSchema].i;
  const messages = parts.slice(lastChannel + 1, firstSchema === -1 ? parts.length : firstSchema);
  const messagesFrom = messages.length > 0 && lastChannel !== -1 ? messages[0].i : schemasFrom;
  // A group starts at the anchor just before its first heading, so the anchor stays with it.
  const groupStart = (i) => (lines[i - 2]?.startsWith('<a id=') ? i - 2 : i);
  const out = [];
  let inCode = false;
  lines.forEach((line, i) => {
    if (i === groupStart(messagesFrom) && messagesFrom < schemasFrom) out.push('## Messages', '');
    if (i === groupStart(schemasFrom) && firstSchema !== -1) out.push('## Schemas', '');
    if (line.startsWith('```')) inCode = !inCode;
    const grouped = !inCode && i >= messagesFrom && /^#{2,5} /.test(line);
    out.push(grouped ? `#${line.replace(/^## Schema: /, '## ')}` : line);
  });
  return out.join('\n');
}
