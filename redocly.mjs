/**
 * Redocly CLI, as the commands run it: found wherever npm installed it, with its telemetry off.
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';

/** Redocly CLI's entry point, wherever npm installed it; null when it is not installed. */
export function redoclyCli() {
  let cli = null;
  try {
    cli = createRequire(import.meta.url).resolve('@redocly/cli/bin/cli.js');
  } catch {
    cli = null;
  }
  return cli;
}

/** Runs Redocly CLI with the given arguments; stdout passes through, stderr is returned. */
export function runRedocly(cli, args) {
  return spawnSync(process.execPath, [cli, ...args], {
    stdio: ['inherit', 'inherit', 'pipe'],
    encoding: 'utf8',
    env: { ...process.env, REDOCLY_TELEMETRY: 'off' },
  });
}

/** The spec as one JSON document with its $refs to other files resolved; null if Redocly fails. */
export function bundle(cli, spec) {
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
