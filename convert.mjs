/**
 * A bundled OpenAPI or AsyncAPI document as Markdown, written by Scalar's converters, and the
 * names every complete rendering of it must mention.
 */
import { createMarkdownFromAsyncApi } from '@scalar/asyncapi-to-markdown';
import { createMarkdownFromOpenApi } from '@scalar/openapi-to-markdown';

const HTTP_METHODS = ['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace'];

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
    const converted = await createMarkdownFromOpenApi(doc);
    if (!OPENAPI_VERSION_LINE.test(converted)) {
      throw new Error('the OpenAPI converter no longer prints the "OpenAPI Version" line that convert.mjs corrects');
    }
    markdown = converted.replace(OPENAPI_VERSION_LINE, `$1${doc.openapi}$2`);
  } else {
    markdown = await createMarkdownFromAsyncApi(doc);
  }
  return markdown;
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
