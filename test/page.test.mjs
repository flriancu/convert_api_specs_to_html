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
  assert.match(html, /<section class="s3" id="scalar-operation-get-notes">\n<h3>Get notes <a class="self-mark" href="#scalar-operation-get-notes" aria-label="Link to this part">#<\/a><\/h3>/);
  assert.doesNotMatch(html, /<a id="scalar-operation-get-notes">/);
  assert.doesNotMatch(html, /&lt;a id/);
});

test('each heading from level 2 down opens a section that closes before the next one of its level or above', () => {
  const html = renderPage('# T\n\n## A\n\n### A1\n\n#### A1a\n\n### A2\n\n## B\n\nText.', CSS);
  const main = html.split('<main>\n')[1].split('\n</main>')[0].replace(/ <a class="self-mark"[^>]*>#<\/a>/g, '');
  const shape = main.match(/<section class="s\d"|<\/section>|<h\d>[^<]*/g).join(' ');
  assert.equal(
    shape,
    '<section class="s2" <h2>A <section class="s3" <h3>A1 <section class="s4" <h4>A1a </section> </section> ' +
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

test("the converters' lists of facts are marked wherever they are; other lists are not", () => {
  const html = renderPage(
    '# T\n\n### Message\n\nSent first.\n\n- **name:** `events.reset`\n- **contentType:** `application/json`\n\nNotes.\n\n' +
      '- **Commands are HTTP.** Facts are events.\n- **`seat`**: `string`\n\nServers.\n\n- **URL:** `http://x`\n  - **Description:** nested\n',
    CSS,
  );
  assert.match(html, /<ul class="facts">\n<li><strong>name:<\/strong> <code>events\.reset<\/code><\/li>\n<li><strong>contentType:<\/strong>/, 'after a paragraph too');
  assert.match(html, /<ul>\n<li><strong>Commands are HTTP\.<\/strong>/, 'a sentence in bold, or a field, is no fact');
  assert.match(html, /<ul>\n<li><strong>URL:<\/strong> <code>http:\/\/x<\/code><ul class="facts">/, 'an item with a list in it is no fact; the list in it may be');
  const endpoint = renderPage('# T\n\n### Get notes\n\n- **Method:** `GET`\n- **Path:** `/notes`\n- **Operation ID:** `listNotes`', CSS);
  assert.match(endpoint, /<ul class="facts">\n<li class="endpoint">/, "an operation's facts lead with its badge");
});

test('examples fold behind their label; other bold paragraphs and code blocks do not', () => {
  const html = renderPage('# T\n\n**Generated payload example:**\n\n```json\n{"a": 1}\n```\n\n**Note:**\n\n```\nplain\n```', CSS);
  assert.match(html, /<details class="example">\n<summary>Generated payload example \(shape only; its values are placeholders\)<\/summary>\n<pre><code class="language-json">/);
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
  assert.deepEqual(structure(tokens).blocks.map((t) => t.type), ['heading', 'paragraph']);
});

test('the title and introduction open the page, the parts follow in main', () => {
  const html = renderPage('# T\n\nIntro.\n\n## A\n\nText.', CSS);
  assert.match(html, /<header>\n<h1>T<\/h1>\n<p>Intro\.<\/p>\n\n<\/header>\n<main>\n<section class="s2" id="a">/);
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

test('a named example folds behind its description; so does one inside a list item', () => {
  const named = renderPage('# T\n\n**Example: version**\n\nA client written against `another` minor\n\n```json\n{}\n```', CSS);
  assert.match(named, /<details class="example">\n<summary>Example: A client written against another minor<\/summary>\n<pre>/);
  const listed = renderPage('# T\n\n- **`time`**: `string`\n\n  Wall-clock time.\n\n  **Example:**\n\n  ```json\n  "2026-10-27T14:05:09Z"\n  ```\n', CSS);
  assert.match(listed, /<li>[\s\S]*<details class="example">\n<summary>Example<\/summary>\n<pre>[\s\S]*<\/details>\n<\/li>/);
  const headed = renderPage('# T\n\n#### Payload\n\n##### restarted\n\n**payload:**\n\n```json\n{}\n```\n\n##### Next', CSS);
  assert.match(headed, /<details class="example">\n<summary>Example: restarted<\/summary>\n<pre>/, "a heading naming an AsyncAPI message's example folds with it");
  assert.doesNotMatch(headed, /<h5>restarted/);
  assert.match(headed, /<h5>Next/);
  const plain = renderPage('# T\n\n**Note**\n\nText.\n\n```\nx\n```', CSS);
  assert.doesNotMatch(plain, /<details/, 'a bold paragraph that is no example label stays as it is');
});

test('every heading gets an id from its parent and its own text, the same when other parts are added', () => {
  const part = '<a id="op"></a>\n\n### Get notes\n\n#### Responses\n\n##### 200 OK\n\n#### Responses';
  const html = renderPage(`# T\n\n## Contract notes\n\n${part}`, CSS);
  for (const id of ['contract-notes', 'op', 'op--responses', 'op--responses--200', 'op--responses-2']) {
    assert.match(html, new RegExp(`<section class="s\\d[^"]*" id="${id}">`), id);
  }
  const more = renderPage(`# T\n\n## Versioning\n\n<a id="other"></a>\n\n### Other\n\n#### Responses\n\n## Contract notes\n\n${part}`, CSS);
  assert.match(more, /<section class="s5 response-success" id="op--responses--200">/, 'adding parts elsewhere keeps the id');
});

test('each field of a list gets an id from its part and its name, nested fields from their parent, with a "#"', () => {
  const html = renderPage('# T\n\n<a id="s"></a>\n\n### Schema\n\n- **`payload` (required)**: `object`\n  - **`reason`**: `string`\n- **`Session-Api-Version`**: `string`\n- **Note:** prose', CSS);
  assert.match(html, /<li id="s--payload"><strong><code>payload<\/code> \(required\)<\/strong>: <code>object<\/code> <a class="self-mark" href="#s--payload" aria-label="Link to this part">#<\/a>/);
  assert.match(html, /<li id="s--payload--reason">/);
  assert.match(html, /<li id="s--session-api-version">/);
  assert.match(html, /<li><strong>Note:<\/strong> prose<\/li>/, 'a bold label without code names no field');
  const twice = renderPage('# T\n\n<a id="s"></a>\n\n### Schema\n\n- **`a`**: x\n\n<a id="s--a"></a>\n\n#### A', CSS);
  assert.match(twice, /<li id="s--a-2">/, "a field's id never takes one an anchor already has");
});

test("a response's part says whether its status is a success or an error", () => {
  const html = renderPage('# T\n\n### Op\n\n#### Responses\n\n##### 200 OK\n\n##### 302 Found\n\n##### 404 Missing\n\n##### default Anything', CSS);
  assert.match(html, /<section class="s5 response-success" id="op--responses--200">/);
  assert.match(html, /<section class="s5 response-other" id="op--responses--302">/);
  assert.match(html, /<section class="s5 response-error" id="op--responses--404">/);
  assert.match(html, /<section class="s5" id="op--responses--default">/);
  assert.match(renderPage('# T\n\n## 200 reasons', CSS), /<section class="s2" id="200">/, 'only a part of an operation is a response');
});

const OPENAPI = [
  '# T', '', 'Intro.', '',
  '## Contents', '', '- [GET /notes](#get-notes)', '',
  '## Tags', '', '<a id="tag-notes"></a>', '', '### notes', '', 'Notes.', '',
  '## Operations', '',
  '<a id="get-notes"></a>', '', '### List notes', '', '- **Method:** `GET`', '- **Path:** `/notes`', '- **Tags:** notes', '',
  '<a id="get-version"></a>', '', '### Version', '', '- **Method:** `GET`', '- **Path:** `/version`', '',
  '## Schemas', '', ...Array.from({ length: 13 }, (_, i) => `### Schema${i}\n`),
].join('\n');

test("the contents replace the converters' list: parts, operations under their tags, long parts folded", () => {
  const html = renderPage(OPENAPI, CSS);
  const contents = html.split('<nav class="contents" aria-label="Contents">')[1].split('</nav>')[0];
  assert.ok(html.indexOf('<nav class="contents"') < html.indexOf('<header>'), 'the contents come first');
  assert.doesNotMatch(html, /<h2>Contents/);
  assert.match(contents, /<li><a href="#operations">Operations<\/a>\n<ul>\n<li class="group"><a href="#tag-notes">notes<\/a>\n<ul>\n<li><a href="#get-notes"><span class="method method-get">GET<\/span> List notes<\/a><\/li>/);
  assert.match(contents, /<li><a href="#get-version"><span class="method method-get">GET<\/span> Version<\/a><\/li>\n<\/ul>/, 'an operation without a tag follows the groups');
  assert.doesNotMatch(contents, /href="#tags"/, "the tags part is left out: its tags lead the groups");
  assert.match(contents, /<li><a href="#schemas">Schemas<\/a>\n<details>\n<summary>13 entries<\/summary>\n<ul>\n<li><a href="#schemas--schema0">Schema0<\/a><\/li>/);
  assert.equal((contents.match(/>Schemas</g) ?? []).length, 1, "a folded part's name is shown once");
});

test("the introduction the AsyncAPI converter writes after its contents list stays, in the header", () => {
  const asyncapi = [
    '# Events', '', '## Contents', '', '- [Servers](#servers)', '', '**Messages**', '', '- [reset](#reset)', '',
    '* **version:** `1.0.0`', '', 'Facts the service publishes.', '', '**Connecting.** Add `apiVersion`.', '',
    '| Code | Meaning |', '| ---- | ------- |', '| 4408 | Behind |', '',
    '<a id="servers"></a>', '', '## Servers', '', 'Local.',
  ].join('\n');
  const html = renderPage(asyncapi, CSS);
  const header = html.split('<header>\n')[1].split('</header>')[0];
  assert.doesNotMatch(html, /href="#reset"|<p><strong>Messages<\/strong><\/p>/, "the converter's list and its group labels are left out");
  for (const kept of ['<code>1.0.0</code>', '<p>Facts the service publishes.</p>', '<strong>Connecting.</strong>', '<td>4408</td>']) {
    assert.ok(header.includes(kept), `the header keeps ${kept}`);
  }
});

test('each tag lists its operations, with their badges and paths', () => {
  const html = renderPage(OPENAPI, CSS);
  assert.match(html, /<p>Notes\.<\/p>\n<ul class="operations">\n<li><a href="#get-notes"><span class="method method-get">GET<\/span> <code>\/notes<\/code> List notes<\/a><\/li>\n<\/ul>\n<\/section>/);
});

test('a page without parts has no contents', () => {
  assert.doesNotMatch(renderPage('# T\n\nText.', CSS), /<nav/);
});
