/**
 * What the package's commands share.
 */
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * Whether the module at moduleUrl is the script Node was asked to run, rather than imported.
 * npm installs a command as a symlink (Linux, macOS) or a shim (Windows), and Node resolves the
 * symlink for the module's URL but not for process.argv[1], so both are compared as real paths.
 */
export function runsAsCommand(moduleUrl) {
  let script = null;
  try {
    script = process.argv[1] === undefined ? null : realpathSync(process.argv[1]);
  } catch {
    script = null;
  }
  return script !== null && script === realpathSync(fileURLToPath(moduleUrl));
}
