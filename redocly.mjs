/**
 * Redocly CLI, as both builds run it: found wherever npm installed it, with its telemetry off.
 */
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';

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
