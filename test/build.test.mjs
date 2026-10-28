import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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

test('builds both examples into checked pages with their stylesheet', () => {
  const result = run(path.join(EXAMPLES, 'notes.openapi.yaml'), path.join(EXAMPLES, 'notes.asyncapi.yaml'), '-o', OUT);
  assert.equal(result.status, 0, result.stderr);
  assert.ok(existsSync(path.join(OUT, 'page.css')));
  const pages = { 'notes.openapi.html': 'Notes API', 'notes.asyncapi.html': 'Notes events' };
  for (const [name, title] of Object.entries(pages)) {
    const html = readFileSync(path.join(OUT, name), 'utf8');
    assert.match(html, new RegExp(`<title>${title}</title>`));
    assert.deepEqual(checkPage(html, { cssHref: 'page.css', names: [] }), [], name);
  }
});

test('raw HTML in a description never reaches the page as HTML; the text around it does, and the loss fails the build', () => {
  const spec = path.join(OUT, 'hostile.openapi.yaml');
  writeFileSync(spec, [
    'openapi: 3.1.0',
    'info:',
    '  title: Hostile',
    '  version: 1.0.0',
    '  description: |',
    '    Before the tags.',
    '',
    '    <meta http-equiv="refresh" content="0;url=http://example.invalid/">',
    '',
    '    <script>alert(1)</script> <img src="http://example.invalid/x.png" onerror="alert(2)">',
    '',
    '    After the tags.',
    'paths: {}',
    '',
  ].join('\n'));
  const out = path.join(OUT, 'hostile');
  const result = run(spec, '-o', out);
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stderr, /loses 2 of 4 paragraphs, list items and table cells .*"<meta http-equiv=.*in backticks/);
  const html = readFileSync(path.join(out, 'hostile.openapi.html'), 'utf8');
  assert.doesNotMatch(html, /<meta http-equiv|<script|<img|onerror=/);
  assert.match(html, /Before the tags\./);
  assert.match(html, /After the tags\./);
});

test('every link within a page points at an id that exists, and every id is used once', () => {
  for (const name of ['notes.openapi.html', 'notes.asyncapi.html']) {
    const html = readFileSync(path.join(OUT, name), 'utf8');
    const targets = [...html.matchAll(/href="#([^"]+)"/g)].map((m) => m[1]);
    const ids = [...html.matchAll(/ id="([^"]+)"/g)].map((m) => m[1]);
    assert.ok(targets.length > 0, `${name} has links within it`);
    assert.deepEqual(targets.filter((t) => !ids.includes(t)), [], name);
    assert.equal(new Set(ids).size, ids.length, name);
  }
});

test('every operation of the examples has its badge, and their sections balance', () => {
  for (const [name, badges] of [['notes.openapi.html', 2], ['notes.asyncapi.html', 1]]) {
    const html = readFileSync(path.join(OUT, name), 'utf8');
    assert.equal((html.match(/<li class="endpoint"><span class="method method-[a-z]+">/g) ?? []).length, badges, name);
    assert.equal((html.match(/<section /g) ?? []).length, (html.match(/<\/section>/g) ?? []).length, name);
  }
});

test('a $ref to a URL fails the build before anything is fetched', () => {
  const spec = path.join(OUT, 'remote.openapi.yaml');
  writeFileSync(spec, [
    'openapi: 3.1.0',
    'info: { title: Remote, version: 1.0.0 }',
    'paths: {}',
    'components:',
    '  schemas:',
    "    Leak: { $ref: 'http://127.0.0.1:9/latest/meta-data/' }",
    '',
  ].join('\n'));
  const result = run(spec, '-o', OUT);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /is not a relative path inside the specification's folder/);
  assert.doesNotMatch(result.stderr, /bundling/);
});

test('two specs that would write the same page are refused', () => {
  const a = path.join(OUT, 'a', 'api.yaml');
  const b = path.join(OUT, 'b', 'api.yml');
  for (const file of [a, b]) {
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, 'openapi: 3.1.0\ninfo: { title: T, version: 1.0.0 }\npaths: {}\n');
  }
  const result = run(a, b, '-o', OUT);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /api\.html/);
});

test('fails with exit 1 on a missing description', () => {
  const result = run(path.join(EXAMPLES, 'missing.yaml'), '-o', OUT);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /missing\.yaml: the description does not exist/);
});

test('prints usage and exits with 2 without descriptions', () => {
  const result = run();
  assert.equal(result.status, 2);
  assert.match(result.stdout, /^usage:/);
});

test("a page an earlier build wrote and this one does not is removed; other files are not", () => {
  const out = path.join(OUT, 'stale');
  mkdirSync(out, { recursive: true });
  writeFileSync(path.join(out, 'mine.html'), 'not the build\'s');
  assert.equal(run(path.join(EXAMPLES, 'notes.openapi.yaml'), path.join(EXAMPLES, 'notes.asyncapi.yaml'), '-o', out).status, 0);
  assert.equal(run(path.join(EXAMPLES, 'notes.openapi.yaml'), '-o', out).status, 0);
  assert.ok(existsSync(path.join(out, 'notes.openapi.html')));
  assert.ok(!existsSync(path.join(out, 'notes.asyncapi.html')), 'the page of a description no longer built is gone');
  assert.ok(existsSync(path.join(out, 'mine.html')), 'a file the build did not write stays');
});

test('-o naming a file is refused with a message, not a stack trace', () => {
  const file = path.join(OUT, 'a-file');
  writeFileSync(file, 'x');
  const result = run(path.join(EXAMPLES, 'notes.openapi.yaml'), '-o', file);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /is not a folder/);
  assert.doesNotMatch(result.stderr, /at .*build\.mjs/);
});
