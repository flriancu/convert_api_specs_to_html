#!/usr/bin/env node
/**
 * Checks that every example in a specification matches the schema it illustrates, for
 * OpenAPI and AsyncAPI (2.x and 3.x) alike: request bodies, responses, parameters and headers
 * with their `example` or `examples` (references to `components/examples` resolved); AsyncAPI
 * message examples against the message's payload and headers, with the message's traits
 * applied as the specification's version merges them; channel parameter examples against
 * their `enum`; and the `examples` and `default` of every schema, inline ones included, binding
 * schemas among them. Linters leave AsyncAPI examples unchecked, so an example can drift from
 * its schema unnoticed; this finds it.
 *
 * It also reports what no instance could satisfy (a minimum above its maximum, and the like)
 * and a `$schema` other than the document's dialect. What it cannot check it counts and names
 * instead of passing quietly: payloads in another schema format (Avro, OpenAPI), and payloads
 * that traits and the message both define.
 *
 * Patterns run on RE2, a linear-time engine (linear_regexp.mjs), so a pattern that backtracks
 * badly cannot make the check slow; one that needs lookarounds or backreferences, which RE2
 * lacks, is named as not checked.
 *
 * The description's $refs are checked first (check_refs.mjs), then Redocly CLI bundles it into
 * one document (redocly.mjs). Schemas are validated with format checks in the dialect the
 * document's own schemas use: JSON Schema 2020-12 for OpenAPI 3.1, and draft-07 for AsyncAPI,
 * whose default schema format extends it.
 *
 * Usage (installed as a dependency, the command is check-api-spec-examples):
 *   node check_examples.mjs <spec>...
 */
import Ajv from 'ajv';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

import { checkRefs } from './check_refs.mjs';
import { runsAsCommand } from './cli.mjs';
import { linearRegExp, NeedsBacktracking } from './linear_regexp.mjs';
import { bundle, redoclyCli } from './redocly.mjs';

const DOC_ID = 'https://spec.invalid/document.json';
const SCHEMA_KEYWORDS_SINGLE = ['additionalProperties', 'items', 'contains', 'not', 'if', 'then', 'else', 'unevaluatedProperties', 'unevaluatedItems', 'propertyNames'];
const SCHEMA_KEYWORDS_LIST = ['allOf', 'anyOf', 'oneOf', 'prefixItems'];
const SCHEMA_KEYWORDS_MAP = ['properties', 'patternProperties', '$defs', 'definitions', 'dependentSchemas'];
const BOUNDS = [['minimum', 'maximum'], ['minLength', 'maxLength'], ['minItems', 'maxItems'], ['minProperties', 'maxProperties'], ['minContains', 'maxContains']];
// The JSON Schema dialect each kind of document uses, and how its $schema is written.
const DIALECTS = {
  openapi: { name: 'JSON Schema 2020-12', id: /^https?:\/\/json-schema\.org\/draft\/2020-12\/schema#?$/, Validator: Ajv2020 },
  asyncapi: { name: 'JSON Schema draft-07', id: /^https?:\/\/json-schema\.org\/draft-07\/schema#?$/, Validator: Ajv },
};
const JSON_SCHEMA_FORMAT = /^application\/(schema\+json|schema\+yaml|vnd\.aai\.asyncapi(\+json|\+yaml)?)(;|$)/i;
const BINDING_SCHEMAS = ['query', 'headers'];

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function entriesOf(value) {
  return Object.entries(isObject(value) ? value : {});
}

function tokens(parts) {
  return parts.map((p) => String(p).replaceAll('~', '~0').replaceAll('/', '~1'));
}

/** Where a node is, for people: "#" and a JSON pointer (RFC 6901) to it. */
export function location(parts) {
  return `#${tokens(parts).map((t) => `/${t}`).join('')}`;
}

/** A JSON pointer to the given path as a URI fragment, percent-encoded, for a $ref. */
export function pointer(parts) {
  return `#${tokens(parts).map((t) => `/${encodeURIComponent(t)}`).join('')}`;
}

function resolvePointer(doc, ref) {
  let node = doc;
  for (const raw of ref.slice(2).split('/')) {
    const key = decodeURIComponent(raw).replaceAll('~1', '/').replaceAll('~0', '~');
    node = isObject(node) || Array.isArray(node) ? node[key] : undefined;
  }
  return node;
}

/** The object a local $ref leads to and its path, following chains; the node itself when it is no $ref. */
function deref(doc, node, parts) {
  let current = { node, parts };
  const seen = new Set();
  while (isObject(current.node) && typeof current.node.$ref === 'string' && current.node.$ref.startsWith('#/') && !seen.has(current.node.$ref)) {
    seen.add(current.node.$ref);
    const ref = current.node.$ref;
    current = {
      node: resolvePointer(doc, ref),
      parts: ref.slice(2).split('/').map((raw) => decodeURIComponent(raw).replaceAll('~1', '/').replaceAll('~0', '~')),
    };
  }
  return current;
}

/**
 * What a schema and every schema inside it hold for checking: its `examples` and `default`
 * (to validate against the schema they sit in), and what is wrong with it outright.
 */
function* schemaItems(schema, parts) {
  if (isObject(schema)) {
    for (const [index, value] of (Array.isArray(schema.examples) ? schema.examples : []).entries()) {
      yield { where: location([...parts, 'examples', index]), schema: parts, value };
    }
    if ('default' in schema) {
      yield { where: location([...parts, 'default']), schema: parts, value: schema.default };
    }
    for (const [low, high] of BOUNDS) {
      if (typeof schema[low] === 'number' && typeof schema[high] === 'number' && schema[low] > schema[high]) {
        yield { where: location(parts), problem: `${low} ${schema[low]} is above ${high} ${schema[high]}: no value can satisfy it` };
      }
    }
    if (typeof schema.exclusiveMinimum === 'number' && typeof schema.exclusiveMaximum === 'number' && schema.exclusiveMinimum >= schema.exclusiveMaximum) {
      yield { where: location(parts), problem: 'exclusiveMinimum is not below exclusiveMaximum: no value can satisfy it' };
    }
    if (typeof schema.$schema === 'string') {
      yield { where: location([...parts, '$schema']), dialect: schema.$schema };
    }
    for (const key of SCHEMA_KEYWORDS_SINGLE) {
      yield* schemaItems(schema[key], [...parts, key]);
    }
    for (const key of SCHEMA_KEYWORDS_LIST) {
      for (const [index, sub] of (Array.isArray(schema[key]) ? schema[key] : []).entries()) {
        yield* schemaItems(sub, [...parts, key, index]);
      }
    }
    for (const key of SCHEMA_KEYWORDS_MAP) {
      for (const [name, sub] of entriesOf(schema[key])) {
        yield* schemaItems(sub, [...parts, key, name]);
      }
    }
  }
}

/** The examples of an object carrying a schema and example/examples (media type, parameter, header), and its schema's own. */
function* exampleHolder(doc, holder, parts) {
  if (isObject(holder) && holder.schema !== undefined) {
    const schema = [...parts, 'schema'];
    if ('example' in holder) {
      yield { where: location([...parts, 'example']), schema, value: holder.example };
    }
    for (const [name, entry] of entriesOf(holder.examples)) {
      const example = deref(doc, entry, [...parts, 'examples', name]).node;
      if (isObject(example) && 'value' in example) {
        yield { where: location([...parts, 'examples', name]), schema, value: example.value };
      }
    }
    yield* schemaItems(holder.schema, schema);
  }
}

function* contentExamples(doc, owner, parts) {
  for (const [mediaType, media] of entriesOf(owner?.content)) {
    yield* exampleHolder(doc, media, [...parts, 'content', mediaType]);
  }
}

function* responseExamples(doc, response, parts) {
  if (isObject(response) && response.$ref === undefined) {
    yield* contentExamples(doc, response, parts);
    for (const [name, header] of entriesOf(response.headers)) {
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

function* openApiItems(doc) {
  const methods = ['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace'];
  for (const [route, item] of entriesOf(doc.paths)) {
    const at = ['paths', route];
    yield* parameterExamples(doc, item?.parameters, [...at, 'parameters']);
    for (const method of methods.filter((m) => isObject(item?.[m]))) {
      const operation = item[method];
      yield* parameterExamples(doc, operation.parameters, [...at, method, 'parameters']);
      if (isObject(operation.requestBody) && operation.requestBody.$ref === undefined) {
        yield* contentExamples(doc, operation.requestBody, [...at, method, 'requestBody']);
      }
      for (const [status, response] of entriesOf(operation.responses)) {
        yield* responseExamples(doc, response, [...at, method, 'responses', status]);
      }
    }
  }
  const components = isObject(doc.components) ? doc.components : {};
  for (const [name, response] of entriesOf(components.responses)) {
    yield* responseExamples(doc, response, ['components', 'responses', name]);
  }
  for (const [name, body] of entriesOf(components.requestBodies)) {
    yield* contentExamples(doc, body, ['components', 'requestBodies', name]);
  }
  for (const [name, parameter] of entriesOf(components.parameters)) {
    yield* exampleHolder(doc, parameter, ['components', 'parameters', name]);
  }
  for (const [name, header] of entriesOf(components.headers)) {
    yield* exampleHolder(doc, header, ['components', 'headers', name]);
  }
}

/**
 * A message with its traits applied: for each property, its value and the path it came from.
 * AsyncAPI 3 merges traits under the message (a trait never overrides the message's own
 * property); AsyncAPI 2 merges them over it, in order.
 */
function effectiveMessage(doc, message, parts, major) {
  const sources = [];
  for (const [index, trait] of (Array.isArray(message.traits) ? message.traits : []).entries()) {
    sources.push(deref(doc, trait, [...parts, 'traits', index]));
  }
  const own = { node: message, parts };
  const order = major >= 3 ? [...sources, own] : [own, ...sources];
  const merged = {};
  const conflicts = new Set();
  for (const source of order.filter((s) => isObject(s.node))) {
    for (const [key, value] of Object.entries(source.node)) {
      if (key !== 'traits') {
        if (merged[key] !== undefined && isObject(merged[key].value) && isObject(value) && (key === 'payload' || key === 'headers')) {
          conflicts.add(key);
        }
        merged[key] = { value, parts: [...source.parts, key] };
      }
    }
  }
  return { merged, conflicts };
}

/**
 * A merged message's payload or headers as a JSON Schema: its path and the schema itself, or
 * why it is not checked.
 */
function asyncSchema(doc, merged, key, conflicts) {
  // A payload may be a $ref to a schema written in another format: followed before it is judged.
  let entry;
  if (merged[key] !== undefined) {
    const { node, parts } = deref(doc, merged[key].value, merged[key].parts);
    entry = { value: node, parts };
  }
  const format = merged.schemaFormat?.value;
  let result = { path: null, schema: null, skipped: null };
  if (entry === undefined) {
    result = { path: null, schema: null, skipped: `the message defines no ${key}` };
  } else if (conflicts.has(key)) {
    result = { path: null, schema: null, skipped: `its ${key} is merged from traits and the message` };
  } else if (isObject(entry.value) && isObject(entry.value.schema) && typeof entry.value.schemaFormat === 'string') {
    result = JSON_SCHEMA_FORMAT.test(entry.value.schemaFormat)
      ? { path: [...entry.parts, 'schema'], schema: entry.value.schema, skipped: null }
      : { path: null, schema: null, skipped: `its ${key} is in schema format ${entry.value.schemaFormat}` };
  } else {
    result = format === undefined || JSON_SCHEMA_FORMAT.test(format)
      ? { path: entry.parts, schema: entry.value, skipped: null }
      : { path: null, schema: null, skipped: `its ${key} is in schema format ${format}` };
  }
  return result;
}

function* messageItems(doc, message, parts, major) {
  if (isObject(message) && message.$ref === undefined) {
    const { merged, conflicts } = effectiveMessage(doc, message, parts, major);
    const examples = merged.examples;
    for (const key of ['payload', 'headers']) {
      const { path, schema, skipped } = asyncSchema(doc, merged, key, conflicts);
      for (const [index, example] of (Array.isArray(examples?.value) ? examples.value : []).entries()) {
        if (isObject(example) && key in example) {
          const where = location([...examples.parts, index, key]);
          yield path !== null ? { where, schema: path, value: example[key] } : { where, skipped };
        }
      }
      if (path !== null) {
        yield* schemaItems(schema, path);
      }
    }
    yield* bindingItems(message.bindings, [...parts, 'bindings']);
  }
}

/** The schemas of bindings (the query and headers of ws and http bindings). */
function* bindingItems(bindings, parts) {
  for (const [protocol, binding] of entriesOf(bindings)) {
    for (const key of BINDING_SCHEMAS) {
      if (isObject(binding?.[key])) {
        yield* schemaItems(binding[key], [...parts, protocol, key]);
      }
    }
  }
}

/** An AsyncAPI 3 channel parameter's examples and default, against its enum. */
function* parameterEnumItems(parameter, parts) {
  if (isObject(parameter) && Array.isArray(parameter.enum)) {
    for (const [index, value] of (Array.isArray(parameter.examples) ? parameter.examples : []).entries()) {
      if (!parameter.enum.includes(value)) {
        yield { where: location([...parts, 'examples', index]), problem: `${JSON.stringify(value)} is not one of its enum` };
      }
    }
    if ('default' in parameter && !parameter.enum.includes(parameter.default)) {
      yield { where: location([...parts, 'default']), problem: `${JSON.stringify(parameter.default)} is not one of its enum` };
    }
  }
}

/** The messages of an AsyncAPI 2 operation: one, or a oneOf list. */
function* operationMessages(operation, parts) {
  const message = operation?.message;
  if (isObject(message) && Array.isArray(message.oneOf)) {
    for (const [index, entry] of message.oneOf.entries()) {
      yield { message: entry, parts: [...parts, 'message', 'oneOf', index] };
    }
  } else if (isObject(message)) {
    yield { message, parts: [...parts, 'message'] };
  }
}

function* asyncApiItems(doc, major) {
  const components = isObject(doc.components) ? doc.components : {};
  for (const [name, message] of entriesOf(components.messages)) {
    yield* messageItems(doc, message, ['components', 'messages', name], major);
  }
  for (const [channelName, channel] of entriesOf(doc.channels)) {
    const at = ['channels', channelName];
    if (major >= 3) {
      for (const [name, message] of entriesOf(channel?.messages)) {
        yield* messageItems(doc, message, [...at, 'messages', name], major);
      }
      for (const [name, parameter] of entriesOf(channel?.parameters)) {
        yield* parameterEnumItems(parameter, [...at, 'parameters', name]);
      }
    } else {
      for (const action of ['publish', 'subscribe']) {
        for (const { message, parts } of operationMessages(channel?.[action], [...at, action])) {
          yield* messageItems(doc, message, parts, major);
        }
        yield* bindingItems(channel?.[action]?.bindings, [...at, action, 'bindings']);
      }
      for (const [name, parameter] of entriesOf(channel?.parameters)) {
        if (isObject(parameter?.schema)) {
          yield* schemaItems(parameter.schema, [...at, 'parameters', name, 'schema']);
        }
      }
    }
    yield* bindingItems(channel?.bindings, [...at, 'bindings']);
  }
  for (const [name, operation] of entriesOf(major >= 3 ? doc.operations : {})) {
    yield* bindingItems(operation?.bindings, ['operations', name, 'bindings']);
  }
}

/**
 * Everything to check in a bundled OpenAPI or AsyncAPI document: examples and defaults with
 * where they are, their schema's path and value; problems found outright; and what is skipped.
 */
export function itemsIn(doc) {
  const asyncapi = isObject(doc) && typeof doc.asyncapi === 'string';
  const major = asyncapi ? Number.parseInt(doc.asyncapi, 10) : 0;
  const found = asyncapi ? [...asyncApiItems(doc, major)] : [...openApiItems(doc)];
  const components = isObject(doc?.components) ? doc.components : {};
  for (const [name, schema] of entriesOf(components.schemas)) {
    found.push(...schemaItems(schema, ['components', 'schemas', name]));
  }
  return found;
}

/** The examples of a bundled document: where each is, its schema's path, its value. */
export function examplesIn(doc) {
  return itemsIn(doc).filter((item) => 'value' in item);
}

/**
 * Problems with the examples of a bundled document, as sentences; how many examples were
 * checked; and what was not checked, with why.
 */
export function checkExamples(doc) {
  const dialect = isObject(doc) && typeof doc.asyncapi === 'string' ? DIALECTS.asyncapi : DIALECTS.openapi;
  const ajv = new dialect.Validator({ strict: false, validateSchema: false, allErrors: false, code: { regExp: linearRegExp } });
  addFormats(ajv);
  const problems = [];
  const skipped = [];
  let count = 0;
  let loaded = true;
  try {
    ajv.addSchema(doc, DOC_ID);
  } catch (error) {
    loaded = false;
    problems.push(`the document cannot be checked: ${error.message}`);
  }
  for (const item of loaded ? itemsIn(doc) : []) {
    if ('problem' in item) {
      problems.push(`${item.where}: ${item.problem}`);
    } else if ('dialect' in item) {
      if (!dialect.id.test(item.dialect)) {
        problems.push(`${item.where}: declares ${item.dialect}; this document's schemas are checked as ${dialect.name}`);
      }
    } else if ('skipped' in item) {
      skipped.push(`${item.where}: ${item.skipped}`);
    } else {
      count += 1;
      let validate = null;
      try {
        validate = ajv.compile({ $ref: `${DOC_ID}${pointer(item.schema)}` });
      } catch (error) {
        if (error instanceof NeedsBacktracking) {
          skipped.push(`${item.where}: ${error.message}`);
        } else {
          problems.push(`${item.where}: its schema cannot be compiled: ${error.message}`);
        }
      }
      if (validate !== null && !validate(item.value)) {
        const [first] = validate.errors;
        problems.push(`${item.where}: ${first.instancePath || '(the example)'} ${first.message}`);
      }
    }
  }
  return { count, problems, skipped };
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
      let skipped = [];
      if (problems.length === 0) {
        const doc = bundle(cli, spec);
        if (doc === null) {
          problems = ['redocly bundle failed'];
        } else {
          ({ count, problems, skipped } = checkExamples(doc));
        }
      }
      for (const problem of problems) {
        console.error(`${spec}: ${problem}`);
      }
      if (problems.length > 0) {
        exitCode = 1;
      } else {
        const unchecked = skipped.length > 0 ? `; ${skipped.length} not checked` : '';
        console.log(`${spec}: every example matches its schema (${count} checked${unchecked})`);
        for (const reason of skipped) {
          console.log(`${spec}: not checked: ${reason}`);
        }
      }
    }
  }
  process.exitCode = exitCode;
}

if (runsAsCommand(import.meta.url)) {
  main();
}
