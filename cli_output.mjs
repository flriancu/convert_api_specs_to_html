/**
 * Redocly CLI's console output as build.mjs passes it on.
 */

const ANSI = /\x1b\[[0-9;]*m/g;
const BOX_TOP = '╔';
const BOX_BOTTOM = '╚';
const REDOC3_NOTICE = 'build-docs now renders docs with Redoc 3.';

function plain(line) {
  return line.replace(ANSI, '').trim();
}

/**
 * The text without the boxed notice about Redoc 3 that `build-docs` prints on every run, and
 * without the blank line on each side of it. The notice has no switch in Redocly CLI. Every
 * other line is kept, other boxes included.
 */
export function withoutRedoc3Notice(text) {
  const lines = text.split('\n');
  const kept = [];
  let box = [];
  let dropNextBlank = false;

  for (const line of lines) {
    const content = plain(line);
    if (box.length > 0 || content.startsWith(BOX_TOP)) {
      box.push(line);
      if (content.startsWith(BOX_BOTTOM)) {
        const isNotice = box.some((boxLine) => plain(boxLine).includes(REDOC3_NOTICE));
        if (isNotice) {
          if (kept.length > 0 && plain(kept[kept.length - 1]) === '') {
            kept.pop();
          }
          dropNextBlank = true;
        } else {
          kept.push(...box);
        }
        box = [];
      }
    } else if (dropNextBlank && content === '') {
      dropNextBlank = false;
    } else {
      dropNextBlank = false;
      kept.push(line);
    }
  }
  kept.push(...box);
  return kept.join('\n');
}
