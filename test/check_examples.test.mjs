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
  assert.deepEqual(checkExamples(doc).problems, ['#/components/messages/bad/examples/0/payload: /seq must be >= 1']);
});

test('the command checks the examples of the example specifications', () => {
  const result = spawnSync(process.execPath, [path.join(ROOT, 'check_examples.mjs'), path.join(EXAMPLES, 'notes.openapi.yaml'), path.join(EXAMPLES, 'notes.asyncapi.yaml')], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /notes\.openapi\.yaml: every example matches its schema \(4 checked\)/);
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
