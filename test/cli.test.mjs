import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { runsAsCommand } from '../cli.mjs';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const SCRIPT = path.join(ROOT, 'check_refs.mjs');
const WINDOWS = process.platform === 'win32';

// Node takes a file for a module by its lower-case .mjs, so the extension keeps its case.
const spellings = WINDOWS ? [SCRIPT, path.join(ROOT.toUpperCase(), 'CHECK_REFS.mjs'), '\\\\?\\' + SCRIPT] : [SCRIPT];

test('a command knows its own script by any spelling of the path, and no other', () => {
  const saved = process.argv[1];
  try {
    for (const spelling of spellings) {
      process.argv[1] = spelling;
      assert.equal(runsAsCommand(pathToFileURL(SCRIPT).href), true, spelling);
    }
    process.argv[1] = path.join(ROOT, 'cli.mjs');
    assert.equal(runsAsCommand(pathToFileURL(SCRIPT).href), false, 'another script');
  } finally {
    process.argv[1] = saved;
  }
});

// Started for real: Node 22 cannot start a script by a \\?\ path at all (it fails resolving
// the main module), so that spelling is left to the test above.
test('a command started by another case of its path runs', { skip: !WINDOWS && 'Windows spellings' }, () => {
  for (const spelling of spellings.slice(0, 2)) {
    const result = spawnSync(process.execPath, [spelling], { encoding: 'utf8' });
    assert.equal(result.status, 2, spelling);
    assert.match(result.stdout, /^usage: /, spelling);
  }
});
