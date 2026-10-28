import assert from 'node:assert/strict';
import { test } from 'node:test';

import { tidyAsyncApi, tidyOpenApi } from '../tidy.mjs';

// The converters put a no-break space after a label's colon.
const NBSP = ' ';

const SCHEMAS = [
  '<a id="scalar-schema-seatid"></a>', '', '### SeatId', '', `**Type:**${NBSP}\`string\`, pattern: \`^seat[1-9]$\``, '',
  'A seat of the car.', '',
  '<a id="scalar-schema-placement"></a>', '', '### Placement', '', `**Type:**${NBSP}\`object\``, '',
].join('\n');

test("a field typed by a named primitive schema shows the schema's type before its link", () => {
  const markdown = `- **\`seat\` (required)**: [SeatId](#scalar-schema-seatid)\n- **\`at\`**: [Placement](#scalar-schema-placement)\n\n${SCHEMAS}`;
  const tidied = tidyOpenApi(markdown);
  assert.match(tidied, /^- \*\*`seat` \(required\)\*\*: `string`, pattern: `\^seat\[1-9\]\$` \(\[SeatId\]\(#scalar-schema-seatid\)\)$/m);
  assert.match(tidied, /^- \*\*`at`\*\*: \[Placement\]\(#scalar-schema-placement\)$/m, 'an object schema stays a link');
  const array = tidyOpenApi(`- **\`seats\`**: array of [SeatId](#scalar-schema-seatid), maxItems: \`9\`\n\n${SCHEMAS}`);
  assert.match(array, /^- \*\*`seats`\*\*: array of `string`, pattern: `\^seat\[1-9\]\$` \(\[SeatId\]\(#scalar-schema-seatid\)\), maxItems: `9`$/m);
  assert.match(tidied, /^\*\*Type:\*\* `string`, pattern: `\^seat\[1-9\]\$`$/m, "the schema's own section is left as it is");
});

test("the schema's description is dropped from a field that has its own, and kept for one that has none", () => {
  const own = tidyOpenApi(`- **\`seat\`**: [SeatId](#scalar-schema-seatid)\n\n  The seat the subject sits in.\n\n  A seat of the car.\n- **\`next\`**: \`string\`\n\n${SCHEMAS}`);
  assert.match(own, /^- \*\*`seat`\*\*: .*\n\n {2}The seat the subject sits in\.\n- \*\*`next`\*\*/m);
  const only = tidyOpenApi(`- **\`seat\`**: [SeatId](#scalar-schema-seatid)\n\n  A seat of the car.\n\n${SCHEMAS}`);
  assert.match(only, /^- \*\*`seat`\*\*: .*\n\n {2}A seat of the car\.\n/m);
});

test("lines saying an operation uses the document's servers and authentication are dropped", () => {
  const markdown = [
    'Text.', '',
    `**Servers:**${NBSP}[Inherited servers](#scalar-context-global-servers)`, '',
    `**Authentication:**${NBSP}[Global authentication](#scalar-context-global-authentication)`, '',
    `**Servers:**${NBSP}[local](#scalar-server-local)`, '',
  ].join('\n');
  assert.equal(tidyOpenApi(markdown), `Text.\n\n**Servers:**${NBSP}[local](#scalar-server-local)\n`);
});

test("a request body's Required line joins its content type", () => {
  const body = (required) => `#### Request body\n\n**Required:**${NBSP}\`${required}\`\n\n**Content type:**${NBSP}\`application/json\`\n`;
  assert.equal(tidyOpenApi(body(true)), `#### Request body\n\n**Content type:**${NBSP}\`application/json\` (required)\n`);
  assert.equal(tidyOpenApi(body(false)), `#### Request body\n\n**Content type:**${NBSP}\`application/json\` (optional)\n`);
});

test('AsyncAPI messages and schemas are grouped one level down', () => {
  const markdown = [
    '# T', '', '## Servers', '', '<a id="scalar-section-events"></a>', '', '## events', '', '### Receive', '',
    '<a id="scalar-section-created"></a>', '', '## A note was created', '', '### Payload', '', '```json', '## not a heading', '```', '',
    '<a id="scalar-model-note"></a>', '', '## Schema: Note', '', 'Text.', '',
  ].join('\n');
  assert.equal(tidyAsyncApi(markdown, ['events']), [
    '# T', '', '## Servers', '', '<a id="scalar-section-events"></a>', '', '## events', '', '### Receive', '',
    '## Messages', '', '<a id="scalar-section-created"></a>', '', '### A note was created', '', '#### Payload', '', '```json', '## not a heading', '```', '',
    '## Schemas', '', '<a id="scalar-model-note"></a>', '', '### Note', '', 'Text.', '',
  ].join('\n'));
});

test('an AsyncAPI document without messages or schemas is left alone', () => {
  const markdown = '# T\n\n## events\n\n### Receive\n';
  assert.equal(tidyAsyncApi(markdown, ['events']), markdown);
});
