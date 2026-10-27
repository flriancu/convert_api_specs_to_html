#!/usr/bin/env node
/**
 * Checks that a specification's $refs stay inside its own folder: only "#..." pointers and
 * relative paths to files in or under the folder of the description that was given, followed
 * through every file they reach. A $ref to a URL (http:, https:, file:, //host) or out of the
 * folder (../, an absolute path) is reported, before any tool resolves it: a linter or bundler
 * would otherwise fetch the URL or read the file and could put its content into a build output.
 *
 * Usage (installed as a dependency, the command is check-api-spec-refs):
 *   node check_refs.mjs <spec>...
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

// $ref: value  /  "$ref": "value"  /  $ref: 'value'  (YAML block or flow style, JSON)
const REF = /["']?\$ref["']?\s*:\s*(?:"([^"]*)"|'([^']*)'|([^\s,}\]]+))/g;
const URL_LIKE = /^([a-z][a-z0-9+.-]*:|\/\/)/i;

/** Every $ref value written in the text, in order. */
export function refsIn(text) {
  return [...text.matchAll(REF)].map((m) => m[1] ?? m[2] ?? m[3]);
}

/**
 * Problems with the $refs of the description at specPath and of every file it reaches, as
 * sentences; empty when every $ref stays inside the description's folder.
 */
export function checkRefs(specPath) {
  const root = path.resolve(path.dirname(specPath));
  const problems = existsSync(specPath) ? [] : ['the description does not exist'];
  const seen = new Set();
  const pending = problems.length === 0 ? [path.resolve(specPath)] : [];
  while (pending.length > 0) {
    const file = pending.pop();
    if (!seen.has(file)) {
      seen.add(file);
      for (const ref of refsIn(readFileSync(file, 'utf8'))) {
        const target = ref.split('#')[0];
        const where = path.relative(root, file) || path.basename(file);
        if (target === '') {
          continue;
        }
        if (URL_LIKE.test(target) || path.isAbsolute(target)) {
          problems.push(`${where}: $ref "${ref}" is not a relative path inside the specification's folder`);
          continue;
        }
        const resolved = path.resolve(path.dirname(file), decodeURIComponent(target));
        const relative = path.relative(root, resolved);
        if (relative.startsWith('..') || path.isAbsolute(relative)) {
          problems.push(`${where}: $ref "${ref}" points outside the specification's folder`);
        } else if (!existsSync(resolved)) {
          problems.push(`${where}: $ref "${ref}" points to a file that does not exist`);
        } else {
          pending.push(resolved);
        }
      }
    }
  }
  return problems;
}

function main() {
  const specs = process.argv.slice(2);
  let exitCode = 0;
  if (specs.length === 0 || specs.includes('-h') || specs.includes('--help')) {
    console.log('usage: check-api-spec-refs <spec>...');
    exitCode = specs.length === 0 ? 2 : 0;
  } else {
    for (const spec of specs) {
      for (const problem of checkRefs(spec)) {
        console.error(`${spec}: ${problem}`);
        exitCode = 1;
      }
    }
  }
  process.exitCode = exitCode;
}

const runDirectly = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (runDirectly) {
  main();
}
