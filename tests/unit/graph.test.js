import test from 'node:test';
import assert from 'node:assert/strict';
import * as A from '../../js/core/aliases.js';
import { edit, actionFor, historySearch } from '../../js/core/lineedit.js';
import * as C from '../../js/core/completion.js';
import { convert } from '../../js/lib/units.js';
import * as G from '../../js/core/graph.js';
import { makeApp, graphEnv, fanOf } from '../helpers.mjs';

test('graph mode: usage lines become forms (words, placeholders, optional parts, alternatives)', () => {
  const forms = (line) => G.parseUsage(line).map((f) => f.seq.map((el) => (el.lit ? el.words.join('|') : el.display + (el.rest ? '…' : ''))).join(' '));
  assert.deepEqual(forms('cook convert <amount> <measure> <ingredient>'), ['convert <amount:number> <measure> <ingredient>…']);
  assert.deepEqual(forms('n <id> [edit [<field> [<value>]] | rm]'), ['<id>', '<id> edit', '<id> edit <field>', '<id> edit <field> <value>…', '<id> rm']);
  assert.deepEqual(forms('cal next|last'), ['next|last']);
  assert.deepEqual(forms('font bigger | smaller'), ['bigger', 'smaller']);
  assert.deepEqual(forms('tasks add <text> [due:<date>]'), ['add <text>…', 'add <text>… due:<date>']);
  assert.deepEqual(forms('widgets <name> move top|up|<n>'), ['<name> move top|up', '<name> move <n:number>']);
  assert.deepEqual(forms('find /<regex>/[flags]'), ['/<regex>/[flags]']);
  assert.deepEqual(forms('cook target [food]'), ['target', 'target <food>…']);
  const re = G.parseUsage('t <text> [due:<date>]')[1].seq[1].re;
  assert.ok(re.test('due:fri') && !re.test('milk'));
  assert.equal(G.parseUsage('x ' + Array.from({ length: 12 }, (_, i) => '[o' + i + ']').join(' ')).length, 400); // capped
});

test('graph mode: the prefix turns it on, Esc or deleting it turns it off', async () => {
  const app = await makeApp();
  const env = graphEnv(app);
  assert.equal(G.graphView('cook convert', env), null);
  assert.equal(G.graphView('graph', env), null);
  assert.equal(G.graphView('graphs ', env), null);
  assert.ok(G.graphView('graph ', env));
  assert.ok(G.graphView('Graph cook', env));
  assert.equal(G.leave('graph cook convert 2 cups'), 'cook convert 2 cups');
  assert.equal(G.leave('cook'), 'cook');
  assert.equal(G.unwrap('graph cook convert 2 cups flour'), 'cook convert 2 cups flour');
  assert.equal(G.unwrap('graph :sort alpha'), null); // the graph command itself
  assert.equal(G.unwrap('graph'), null);
  assert.equal(G.unwrap('cook'), null);
});

test('graph mode: the fan at every depth of every command, and the text runs as typed', async () => {
  const app = await makeApp();
  await app.run('t buy milk');
  const env = graphEnv(app);
  const root = G.graphView('graph ', env);
  for (const d of app.commands.defs.filter((x) => !x.hidden && x.name !== 'graph')) assert.ok(fanOf(root).includes(d.name), d.name);
  assert.ok(fanOf(root).includes('g') && fanOf(root).includes(':sort'));
  let views = 0;
  for (const d of app.commands.defs.filter((x) => !x.hidden)) {
    for (const u of d.usage) {
      for (const f of G.parseUsage(u)) {
        const words = f.seq.map((el) => (el.lit ? el.words[0] : el.type === 'number' ? '2' : el.type === 'date' ? 'friday' : el.re ? el.ph.replace(/<[^>]*>/g, 'x').replace(/[[\]"]/g, '') : 'x'));
        for (let k = 0; k <= words.length; k++) {
          const text = 'graph ' + [d.name, ...words.slice(0, k)].join(' ') + ' ';
          const v = G.graphView(text, env);
          views++;
          assert.ok(!v.ambiguous && !v.offMap, text);
          assert.ok(v.fan.length || v.canEnd, text + ': nothing next and not complete');
          assert.equal(v.run, text.slice(6).trim(), text);
        }
      }
    }
  }
  assert.ok(views > 1000);
});

test('graph mode: path, fan and usage lines; values become typed placeholders', async () => {
  const app = await makeApp();
  await app.run('t buy milk');
  const env = graphEnv(app);
  let v = G.graphView('graph cook ', env);
  assert.deepEqual(fanOf(v), ['calorie', 'convert', 'oven', 'target']);
  assert.equal(v.lines[2], 'cook convert <amount> <measure> <ingredient>');
  v = G.graphView('graph cook convert ', env);
  assert.deepEqual(fanOf(v), ['<amount:number>', '<temperature>']);
  assert.ok(v.fan.every((f) => f.ph));
  v = G.graphView('graph cook convert 2 cups plain flour', env);
  assert.deepEqual(v.path.map((n) => n.kind === 'param' ? n.value + '=' + n.label : n.value), ['cook', 'convert', '2=<amount:number>', 'cups=<measure>', 'plain=<ingredient>']);
  assert.equal(v.run, 'cook convert 2 cups plain flour');
  assert.ok(v.canEnd);
  v = G.graphView('graph cook target ', env);
  assert.ok(fanOf(v).includes('chicken-breast') && fanOf(v).includes('<food>')); // known values and the placeholder
  v = G.graphView('graph tasks ', env);
  assert.deepEqual(fanOf(v), ['add', 'all', 't1', '<id>', '#tag']); // words by use then a to z, placeholders in grammar order
  assert.deepEqual(fanOf(G.graphView('graph tasks t1 ', env)), ['done', 'edit', 'rm']);
  assert.deepEqual(fanOf(G.graphView('graph tasks t1 edit ', env)), ['done', 'due', 'repeat', 'tags', 'text', '<field>']);
  v = G.graphView('graph t buy due:fri ', env);
  assert.equal(v.path[2].label, 'due:<date>');
  assert.deepEqual(fanOf(v), ['every:<rule>', '#tag']);
  v = G.graphView('graph g cats and dogs', env); // an engine takes words
  assert.equal(v.path[1].label, '<search words>');
  assert.equal(v.run, 'g cats and dogs');
  assert.deepEqual(fanOf(G.graphView('graph :sort ', env)), ['alpha', 'freq']);
});

test('graph mode: typos resolve to their node; free text is never changed; ambiguous words wait', async () => {
  const app = await makeApp();
  await app.run('t buy milk');
  const env = graphEnv(app);
  let v = G.graphView('graph cok convrt ', env);
  assert.deepEqual(v.path.map((n) => n.value + (n.corrected ? '<' + n.text : '')), ['cook<cok', 'convert<convrt']);
  assert.deepEqual(fanOf(v), ['<amount:number>', '<temperature>']); // the fan of the resolved node
  assert.equal(G.graphView('graph cok convrt 2 cups flour', env).run, 'cook convert 2 cups flour');
  assert.equal(G.graphView('graph tsks', env).run, 'tasks');
  assert.equal(G.graphView('graph cook conevrt 1 cup sugar', env).run, 'cook convert 1 cup sugar'); // swapped letters
  assert.equal(G.graphView('graph t t1 dne', env).run, 't t1 done'); // a known id beats free text
  assert.equal(G.graphView('graph crypt kegen ed2551', env).run, 'crypt keygen ed25519');
  // Placeholders take words as they are.
  assert.equal(G.graphView('graph n ad hoc meeting', env).run, 'n ad hoc meeting');
  assert.equal(G.graphView('graph t buy dne', env).run, 't buy dne');
  assert.equal(G.graphView('graph cook convert 2 cup  flour', env).run, 'cook convert 2 cup  flour'); // spacing kept
  // Unknown first word: off the map, runs as typed (a search).
  v = G.graphView('graph best pizza near me', env);
  assert.ok(v.offMap);
  assert.equal(v.run, 'best pizza near me');
  // Ambiguous: top matches, path not committed, Enter has nothing to run.
  v = G.graphView('graph co convert', env);
  assert.ok(v.ambiguous);
  assert.equal(v.run, null);
  assert.deepEqual(v.path, []);
  assert.deepEqual(v.pending.map((t) => t.text), ['convert']);
  // The same nodes in the same order as with nothing typed: the best match is chosen, the others dimmed around it.
  assert.deepEqual(fanOf(v), fanOf(G.graphView('graph ', env)));
  assert.equal(v.fan[v.sel].value, 'color'); // a tie in the best tier: the first in order
  assert.deepEqual(v.fan.filter((f) => f.match).map((f) => f.value), ['chmod', 'color', 'config', 'cook', 'count', 'cron']);
  assert.equal(G.take('graph co convert', v, 'cook'), 'graph cook convert');
  assert.equal(G.graphView('graph cook c', env).ambiguous, true); // calorie or convert
  assert.equal(G.graphView('graph cook c', env).run, null);
});

test('graph mode is additive: Tab and ghost text complete the command as normal mode does; a tap puts a node in', async () => {
  const app = await makeApp();
  const env = graphEnv(app);
  const cenv = { defs: app.commands.defs, entries: app.data.state.aliases.entries, history: [] };
  // Completion sees through `graph `: the same candidates as for the command alone.
  assert.deepEqual(C.complete('graph cook co', cenv), C.complete('cook co', cenv));
  assert.deepEqual(C.applyTab('graph cook conv', cenv), { input: 'graph cook convert ' });
  assert.deepEqual(C.applyTab('graph tsks', cenv), { input: 'graph tasks ' }); // did you mean, too
  assert.deepEqual(C.applyTab('graph cook c', cenv), C.applyTab('cook c', cenv)); // a list: the same list
  assert.deepEqual(C.applyTab('graph :s', cenv), { input: 'graph :sort ' }); // the graph command's own word
  assert.deepEqual(C.complete('graph ', cenv).candidates, []);
  // A tapped word takes the word at the cursor and moves on; a branch of letters stays open.
  let text = 'graph cook ';
  let v = G.graphView(text, env);
  assert.equal(G.take(text, v, 'convert'), 'graph cook convert ');
  assert.equal(G.take('graph cook c', G.graphView('graph cook c', env), 'co', false), 'graph cook co');
  text = 'graph cook convert 2';
  v = G.graphView(text, env);
  assert.equal(G.take(text, v, '3'), 'graph cook convert 3 '); // a recent value
  // An earlier word picked from its list: that word changes, what followed goes.
  v = G.graphView('graph cook convert 2 ', env);
  assert.equal(G.pick('graph cook convert 2 ', v, 1, v.columns[1].items.findIndex((it) => it.value === 'oven')), 'graph cook oven ');
  assert.equal(G.pick('graph cook convert 2 ', v, 3, 0), null); // the column being typed in: a placeholder is typed, not tapped
});

test('graph mode: ranked by match, then use or a to z; counts per node path', async () => {
  const app = await makeApp();
  let prefs = G.readPrefs(null);
  assert.deepEqual(prefs, { sort: 'freq', counts: {} });
  const v1 = G.graphView('graph cook target chicken', graphEnv(app));
  assert.deepEqual(G.countKeys(v1), ['cook', 'cook target', 'cook target <food>']); // a value counts as its placeholder
  assert.deepEqual(G.countKeys(G.graphView('graph cook convert 2 cups', graphEnv(app))), ['cook', 'cook convert', 'cook convert <amount:number>', 'cook convert <amount:number> <measure>']);
  assert.deepEqual(G.countKeys(G.graphView('graph co', graphEnv(app))), []); // ambiguous: nothing ran
  for (let i = 0; i < 3; i++) prefs = G.bump(prefs, ['cook', 'cook target']);
  prefs = G.bump(prefs, ['uuid']);
  assert.deepEqual(prefs.counts, { cook: 3, 'cook target': 3, uuid: 1 });
  const freq = G.graphView('graph ', graphEnv(app, { counts: prefs.counts }));
  assert.deepEqual(fanOf(freq).slice(0, 3), ['cook', 'uuid', 'agenda']);
  const alpha = G.graphView('graph ', graphEnv(app, { counts: prefs.counts, sort: 'alpha' }));
  assert.deepEqual(fanOf(alpha).slice(0, 3), ['agenda', 'alias', 'aliases']);
  assert.equal(fanOf(alpha).pop(), ':sort'); // the graph's own node goes last
  assert.deepEqual(fanOf(G.graphView('graph cook ', graphEnv(app, { counts: prefs.counts }))), ['target', 'calorie', 'convert', 'oven']);
  // A typed word: the best match is chosen; among equally good ones, the first in order.
  const chosen = (text, extra) => { const v = G.graphView(text, graphEnv(app, Object.assign({ counts: prefs.counts }, extra))); return v.fan[v.sel].value; };
  assert.equal(chosen('graph u'), 'uuid');
  assert.equal(chosen('graph u', { sort: 'alpha' }), 'ua');
  assert.equal(chosen('graph uu', { sort: 'alpha' }), 'uuid');
  assert.equal(chosen('graph cook c'), 'calorie');
  // The normal history counts at the root too.
  assert.equal(fanOf(G.graphView('graph ', graphEnv(app, { history: ['ping a', 'ping b'] })))[0], 'ping');

  // Columns: one per word, its node at the centre, the nodes sorting before and after around it.
  const v = G.graphView('graph cok convrt 2 cups plain flour', graphEnv(app));
  const cols = v.columns.map((c) => [c.value, c.sub, c.kind, c.active ? 'active' : '']);
  assert.deepEqual(cols, [['cook', '', 'command', ''], ['convert', '', 'word', ''], ['2', '<amount:number>', 'param', ''],
    ['cups', '<measure>', 'param', ''], ['plain flour', '<ingredient>', 'param', 'active']]); // free text: one column
  const cook = v.columns[0];
  assert.equal(cook.items[cook.at].value, 'cook');
  assert.deepEqual(cook.items.slice(cook.at - 2, cook.at + 3).map((i) => i.value), ['color', 'config', 'cook', 'count', 'cron']);
  assert.ok(cook.corrected && cook.typed === 'cok');
  // Typed text nothing matches sits where it would sort, marked.
  const miss = G.graphView('graph cook xyz', graphEnv(app)).columns[1];
  assert.deepEqual([miss.value, miss.kind, miss.hit, miss.items[miss.at - 1].value], ['xyz', 'miss', false, 'target']);
  // A word nobody knows (a search) gets a column too.
  assert.deepEqual(G.graphView('graph best pizza', graphEnv(app)).columns.map((c) => c.kind), ['raw', 'miss']);
  // Picking in an earlier column changes that word and drops what depended on it.
  assert.equal(G.pick('graph cok convrt 2 cups plain flour', v, 1, v.columns[1].items.findIndex((i) => i.value === 'oven')), 'graph cok oven ');
  assert.equal(G.pick('graph cook ', G.graphView('graph cook ', graphEnv(app)), 0, 0), 'graph agenda ');
  // Stored prefs are checked; the counts are capped.
  assert.deepEqual(G.readPrefs({ sort: 'zzz', counts: { a: 2, b: -1, c: 'x', d: 1.5 } }), { sort: 'freq', counts: { a: 2 } });
  let big = { sort: 'alpha', counts: {} };
  for (let i = 0; i < 450; i++) big.counts['k' + i] = i + 1;
  big = G.bump(big, ['new']);
  assert.equal(Object.keys(big.counts).length, 400);
  assert.equal(big.sort, 'alpha');
  assert.ok(!('new' in big.counts) && 'k449' in big.counts);
});

test('graph mode: the forward pane is the letter tree at the cursor, with what each word leads to', async () => {
  const app = await makeApp();
  const env = graphEnv(app, { history: ['cook convert 2 cups flour', 'graph cook convert 3 tbsp sugar', 'tasks add call mum', 't buy milk'] });
  const fw = (t) => G.graphView(t, env).forward;
  const tree = (n) => n.edge + (n.word ? '=' + n.word.value : '') + (n.children.length ? '(' + n.children.map(tree).join(' ') + ')' : '');
  let f = fw('graph cook ');
  assert.deepEqual(f.words.map((w) => w.value), ['calorie', 'convert', 'oven', 'target']);
  assert.equal(tree(f.trie), '(c(alorie=calorie onvert=convert) oven=oven target=target)'); // radix: shared letters once
  assert.equal(f.trie.size, 4);
  const convert = f.words[1];
  assert.deepEqual(convert.next, ['<amount:number>', '<temperature>']);
  assert.ok(convert.reach.includes('cook convert <amount> <measure> <ingredient>') && !convert.end);
  assert.ok(f.words[3].end && f.words[3].next.includes('chicken-breast')); // cook target: complete, or a food
  f = fw('graph cook co'); // narrows as you type; rooted at the cursor
  assert.equal(tree(f.trie), 'co(nvert=convert)');
  assert.deepEqual([f.words[0].rest, f.words[0].best], ['nvert', true]);
  assert.deepEqual(f.typos, []); // calorie has c…o only in order: not shown while a word starts with 'co'
  f = fw('graph cook covert');
  assert.deepEqual([f.words.length, f.typos.map((w) => w.value)], [0, ['convert']]); // a typo, shown apart
  f = fw('graph co');
  assert.ok(f.words.length >= 1 && f.words.every((w) => w.value.toLowerCase().startsWith('co')));
  assert.equal(f.words.filter((w) => w.best).length, 1);
  assert.equal(fw('graph ').trie.size, fw('graph ').words.length);
  // Open slots: their shape, and what was typed there before (after the same words).
  f = fw('graph cook convert ');
  assert.deepEqual(f.slots.map((s) => [s.display, s.type, s.rest]), [['<amount:number>', 'number', false], ['<temperature>', 'text', true]]);
  assert.deepEqual(f.slots[0].recent, ['3', '2']); // newest first, typed in graph mode or not
  assert.deepEqual(fw('graph cook convert 2').slots[0], { display: '<amount:number>', type: 'number', rest: false, takes: true, recent: ['2'] });
  assert.deepEqual(fw('graph cook convert 2 cups ').slots[0].recent, ['flour']);
  assert.deepEqual(fw('graph tasks add ').slots[0].recent, ['call mum']); // free text: the rest of the line
  assert.deepEqual(fw('graph t ').slots[0].recent, ['buy milk']); // 'tasks add call mum' took the word add here
  f = fw('graph zzzz foo '); // off the map: nothing ahead
  assert.deepEqual([f.words, f.typos, f.slots], [[], [], []]);
});

test('graph command: explains the mode and switches the ranking on this device', async () => {
  const app = await makeApp();
  const out = await app.run('graph');
  assert.equal(out[0], '# Graph mode · experimental · a map of every command as you type it');
  assert.equal(app.ctx.inputSet, 'graph ');
  assert.deepEqual((await app.run('graph :sort')).slice(0, 1), ['# Graph mode is ranking by use']);
  assert.deepEqual((await app.run('graph :sort alpha')).slice(0, 1), ['# Graph mode ranks a to z']);
  assert.equal(G.readPrefs(app.store.getLocal(G.PREFS_KEY)).sort, 'alpha');
  assert.match((await app.run('graph :sort size'))[0], /^err: graph :sort takes freq or alpha/);
  await app.run('graph :sort freq');
  assert.equal(G.readPrefs(app.store.getLocal(G.PREFS_KEY)).sort, 'freq');
  assert.match((await app.run('graph cook'))[0], /^err: Graph mode runs commands from the prompt/);
  assert.equal(app.data.state.settings.graph, undefined); // device-local, never synced
});
