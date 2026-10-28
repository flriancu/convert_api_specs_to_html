import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

// A command must run however its path is spelled: Windows names in another case, and with the
// \?\ prefix; symlinks are covered with the commands' own tests.
test('a command runs whatever the spelling of its path', { skip: process.platform !== 'win32' && 'Windows spellings' }, () => {
  const script = path.join(ROOT, 'check_refs.mjs');
  // Node takes a file for a module by its lower-case .mjs, so the extension keeps its case.
  for (const spelling of [script, path.join(ROOT.toUpperCase(), 'CHECK_REFS.mjs'), '\\\\?\\' + script]) {
    const result = spawnSync(process.execPath, [spelling], { encoding: 'utf8' });
    assert.equal(result.status, 2, spelling);
    assert.match(result.stdout, /^usage: /, spelling);
  }
});
