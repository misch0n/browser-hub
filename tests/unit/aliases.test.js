import test from 'node:test';
import assert from 'node:assert/strict';
import * as A from '../../js/core/aliases.js';
import { dispatch } from '../../js/core/dispatch.js';
import { edit, actionFor, historySearch } from '../../js/core/lineedit.js';
import { linkURL } from '../../js/core/records.js';
import { createData, DEFAULTS } from '../../js/core/data.js';
import { merge } from '../../js/core/importer.js';
import { MON, isBuiltin, makeApp } from '../helpers.mjs';

test('aliases: url validation', () => {
  assert.equal(A.urlError('https://github.com/', false), null);
  assert.match(A.urlError('javascript:alert(1)', false), /http/);
  assert.match(A.urlError('data:text/html,hi', false), /http/);
  assert.match(A.urlError('https:example.com', false), /http/);
  assert.equal(A.urlError('https://x.com/?q=a b "c"', false), null); // spaces and quotes are encoded on the way out
  assert.match(A.urlError('https://x.com/\ta', false), /tabs/);
  assert.match(A.urlError('https:// x.com/', false), /http/);
  assert.equal(A.urlError('https://x.com/{1}/{2}', true), null);
  assert.match(A.urlError('https://{1}.x.com/', true), /after the host/);
  assert.equal(A.urlError('https://x.com/?q={}', true), null);
  assert.match(A.urlError('https://x.com/', true), /\{\}/);
  assert.match(A.urlError('https://{}.evil.com/', true), /after the host/);
  assert.match(A.urlError('https://x.com@{}', true), /after the host/);
});

test('aliases: validateEntry and buildUrl', () => {
  assert.equal(A.validateEntry({ name: 'GH', base: 'https://github.com/' }, isBuiltin).entry.name, 'gh');
  assert.match(A.validateEntry({ name: 'help', base: 'https://x.com/' }, isBuiltin).error, /built-in/);
  assert.match(A.validateEntry({ name: 'rm', base: 'https://x.com/' }, isBuiltin).error, /reserved/);
  assert.match(A.validateEntry({ name: 'js', base: 'https://x.com/', template: 'javascript:{}' }, isBuiltin).error, /template/);
  const q = { name: 'g', base: 'https://g.com/', template: 'https://g.com/?q={}', escape: 'query' };
  const p = { name: 'gh', base: 'https://gh.com/', template: 'https://gh.com/{}', escape: 'path' };
  assert.equal(A.buildUrl(q, 'a/b c').url, 'https://g.com/?q=a%2Fb%20c');
  assert.equal(A.buildUrl(p, 'org/repo').url, 'https://gh.com/org/repo');
  assert.equal(A.buildUrl(q, "$& $1").url, 'https://g.com/?q=%24%26%20%241');
  assert.match(A.buildUrl({ name: 'x', base: 'https://x.com/', escape: 'query' }, 'arg').note, /ignoring/);

  // %s is stored as {}; numbered placeholders take single (quotable) arguments.
  assert.equal(A.validateEntry({ name: 'w', base: 'https://w.org/', template: 'https://w.org/?s=%s' }, isBuiltin).entry.template, 'https://w.org/?s={}');
  const j = { name: 'jira', base: 'https://j.com/', template: 'https://j.com/{1}/browse/{2}', escape: 'query' };
  assert.equal(A.arity(j.template), 2);
  assert.equal(A.buildUrl(j, 'ABC 12').url, 'https://j.com/ABC/browse/12');
  assert.equal(A.buildUrl(j, '"A B" more words').url, 'https://j.com/A%20B/browse/more%20words'); // last one takes the rest
  assert.match(A.buildUrl(j, 'ABC').error, /needs 2 arguments, got 1/);
  // The JQL alias: quotes and spaces in the template, the phrase inside its quotes.
  const jql = 'https://jira.example.net/issues/?jql=project="UBMVC" AND "Migrated From Bugzilla Id" ~ "%s"';
  const mobile = A.validateEntry({ name: 'mobile', base: A.siteRoot(jql), template: jql }, isBuiltin).entry;
  assert.equal(mobile.base, 'https://jira.example.net/');
  const url = A.buildUrl(mobile, '12345').url;
  assert.equal(url, 'https://jira.example.net/issues/?jql=project="UBMVC" AND "Migrated From Bugzilla Id" ~ "12345"');
  assert.equal(new URL(url).href, 'https://jira.example.net/issues/?jql=project=%22UBMVC%22%20AND%20%22Migrated%20From%20Bugzilla%20Id%22%20~%20%2212345%22');
});

test('dispatch: builtin, alias, engine, fallback', () => {
  const entries = A.starters().concat([{ name: 'gh', base: 'https://github.com/', template: 'https://github.com/{}', escape: 'path' }]);
  const env = { isBuiltin, entries, defaultEngine: 'g' };
  const d = (s) => dispatch(s, env);
  assert.deepEqual(d('   '), { kind: 'empty' });
  assert.deepEqual(d('T   buy   flour'), { kind: 'builtin', name: 't', rest: 'buy   flour' });
  assert.equal(d('gh').url, 'https://github.com/');
  assert.equal(d('gh org/repo').url, 'https://github.com/org/repo');
  assert.equal(d('g how to proof sourdough').url, 'https://www.google.com/search?q=how%20to%20proof%20sourdough');
  assert.equal(d('vitosha weather').url, 'https://www.google.com/search?q=vitosha%20weather');
  assert.equal(d('gihtub').kind, 'search');
  // An engine with a phrase is a search on that engine; unknown input falls back to the default.
  assert.deepEqual(d('ddg sourdough starter'), { kind: 'search', url: 'https://duckduckgo.com/?q=sourdough%20starter', name: 'ddg', query: 'sourdough starter', fallback: false });
  assert.deepEqual(d('gtg'), { kind: 'search', url: 'https://www.google.com/search?q=gtg', name: 'g', query: 'gtg', fallback: true });
  assert.equal(d('gh org/repo').kind, 'search');
  assert.equal(d('ddg').kind, 'redirect');
  assert.equal(dispatch('x', { isBuiltin, entries: [], defaultEngine: 'g' }).kind, 'error');
  assert.equal(dispatch('help', { isBuiltin, entries: [{ name: 'help', base: 'https://x.com/' }], defaultEngine: 'g' }).kind, 'builtin');
});

test('alias templates: spaces and quotes, numbered placeholders, editing', async () => {
  const app = await makeApp();
  const st = () => app.data.state;
  const env = () => ({ isBuiltin: app.commands.isBuiltin, entries: st().aliases.entries, defaultEngine: st().aliases.defaultEngine });
  const go = (s) => dispatch(s, env());
  // The JQL alias, pasted as is: no quoting needed; \/ from JSON copies is read as /.
  const def = 'alias mobile https:\\/\\/jira.example.net\\/issues\\/?jql=project="UBMVC" AND "Migrated From Bugzilla Id" ~ "%s"';
  assert.equal((await app.run(def))[0], '# Added mobile  engine');
  const mobile = st().aliases.entries.find((e) => e.name === 'mobile');
  assert.equal(mobile.template, 'https://jira.example.net/issues/?jql=project="UBMVC" AND "Migrated From Bugzilla Id" ~ "{}"');
  assert.equal(mobile.base, 'https://jira.example.net/');
  assert.equal(go('mobile 12345').url, 'https://jira.example.net/issues/?jql=project="UBMVC" AND "Migrated From Bugzilla Id" ~ "12345"');
  assert.equal(go('mobile').url, 'https://jira.example.net/');
  // Quoted, with a base and a flag after it.
  await app.run("alias q2 https://x.com/ 'https://x.com/s?q=a b {}' --force");
  assert.equal(st().aliases.entries.find((e) => e.name === 'q2').template, 'https://x.com/s?q=a b {}');
  // Numbered placeholders.
  await app.run('alias jira https://jira.example.com/browse/{1}-{2}');
  assert.equal(go('jira APP 42').url, 'https://jira.example.com/browse/APP-42');
  assert.deepEqual(go('jira APP'), { kind: 'error', message: "'jira' needs 2 arguments, got 1: https://jira.example.com/browse/{1}-{2}" });
  assert.match((await app.run('alias bad https://x.com/a b'))[0], /^# Added bad  alias/); // a base URL may have spaces too
  assert.match((await app.run('alias bad2 https://{1}.x.com/'))[0], /after the host/);
  assert.equal((await app.run('alias edit2 x'))[0].startsWith('err:'), true);

  // aliases <name> edit: in place, like everything else; the template field takes the URL as typed.
  const ed = await app.run('aliases mobile edit');
  assert.equal(ed[0], '# Editing aliases mobile · tap any value, Enter saves, Esc leaves it');
  assert.ok(ed.includes('template: ' + mobile.template + '  [aliases mobile edit template = ' + mobile.template + ']'));
  assert.equal((await app.run('alias edit mobile'))[0], ed[0]); // the older order too
  assert.equal((await app.run('aliases mobile edit template ' + mobile.template))[0], '# Updated aliases mobile template'); // reads back unchanged
  assert.equal(st().aliases.entries.find((e) => e.name === 'mobile').template, mobile.template);
  // Field edits; a rename keeps the default engine pointing at it.
  await app.run('alias edit g.name google');
  assert.equal(st().aliases.defaultEngine, 'google');
  assert.equal((await app.run('alias edit google.template none'))[0], "err: 'google' is the default engine and needs a template");
  assert.equal((await app.run('alias edit ddg.name google'))[0], "err: alias 'google' already exists");
  assert.match((await app.run('alias edit ddg.name t'))[0], /built-in/);
  assert.match((await app.run('alias edit ddg.base javascript:alert(1)'))[0], /http/);
  await app.run('alias edit ddg.template https://duckduckgo.com/?q=%s&ia=web');
  assert.equal(st().aliases.entries.find((e) => e.name === 'ddg').template, 'https://duckduckgo.com/?q={}&ia=web');
  const shown = await app.run('alias show ddg');
  assert.ok(shown.includes('template: https://duckduckgo.com/?q={}&ia=web  [aliases ddg edit template = https://duckduckgo.com/?q={}&ia=web]'));
});

test('alias and engine commands', async () => {
  const app = await makeApp();
  const add = await app.run('alias gh https://github.com/ https://github.com/{} --path');
  assert.equal(add[0], '# Added gh  engine');
  assert.ok(add.includes('escape: path'));
  const dup = await app.run('alias gh https://example.com/');
  assert.equal(dup[0], "err: Alias 'gh' already exists");
  assert.equal(dup.tone, 'err');
  assert.equal((await app.run('alias set gh https://example.com/ --force'))[0], '# Updated gh  alias');
  assert.match((await app.run('alias t https://example.com/'))[0], /'t' is a built-in command/);
  assert.match((await app.run('alias x javascript:alert(1)'))[0], /http/);
  assert.match((await app.run('alias rm g'))[0], /default engine/);
  assert.match((await app.run('engine default gh'))[0], /no template/);
  assert.deepEqual(await app.run('engine default ddg'), ['# Default engine is now ddg']);
  // A lone template defines an engine; its base is the site root. `%s` works like `{}`.
  assert.equal((await app.run('alias yt https://www.youtube.com/results?search_query={}'))[0], '# Added yt  engine');
  assert.deepEqual(app.data.state.aliases.entries.find((e) => e.name === 'yt'),
    { name: 'yt', base: 'https://www.youtube.com/', template: 'https://www.youtube.com/results?search_query={}', escape: 'query' });
  await app.run('alias w https://en.wikipedia.org/w/index.php?search=%s');
  assert.equal(app.data.state.aliases.entries.find((e) => e.name === 'w').template, 'https://en.wikipedia.org/w/index.php?search={}');
  assert.match((await app.run('alias bad https://x.com{}'))[0], /after the host/);
  await app.run('alias rm yt');
  await app.run('alias rm w');
  const ls = await app.run('alias ls');
  assert.equal(ls[0], '# 3 aliases · 2 engines');
  assert.ok(ls.some((l) => /^ddg \| your engine \| .* \| ★ default$/.test(l)));
  assert.deepEqual(await app.run('aliases'), ls); // the noun lists the same
  assert.match((await app.run('aliases gh'))[0], /^# gh  alias/);
  assert.deepEqual(await app.run('aliases ddg default'), ['# Default engine is now ddg']);
  assert.match((await app.run('aliases add gh2 https://github.com/'))[0], /^# Added gh2  alias/);
  assert.match((await app.run('aliases gh2 rm'))[0], /^# Removed gh2/);
});

test('command aliases: defined like URL aliases, run a built-in with placeholders, listed next to it', async () => {
  const A = await import('../../js/core/aliases.js');
  const isB = (n) => ['tasks', 'zones', 'notes'].includes(n);
  assert.deepEqual(A.validateEntry({ name: 'groc', command: 'tasks add %s #groceries' }, isB), { entry: { name: 'groc', command: 'tasks add {} #groceries' } });
  assert.match(A.validateEntry({ name: 'x', command: 'gh org' }, isB).error, /'gh' is not a built-in command \(an alias can run a command, not another alias\)/);
  assert.match(A.validateEntry({ name: 'x', command: 'tasks\nrm' }, isB).error, /one line/);
  assert.match(A.validateEntry({ name: 'tasks', command: 'notes' }, isB).error, /built-in command/);
  assert.deepEqual(A.expandCommand({ name: 'mv', command: 'zones {1} edit name {2}' }, 'tokyo "Kenji team"'), { input: 'zones tokyo edit name "Kenji team"' });
  assert.deepEqual(A.expandCommand({ name: 'mv', command: 'zones {1} edit name {2}' }, '"new york" Bob'), { input: 'zones "new york" edit name Bob' });
  assert.match(A.expandCommand({ name: 'mv', command: 'zones {1} edit name {2}' }, 'tokyo').error, /needs 2 arguments, got 1/);
  assert.deepEqual(A.expandCommand({ name: 'tt', command: 'tasks' }, 't3 done'), { input: 'tasks t3 done' });

  const app = await makeApp();
  const add = await app.run('alias groc tasks add {} #groceries');
  assert.deepEqual(add.slice(0, 2), ['# Added groc  runs tasks', 'runs: tasks add {} #groceries']);
  assert.equal(add.tone, 'ok');
  await app.run('aliases add tt tasks');
  // Running one runs the target with the placeholders filled (main.js also prints → <command>; see e2e).
  assert.equal((await app.run('groc oat milk'))[0], '# Added task t1');
  assert.deepEqual([app.data.state.tasks.items[0].text, app.data.state.tasks.items[0].tags], ['oat milk', ['groceries']]);
  await app.run('tt t1 done');
  assert.equal(app.data.state.tasks.items[0].done, true);
  assert.equal((await app.run('groc'))[0], "err: 'groc' needs something for its placeholder: tasks add {} #groceries");
  // Shown with its own fields; edited like everything else; can't be the default engine.
  const show = await app.run('aliases groc');
  assert.equal(show[0], '# groc  command alias  ');
  assert.deepEqual(show.slice(1, 3), ['name: groc  [aliases groc edit name = groc]', 'command: tasks add {} #groceries  [aliases groc edit command = tasks add {} #groceries]']);
  assert.equal((await app.run('aliases groc edit command tasks add {} #shop'))[0], '# Updated aliases groc command');
  assert.equal(app.data.state.aliases.entries.find((e) => e.name === 'groc').command, 'tasks add {} #shop');
  assert.match((await app.run('aliases groc edit base https://x.org/'))[0], /^err: Aliases that run a command have no field base/);
  assert.match((await app.run('aliases groc edit command gh x'))[0], /^err: command: 'gh' is not a built-in command/);
  assert.equal((await app.run('aliases groc default'))[0], "err: 'groc' runs a command, so it can't be a search engine");
  assert.match((await app.run('alias groc notes --force'))[0], /^# Updated groc  runs notes/);
  // Help lists it next to the command it runs, marked as yours; help <alias> explains it.
  const help = await app.run('help');
  assert.ok(help.some((l) => /^notes, n, groc↗ \| /.test(l)), help.find((l) => l.startsWith('notes')));
  assert.ok(help.some((l) => /^tasks, t, tt↗ \| /.test(l)));
  assert.deepEqual((await app.run('help tt')).slice(0, 2), ['tt↗ your alias: runs tasks', '# tasks · list, add, show, edit, complete and remove tasks']);
  // An alias whose command is no longer built in is listed as broken (an imported one, say).
  await app.data.mutate('aliases', (d) => { d.entries.push({ name: 'old', command: 'gone x' }); });
  assert.ok((await app.run('help')).includes("old | gone x  broken: 'gone' is not a command"));
  assert.equal((await app.run('old 1'))[0], "err: 'old' runs 'gone', which is not a built-in command");
  // Listed among aliases, and found.
  const list = await app.run('aliases');
  assert.match(list[0], /1 command alias|3 command aliases/);
  assert.ok(list.includes('groc | your command alias | notes | '));
  assert.ok((await app.run('find groc')).some((l) => /groc/.test(l)));
  // Import validates the same way.
  const { merge: mergeImport } = await import('../../js/core/importer.js');
  const other = await makeApp();
  const cur = {};
  for (const k of Object.keys(DEFAULTS)) cur[k] = other.data.state[k];
  const imp = mergeImport(cur, { schema: 1, collections: { aliases: { entries: [{ name: 'groc', command: 'tasks add {}' }, { name: 'bad', command: 'nope' }] } } }, other.commands.isBuiltin, () => MON);
  assert.deepEqual(imp.collections.aliases.entries.filter((e) => e.command), [{ name: 'groc', command: 'tasks add {}' }]);
});

test('web addresses: a bare host is https, this machine is http, other schemes are refused', () => {
  assert.equal(linkURL('example.com/a?b=1'), 'https://example.com/a?b=1');
  assert.equal(linkURL('http://example.com'), 'http://example.com/');
  assert.equal(linkURL('//example.com/x'), 'https://example.com/x');
  assert.equal(linkURL('localhost:8000/app'), 'http://localhost:8000/app'); // a port, not a scheme
  assert.equal(linkURL('127.0.0.1:3000'), 'http://127.0.0.1:3000/');
  assert.equal(linkURL('[::1]:5173'), 'http://[::1]:5173/');
  assert.equal(linkURL('example.com:8443/x'), 'https://example.com:8443/x');
  for (const bad of ['javascript:alert(1)', 'data:text/html,hi', 'file:///etc/passwd', 'ftp://example.com', 'cats', 'two words.com', '']) assert.equal(linkURL(bad), null, bad);
});

test('go: opens an address as an alias does, once the command is in the history', async () => {
  const app = await makeApp();
  app.ctx.navigateAfter = null;
  assert.deepEqual(await app.run('go example.com/docs?x=1'), ['# Opening example.com/docs?x=1', 'dim: https://example.com/docs?x=1']);
  assert.equal(app.ctx.navigateAfter, 'https://example.com/docs?x=1');
  app.ctx.navigateAfter = null;
  await app.run('go localhost:8000');
  assert.equal(app.ctx.navigateAfter, 'http://localhost:8000/');
  app.ctx.navigateAfter = null;
  assert.match((await app.run('go javascript:alert(1)'))[0], /^err: Only http and https addresses open from here/);
  assert.match((await app.run('go cats'))[0], /^err: 'cats' is not a web address/);
  assert.match((await app.run('go cute cats'))[0], /^err: A web address has no spaces/);
  assert.equal(app.ctx.navigateAfter, null); // nothing opens
  assert.match((await app.run('go'))[0], /Usage/);
  // Tab offers the addresses opened before, newest first.
  await app.data.addHistory('go example.com/a');
  await app.data.addHistory('go example.org');
  await app.data.addHistory('go example.com/a');
  const go = app.commands.defs.find((d) => d.name === 'go');
  assert.deepEqual(go.complete([]).map((c) => c.value), ['example.com/a', 'example.org']);
});
