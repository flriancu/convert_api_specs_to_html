/**
 * A bundled OpenAPI or AsyncAPI document as Markdown, written by Scalar's converters and tidied
 * (tidy.mjs), and the names every complete rendering of it must mention.
 */
import { createMarkdownFromAsyncApi } from '@scalar/asyncapi-to-markdown';
import { createMarkdownFromOpenApi } from '@scalar/openapi-to-markdown';

import { tidyAsyncApi, tidyOpenApi } from './tidy.mjs';

const HTTP_METHODS = ['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace'];

// Named primitive schemas (an id's pattern, an enumeration) are linked like the others, so a
// field shows which schema it uses. The AsyncAPI converter only links them in its linked mode,
// which leaves out the generated examples, so it keeps writing them in place.
const OPENAPI_OPTIONS = { schemaReferences: { inlinePrimitives: false } };

// The OpenAPI converter upgrades the document to the newest OpenAPI version before rendering it
// and prints that version; the page shows the version the description declares.
const OPENAPI_VERSION_LINE = /^(- \*\*OpenAPI Version:\*\*\s+`)[^`]*(`)$/m;

/** 'openapi' or 'asyncapi'; throws for anything else. */
export function kindOf(doc) {
  let kind = null;
  if (typeof doc?.openapi === 'string') {
    kind = 'openapi';
  } else if (typeof doc?.asyncapi === 'string') {
    kind = 'asyncapi';
  } else {
    throw new Error('not an OpenAPI or AsyncAPI document');
  }
  return kind;
}

export async function toMarkdown(doc) {
  let markdown = '';
  if (kindOf(doc) === 'openapi') {
    const converted = await createMarkdownFromOpenApi(doc, OPENAPI_OPTIONS);
    if (!OPENAPI_VERSION_LINE.test(converted)) {
      throw new Error('the OpenAPI converter no longer prints the "OpenAPI Version" line that convert.mjs corrects');
    }
    markdown = tidyOpenApi(converted.replace(OPENAPI_VERSION_LINE, `$1${doc.openapi}$2`));
  } else {
    markdown = tidyAsyncApi(await createMarkdownFromAsyncApi(doc), Object.keys(doc.channels ?? {}));
  }
  return markdown;
}

/** How many operations the document has: OpenAPI methods on its paths, AsyncAPI operations. */
export function operationCount(doc) {
  let count = 0;
  if (kindOf(doc) === 'openapi') {
    for (const item of Object.values(doc.paths ?? {})) {
      count += HTTP_METHODS.filter((method) => item?.[method]).length;
    }
  } else {
    count = Object.keys(doc.operations ?? {}).length;
  }
  return count;
}

// Keys whose values are data, not description: examples, defaults, constants, enumerations and
// extensions. An Example Object's description is text; its value is data.
const DATA_KEYS = new Set(['example', 'default', 'const', 'enum', 'value']);
// Keywords whose object maps names to objects (properties, paths, messages...): a name there is
// not a keyword, so a property called "default" is described like any other.
const NAME_MAPS = new Set([
  'properties', 'patternProperties', '$defs', 'definitions', 'dependentSchemas', 'schemas', 'parameters',
  'responses', 'headers', 'content', 'examples', 'requestBodies', 'securitySchemes', 'callbacks', 'links',
  'paths', 'servers', 'variables', 'channels', 'operations', 'messages',
]);

/**
 * Every description the document gives, as Markdown, in document order: the document's, its
 * operations', parameters', messages', schemas' and properties', and named examples'.
 */
export function expectedDescriptions(doc) {
  const found = [];
  const walk = (node, key) => {
    if (typeof node === 'string') {
      if (key === 'description' && node.trim() !== '') found.push(node);
    } else if (Array.isArray(node)) {
      if (key !== 'examples') node.forEach((item) => walk(item, null));
    } else if (node !== null && typeof node === 'object' && NAME_MAPS.has(key)) {
      Object.values(node).forEach((item) => walk(item, null));
    } else if (node !== null && typeof node === 'object') {
      for (const [k, v] of Object.entries(node)) {
        if (!DATA_KEYS.has(k) && !k.startsWith('x-')) walk(v, k);
      }
    }
  };
  walk(doc, null);
  return found;
}

/**
 * The names a complete rendering shows: for OpenAPI each operation's id (or method and path)
 * and each schema; for AsyncAPI each channel and schema, each operation by its title or summary
 * and each message by its name or title, the labels the AsyncAPI converter shows them under.
 */
export function expectedNames(doc) {
  const names = [];
  if (kindOf(doc) === 'openapi') {
    for (const [path, item] of Object.entries(doc.paths ?? {})) {
      for (const method of HTTP_METHODS) {
        const operation = item?.[method];
        if (operation) {
          names.push(operation.operationId ?? `${method.toUpperCase()} ${path}`);
        }
      }
    }
  } else {
    names.push(...Object.keys(doc.channels ?? {}));
    for (const [id, operation] of Object.entries(doc.operations ?? {})) {
      names.push(operation?.title ?? operation?.summary ?? id);
    }
    for (const [id, message] of Object.entries(doc.components?.messages ?? {})) {
      names.push(message?.name ?? message?.title ?? id);
    }
  }
  names.push(...Object.keys(doc.components?.schemas ?? {}));
  return names;
}
