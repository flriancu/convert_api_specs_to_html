import assert from 'node:assert/strict';
import { test } from 'node:test';

import Ajv2020 from 'ajv/dist/2020.js';

import { linearRegExp, NeedsBacktracking } from '../linear_regexp.mjs';

test('a pattern that backtracks badly takes linear time, with the same answers', () => {
  const ajv = new Ajv2020({ code: { regExp: linearRegExp } });
  const validate = ajv.compile({ type: 'string', pattern: '^(a+)+$' });
  const started = performance.now();
  assert.equal(validate(`${'a'.repeat(100000)}!`), false);
  assert.ok(performance.now() - started < 2000, 'a backtracking engine takes seconds at 28 characters');
  assert.equal(validate('aaa'), true);
});

test('patterns are told apart, as Ajv keeps them by toString()', () => {
  const ajv = new Ajv2020({ code: { regExp: linearRegExp } });
  const validate = ajv.compile({
    type: 'object',
    properties: { a: { type: 'string', pattern: '^a$' }, b: { type: 'string', pattern: '^b$' } },
    patternProperties: { '^x-': { type: 'integer' } },
  });
  assert.equal(validate({ a: 'a', b: 'b', 'x-n': 1 }), true);
  assert.equal(validate({ a: 'b' }), false);
  assert.equal(validate({ b: 'a' }), false);
  assert.equal(validate({ 'x-n': 'one' }), false);
});

test('a pattern search is unanchored, as RegExp.test is, and case flags carry over', () => {
  assert.equal(linearRegExp('b', 'u').test('abc'), true);
  assert.equal(linearRegExp('B', 'iu').test('abc'), true);
  assert.equal(linearRegExp('B', 'u').test('abc'), false);
});

test('a pattern RE2 cannot run is refused as needing backtracking', () => {
  for (const pattern of ['(?=x)a', '(?<!x)a', String.raw`(a)\1`]) {
    assert.throws(() => linearRegExp(pattern, 'u'), NeedsBacktracking, pattern);
  }
});
