/**
 * Schema patterns on a linear-time engine. JavaScript's own engine backtracks, so a pattern such
 * as ^(a+)+$ can take exponentially long on an example that almost matches it; RE2 (here re2js,
 * a JavaScript port) runs in time linear in the input, as Ajv's security notes recommend
 * (https://ajv.js.org/security.html). RE2 has no lookarounds or backreferences: a pattern that
 * needs them is refused with NeedsBacktracking, and the check names it rather than run it on a
 * backtracking engine.
 */
import { RE2JS } from 're2js';

/** A pattern RE2 cannot run: it needs a backtracking engine (a lookaround, a backreference). */
export class NeedsBacktracking extends Error {}

/**
 * The pattern compiled for Ajv's code.regExp option: something with test() as a RegExp has, and
 * a toString() that tells patterns apart, since Ajv keeps compiled patterns by it.
 */
export function linearRegExp(source, flags) {
  let compiled = null;
  try {
    compiled = RE2JS.compile(source, flags.includes('i') ? RE2JS.CASE_INSENSITIVE : 0);
  } catch (error) {
    throw new NeedsBacktracking(`its pattern ${JSON.stringify(source)} needs a backtracking engine (${error.message.split('\n')[0]})`);
  }
  return {
    test: (text) => compiled.matcher(text).find(),
    toString: () => `/${source}/${flags}`,
  };
}

// Ajv writes this name only into standalone code, which the check does not generate.
linearRegExp.code = 'linearRegExp';
