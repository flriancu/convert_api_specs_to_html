import assert from 'node:assert/strict';
import { test } from 'node:test';

import { escapeHtml, renderPage } from '../page.mjs';

const CSS = { cssHref: 'page.css' };

test('a page links its stylesheet and takes its title from the first heading', () => {
  const html = renderPage('# Notes API\n\nText.', CSS);
  assert.match(html, /<link rel="stylesheet" href="page\.css">/);
  assert.match(html, /<title>Notes API<\/title>/);
});

test('raw HTML from a description is shown as text', () => {
  const html = renderPage(
    '# T\n\n<meta http-equiv="refresh" content="0;url=http://example.invalid/">\n\n<script>alert(1)</script>\n\nInline <b onclick="x()">bold</b>.',
    CSS,
  );
  assert.doesNotMatch(html, /<meta http-equiv/);
  assert.doesNotMatch(html, /<script/);
  assert.doesNotMatch(html, /<b onclick/);
  assert.match(html, /&lt;meta http-equiv=&quot;refresh&quot;/);
});

test("the converters' anchors stay anchors", () => {
  const html = renderPage('# T\n\n<a id="scalar-operation-get-notes"></a>\n\n### Get notes', CSS);
  assert.match(html, /<a id="scalar-operation-get-notes"><\/a>/);
  assert.doesNotMatch(html, /&lt;a id/);
});

test('an anchor carrying anything more is shown as text', () => {
  const html = renderPage('# T\n\n<a id="x" href="javascript:alert(1)"></a>', CSS);
  assert.doesNotMatch(html, /<a id="x"/);
});

test('links keep only http, https, mailto and fragment targets', () => {
  const html = renderPage('# T\n\n[a](https://example.com) [b](#part) [c](javascript:alert(1)) [d](data:text/html,x)', CSS);
  assert.match(html, /<a href="https:\/\/example\.com">a<\/a>/);
  assert.match(html, /<a href="#part">b<\/a>/);
  assert.doesNotMatch(html, /javascript:|data:text/);
});

test('images become links, so the page loads nothing', () => {
  const html = renderPage('# T\n\n![diagram](https://example.com/d.png) ![x](data:image/png;base64,AAAA)', CSS);
  assert.doesNotMatch(html, /<img/);
  assert.match(html, /<a href="https:\/\/example\.com\/d\.png">diagram<\/a>/);
});

test('escapeHtml escapes the five characters', () => {
  assert.equal(escapeHtml(`<a href="x">'&'</a>`), '&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;');
});
