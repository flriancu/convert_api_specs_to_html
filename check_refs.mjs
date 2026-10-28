#!/usr/bin/env node
/**
 * Checks that a specification reads nothing from outside its own folder, before any tool
 * resolves it: every `$ref`, and every `externalValue`, is a "#..." pointer or a relative path
 * to a file in or under the folder of the description that was given, followed through every
 * file a `$ref` reaches. A reference to a URL (http:, https:, file:, //host), out of the folder
 * (../, an absolute path, or a link inside the folder that leads out of it) is reported; a
 * linter or bundler would otherwise fetch the URL or read the file and could put its content
 * into a build output.
 *
 * Each file is parsed as YAML 1.2 (JSON included) and the references are read from the parsed
 * tree, so escaped keys ("$ref") count as what they are. What loaders may read
 * differently is refused instead of guessed: an alias as a key, a merge key (<<), a key twice.
 *
 * Usage (installed as a dependency, the command is check-api-spec-refs):
 *   node check_refs.mjs <spec>...
 */
import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import path from 'node:path';

import { isAlias, isScalar, parseDocument, visit } from 'yaml';

import { runsAsCommand } from './cli.mjs';

const URL_LIKE = /^([a-z][a-z0-9+.-]*:|\/\/)/i;
const REFERENCES = new Set(['$ref', 'externalValue']);

/**
 * The references written in one file's text, with what in the text is refused: `refs` holds
 * { key, value } for every $ref and externalValue, `problems` sentences.
 */
export function referencesIn(text) {
  const problems = [];
  const refs = [];
  const doc = parseDocument(text, { uniqueKeys: true, merge: false, maxAliasCount: 100 });
  for (const error of [...doc.errors, ...doc.warnings]) {
    problems.push(`is not YAML this check can read: ${error.message.split('\n')[0]}`);
  }
  if (doc.errors.length === 0) {
    visit(doc, {
      Pair(_, pair) {
        const key = isScalar(pair.key) ? pair.key.value : null;
        if (isAlias(pair.key)) {
          problems.push('uses an alias as a key, which loaders read differently');
        } else if (key === '<<') {
          problems.push('uses a merge key (<<), which loaders read differently');
        } else if (typeof key === 'string' && REFERENCES.has(key)) {
          const value = isAlias(pair.value) ? pair.value.resolve(doc) : pair.value;
          if (isScalar(value) && typeof value.value === 'string') {
            refs.push({ key, value: value.value });
          } else {
            problems.push(`has a ${key} whose value is not a string`);
          }
        }
      },
    });
  }
  return { problems, refs };
}

function inside(root, target) {
  const relative = path.relative(root, target);
  return relative === '' || !(relative.startsWith('..') || path.isAbsolute(relative));
}

/**
 * Whether target exists under root with the exact case of every name on the way, as a
 * case-sensitive file system (Linux CI) would find it.
 */
function existsWithCase(root, target) {
  let current = root;
  let found = true;
  for (const name of path.relative(root, target).split(path.sep).filter((n) => n !== '')) {
    let names = [];
    try {
      names = readdirSync(current);
    } catch {
      names = [];
    }
    found = found && names.includes(name);
    current = path.join(current, name);
  }
  return found && existsSync(target);
}

/** Why a reference value from file is refused, or null; when it leads to a file, that file's real path. */
function judge(root, file, value) {
  const target = value.split('#')[0];
  let decoded = null;
  try {
    decoded = decodeURIComponent(target);
  } catch {
    decoded = null;
  }
  const resolved = decoded === null ? null : path.resolve(path.dirname(file), decoded);
  let problem = null;
  if (target === '') {
    problem = null;
  } else if (URL_LIKE.test(target) || path.isAbsolute(target) || target.startsWith('\\')) {
    problem = 'is not a relative path inside the specification\'s folder';
  } else if (target.includes('\\')) {
    problem = 'has a backslash: references are URI references, written with /';
  } else if (resolved === null) {
    problem = 'has a malformed percent-encoding';
  } else if (!inside(root, resolved)) {
    problem = 'points outside the specification\'s folder';
  } else if (!existsWithCase(root, resolved)) {
    problem = 'points to a file that does not exist (names are compared with their case)';
  } else if (!inside(root, realpathSync.native(resolved))) {
    problem = 'leads outside the specification\'s folder through a link';
  }
  const leadsTo = problem === null && target !== '' ? realpathSync.native(resolved) : null;
  return { problem, file: leadsTo };
}

/**
 * Problems with the references of the description at specPath and of every file its $refs
 * reach, as sentences; empty when everything stays inside the description's folder.
 */
export function checkRefs(specPath) {
  const problems = [];
  if (!existsSync(specPath)) {
    problems.push('the description does not exist');
  } else if (!statSync(specPath).isFile()) {
    problems.push('the description is not a file');
  }
  const root = problems.length === 0 ? realpathSync.native(path.dirname(path.resolve(specPath))) : null;
  const seen = new Set();
  const pending = problems.length === 0 ? [realpathSync.native(path.resolve(specPath))] : [];
  while (pending.length > 0) {
    const file = pending.pop();
    if (!seen.has(file)) {
      seen.add(file);
      const where = path.relative(root, file) || path.basename(file);
      const found = referencesIn(readFileSync(file, 'utf8'));
      problems.push(...found.problems.map((problem) => `${where}: ${problem}`));
      for (const { key, value } of found.refs) {
        const verdict = judge(root, file, value);
        if (verdict.problem !== null) {
          problems.push(`${where}: ${key} "${value}" ${verdict.problem}`);
        } else if (verdict.file !== null && key === '$ref') {
          pending.push(verdict.file);
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

if (runsAsCommand(import.meta.url)) {
  main();
}
