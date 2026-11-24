// Small, dependency-free helpers shared by the dev-kit scripts. Pure functions are unit-tested in lib.test.mjs.

/**
 * Parses a .env file. Supports `KEY=value`, `export KEY=value`, quoted values and `#` comments.
 * @param {string} text
 * @returns {Record<string, string>}
 */
export function parseDotenv(text) {
  /** @type {Record<string, string>} */
  const out = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const m = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!m) continue;
    let value = m[2];
    const quoted = /^(['"])(.*)\1$/.exec(value);
    if (quoted) value = quoted[2];
    else value = value.replace(/\s+#.*$/, '').trim(); // strip trailing comment on unquoted values
    out[m[1]] = value;
  }
  return out;
}

/**
 * Renders KEY=value lines. Values containing spaces, '#' or quotes are double-quoted.
 * @param {Array<[string, string] | string>} entries  a string entry is written as a comment line
 */
export function renderDotenv(entries) {
  return (
    entries
      .map((e) => {
        if (typeof e === 'string') return e === '' ? '' : `# ${e}`;
        const [k, v] = e;
        return /[\s#"']/.test(v) ? `${k}="${v.replace(/"/g, '\\"')}"` : `${k}=${v}`;
      })
      .join('\n') + '\n'
  );
}

/** Upper-cases an environment name for use in a variable name: "Staging EU" -> "STAGING_EU". */
export function envVarSuffix(name) {
  return name
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_|_$/g, '');
}

/** Strips trailing slashes so we can safely append paths. */
export function normaliseBaseUrl(url) {
  return url.replace(/\/+$/, '');
}

/**
 * Polls `check` until it resolves truthy or `timeoutMs` passes.
 * @param {() => Promise<boolean>} check
 */
export async function waitUntil(check, { timeoutMs = 180_000, intervalMs = 2_000, onWait = () => {} } = {}) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (await check().catch(() => false)) return true;
    if (Date.now() > deadline) return false;
    onWait();
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}
