import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';

import { checkRefs, refsIn } from '../check_refs.mjs';

const ROOT = mkdtempSync(path.join(os.tmpdir(), 'check-refs-'));
after(() => rmSync(ROOT, { recursive: true, force: true }));

function spec(name, text) {
  const file = path.join(ROOT, name);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, text);
  return file;
}

test('refsIn reads block, flow and JSON styles, quoted or not', () => {
  const text = [
    'a:',
    "  $ref: './schemas.yaml#/$defs/A'",
    'b: { $ref: "#/components/schemas/B" }',
    'c: { $ref: other.yaml }',
    '"d": { "$ref": "http://example.invalid/x.yaml" }',
  ].join('\n');
  assert.deepEqual(refsIn(text), ['./schemas.yaml#/$defs/A', '#/components/schemas/B', 'other.yaml', 'http://example.invalid/x.yaml']);
});

test('local pointers and files inside the folder are fine, followed through every file', () => {
  spec('good/api.yaml', "x: { $ref: '#/y' }\nz: { $ref: './parts/types.yaml#/T' }\n");
  spec('good/parts/types.yaml', "T: { $ref: './more.yaml#/U' }\n");
  spec('good/parts/more.yaml', 'U: { type: string }\n');
  assert.deepEqual(checkRefs(path.join(ROOT, 'good/api.yaml')), []);
});

test('a URL is refused, before anything fetches it', () => {
  const file = spec('remote/api.yaml', "x: { $ref: 'http://169.254.169.254/latest/meta-data/' }\ny: { $ref: '//host/x.yaml' }\n");
  assert.deepEqual(checkRefs(file), [
    'api.yaml: $ref "http://169.254.169.254/latest/meta-data/" is not a relative path inside the specification\'s folder',
    'api.yaml: $ref "//host/x.yaml" is not a relative path inside the specification\'s folder',
  ]);
});

test('a path out of the folder is refused, also when reached through another file', () => {
  spec('secret.yaml', 'S: { type: string }\n');
  spec('out/api.yaml', "x: { $ref: './inner.yaml#/I' }\n");
  spec('out/inner.yaml', "I: { $ref: '../secret.yaml#/S' }\n");
  assert.deepEqual(checkRefs(path.join(ROOT, 'out/api.yaml')), [
    'inner.yaml: $ref "../secret.yaml#/S" points outside the specification\'s folder',
  ]);
});

test('an absolute path and a missing file are refused', () => {
  const file = spec('abs/api.yaml', "x: { $ref: 'C:/Windows/win.ini' }\ny: { $ref: './nope.yaml' }\n");
  const problems = checkRefs(file);
  assert.equal(problems.length, 2);
  assert.match(problems[0], /is not a relative path inside/);
  assert.match(problems[1], /points to a file that does not exist/);
});

test('a cycle of files terminates', () => {
  spec('cycle/a.yaml', "x: { $ref: './b.yaml' }\n");
  spec('cycle/b.yaml', "y: { $ref: './a.yaml' }\n");
  assert.deepEqual(checkRefs(path.join(ROOT, 'cycle/a.yaml')), []);
});
