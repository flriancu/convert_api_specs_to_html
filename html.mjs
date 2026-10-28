/** HTML pieces the page and its contents share: escaping, and an operation's badge. */

export function escapeHtml(text) {
  return String(text)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export function badge(kind, label) {
  return `<span class="method method-${kind}">${escapeHtml(label)}</span>`;
}

/** The badge for an operation's method (with its path when withPath), or for its action; null for anything else. */
export function endpointBadge({ method, path, action }, { withPath = true } = {}) {
  let html = null;
  if (method && path) {
    html = withPath ? `${badge(method.toLowerCase(), method)} <code>${escapeHtml(path)}</code>` : badge(method.toLowerCase(), method);
  } else if (action) {
    html = badge(action, action.toUpperCase());
  }
  return html;
}
