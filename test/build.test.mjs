import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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

test('raw HTML in a description never reaches the page as HTML; the text around it does', () => {
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
  const result = run(spec, '-o', OUT);
  assert.equal(result.status, 0, result.stderr);
  const html = readFileSync(path.join(OUT, 'hostile.openapi.html'), 'utf8');
  assert.doesNotMatch(html, /<meta http-equiv|<script|<img|onerror=/);
  assert.match(html, /Before the tags\./);
  assert.match(html, /After the tags\./);
});

test('the contents links point at anchors that exist', () => {
  const html = readFileSync(path.join(OUT, 'notes.asyncapi.html'), 'utf8');
  const targets = [...html.matchAll(/href="#([^"]+)"/g)].map((m) => m[1]);
  assert.ok(targets.length > 0, 'the page has contents links');
  for (const target of targets) {
    assert.match(html, new RegExp(`<a id="${target}">`), `anchor ${target}`);
  }
});

test('fails with exit 1 on a missing description', () => {
  const result = run(path.join(EXAMPLES, 'missing.yaml'), '-o', OUT);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /missing\.yaml: redocly bundle failed/);
});

test('prints usage and exits with 2 without descriptions', () => {
  const result = run();
  assert.equal(result.status, 2);
  assert.match(result.stdout, /^usage:/);
});
