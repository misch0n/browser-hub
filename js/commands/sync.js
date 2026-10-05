import { relative } from '../lib/misc.js';
import { REPO_RE } from '../sync.js';

// sync: keep notes, tasks, events, aliases and settings in a file in a
// private GitHub repository. The token stays on this device.

const HOW = [
  'Make a private repository on GitHub (an empty one is fine), e.g. browser-hub-data',
  'Make a fine-grained token at github.com/settings/personal-access-tokens/new: only that repository, Contents: Read and write, and an expiry',
  'Run: sync setup <you>/<repository>  (the prompt then asks for the token, hidden)',
];

export default function register(add, { usage }) {
  add({
    name: 'sync', group: 'Sync', noUndo: true,
    desc: 'sync with a private GitHub repository; the token stays on this device',
    usage: ['sync', 'sync setup <owner/repo> [file]', 'sync now', 'sync token', 'sync off'],
    examples: ['sync setup me/browser-hub-data', 'sync now', 'sync token'],
    complete: (prev) => (prev.length === 0 ? ['setup', 'now', 'token', 'off'].map((v) => ({ value: v })) : []),
    async run(ctx, rest) {
      const { out } = ctx;
      const sync = ctx.sync;
      if (!sync) return out.err('Sync is not available here');
      const [sub, ...args] = rest.trim().split(/\s+/).filter(Boolean);
      const cmd = (sub || '').toLowerCase();

      const report = (r, what) => {
        if (!r || r.off) return;
        out.head([[what, ''], [sync.config.repo, 'strong'], [' · ' + sync.config.path, 'dim']], 'ok');
        out.line([[r.pulled ? 'got changes from the repository' : 'nothing new in the repository', 'dim'], [' · ', 'faint'],
          [r.pushed ? 'sent this device\'s changes' : 'nothing to send', 'dim']]);
        for (const x of r.renumbered || []) out.warn(x.from + ' was also made on another device; this one is now ' + x.to);
        if (r.conflicts && r.conflicts.length) out.warn('changed on both devices, kept this device\'s version: ' + r.conflicts.join(', '));
      };
      const failed = (e) => {
        out.err(e.message);
        if (e.kind === 'auth') out.dim('Make a new token (same repository, Contents: Read and write) and run: sync token');
      };
      const askToken = (repo) => ctx.askSecret('GitHub token for ' + repo + ' (hidden)');

      if (!cmd || cmd === 'status') {
        const c = sync.config;
        if (!c) {
          out.head([['Sync is off', 'strong'], [' · everything is on this device only', 'dim']]);
          out.table(null, HOW.map((x, i) => [[[String(i + 1), 'num']], [[x, '']]]), { stack: true });
          return;
        }
        const s = sync.status;
        const state = { ok: ['in sync', 'ok'], syncing: ['syncing…', 'info'], idle: ['waiting', 'dim'], error: ['failing', 'err'], auth: ['token refused', 'err'] }[s.state] || [s.state, 'dim'];
        out.head([['Sync', 'strong'], [' · ', 'faint'], state], s.state === 'error' || s.state === 'auth' ? 'err' : 'ok');
        out.kv([
          ['repository', [[c.repo, 'strong']]],
          ['file', [[c.path, ''], [c.branch ? ' on ' + c.branch : '', 'dim']]],
          ['last sync', c.lastSync ? [[relative(new Date(c.lastSync), ctx.now()), 'dim']] : [['never', 'faint']]],
          ['token', sync.hasToken ? [[sync.tokenHint(), 'dim'], [' · on this device only', 'faint']] : [['none on this device', 'err']]],
        ]);
        if (s.message) out.err(s.message);
        if (s.state === 'auth') out.dim('Run sync token to enter a new one');
        else out.dim('sync now · sync token · sync off');
        return;
      }

      if (cmd === 'setup') {
        const [repo, path] = args;
        if (!repo || args.length > 2) return usage(ctx, this);
        if (!REPO_RE.test(repo)) return out.err("'" + repo + "' is not owner/repository");
        if (path && !/^[\w.\-/]+\.json$/.test(path)) return out.err('the file must be a .json path inside the repository');
        const tok = await askToken(repo);
        if (!tok) return out.head('Cancelled; nothing was saved', 'dim');
        out.dim('Checking ' + repo + '…');
        try {
          report(await sync.setup(repo, path, tok), 'Syncing with ');
          out.dim('Changes sync a few seconds after you make them, and when the page opens or comes back into view');
        } catch (e) {
          failed(e);
        }
        return;
      }

      if (cmd === 'token') {
        if (!sync.config) return out.err('Sync is not set up · sync setup <owner/repo>');
        const tok = await askToken(sync.config.repo);
        if (!tok) return out.head('Cancelled; the old token is unchanged', 'dim');
        try {
          report(await sync.setToken(tok), 'New token saved · syncing with ');
        } catch (e) {
          failed(e);
        }
        return;
      }

      if (cmd === 'now') {
        if (!sync.config) return out.err('Sync is not set up · sync setup <owner/repo>');
        try {
          report(await sync.syncNow(), 'Synced with ');
        } catch (e) {
          failed(e);
        }
        return;
      }

      if (cmd === 'off') {
        if (!sync.config) return out.head('Sync is already off', 'dim');
        const repo = sync.config.repo;
        sync.off();
        out.head([['Sync is off', 'ok'], [' · the token is forgotten on this device; your data stays here and in ' + repo, 'dim']], 'ok');
        return;
      }
      return usage(ctx, this);
    },
  });
}

