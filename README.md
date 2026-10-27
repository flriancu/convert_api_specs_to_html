# convert_api_specs_to_html

Renders OpenAPI and AsyncAPI descriptions as self-contained HTML pages, one per description, with
the same look for both. The pages open offline, send no telemetry and fetch nothing from other
hosts, so they are safe to attach to an email or publish behind a firewall.

The renderer is [Redoc](https://github.com/Redocly/redoc) 3, through the `build-docs` command of
[Redocly CLI](https://github.com/Redocly/redocly-cli) (both MIT), pinned in `package.json`. Redoc 3
reads OpenAPI 2.0 to 3.2 and AsyncAPI 3.x and detects the format from the document.

```
npm ci
node build.mjs api.openapi.yaml events.asyncapi.yaml -o out
node build.mjs api.openapi.yaml -- --openapi.hideDownloadButtons=true
```

## Use in a project

Add it as a development dependency pinned to a release tag; the lockfile records the commit.

```
npm install --save-dev github:flriancu/convert_api_specs_to_html#v1.0.0
```

```json
"scripts": {
  "docs": "convert-api-specs-to-html api.openapi.yaml events.asyncapi.yaml -o out/docs"
}
```

## Options

Each description `<name>.<ext>` becomes `<dir>/<name>.html` (default `out/`). Relative `$ref`s
to other files are resolved and embedded. Anything after `--` goes to `redocly build-docs`
unchanged: Redoc options as `--openapi.<option>` or `--asyncapi.<option>`, `--title`, `--config`.

## What differs from plain `build-docs`

| Default `build-docs` | Here | How |
|---|---|---|
| Loads Redoc from `cdn.redocly.com` | Redoc embedded in the page (about 2.5 MB) | `--inlineBundle` |
| Usage telemetry from the CLI and from the page | None | `REDOCLY_TELEMETRY=off` for the run |
| "API docs by Redocly" badge, logo from `cdn.redoc.ly` | Hidden, not fetched | CSS rule and Content-Security-Policy in `template.hbs` |

The Content-Security-Policy allows inline scripts and styles plus `data:` and `blob:` URLs only,
so the page cannot reach any host, whatever a future Redoc version tries to load.

Redoc has no option for the badge; `template.hbs` hides the element that holds its link. After
each build, `check_page.mjs` confirms the page is embedded, has telemetry off, carries the policy
and still has the badge link the CSS rule targets. A build that fails a check exits with 1 and
names the problem.

## Upgrading Redocly CLI

Change the exact version in `package.json`, run `npm install`, build a description and read the
check results. If the badge check fails, update the selector in `template.hbs` to the new markup.

## Requirements

Node.js 22.12 or later (Redocly CLI's own requirement) and npm.

## License

MIT, see `LICENSE`.
