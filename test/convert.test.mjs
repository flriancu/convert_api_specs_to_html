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

test('both converters show every expected name', async () => {
  for (const doc of [OPENAPI, ASYNCAPI]) {
    const markdown = await toMarkdown(doc);
    for (const name of expectedNames(doc)) {
      assert.ok(markdown.includes(name), `${kindOf(doc)} markdown shows ${name}`);
    }
  }
});
