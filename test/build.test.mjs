import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { checkPage } from '../check_page.mjs';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const EXAMPLES = path.join(ROOT, 'examples');
const OUT = mkdtempSync(path.join(os.tmpdir(), 'convert-api-specs-'));

after(() => rmSync(OUT, { recursive: true, force: true }));

function run(...args) {
  return spawnSync(process.execPath, [path.join(ROOT, 'build.mjs'), ...args], { encoding: 'utf8' });
}

test('builds both examples into pages that pass every check', () => {
  const result = run(
    path.join(EXAMPLES, 'notes.openapi.yaml'),
    path.join(EXAMPLES, 'notes.asyncapi.yaml'),
    '-o',
    OUT,
  );
  assert.equal(result.status, 0, result.stderr);
  const pages = { 'notes.openapi.html': 'Notes API', 'notes.asyncapi.html': 'Notes events' };
  for (const [name, title] of Object.entries(pages)) {
    const html = readFileSync(path.join(OUT, name), 'utf8');
    assert.deepEqual(checkPage(html), [], name);
    assert.ok(html.includes(title), `${name} shows "${title}"`);
  }
});

test('does not print the Redoc 3 notice', () => {
  const result = run(path.join(EXAMPLES, 'notes.asyncapi.yaml'), '-o', OUT);
  assert.equal(result.status, 0, result.stderr);
  assert.ok(result.stderr.includes('bundled successfully'), result.stderr);
  assert.ok(!result.stderr.includes('Redoc 3'), result.stderr);
});

test('fails with exit 1 on a missing description', () => {
  const result = run(path.join(EXAMPLES, 'missing.yaml'), '-o', OUT);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /missing\.yaml: redocly build-docs exited with 1/);
});

test('prints usage and exits with 2 without descriptions', () => {
  const result = run();
  assert.equal(result.status, 2);
  assert.match(result.stdout, /^usage:/);
});
