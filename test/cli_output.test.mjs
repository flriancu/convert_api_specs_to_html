import assert from 'node:assert/strict';
import { test } from 'node:test';

import { withoutRedoc3Notice } from '../cli_output.mjs';

const YELLOW = '\x1b[33m';
const RESET = '\x1b[39m';

function box(...lines) {
  return [
    `    ${YELLOW}╔══╗${RESET}`,
    ...lines.map((line) => `    ${YELLOW}║${RESET}  ${line}`),
    `    ${YELLOW}╚══╝${RESET}`,
  ];
}

test('drops the Redoc 3 notice and the blank line on each side', () => {
  const text = [
    '',
    ...box('build-docs now renders docs with Redoc 3.', 'Learn more: https://redocly.com/redoc-ce'),
    '',
    'Prerendering docs',
    'bundled successfully',
  ].join('\n');
  assert.equal(withoutRedoc3Notice(text), 'Prerendering docs\nbundled successfully');
});

test('keeps other boxes', () => {
  const text = ['before', ...box('A new version of Redocly CLI is available.'), 'after'].join('\n');
  assert.equal(withoutRedoc3Notice(text), text);
});

test('keeps text without boxes unchanged', () => {
  const text = 'Found redocly.yaml\nPrerendering docs\n';
  assert.equal(withoutRedoc3Notice(text), text);
});

test('keeps an unterminated box', () => {
  const text = [`${YELLOW}╔═╗${RESET}`, 'build-docs now renders docs with Redoc 3.'].join('\n');
  assert.equal(withoutRedoc3Notice(text), text);
});
