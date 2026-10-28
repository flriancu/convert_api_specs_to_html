import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';

import { checkRefs, referencesIn } from '../check_refs.mjs';

const ROOT = mkdtempSync(path.join(os.tmpdir(), 'check-refs-'));
after(() => rmSync(ROOT, { recursive: true, force: true }));

function spec(name, text) {
  const file = path.join(ROOT, name);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, text);
  return file;
}

const values = (text) => referencesIn(text).refs.map((r) => r.value);

test('references are read from block, flow and JSON styles, quoted or not', () => {
  const text = [
    'a:',
    "  $ref: './schemas.yaml#/$defs/A'",
    'b: { $ref: "#/components/schemas/B" }',
    'c: { $ref: other.yaml }',
    '"d": { "$ref": "http://example.invalid/x.yaml" }',
    'e: { externalValue: ./example.json }',
  ].join('\n');
  assert.deepEqual(values(text), ['./schemas.yaml#/$defs/A', '#/components/schemas/B', 'other.yaml', 'http://example.invalid/x.yaml', './example.json']);
});

test('a key spelled with escapes is the key it decodes to', () => {
  for (const key of ['"\\u0024ref"', '"\\x24ref"', '"$r\\x65f"']) {
    assert.deepEqual(values(`x: { ${key}: "http://example.invalid/a" }`), ['http://example.invalid/a'], key);
  }
  assert.deepEqual(values('{ "x": { "\\u0024ref": "http://example.invalid/a" } }'), ['http://example.invalid/a'], 'JSON');
});

test('what loaders read differently is refused, not guessed', () => {
  const alias = referencesIn("k: &k $ref\nx: { *k : 'http://example.invalid/a' }\n");
  assert.match(alias.problems.join(), /alias as a key/);
  const merge = referencesIn("x: { <<: { $ref: 'http://example.invalid/a' } }\n");
  assert.match(merge.problems.join(), /merge key/);
  const twice = referencesIn("x: { $ref: '#/a', $ref: 'http://example.invalid/a' }\n");
  assert.match(twice.problems.join(), /not YAML this check can read/);
  assert.match(referencesIn('x: { $ref: [a] }\n').problems.join(), /not a string/);
});

test('local pointers and files inside the folder are fine, followed through every file', () => {
  spec('good/api.yaml', "x: { $ref: '#/y' }\nz: { $ref: './parts/types.yaml#/T' }\nw: { externalValue: ./parts/example.json }\n");
  spec('good/parts/types.yaml', "T: { $ref: './more.yaml#/U' }\n");
  spec('good/parts/more.yaml', 'U: { type: string }\n');
  spec('good/parts/example.json', '{ "a": 1 }\n');
  assert.deepEqual(checkRefs(path.join(ROOT, 'good/api.yaml')), []);
});

test('a URL is refused, before anything fetches it, also as an externalValue or escaped', () => {
  const file = spec(
    'remote/api.yaml',
    "x: { $ref: 'http://169.254.169.254/latest/meta-data/' }\ny: { $ref: '//host/x.yaml' }\nz: { externalValue: 'https://example.invalid/e.json' }\nw: { \"\\u0024ref\": 'http://example.invalid/a' }\n",
  );
  assert.deepEqual(checkRefs(file), [
    'api.yaml: $ref "http://169.254.169.254/latest/meta-data/" is not a relative path inside the specification\'s folder',
    'api.yaml: $ref "//host/x.yaml" is not a relative path inside the specification\'s folder',
    'api.yaml: externalValue "https://example.invalid/e.json" is not a relative path inside the specification\'s folder',
    'api.yaml: $ref "http://example.invalid/a" is not a relative path inside the specification\'s folder',
  ]);
});

test('a path out of the folder is refused, also when reached through another file', () => {
  spec('secret.yaml', 'S: { type: string }\n');
  spec('out/api.yaml', "x: { $ref: './inner.yaml#/I' }\ny: { externalValue: '../secret.yaml' }\n");
  spec('out/inner.yaml', "I: { $ref: '../secret.yaml#/S' }\n");
  assert.deepEqual(checkRefs(path.join(ROOT, 'out/api.yaml')), [
    'api.yaml: externalValue "../secret.yaml" points outside the specification\'s folder',
    'inner.yaml: $ref "../secret.yaml#/S" points outside the specification\'s folder',
  ]);
});

test('a link inside the folder that leads out of it is refused', () => {
  spec('elsewhere/secret.yaml', 'S: { type: string }\n');
  spec('linked/api.yaml', "x: { $ref: './door/secret.yaml#/S' }\n");
  symlinkSync(path.join(ROOT, 'elsewhere'), path.join(ROOT, 'linked', 'door'), 'junction');
  assert.deepEqual(checkRefs(path.join(ROOT, 'linked/api.yaml')), [
    'api.yaml: $ref "./door/secret.yaml#/S" leads outside the specification\'s folder through a link',
  ]);
});

test('names are compared with their case, as on Linux, and written with /', () => {
  spec('cased/sub/schemas.yaml', 'X: { type: string }\n');
  const file = spec('cased/api.yaml', "a: { $ref: './SUB/Schemas.yaml#/X' }\nb: { $ref: './sub\\schemas.yaml#/X' }\nc: { $ref: './sub/schemas.yaml#/X' }\n");
  assert.deepEqual(checkRefs(file), [
    'api.yaml: $ref "./SUB/Schemas.yaml#/X" points to a file that does not exist (names are compared with their case)',
    'api.yaml: $ref "./sub\\schemas.yaml#/X" has a backslash: references are URI references, written with /',
  ]);
});

test('an absolute path, a missing file and a directory as the description are refused', () => {
  const file = spec('abs/api.yaml', "x: { $ref: 'C:/Windows/win.ini' }\ny: { $ref: './nope.yaml' }\n");
  const problems = checkRefs(file);
  assert.equal(problems.length, 2);
  assert.match(problems[0], /is not a relative path inside/);
  assert.match(problems[1], /points to a file that does not exist/);
  assert.deepEqual(checkRefs(path.join(ROOT, 'abs')), ['the description is not a file']);
  assert.deepEqual(checkRefs(path.join(ROOT, 'none.yaml')), ['the description does not exist']);
});

test('a cycle of files terminates', () => {
  spec('cycle/a.yaml', "x: { $ref: './b.yaml' }\n");
  spec('cycle/b.yaml', "y: { $ref: './a.yaml' }\n");
  assert.deepEqual(checkRefs(path.join(ROOT, 'cycle/a.yaml')), []);
});
