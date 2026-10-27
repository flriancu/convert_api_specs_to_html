/**
 * Checks that a page built by build.mjs keeps its promises: Redoc embedded, telemetry off, the
 * Content-Security-Policy in place and the badge hidden by template.hbs.
 */

const BADGE_LINK = 'href="https://redocly.com/redoc/"';

/** Problems with a built page, as sentences; empty when the page has every property. */
export function checkPage(html) {
  const problems = [];
  if (!html.includes('"disableTelemetry":true')) {
    problems.push('telemetry is not disabled in the page options');
  }
  if (!html.includes('http-equiv="Content-Security-Policy"')) {
    problems.push('the Content-Security-Policy from template.hbs is missing');
  }
  if (html.includes('rel="modulepreload" href="https://cdn.redocly.com/')) {
    problems.push('Redoc is loaded from the CDN instead of being embedded');
  }
  if (html.includes('API docs by') && !html.includes(BADGE_LINK)) {
    problems.push('the badge link changed, so the CSS rule in template.hbs no longer hides it');
  }
  return problems;
}
