import assert from 'node:assert/strict';
import { test } from 'node:test';

import { expectedNames, kindOf, toMarkdown } from '../convert.mjs';

const OPENAPI = {
  openapi: '3.1.0',
  info: { title: 'Notes API', version: '1.0.0' },
  paths: {
    '/notes': {
      get: { operationId: 'listNotes', responses: { 200: { description: 'Notes.' } } },
      post: { responses: { 201: { description: 'Created.' } } },
    },
  },
  components: { schemas: { Note: { type: 'object' } } },
};

const ASYNCAPI = {
  asyncapi: '3.0.0',
  info: { title: 'Notes events', version: '1.0.0' },
  channels: { events: { address: '/events', messages: { created: { $ref: '#/components/messages/noteCreated' } } } },
  operations: { receiveCreated: { action: 'receive', channel: { $ref: '#/channels/events' }, summary: 'Receive each note.' } },
  components: {
    messages: { noteCreated: { name: 'note.created', payload: { $ref: '#/components/schemas/Note' } } },
    schemas: { Note: { type: 'object' } },
  },
};

test('kindOf tells the formats apart and refuses anything else', () => {
  assert.equal(kindOf(OPENAPI), 'openapi');
  assert.equal(kindOf(ASYNCAPI), 'asyncapi');
  assert.throws(() => kindOf({ swagger: '2.0' }), /not an OpenAPI or AsyncAPI document/);
});

test('OpenAPI names: operation ids, else method and path, and schemas', () => {
  assert.deepEqual(expectedNames(OPENAPI), ['listNotes', 'POST /notes', 'Note']);
});

test('AsyncAPI names: channels, operations by summary, messages by name, schemas', () => {
  assert.deepEqual(expectedNames(ASYNCAPI), ['events', 'Receive each note.', 'note.created', 'Note']);
});

test('the page shows the OpenAPI version the description declares, not the upgraded one', async () => {
  const markdown = await toMarkdown(OPENAPI);
  assert.match(markdown, /OpenAPI Version:\*\*\s+`3\.1\.0`/);
  assert.doesNotMatch(markdown, /OpenAPI Version:\*\*\s+`3\.2/);
});

test("the converters' Markdown comes out tidied (tidy.mjs): a converter that writes it differently fails here", async () => {
  const openapi = await toMarkdown({
    ...OPENAPI,
    servers: [{ url: 'http://localhost:8080' }],
    paths: {
      '/notes/{id}': {
        put: {
          parameters: [{ name: 'id', in: 'path', required: true, description: 'Which note.', schema: { $ref: '#/components/schemas/NoteId' } }],
          requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/Note' } } } },
          responses: { 204: { description: 'Stored.' } },
        },
      },
    },
    components: { schemas: { Note: { type: 'object' }, NoteId: { type: 'string', pattern: '^n-[0-9]+$', description: 'A note id.' } } },
  });
  assert.match(openapi, /- \*\*`id` \(required\)\*\*: `string`, pattern: `\^n-\[0-9\]\+\$` \(\[NoteId\]\(#scalar-schema-noteid\)\)\n\n {2}Which note\.\n/);
  assert.doesNotMatch(openapi, /^ {2}A note id\.$/m);
  assert.doesNotMatch(openapi, /Inherited servers|Global authentication|\*\*Required:\*\*/);
  assert.match(openapi, /\*\*Content type:\*\*\s+`application\/json` \(required\)/);
  const asyncapi = await toMarkdown(ASYNCAPI);
  assert.match(asyncapi, /^## Messages\n\n(<a id="[^"]+"><\/a>\n\n)?### note\.created$/m);
  assert.match(asyncapi, /^## Schemas\n\n(<a id="[^"]+"><\/a>\n\n)?### Note$/m);
});

test('both converters show every expected name', async () => {
  for (const doc of [OPENAPI, ASYNCAPI]) {
    const markdown = await toMarkdown(doc);
    for (const name of expectedNames(doc)) {
      assert.ok(markdown.includes(name), `${kindOf(doc)} markdown shows ${name}`);
    }
  }
});
