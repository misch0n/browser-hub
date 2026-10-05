// A small in-memory GitHub REST API: just what sync uses. Shared by the unit
// tests (as a fetch) and the browser tests (behind page.route).
//   const gh = fakeGitHub({ tokens: ['good'], repos: { 'me/data': { private: true } } });
//   gh.fetch(url, init) -> Promise<Response-like>; gh.handle(method, url, headers, bodyText) -> { status, json }

export function fakeGitHub({ tokens = [], repos = {} } = {}) {
  const valid = new Set(tokens);
  const state = { repos: {}, requests: [], failNextPut: 0 };
  for (const [name, r] of Object.entries(repos)) state.repos[name] = { private: r.private !== false, push: r.push !== false, branch: 'main', files: {} };
  let shaN = 0;
  const b64 = (s) => Buffer.from(s, 'utf8').toString('base64');

  function handle(method, url, headers, bodyText) {
    const u = new URL(url);
    state.requests.push(method + ' ' + u.pathname);
    const auth = headers.authorization || headers.Authorization || '';
    if (!valid.has(auth.replace(/^Bearer /, ''))) return { status: 401, json: { message: 'Bad credentials' } };
    const m = /^\/repos\/([^/]+\/[^/]+)(\/contents\/(.+))?$/.exec(u.pathname);
    const repo = m && state.repos[m[1]];
    if (!repo) return { status: 404, json: { message: 'Not Found' } };
    if (!m[2]) return { status: 200, json: { full_name: m[1], private: repo.private, default_branch: repo.branch, permissions: { push: repo.push } } };
    const path = decodeURIComponent(m[3]);
    const file = repo.files[path];
    if (method === 'GET') {
      if (!file) return { status: 404, json: { message: 'Not Found' } };
      return { status: 200, json: { type: 'file', path, sha: file.sha, size: file.text.length, encoding: 'base64', content: b64(file.text).replace(/(.{60})/g, '$1\n') } };
    }
    if (method === 'PUT') {
      if (!repo.push) return { status: 403, json: { message: 'Resource not accessible by personal access token' } };
      const body = JSON.parse(bodyText);
      if (state.failNextPut > 0) { state.failNextPut--; return { status: 409, json: { message: 'is at a different sha' } }; }
      if (file && body.sha !== file.sha) return { status: 409, json: { message: path + ' does not match ' + body.sha } };
      if (!file && body.sha) return { status: 422, json: { message: 'sha given for a new file' } };
      const text = Buffer.from(body.content, 'base64').toString('utf8');
      const sha = 'sha' + (++shaN);
      repo.files[path] = { text, sha, message: body.message };
      return { status: file ? 200 : 201, json: { content: { path, sha } } };
    }
    return { status: 405, json: { message: 'Method not allowed' } };
  }

  async function fetch(url, init = {}) {
    const r = handle(init.method || 'GET', url, init.headers || {}, init.body || '');
    return { status: r.status, ok: r.status < 300, json: async () => r.json };
  }

  // The data in a repo's sync file, parsed.
  const file = (repo, path = 'browser-hub/data.json') => {
    const f = state.repos[repo].files[path];
    return f ? JSON.parse(f.text) : null;
  };

  // Puts a file in a repo, as another project sharing it would have.
  const seed = (repo, path, text) => { state.repos[repo].files[path] = { text, sha: 'seed' + (++shaN) }; };
  const raw = (repo, path) => (state.repos[repo].files[path] || {}).text;
  const message = (repo, path = 'browser-hub/data.json') => (state.repos[repo].files[path] || {}).message;

  return { handle, fetch, state, file, seed, raw, message, revoke: (t) => valid.delete(t), allow: (t) => valid.add(t) };
}
