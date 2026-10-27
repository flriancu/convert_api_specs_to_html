#!/usr/bin/env node
/**
 * Render OpenAPI and AsyncAPI descriptions as script-free HTML pages.
 *
 * Each description becomes <name>.html, with its styles in page.css beside it:
 *
 * - Redocly CLI bundles the description into one document, resolving $refs to other files
 *   (redocly.mjs), with its telemetry off;
 * - Scalar's converters write it as Markdown, OpenAPI and AsyncAPI alike (convert.mjs);
 * - the Markdown becomes a page with no scripts, no inline styles and no data: URLs, raw HTML
 *   from the description shown as text (page.mjs), so it reads where a strict
 *   Content-Security-Policy is applied, such as Jenkins' archived artifacts;
 * - the page is checked for those properties and for completeness: every operation, channel,
 *   message and schema of the description is shown (check_page.mjs). A failed check exits 1.
 *
 * Usage (installed as a dependency, the command is convert-api-specs-to-html):
 *   node build.mjs <spec>... [-o <dir>]
 *
 *   node build.mjs api.openapi.yaml events.asyncapi.yaml -o out
 */
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { checkPage } from './check_page.mjs';
import { expectedNames, toMarkdown } from './convert.mjs';
import { renderPage } from './page.mjs';
import { redoclyCli, runRedocly } from './redocly.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const STYLESHEET = path.join(HERE, 'page.css');
const STYLESHEET_NAME = 'page.css';

const USAGE = 'usage: convert-api-specs-to-html <spec>... [-o <dir>]';

function parseArgs(argv) {
  const args = { specs: [], outDir: 'out' };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '-o' || arg === '--output') {
      i += 1;
      args.outDir = argv[i];
    } else if (arg === '-h' || arg === '--help') {
      args.help = true;
    } else {
      args.specs.push(arg);
    }
  }
  return args;
}

/** The spec as one JSON document with its $refs to other files resolved; null if Redocly fails. */
function bundle(cli, spec) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'convert-api-specs-'));
  let doc = null;
  try {
    const file = path.join(dir, 'bundle.json');
    const result = runRedocly(cli, ['bundle', spec, '-o', file, '--ext', 'json']);
    process.stderr.write(result.stderr ?? '');
    if (result.status === 0) {
      doc = JSON.parse(readFileSync(file, 'utf8'));
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  return doc;
}

async function build(cli, spec, outDir) {
  const doc = bundle(cli, spec);
  let problems = [];
  if (doc === null) {
    problems = ['redocly bundle failed'];
  } else {
    const html = renderPage(await toMarkdown(doc), { cssHref: STYLESHEET_NAME });
    const outFile = path.join(outDir, `${path.basename(spec, path.extname(spec))}.html`);
    writeFileSync(outFile, html);
    problems = checkPage(html, { cssHref: STYLESHEET_NAME, names: expectedNames(doc) });
  }
  return problems;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const cli = redoclyCli();
  let exitCode = 0;

  if (args.help || args.specs.length === 0 || !args.outDir) {
    console.log(USAGE);
    exitCode = args.help ? 0 : 2;
  } else if (cli === null) {
    console.error('Redocly CLI is not installed; run "npm ci" in this package or in the project using it');
    exitCode = 2;
  } else {
    mkdirSync(args.outDir, { recursive: true });
    copyFileSync(STYLESHEET, path.join(args.outDir, STYLESHEET_NAME));
    const failed = [];
    for (const spec of args.specs) {
      const problems = await build(cli, spec, args.outDir);
      for (const problem of problems) {
        console.error(`${spec}: ${problem}`);
      }
      if (problems.length > 0) {
        failed.push(spec);
      }
    }
    if (failed.length > 0) {
      console.error(`failed: ${failed.join(', ')}`);
      exitCode = 1;
    }
  }
  process.exitCode = exitCode;
}

await main();
