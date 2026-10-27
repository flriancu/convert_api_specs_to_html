# convert_api_specs_to_html

Renders OpenAPI and AsyncAPI descriptions as plain HTML pages, one per description, with the same
look for both. The pages run no scripts, use no inline styles and load nothing from other hosts:
they read wherever a strict Content-Security-Policy applies (for example, files archived by
Jenkins), open offline, and print well.

```
npm ci
node build.mjs api.openapi.yaml events.asyncapi.yaml -o out
```

Each description `<name>.<ext>` becomes `<dir>/<name>.html` (default `out/`); the stylesheet
`page.css` is written beside the pages, which link it.

## How it works

1. [Redocly CLI](https://github.com/Redocly/redocly-cli) bundles the description into one document,
   resolving `$ref`s to other files, with its telemetry off (`redocly.mjs`).
2. Scalar's converters, [`@scalar/openapi-to-markdown`](https://www.npmjs.com/package/@scalar/openapi-to-markdown)
   and [`@scalar/asyncapi-to-markdown`](https://www.npmjs.com/package/@scalar/asyncapi-to-markdown),
   write it as Markdown (`convert.mjs`). The OpenAPI converter upgrades the document before
   rendering and prints the upgraded version; the page shows the version the description declares.
3. [marked](https://github.com/markedjs/marked) turns the Markdown into the page (`page.mjs`).
   Descriptions come from whoever wrote the specification, so raw HTML in them is shown as text;
   only the converters' id-only anchors pass. Links keep `http`, `https`, `mailto` and `#`
   targets; images become links.
4. Each page is checked (`check_page.mjs`): no scripts, `<style>`, style attributes, event
   handlers, `data:`/`javascript:` URLs, `<meta http-equiv>`, forms or frames; the stylesheet is
   linked; and every operation, channel, message and schema of the description is shown. A
   failed check exits with 1 and names the problem, so a converter upgrade that drops content
   fails the build.

All dependencies are pinned exactly in `package.json`.

## Use in a project

Add it as a development dependency pinned to a release tag; the lockfile records the commit.

```
npm install --save-dev github:flriancu/convert_api_specs_to_html#v2.0.0
```

```json
"scripts": {
  "docs": "convert-api-specs-to-html api.openapi.yaml events.asyncapi.yaml -o out/docs"
}
```

## Development

```
npm ci
npm run examples:lint   # the examples pass Redocly's recommended-strict rules
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
