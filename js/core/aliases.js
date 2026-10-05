import { tokenize } from './args.js';

// Aliases and search engines share one table: an engine is an alias with a template.
// Entry: { name, base, template?, escape: 'query' | 'path' }
//
// Template placeholders: {} is everything typed after the name; {1}, {2} … are
// single arguments (quotes group words), and the last one used also takes any
// extra words. `%s`, the placeholder browsers use, is stored as {}.
const PLACEHOLDER = /\{([1-9]?)\}/g;

const SHIPPED_DEFAULT = 'g';
const RESERVED = ['add', 'set', 'rm', 'ls', 'show', 'edit', 'default', 'all']; // words the alias commands use

function starters() {
  return [
    { name: 'g', base: 'https://www.google.com/', template: 'https://www.google.com/search?q={}', escape: 'query' },
    { name: 'ddg', base: 'https://duckduckgo.com/', template: 'https://duckduckgo.com/?q={}', escape: 'query' },
  ];
}

// Returns an error string, or null when `url` is acceptable. Only http(s) is
// allowed: location.assign('javascript:...') would run code with access to
// every stored note. For templates, every placeholder must come after the
// host so the user's text can never choose where the request goes. Spaces and
// quotes are fine (a JQL query, say); the browser encodes them on the way out.
function urlError(url, isTemplate) {
  if (typeof url !== 'string' || url.length === 0) return 'URL is missing';
  if (url.length > 2000) return 'URL is too long';
  if (/[\t\n\r\f\v]/.test(url)) return 'URL must not contain tabs or line breaks';
  if (!/^https?:\/\/[^/?#\s]/i.test(url)) return 'only http: and https: URLs are allowed';
  const probe = isTemplate ? url.replace(PLACEHOLDER, 'x') : url;
  let parsed;
  try {
    parsed = new URL(probe);
  } catch (e) {
    return 'not a valid URL';
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return 'only http: and https: URLs are allowed';
  }
  if (isTemplate) {
    const first = url.search(PLACEHOLDER);
    if (first < 0) return 'template must contain {} (or %s, or {1}, {2} …)';
    const authorityStart = url.indexOf('://') + 3;
    const hostEnd = url.slice(authorityStart).search(/[/?#]/);
    if (hostEnd < 0 || first < authorityStart + hostEnd) return 'placeholders must come after the host';
  }
  return null;
}

// '%s' -> '{}'.
const normalizeTemplate = (t) => t.split('%s').join('{}');

// "https://www.google.com/search?q={}" -> "https://www.google.com/"
function siteRoot(template) {
  const m = /^(https?:\/\/[^/?#{}\s]+)/i.exec(template);
  return m ? m[1] + '/' : template;
}

// Highest numbered placeholder in a template (0 when it only uses {}).
function arity(template) {
  let n = 0;
  for (const m of template.matchAll(PLACEHOLDER)) if (m[1]) n = Math.max(n, +m[1]);
  return n;
}

function nameError(name, isBuiltin) {
  if (!/^[a-z0-9._-]+$/.test(name)) {
    return 'name must be lowercase letters, digits, ".", "_" or "-"';
  }
  if (name.length > 32) return 'name is too long';
  if (isBuiltin(name)) return "'" + name + "' is a built-in command";
  return null;
}

// Checks an untrusted entry (from the prompt or an imported file). Returns
// { entry } with a clean copy, or { error }.
function validateEntry(raw, isBuiltin) {
  if (!raw || typeof raw !== 'object') return { error: 'not an object' };
  const name = typeof raw.name === 'string' ? raw.name.toLowerCase() : '';
  const err = nameError(name, isBuiltin) || (RESERVED.includes(name) ? "'" + name + "' is reserved" : null);
  if (err) return { error: err };
  const baseErr = urlError(raw.base, false);
  if (baseErr) return { error: 'base: ' + baseErr };
  const entry = { name, base: raw.base, escape: raw.escape === 'path' ? 'path' : 'query' };
  if (raw.template !== undefined && raw.template !== null && raw.template !== '') {
    const template = typeof raw.template === 'string' ? normalizeTemplate(raw.template) : raw.template;
    const tErr = urlError(template, true);
    if (tErr) return { error: 'template: ' + tErr };
    entry.template = template;
  }
  return { entry };
}

function encodeRest(entry, rest) {
  if (entry.escape === 'path') return rest.split('/').map(encodeURIComponent).join('/');
  return encodeURIComponent(rest);
}

// -> { url, note? } or { error }
function buildUrl(entry, rest) {
  if (!rest) return { url: entry.base };
  if (!entry.template) {
    return { url: entry.base, note: "'" + entry.name + "' has no template; ignoring the argument" };
  }
  const n = arity(entry.template);
  let args = [];
  if (n) {
    const toks = tokenize(rest);
    if (toks.length < n) {
      return { error: "'" + entry.name + "' needs " + n + ' arguments, got ' + toks.length + ': ' + entry.template };
    }
    args = toks.slice(0, n).map((t) => t.text);
    // Extra words go to the last numbered placeholder, as typed.
    if (toks.length > n) args[n - 1] = rest.slice(toks[n - 1].start).trim();
  }
  // A replacer function, so `$&` in the user's text is never a pattern.
  const url = entry.template.replace(PLACEHOLDER, (m, i) => encodeRest(entry, i ? args[+i - 1] : rest));
  return { url };
}

export { SHIPPED_DEFAULT, RESERVED, starters, urlError, nameError, validateEntry, buildUrl, siteRoot, arity, normalizeTemplate };
