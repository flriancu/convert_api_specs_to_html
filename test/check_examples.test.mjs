import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { checkExamples, examplesIn } from '../check_examples.mjs';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const EXAMPLES = path.join(ROOT, 'examples');
const TMP = mkdtempSync(path.join(os.tmpdir(), 'check-examples-'));

after(() => rmSync(TMP, { recursive: true, force: true }));

function openapi(paths, components = {}) {
  return { openapi: '3.1.0', info: { title: 'T', version: '1.0.0' }, paths, components };
}

const CLOCK = { type: 'string', pattern: '^(0|[1-9][0-9]{0,18})$' };

test('matching examples pass, wherever they are and however they refer to their schema', () => {
  const doc = openapi(
    {
      '/takes/{id}': {
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' }, example: 't-1' }],
        put: {
          requestBody: { content: { 'application/json': { schema: { $ref: '#/components/schemas/Take' }, example: { id: 't-1', at: '12' } } } },
          responses: {
            200: { description: 'ok', content: { 'application/json': { schema: { $ref: '#/components/schemas/Take' }, examples: { one: { $ref: '#/components/examples/Take' } } } } },
            429: { $ref: '#/components/responses/Limit' },
          },
        },
      },
    },
    {
      schemas: { Take: { type: 'object', required: ['id'], properties: { id: { type: 'string' }, at: CLOCK } }, Clock: { ...CLOCK, examples: ['0', '1793098332016666667'] } },
      examples: { Take: { value: { id: 't-1' } } },
      responses: { Limit: { description: 'later', headers: { 'Retry-After': { schema: { type: 'integer' }, example: 5 } } } },
    },
  );
  const { count, problems } = checkExamples(doc);
  assert.deepEqual(problems, []);
  assert.equal(count, 6);
});

test('an example that does not match is reported with where it is and what is wrong', () => {
  const doc = openapi(
    {
      '/takes': {
        get: {
          parameters: [{ name: 'since', in: 'query', schema: CLOCK, example: '-1' }],
          responses: { 200: { description: 'ok', content: { 'application/json': { schema: { $ref: '#/components/schemas/Take' }, examples: { bad: { $ref: '#/components/examples/Bad' } } } } } },
        },
      },
    },
    {
      schemas: { Take: { type: 'object', required: ['id'], properties: { id: { type: 'string' }, at: CLOCK, startedAt: { type: 'string', format: 'date-time' } } }, Clock: { ...CLOCK, examples: [1793098332016666667] } },
      examples: { Bad: { value: { id: 't-1', startedAt: 'yesterday' } } },
    },
  );
  assert.deepEqual(checkExamples(doc).problems, [
    '#/paths/~1takes/get/parameters/0/example: (the example) must match pattern "^(0|[1-9][0-9]{0,18})$"',
    '#/paths/~1takes/get/responses/200/content/application~1json/examples/bad: /startedAt must match format "date-time"',
    '#/components/schemas/Clock/examples/0: (the example) must be string',
  ]);
});

test('AsyncAPI message examples are checked against their payload, including composed envelopes', () => {
  const envelope = { type: 'object', required: ['seq', 'type', 'payload'], properties: { seq: { type: 'integer', minimum: 1 }, type: { type: 'string' }, payload: { type: 'object' } } };
  const doc = {
    asyncapi: '3.0.0',
    info: { title: 'E', version: '1.0.0' },
    components: {
      schemas: { Envelope: envelope },
      messages: {
        good: { payload: { allOf: [{ $ref: '#/components/schemas/Envelope' }, { properties: { type: { const: 'a' } } }] }, examples: [{ payload: { seq: 1, type: 'a', payload: {} } }] },
        bad: { payload: { allOf: [{ $ref: '#/components/schemas/Envelope' }, { properties: { type: { const: 'b' } } }] }, examples: [{ name: 'wrong type', payload: { seq: 0, type: 'b', payload: {} } }] },
        avro: { payload: { schemaFormat: 'application/vnd.apache.avro;version=1.9.0', schema: { type: 'record' } }, examples: [{ payload: 'anything' }] },
      },
    },
  };
  assert.equal(examplesIn(doc).length, 2);
  const result = checkExamples(doc);
  assert.deepEqual(result.problems, ['#/components/messages/bad/examples/0/payload: /seq must be >= 1']);
  assert.deepEqual(result.skipped, ['#/components/messages/avro/examples/0/payload: its payload is in schema format application/vnd.apache.avro;version=1.9.0'],
    'what cannot be checked is said, not passed quietly');
});

function asyncapi(major, components, channels = {}) {
  return { asyncapi: `${major}.0.0`, info: { title: 'E', version: '1.0.0' }, channels, components };
}

test('a name that percent-decodes to another is checked against its own schema', () => {
  const doc = asyncapi(3, { messages: { c: { payload: { type: 'integer' } }, '%63': { payload: { type: 'string' }, examples: [{ payload: 5 }] } } });
  assert.deepEqual(checkExamples(doc).problems, ['#/components/messages/%63/examples/0/payload: (the example) must be string']);
});

test("a message's traits bring their examples and payload, merged as the version says", () => {
  const traits = [{ examples: [{ payload: 'from the trait' }] }];
  const v3 = asyncapi(3, { messages: { m: { payload: { type: 'integer' }, traits } } });
  assert.deepEqual(checkExamples(v3).problems, ['#/components/messages/m/traits/0/examples/0/payload: (the example) must be integer']);
  const own = asyncapi(3, { messages: { m: { payload: { type: 'integer' }, examples: [{ payload: 1 }], traits } } });
  assert.deepEqual(checkExamples(own).problems, [], 'in 3.x a trait never overrides the message');
  const v2 = asyncapi(2, { messages: { m: { payload: { type: 'integer' }, examples: [{ payload: 1 }], traits } } });
  assert.deepEqual(checkExamples(v2).problems, ['#/components/messages/m/traits/0/examples/0/payload: (the example) must be integer'],
    'in 2.x traits are merged over the message');
});

test('AsyncAPI 2 operations, parameters and bindings are checked too', () => {
  const doc = asyncapi(2, {}, {
    c: {
      parameters: { p: { schema: { type: 'string', examples: [3] } } },
      bindings: { ws: { query: { type: 'object', properties: { v: { type: 'string', default: 1 } } } } },
      subscribe: { message: { oneOf: [{ payload: { type: 'integer' }, examples: [{ payload: 'x' }] }] } },
    },
  });
  assert.deepEqual(checkExamples(doc).problems, [
    '#/channels/c/subscribe/message/oneOf/0/examples/0/payload: (the example) must be integer',
    '#/channels/c/parameters/p/schema/examples/0: (the example) must be string',
    '#/channels/c/bindings/ws/query/properties/v/default: (the example) must be string',
  ]);
});

test("an AsyncAPI 3 channel parameter's examples and default are among its enum", () => {
  const doc = asyncapi(3, {}, { c: { address: '/{p}', parameters: { p: { enum: ['a', 'b'], examples: ['a', 'c'], default: 'd' } } } });
  assert.deepEqual(checkExamples(doc).problems, [
    '#/channels/c/parameters/p/examples/1: "c" is not one of its enum',
    '#/channels/c/parameters/p/default: "d" is not one of its enum',
  ]);
});

test('defaults are checked, and what no value satisfies or another dialect is reported', () => {
  const doc = openapi({}, {
    schemas: {
      Default: { type: 'integer', default: 'ten' },
      Range: { type: 'integer', minimum: 5, maximum: 1 },
      Old: { $schema: 'http://json-schema.org/draft-04/schema#', type: 'string' },
      Fine: { type: 'string', minLength: 1, maxLength: 1, default: 'x', $schema: 'https://json-schema.org/draft/2020-12/schema' },
    },
  });
  assert.deepEqual(checkExamples(doc).problems, [
    '#/components/schemas/Default/default: (the example) must be integer',
    '#/components/schemas/Range: minimum 5 is above maximum 1: no value can satisfy it',
    "#/components/schemas/Old/$schema: declares http://json-schema.org/draft-04/schema#; this document's schemas are checked as JSON Schema 2020-12",
  ]);
});

test("AsyncAPI schemas are read as draft-07, the dialect AsyncAPI's schema format extends", () => {
  const tuple = { type: 'array', items: [{ type: 'integer' }, { type: 'string' }] };
  const doc = asyncapi(3, { messages: { m: { payload: tuple, examples: [{ payload: [1, 'a'] }, { payload: ['a', 1] }] } } });
  assert.deepEqual(checkExamples(doc).problems, ['#/components/messages/m/examples/1/payload: /0 must be integer']);
  const declared = asyncapi(3, { schemas: { S: { $schema: 'http://json-schema.org/draft-07/schema#', type: 'string' } } });
  assert.deepEqual(checkExamples(declared).problems, []);
});

test('a payload reached through a $ref is judged by where it leads; a missing one is named', () => {
  const doc = asyncapi(3, {
    schemas: { Avro: { schemaFormat: 'application/vnd.apache.avro;version=1.9.0', schema: { type: 'record' } } },
    messages: {
      viaRef: { payload: { $ref: '#/components/schemas/Avro' }, examples: [{ payload: 'anything' }] },
      none: { examples: [{ payload: 'anything' }] },
    },
  });
  const { problems, skipped } = checkExamples(doc);
  assert.deepEqual(problems, []);
  assert.deepEqual(skipped, [
    '#/components/messages/viaRef/examples/0/payload: its payload is in schema format application/vnd.apache.avro;version=1.9.0',
    '#/components/messages/none/examples/0/payload: the message defines no payload',
  ]);
});

test('a pattern that backtracks badly does not slow the check; one needing backtracking is named', () => {
  const doc = openapi({}, {
    schemas: {
      Slow: { type: 'string', pattern: '^(a+)+$', examples: [`${'a'.repeat(40)}!`] },
      Lookahead: { type: 'string', pattern: '^(?=a)a+$', examples: ['aa'] },
    },
  });
  const started = performance.now();
  const { problems, skipped } = checkExamples(doc);
  assert.ok(performance.now() - started < 2000, 'a backtracking engine would take hours at 40 characters');
  assert.deepEqual(problems, ['#/components/schemas/Slow/examples/0: (the example) must match pattern "^(a+)+$"']);
  assert.equal(skipped.length, 1);
  assert.match(skipped[0], /^#\/components\/schemas\/Lookahead\/examples\/0: its pattern "\^\(\?=a\)a\+\$" needs a backtracking engine/);
});

test('a document whose $id the validator refuses is reported, not a crash', () => {
  for (const id of [7, 'https://spec.invalid/document.json']) {
    const doc = openapi({}, { schemas: { X: { $id: id, type: 'string' }, Y: { $id: 'https://spec.invalid/document.json' } } });
    const { problems } = checkExamples({ ...doc, $id: typeof id === 'number' ? id : undefined });
    assert.ok(problems.length > 0 && problems.every((p) => typeof p === 'string'), JSON.stringify(problems));
  }
});

test('the command checks the examples of the example specifications', () => {
  const result = spawnSync(process.execPath, [path.join(ROOT, 'check_examples.mjs'), path.join(EXAMPLES, 'notes.openapi.yaml'), path.join(EXAMPLES, 'notes.asyncapi.yaml')], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /notes\.openapi\.yaml: every example matches its schema \(5 checked\)/);
  assert.match(result.stdout, /notes\.asyncapi\.yaml: every example matches its schema \(1 checked\)/);
});

test('the command fails on a specification whose example does not match', () => {
  const spec = path.join(TMP, 'bad.openapi.yaml');
  writeFileSync(spec, [
    'openapi: 3.1.0',
    'info: { title: Bad, version: 1.0.0 }',
    'paths:',
    '  /x:',
    '    get:',
    '      responses:',
    "        '200':",
    '          description: ok',
    '          content:',
    '            application/json:',
    '              schema: { type: integer }',
    '              example: seven',
  ].join('\n'));
  const result = spawnSync(process.execPath, [path.join(ROOT, 'check_examples.mjs'), spec], { encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /example: \(the example\) must be integer/);
});

// npm installs the commands as symlinks on Linux and macOS; each must still run there.
for (const command of ['check_examples.mjs', 'check_refs.mjs']) {
  test(`${command} runs when started through a symlink`, (t) => {
    const link = path.join(TMP, `link-${command}`);
    try {
      symlinkSync(path.join(ROOT, command), link);
    } catch (error) {
      t.skip(`this system does not let the test create a symlink (${error.code})`);
      return;
    }
    const result = spawnSync(process.execPath, [link], { encoding: 'utf8' });
    assert.equal(result.status, 2, 'without arguments the command prints its usage and exits with 2');
    assert.match(result.stdout, /^usage: /);
  });
}
