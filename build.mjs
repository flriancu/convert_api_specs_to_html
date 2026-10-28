#!/usr/bin/env node
/**
 * Render OpenAPI and AsyncAPI descriptions as script-free HTML pages.
 *
 * Each description becomes <name>.html, with its styles in page.css beside it:
 *
 * - its $refs are checked to stay inside its folder, so nothing is fetched or read from
 *   elsewhere (check_refs.mjs);
 * - Redocly CLI bundles the description into one document, resolving $refs to other files
 *   (redocly.mjs), with its telemetry off;
 * - Scalar's converters write it as Markdown, OpenAPI and AsyncAPI alike, which is then tidied
 *   (convert.mjs, tidy.mjs);
 * - the Markdown becomes a page with no scripts, no inline styles and no data: URLs, raw HTML
 *   from the description shown as text (page.mjs), so it reads where a strict
 *   Content-Security-Policy is applied, such as Jenkins' archived artifacts;
 * - each heading's part of the page is a section the stylesheet draws as a card, with the
 *   operation's method as a badge and examples folded; every part and field can be linked to,
 *   and the page opens with its contents (page.mjs, contents.mjs);
 * - the page is checked for those properties and for completeness: every operation, channel,
 *   message and schema of the description is shown, each operation with its badge
 *   (check_page.mjs). A failed check exits 1.
 *
 * The output folder keeps a list of the pages the last build wrote
 * (.convert-api-specs-to-html.json); a page an earlier build wrote and this one does not is
 * removed, so a renamed or deleted description leaves no stale page behind. Files the build
 * did not write are never touched.
 *
 * Usage (installed as a dependency, the command is convert-api-specs-to-html):
 *   node build.mjs <spec>... [-o <dir>]
 *
 *   node build.mjs api.openapi.yaml events.asyncapi.yaml -o out
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { checkPage } from './check_page.mjs';
import { checkRefs } from './check_refs.mjs';
import { expectedNames, kindOf, operationCount, toMarkdown } from './convert.mjs';
import { renderPage } from './page.mjs';
import { bundle, redoclyCli } from './redocly.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const STYLESHEET = path.join(HERE, 'page.css');
const STYLESHEET_NAME = 'page.css';
const MANIFEST_NAME = '.convert-api-specs-to-html.json';

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

/** The page a spec becomes: its file name with the last extension replaced by .html. */
function pageName(spec) {
  return `${path.basename(spec, path.extname(spec))}.html`;
}

async function build(cli, spec, outDir) {
  // Refs are checked before Redocly resolves them, so a URL is never fetched.
  let problems = checkRefs(spec);
  if (problems.length === 0) {
    const doc = bundle(cli, spec);
    if (doc === null) {
      problems = ['redocly bundle failed'];
    } else {
      const html = renderPage(await toMarkdown(doc), { cssHref: STYLESHEET_NAME, kind: kindOf(doc) });
      writeFileSync(path.join(outDir, pageName(spec)), html);
      problems = checkPage(html, { cssHref: STYLESHEET_NAME, names: expectedNames(doc), operations: operationCount(doc) });
    }
  }
  return problems;
}

/** The pages the last build wrote into outDir, by its manifest; none when there is no readable one. */
function pagesWrittenBefore(outDir) {
  let pages = [];
  try {
    const manifest = JSON.parse(readFileSync(path.join(outDir, MANIFEST_NAME), 'utf8'));
    pages = Array.isArray(manifest.pages) ? manifest.pages.filter((p) => typeof p === 'string' && p === path.basename(p) && p.endsWith('.html')) : [];
  } catch {
    pages = [];
  }
  return pages;
}

/** Removes the pages an earlier build wrote that this one did not, and records this build's. */
function replaceManifest(outDir, pages) {
  for (const stale of pagesWrittenBefore(outDir).filter((p) => !pages.includes(p))) {
    rmSync(path.join(outDir, stale), { force: true });
  }
  writeFileSync(path.join(outDir, MANIFEST_NAME), `${JSON.stringify({ pages }, null, 2)}\n`);
}

/** Page names that more than one of the specs would write, so one page would replace another. */
function collidingPages(specs) {
  const counts = new Map();
  for (const spec of specs) {
    const name = pageName(spec).toLowerCase();
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  return [...counts].filter(([, n]) => n > 1).map(([name]) => name);
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
  } else if (collidingPages(args.specs).length > 0) {
    console.error(`these pages would be written by more than one spec: ${collidingPages(args.specs).join(', ')}`);
    exitCode = 2;
  } else if (existsSync(args.outDir) && !statSync(args.outDir).isDirectory()) {
    console.error(`${args.outDir} is not a folder: -o names where the pages go`);
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
    replaceManifest(args.outDir, args.specs.map(pageName));
    if (failed.length > 0) {
      console.error(`failed: ${failed.join(', ')}`);
      exitCode = 1;
    }
  }
  process.exitCode = exitCode;
}

await main();
