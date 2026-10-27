import assert from 'node:assert/strict';
import { test } from 'node:test';

import { escapeHtml, renderPage, structure } from '../page.mjs';

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

test("the converters' anchors stay anchors; one before a heading becomes its section's id", () => {
  const html = renderPage('# T\n\n<a id="scalar-example-1"></a>\n\nText.\n\n<a id="scalar-operation-get-notes"></a>\n\n### Get notes', CSS);
  assert.match(html, /<a id="scalar-example-1"><\/a>/);
  assert.match(html, /<section class="s3" id="scalar-operation-get-notes">\n<h3>Get notes<\/h3>/);
  assert.doesNotMatch(html, /<a id="scalar-operation-get-notes">/);
  assert.doesNotMatch(html, /&lt;a id/);
});

test('each heading from level 2 down opens a section that closes before the next one of its level or above', () => {
  const html = renderPage('# T\n\n## A\n\n### A1\n\n#### A1a\n\n### A2\n\n## B\n\nText.', CSS);
  const main = html.split('<main>\n')[1].split('\n</main>')[0];
  const shape = main.match(/<section class="s\d"|<\/section>|<h\d>[^<]*/g).join(' ');
  assert.equal(
    shape,
    '<h1>T <section class="s2" <h2>A <section class="s3" <h3>A1 <section class="s4" <h4>A1a </section> </section> ' +
      '<section class="s3" <h3>A2 </section> </section> <section class="s2" <h2>B </section>',
  );
});

test("an operation's method and path become a badge; an AsyncAPI action too", () => {
  const openapi = renderPage('# T\n\n### Get notes\n\n- **Method:** `DELETE`\n- **Path:** `/notes/{id}`\n- **Operation ID:** `deleteNote`', CSS);
  assert.match(openapi, /<li class="endpoint"><span class="method method-delete">DELETE<\/span> <code>\/notes\/\{id\}<\/code><\/li>/);
  assert.match(openapi, /<li><strong>Operation ID:<\/strong> <code>deleteNote<\/code><\/li>/);
  assert.doesNotMatch(openapi, /Method:|Path:/);
  const asyncapi = renderPage('# T\n\n### Receive notes.\n\n- **action:** `receive`', CSS);
  assert.match(asyncapi, /<span class="method method-receive">RECEIVE<\/span>/);
  const plain = renderPage('# T\n\n- **Method:** `GET`\n- **Other:** `x`', CSS);
  assert.doesNotMatch(plain, /class="method/, 'a method without a path is not an operation');
});

test('examples fold behind their label; other bold paragraphs and code blocks do not', () => {
  const html = renderPage('# T\n\n**Generated payload example:**\n\n```json\n{"a": 1}\n```\n\n**Note:**\n\n```\nplain\n```', CSS);
  assert.match(html, /<details class="example">\n<summary>Generated payload example<\/summary>\n<pre><code class="language-json">/);
  assert.equal((html.match(/<details/g) ?? []).length, 1);
  assert.match(html, /<p><strong>Note:<\/strong><\/p>/);
  const payload = renderPage('# T\n\n**payload:**\n\n```json\n{}\n```', CSS);
  assert.match(payload, /<summary>Example payload<\/summary>/, 'a label alone says what it labels');
});

test('the page body names its kind, for the stylesheet', () => {
  assert.match(renderPage('# T', { ...CSS, kind: 'asyncapi' }), /<body class="asyncapi">/);
  assert.match(renderPage('# T', CSS), /<body>/);
});

test('structure leaves level-1 headings and non-heading blocks alone', () => {
  const tokens = [{ type: 'heading', depth: 1, text: 'T' }, { type: 'paragraph', tokens: [] }];
  assert.deepEqual(structure(tokens).map((t) => t.type), ['heading', 'paragraph']);
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
