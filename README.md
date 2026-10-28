# convert_api_specs_to_html

Renders OpenAPI and AsyncAPI descriptions as plain HTML pages, one per description, with the same
look for both, and checks the descriptions' `$ref`s and examples. The pages run no scripts, use no inline styles and load nothing from other hosts:
they read wherever a strict Content-Security-Policy applies (for example, files archived by
Jenkins), open offline, and print well.

```
npm ci
node build.mjs api.openapi.yaml events.asyncapi.yaml -o out
```

Each description `<name>.<ext>` becomes `<dir>/<name>.html` (default `out/`); the stylesheet
`page.css` is written beside the pages, which link it.

## How it works

1. The description's `$ref`s and `externalValue`s are checked to stay inside its folder
   (`check_refs.mjs`): only `#...` pointers and relative paths to files in or under the folder,
   followed through every file they reach, also through links, with names in their exact case
   as Linux compares them. A reference to a URL or out of the folder fails the build before
   anything resolves it, so no URL is fetched and no outside file ends up in a page. Each file
   is parsed as YAML 1.2 and its references read from the parsed tree, so `"$ref"` is a
   `$ref`; what loaders read differently (an alias as a key, a merge key `<<`, a key twice) is
   refused rather than guessed. Two specs that would write the same page are refused too.
2. [Redocly CLI](https://github.com/Redocly/redocly-cli) bundles the description into one document,
   resolving `$ref`s to other files, with its telemetry and update check off (`redocly.mjs`).
3. Scalar's converters, [`@scalar/openapi-to-markdown`](https://www.npmjs.com/package/@scalar/openapi-to-markdown)
   and [`@scalar/asyncapi-to-markdown`](https://www.npmjs.com/package/@scalar/asyncapi-to-markdown),
   write it as Markdown (`convert.mjs`). The OpenAPI converter upgrades the document before
   rendering and prints the upgraded version; the page shows the version the description declares.
4. [marked](https://github.com/markedjs/marked) turns the Markdown into the page (`page.mjs`).
   Descriptions come from whoever wrote the specification, so raw HTML in them is shown as text;
   only the converters' id-only anchors pass. Links keep `http`, `https`, `mailto` and `#`
   targets; images become links. So a reader sees where each part starts and ends, every
   heading from level 2 down opens a section: level-2 parts are bands, and each operation,
   channel, message and schema is a card whose heading stays at its top while it scrolls. An
   operation's method shows as a badge beside its path (an AsyncAPI operation's action as SEND or
   RECEIVE), and examples fold until asked for; they still print.
5. Each page is checked (`check_page.mjs`): no scripts, `<style>`, style attributes, event
   handlers, `data:`/`javascript:` URLs, `<meta http-equiv>`, forms or frames; the stylesheet is
   linked; every operation, channel, message and schema of the description is shown; and every
   operation has its badge. A failed check exits with 1 and names the problem, so a converter
   upgrade that drops content, or writes an operation's method in another form, fails the
   build. Prose that mentions `style=` or `onclick=` is text, not a problem.
6. The output folder keeps a list of the pages the build wrote
   (`.convert-api-specs-to-html.json`): a page an earlier build wrote and this one does not is
   removed, so a renamed or deleted description leaves no stale page behind. Files the build did
   not write are never touched.

All dependencies are pinned exactly in `package.json`.

## Use in a project

Add it as a development dependency pinned to a release tag; the lockfile records the commit.

```
npm install --save-dev github:flriancu/convert_api_specs_to_html#v2.5.0
```

```json
"scripts": {
  "lint": "check-api-spec-refs api.openapi.yaml events.asyncapi.yaml && redocly lint --config redocly.yaml api.openapi.yaml events.asyncapi.yaml && check-api-spec-examples api.openapi.yaml events.asyncapi.yaml",
  "docs": "convert-api-specs-to-html api.openapi.yaml events.asyncapi.yaml -o out/docs"
}
```

- `check-api-spec-refs` is the same reference check on its own. Run it before a linter or
  anything else that resolves `$ref`s: they fetch URLs and read outside files as they go.
- `check-api-spec-examples` checks every example against the schema it illustrates
  (`check_examples.mjs`): OpenAPI request bodies, responses, parameters and headers, with
  references to `components/examples` resolved; AsyncAPI 2 and 3 message examples against the
  message's payload and headers, with its traits merged as the document's version says; channel
  parameter examples against their `enum`; and the `examples` and `default` of every schema,
  inline and binding schemas included. Linters leave AsyncAPI examples unchecked. It also
  reports bounds no value can meet (a minimum above its maximum) and a `$schema` in another
  dialect. It checks references first, bundles with Redocly CLI, and validates with
  [Ajv](https://ajv.js.org/) with format checks, as JSON Schema 2020-12 for OpenAPI 3.1 and
  draft-07 for AsyncAPI. What it cannot check it counts and names on its summary line instead of
  passing it quietly: payloads in another schema format (Avro, OpenAPI's), payloads that traits
  and the message both define, examples for a message with no payload. A mismatch exits with 1
  and says where the example is and what does not match.
- Pass Redocly its configuration explicitly (`--config redocly.yaml`): without it, a missing or
  renamed file makes Redocly fall back to its `recommended` rules, which only warn about what
  `recommended-strict` refuses.
- Schema patterns run on RE2 ([re2js](https://github.com/le0pard/re2js), a JavaScript port of
  Google's linear-time engine), through Ajv's `code.regExp` option as
  [Ajv's security notes](https://ajv.js.org/security.html) recommend: a pattern that backtracks
  badly, such as `^(a+)+$`, cannot make the check slow, however long the example. RE2 has no
  lookarounds or backreferences; an example whose schema needs them is named as not checked
  rather than run on a backtracking engine. RE2 also reads `\s` and Unicode classes slightly
  differently from JavaScript (`linear_regexp.mjs`).

Each command exits with 1 when it finds a problem and with 2 on a usage error.

## Development

```
npm ci
npm run examples:lint   # the examples pass Redocly's recommended-strict rules and match their schemas
npm test                # unit tests, and both examples built and checked
```

CI runs the same on Linux and Windows with Node.js 22 and 24, for every push and pull request.
Dependabot proposes dependency and GitHub Actions upgrades as pull requests, so CI checks each
upgrade before it is merged; the completeness check is what catches a converter that renders
less.

## Requirements

Node.js 22.12 or later (Redocly CLI's own requirement) and npm.

## License

MIT, see `LICENSE`.
