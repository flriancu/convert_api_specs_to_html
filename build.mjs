#!/usr/bin/env node
/**
 * Render OpenAPI and AsyncAPI descriptions as self-contained HTML pages.
 *
 * Each description becomes one HTML file, rendered by Redoc through Redocly CLI `build-docs`.
 * The page:
 *
 * - embeds Redoc instead of loading it from the Redocly CDN (`--inlineBundle`), so it opens
 *   offline;
 * - sends no telemetry: REDOCLY_TELEMETRY=off turns it off for the CLI run and for the page;
 * - fetches nothing from other hosts and hides the "API docs by Redocly" badge (template.hbs).
 *
 * After each build the page is checked for those properties (check_page.mjs), so a Redocly CLI
 * upgrade that changes them fails here instead of shipping silently.
 *
 * Usage (installed as a dependency, the command is convert-api-specs-to-html):
 *   node build.mjs <spec>... [-o <dir>] [-- <build-docs options>]
 *
 *   node build.mjs api.openapi.yaml events.asyncapi.yaml -o out
 *   node build.mjs api.openapi.yaml -- --openapi.hideDownloadButtons=true
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { checkPage } from './check_page.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATE = path.join(HERE, 'template.hbs');

const USAGE = 'usage: convert-api-specs-to-html <spec>... [-o <dir>] [-- <build-docs options>]';

/** Redocly CLI's entry point, wherever npm installed it; null when it is not installed. */
function redoclyCli() {
  let cli = null;
  try {
    cli = createRequire(import.meta.url).resolve('@redocly/cli/bin/cli.js');
  } catch {
    cli = null;
  }
  return cli;
}

function parseArgs(argv) {
  const args = { specs: [], outDir: 'out', extra: [] };
  const split = argv.indexOf('--');
  const own = split < 0 ? argv : argv.slice(0, split);
  args.extra = split < 0 ? [] : argv.slice(split + 1);

  for (let i = 0; i < own.length; i += 1) {
    const arg = own[i];
    if (arg === '-o' || arg === '--output') {
      i += 1;
      args.outDir = own[i];
    } else if (arg === '-h' || arg === '--help') {
      args.help = true;
    } else {
      args.specs.push(arg);
    }
  }
  return args;
}

/** The output name: the spec's file name with its last extension replaced by .html. */
function outputFor(spec, outDir) {
  const name = path.basename(spec, path.extname(spec));
  return path.join(outDir, `${name}.html`);
}

function build(cli, spec, outFile, extra) {
  const result = spawnSync(
    process.execPath,
    [cli, 'build-docs', spec, '-o', outFile, '-t', TEMPLATE, '--inlineBundle', ...extra],
    { stdio: 'inherit', env: { ...process.env, REDOCLY_TELEMETRY: 'off' } },
  );
  let problems = [];
  if (result.status !== 0) {
    problems = [`redocly build-docs exited with ${result.status ?? result.signal}`];
  } else {
    problems = checkPage(readFileSync(outFile, 'utf8'));
  }
  return problems;
}

function main() {
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
    const failed = [];
    for (const spec of args.specs) {
      const outFile = outputFor(spec, args.outDir);
      const problems = build(cli, spec, outFile, args.extra);
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

main();
