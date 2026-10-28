/**
 * What the package's commands share.
 */
import { statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * Whether the module at moduleUrl is the script Node was asked to run, rather than imported.
 * npm installs a command as a symlink (Linux, macOS) or a shim (Windows), and the script's path
 * can be spelled many ways (a symlink, another case, a \\?\ prefix on Windows), so the two are
 * compared as files: the same device and file id.
 */
export function runsAsCommand(moduleUrl) {
  let same = false;
  try {
    if (process.argv[1] !== undefined) {
      const script = statSync(process.argv[1], { bigint: true });
      const module = statSync(fileURLToPath(moduleUrl), { bigint: true });
      same = script.dev === module.dev && script.ino === module.ino;
    }
  } catch {
    same = false;
  }
  return same;
}
