#!/usr/bin/env node
/**
 * Checks that every example in a specification matches the schema it illustrates, for
 * OpenAPI and AsyncAPI alike: request bodies, responses, parameters and headers with their
 * `example` or `examples` (references to `components/examples` resolved), AsyncAPI message
 * examples against the message's payload and headers, and the `examples` keyword of schemas.
 * Linters leave AsyncAPI examples unchecked, so an example can drift from its schema
 * unnoticed; this finds it.
 *
 * The description's $refs are checked first (check_refs.mjs), then Redocly CLI bundles it into
 * one document (redocly.mjs). Schemas are validated as JSON Schema 2020-12 with format
 * checks: OpenAPI 3.1's dialect, and a superset of what AsyncAPI's default schema format uses.
 * Payloads in another schema format (Avro, RAML) are skipped.
 *
 * Usage (installed as a dependency, the command is check-api-spec-examples):
 *   node check_examples.mjs <spec>...
 */
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

import { checkRefs } from './check_refs.mjs';
import { runsAsCommand } from './cli.mjs';
import { bundle, redoclyCli } from './redocly.mjs';

const DOC_ID = 'https://spec.invalid/document.json';
const SCHEMA_KEYWORDS_SINGLE = ['additionalProperties', 'items', 'contains', 'not', 'if', 'then', 'else', 'unevaluatedProperties', 'unevaluatedItems', 'propertyNames'];
const SCHEMA_KEYWORDS_LIST = ['allOf', 'anyOf', 'oneOf', 'prefixItems'];
const SCHEMA_KEYWORDS_MAP = ['properties', 'patternProperties', '$defs', 'dependentSchemas'];
const JSON_SCHEMA_FORMAT = /^application\/(schema\+json|schema\+yaml|vnd\.aai\.asyncapi(\+json|\+yaml)?)(;|$)/i;

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** A JSON pointer fragment ("#/a/b") to the given path in the document. */
export function pointer(parts) {
  return `#${parts.map((p) => `/${String(p).replaceAll('~', '~0').replaceAll('/', '~1')}`).join('')}`;
}

function resolvePointer(doc, ref) {
  let node = doc;
  for (const raw of ref.slice(2).split('/')) {
    const key = decodeURIComponent(raw).replaceAll('~1', '/').replaceAll('~0', '~');
    node = isObject(node) || Array.isArray(node) ? node[key] : undefined;
  }
  return node;
}

/** The object a local $ref leads to, following chains; the node itself when it is no $ref. */
function deref(doc, node) {
  let current = node;
  const seen = new Set();
  while (isObject(current) && typeof current.$ref === 'string' && current.$ref.startsWith('#/') && !seen.has(current.$ref)) {
    seen.add(current.$ref);
    current = resolvePointer(doc, current.$ref);
  }
  return current;
}

/** The examples of an object carrying a schema and example/examples (media type, parameter, header). */
function* exampleHolder(doc, holder, parts) {
  if (isObject(holder) && holder.schema !== undefined) {
    const schema = [...parts, 'schema'];
    if ('example' in holder) {
      yield { where: pointer([...parts, 'example']), schema, value: holder.example };
    }
    for (const [name, entry] of Object.entries(isObject(holder.examples) ? holder.examples : {})) {
      const example = deref(doc, entry);
      if (isObject(example) && 'value' in example) {
        yield { where: pointer([...parts, 'examples', name]), schema, value: example.value };
      }
    }
  }
}

function* contentExamples(doc, owner, parts) {
  for (const [mediaType, media] of Object.entries(isObject(owner?.content) ? owner.content : {})) {
    yield* exampleHolder(doc, media, [...parts, 'content', mediaType]);
  }
}

function* responseExamples(doc, response, parts) {
  if (isObject(response) && response.$ref === undefined) {
    yield* contentExamples(doc, response, parts);
    for (const [name, header] of Object.entries(isObject(response.headers) ? response.headers : {})) {
      if (isObject(header) && header.$ref === undefined) {
        yield* exampleHolder(doc, header, [...parts, 'headers', name]);
      }
    }
  }
}

function* parameterExamples(doc, parameters, parts) {
  for (const [index, parameter] of (Array.isArray(parameters) ? parameters : []).entries()) {
    if (isObject(parameter) && parameter.$ref === undefined) {
      yield* exampleHolder(doc, parameter, [...parts, index]);
      yield* contentExamples(doc, parameter, [...parts, index]);
    }
  }
}

/** The `examples` keyword of a schema and of every schema inside it. */
function* schemaKeywordExamples(schema, parts) {
  if (isObject(schema)) {
    if (Array.isArray(schema.examples)) {
      for (const [index, value] of schema.examples.entries()) {
        yield { where: pointer([...parts, 'examples', index]), schema: parts, value };
      }
    }
    for (const key of SCHEMA_KEYWORDS_SINGLE) {
      yield* schemaKeywordExamples(schema[key], [...parts, key]);
    }
    for (const key of SCHEMA_KEYWORDS_LIST) {
      for (const [index, sub] of (Array.isArray(schema[key]) ? schema[key] : []).entries()) {
        yield* schemaKeywordExamples(sub, [...parts, key, index]);
      }
    }
    for (const key of SCHEMA_KEYWORDS_MAP) {
      for (const [name, sub] of Object.entries(isObject(schema[key]) ? schema[key] : {})) {
        yield* schemaKeywordExamples(sub, [...parts, key, name]);
      }
    }
  }
}

function* openApiExamples(doc) {
  const methods = ['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace'];
  for (const [route, item] of Object.entries(isObject(doc.paths) ? doc.paths : {})) {
    const at = ['paths', route];
    yield* parameterExamples(doc, item?.parameters, [...at, 'parameters']);
    for (const method of methods.filter((m) => isObject(item?.[m]))) {
      const operation = item[method];
      yield* parameterExamples(doc, operation.parameters, [...at, method, 'parameters']);
      if (isObject(operation.requestBody) && operation.requestBody.$ref === undefined) {
        yield* contentExamples(doc, operation.requestBody, [...at, method, 'requestBody']);
      }
      for (const [status, response] of Object.entries(isObject(operation.responses) ? operation.responses : {})) {
        yield* responseExamples(doc, response, [...at, method, 'responses', status]);
      }
    }
  }
  const components = isObject(doc.components) ? doc.components : {};
  for (const [name, response] of Object.entries(isObject(components.responses) ? components.responses : {})) {
    yield* responseExamples(doc, response, ['components', 'responses', name]);
  }
  for (const [name, body] of Object.entries(isObject(components.requestBodies) ? components.requestBodies : {})) {
    yield* contentExamples(doc, body, ['components', 'requestBodies', name]);
  }
  for (const [name, parameter] of Object.entries(isObject(components.parameters) ? components.parameters : {})) {
    yield* exampleHolder(doc, parameter, ['components', 'parameters', name]);
  }
  for (const [name, header] of Object.entries(isObject(components.headers) ? components.headers : {})) {
    yield* exampleHolder(doc, header, ['components', 'headers', name]);
  }
}

/** The schema path of a message's payload or headers, null when it is in a non-JSON schema format. */
function asyncSchemaPath(doc, message, parts, key) {
  const node = message[key];
  let path = null;
  if (isObject(node) && isObject(node.schema) && typeof node.schemaFormat === 'string') {
    path = JSON_SCHEMA_FORMAT.test(node.schemaFormat) ? [...parts, key, 'schema'] : null;
  } else if (node !== undefined) {
    const format = message.schemaFormat;
    path = format === undefined || JSON_SCHEMA_FORMAT.test(format) ? [...parts, key] : null;
  }
  return path;
}

function* messageExamples(doc, message, parts) {
  if (isObject(message) && message.$ref === undefined) {
    for (const [index, example] of (Array.isArray(message.examples) ? message.examples : []).entries()) {
      for (const key of ['payload', 'headers']) {
        const schema = asyncSchemaPath(doc, message, parts, key);
        if (schema !== null && isObject(example) && key in example) {
          yield { where: pointer([...parts, 'examples', index, key]), schema, value: example[key] };
        }
      }
    }
  }
}

function* asyncApiExamples(doc) {
  const components = isObject(doc.components) ? doc.components : {};
  for (const [name, message] of Object.entries(isObject(components.messages) ? components.messages : {})) {
    yield* messageExamples(doc, message, ['components', 'messages', name]);
  }
  for (const [channelName, channel] of Object.entries(isObject(doc.channels) ? doc.channels : {})) {
    for (const [name, message] of Object.entries(isObject(channel?.messages) ? channel.messages : {})) {
      yield* messageExamples(doc, message, ['channels', channelName, 'messages', name]);
    }
  }
}

/** Every example of a bundled OpenAPI or AsyncAPI document: where it is, its schema's path, its value. */
export function examplesIn(doc) {
  const found = isObject(doc) && typeof doc.asyncapi === 'string' ? [...asyncApiExamples(doc)] : [...openApiExamples(doc)];
  const components = isObject(doc?.components) ? doc.components : {};
  for (const [name, schema] of Object.entries(isObject(components.schemas) ? components.schemas : {})) {
    found.push(...schemaKeywordExamples(schema, ['components', 'schemas', name]));
  }
  return found;
}

/** Problems with the examples of a bundled document, as sentences, and how many examples there are. */
export function checkExamples(doc) {
  const ajv = new Ajv2020({ strict: false, validateSchema: false, allErrors: false });
  addFormats(ajv);
  ajv.addSchema(doc, DOC_ID);
  const examples = examplesIn(doc);
  const problems = [];
  for (const { where, schema, value } of examples) {
    let validate = null;
    try {
      validate = ajv.compile({ $ref: `${DOC_ID}${pointer(schema)}` });
    } catch (error) {
      problems.push(`${where}: its schema cannot be compiled: ${error.message}`);
    }
    if (validate !== null && !validate(value)) {
      const [first] = validate.errors;
      problems.push(`${where}: ${first.instancePath || '(the example)'} ${first.message}`);
    }
  }
  return { count: examples.length, problems };
}

function main() {
  const specs = process.argv.slice(2);
  const cli = redoclyCli();
  let exitCode = 0;
  if (specs.length === 0 || specs.includes('-h') || specs.includes('--help')) {
    console.log('usage: check-api-spec-examples <spec>...');
    exitCode = specs.length === 0 ? 2 : 0;
  } else if (cli === null) {
    console.error('Redocly CLI is not installed; run "npm ci" in this package or in the project using it');
    exitCode = 2;
  } else {
    for (const spec of specs) {
      // Refs are checked before Redocly resolves them, so a URL is never fetched.
      let problems = checkRefs(spec);
      let count = 0;
      if (problems.length === 0) {
        const doc = bundle(cli, spec);
        if (doc === null) {
          problems = ['redocly bundle failed'];
        } else {
          ({ count, problems } = checkExamples(doc));
        }
      }
      for (const problem of problems) {
        console.error(`${spec}: ${problem}`);
      }
      if (problems.length > 0) {
        exitCode = 1;
      } else {
        console.log(`${spec}: every example matches its schema (${count} checked)`);
      }
    }
  }
  process.exitCode = exitCode;
}

if (runsAsCommand(import.meta.url)) {
  main();
}
