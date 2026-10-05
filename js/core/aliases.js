// Aliases and search engines share one table: an engine is an alias with a template.
// Entry: { name, base, template?, escape: 'query' | 'path' }

const SHIPPED_DEFAULT = 'g';
const RESERVED = ['set', 'rm', 'ls', 'show']; // `alias` subcommands

function starters() {
  return [
    { name: 'g', base: 'https://www.google.com/', template: 'https://www.google.com/search?q={}', escape: 'query' },
    { name: 'ddg', base: 'https://duckduckgo.com/', template: 'https://duckduckgo.com/?q={}', escape: 'query' },
  ];
}

// Returns an error string, or null when `url` is acceptable. Only http(s) is
// allowed: location.assign('javascript:...') would run code with access to
// every stored note. For templates, `{}` must come after the host so the
// user's text can never choose where the request goes.
function urlError(url, isTemplate) {
  if (typeof url !== 'string' || url.length === 0) return 'URL is missing';
  if (url.length > 2000) return 'URL is too long';
  if (/\s/.test(url)) return 'URL must not contain whitespace';
  if (!/^https?:\/\/[^/?#]/i.test(url)) return 'only http: and https: URLs are allowed';
  const probe = isTemplate ? url.split('{}').join('x') : url;
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
    const first = url.indexOf('{}');
    if (first < 0) return 'template must contain {}';
    const authorityStart = url.indexOf('://') + 3;
    const hostEnd = url.slice(authorityStart).search(/[/?#]/);
    if (hostEnd < 0 || first < authorityStart + hostEnd) return '{} must come after the host';
  }
  return null;
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
    const tErr = urlError(raw.template, true);
    if (tErr) return { error: 'template: ' + tErr };
    entry.template = raw.template;
  }
  return { entry };
}

function encodeRest(entry, rest) {
  if (entry.escape === 'path') return rest.split('/').map(encodeURIComponent).join('/');
  return encodeURIComponent(rest);
}

// -> { url, note? }
function buildUrl(entry, rest) {
  if (!rest) return { url: entry.base };
  if (!entry.template) {
    return { url: entry.base, note: "'" + entry.name + "' has no template; ignoring the argument" };
  }
  return { url: entry.template.split('{}').join(encodeRest(entry, rest)) };
}

export { SHIPPED_DEFAULT, RESERVED, starters, urlError, nameError, validateEntry, buildUrl };
