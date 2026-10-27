import assert from 'node:assert/strict';
import { test } from 'node:test';

import { checkPage } from '../check_page.mjs';

const GOOD = [
  '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'">',
  'const __redoc_options = {"skipBundle":true,"disableTelemetry":true};',
  '<a href="https://redocly.com/redoc/"><p>API docs by</p></a>',
].join('\n');

test('a page with every property has no problems', () => {
  assert.deepEqual(checkPage(GOOD), []);
});

test('telemetry left on is a problem', () => {
  const page = GOOD.replace('"disableTelemetry":true', '"disableTelemetry":false');
  assert.deepEqual(checkPage(page), ['telemetry is not disabled in the page options']);
});

test('a missing policy is a problem', () => {
  const page = GOOD.replace('http-equiv="Content-Security-Policy"', '');
  assert.deepEqual(checkPage(page), ['the Content-Security-Policy from template.hbs is missing']);
});

test('Redoc loaded from the CDN is a problem', () => {
  const page = `${GOOD}\n<link rel="modulepreload" href="https://cdn.redocly.com/redoc/v3.0.1/bundles/redoc.standalone.js" />`;
  assert.deepEqual(checkPage(page), ['Redoc is loaded from the CDN instead of being embedded']);
});

test('a changed badge link is a problem', () => {
  const page = GOOD.replace('https://redocly.com/redoc/', 'https://redocly.com/docs/redoc/');
  assert.deepEqual(checkPage(page), [
    'the badge link changed, so the CSS rule in template.hbs no longer hides it',
  ]);
});
