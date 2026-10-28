import assert from 'node:assert/strict';
import { test } from 'node:test';

import { checkPage } from '../check_page.mjs';

const OPTIONS = { cssHref: 'page.css', names: ['listNotes', 'Note'] };

test('a name counts only as a whole token, not inside a longer word', () => {
  const page = GOOD.replace('<p>Note</p>', '');
  assert.deepEqual(checkPage(page, { ...OPTIONS, names: ['Note'] }), [
    'does not show 1 of 1 names from the specification: Note',
  ]);
});
const GOOD = '<html><head><link rel="stylesheet" href="page.css"></head><body><h3>listNotes</h3><p>Note</p></body></html>';

test('a good page has no problems', () => {
  assert.deepEqual(checkPage(GOOD, OPTIONS), []);
});

const BAD = {
  'a script': ['<script>x</script>', 'contains a <script> element'],
  'a refresh': ['<meta http-equiv="refresh" content="0">', 'contains a <meta http-equiv> element'],
  'a style element': ['<style>p{}</style>', 'contains a <style> element'],
  'a style attribute': ['<p style="color:red">', 'contains a style attribute'],
  'an event handler': ['<p onclick="x()">', 'contains an event-handler attribute'],
  'a javascript: link': ['<a href="javascript:x()">', 'contains a data:, javascript: or vbscript: URL'],
  'a form': ['<form action="/x"></form>', 'contains an <iframe>, <object>, <embed>, <form> or <base> element'],
  'an image': ['<img src="/x.png">', 'loads a resource (src attribute)'],
};

for (const [name, [fragment, problem]] of Object.entries(BAD)) {
  test(`${name} is a problem`, () => {
    const page = GOOD.replace('<p>Note</p>', `<p>Note</p>${fragment}`);
    assert.deepEqual(checkPage(page, OPTIONS), [problem]);
  });
}

test('prose that mentions what a tag must not carry is no problem', () => {
  const prose = '<p>Never <code>style=&quot;x&quot;</code>, nor onclick= or src= in a page; a data: URL neither.</p>';
  assert.deepEqual(checkPage(GOOD.replace('<p>Note</p>', `<p>Note</p>${prose}`), OPTIONS), []);
});

test('a missing stylesheet link is a problem', () => {
  const page = GOOD.replace('<link rel="stylesheet" href="page.css">', '');
  assert.deepEqual(checkPage(page, OPTIONS), ['does not link its stylesheet page.css']);
});

test('a page whose operations lack their badges is a problem', () => {
  const page = GOOD.replace('</body>', '<span class="method method-get">GET</span></body>');
  assert.deepEqual(checkPage(page, { ...OPTIONS, operations: 1 }), []);
  assert.deepEqual(checkPage(page, { ...OPTIONS, operations: 2 }), ['shows 1 operation badges for the specification\'s 2 operations']);
});

test('a name from the specification that the page does not show is a problem', () => {
  const page = GOOD.replace('<p>Note</p>', '');
  assert.deepEqual(checkPage(page, OPTIONS), ['does not show 1 of 2 names from the specification: Note']);
});

test('names are compared with the escapes decoded', () => {
  const page = GOOD.replace('<p>Note</p>', '<p>Note</p><p>GET /a&lt;b&gt;</p>');
  assert.deepEqual(checkPage(page, { ...OPTIONS, names: ['GET /a<b>'] }), []);
});
