import test from 'node:test';
import assert from 'node:assert/strict';
import * as A from '../../js/core/aliases.js';
import { edit, actionFor, historySearch } from '../../js/core/lineedit.js';
import { createSync } from '../../js/sync.js';
import * as Sync from '../../js/sync.js';
import { fakeGitHub } from '../fake-github.mjs';
import { createData, DEFAULTS } from '../../js/core/data.js';
import { merge } from '../../js/core/importer.js';
import * as M from '../../js/lib/misc.js';
import * as Dia from '../../js/lib/diagrams.js';
import { MON, makeApp } from '../helpers.mjs';

test('snippets and later: the shared grammar, names, read state, undo, find, export, sync', async () => {
  const app = await makeApp();
  // Snippets: snip <name> <text> adds, snip <name> shows it ready to copy.
  assert.deepEqual(await app.run('snip sig Best regards, Mihail'), ['# Added snippet sig · s1']);
  const shown = await app.run('snip sig');
  assert.deepEqual(shown.slice(0, 2), ['# Snippet sig · s1', '= Best regards, Mihail']);
  assert.equal(shown.copied, 'Best regards, Mihail');
  assert.equal((await app.run('snippets s1'))[1], '= Best regards, Mihail'); // by id too
  assert.match((await app.run('snip sig again'))[0], /^err: There is already a snippet named 'sig'/);
  assert.match((await app.run('snip s2 text'))[0], /^err: The name is one word/); // ids aren't names
  await app.run('snippets add addr "1 Long Street, Sofia"');
  assert.equal((await app.run('snip addr'))[1], '= 1 Long Street, Sofia');
  const list = await app.run('snippets');
  assert.deepEqual(list, ['# 2 snippets · snip <name> copies one', '| id | name | text', 's2 | addr | 1 Long Street, Sofia', 's1 | sig | Best regards, Mihail']);
  // Edit by name or id, rename, refuse a clash.
  await app.run('snip sig edit text Cheers, M');
  assert.equal(app.data.state.snippets.items[0].text, 'Cheers, M');
  assert.equal((await app.run('snippets s1 edit name addr'))[0], "err: a snippet named 'addr' already exists");
  await app.run('snippets s1 edit name signature');
  assert.equal((await app.run('snip signature'))[1], '= Cheers, M');
  // A multi-line snippet shows as code with its own copy button.
  await app.run('snip poem roses are red\nviolets are blue');
  assert.deepEqual((await app.run('snip poem')).slice(1, 3), ['roses are red', 'violets are blue']);
  await app.run('snip poem rm');
  assert.equal(app.data.state.snippets.items.length, 2);
  await app.run('undo');
  assert.equal(app.data.state.snippets.items.length, 3);

  // Later: a URL first saves it; lists the unread; open marks read and opens after the command.
  assert.deepEqual(await app.run('later example.com/long-read A long read'), ['# Saved for later l1 · A long read']);
  assert.equal(app.data.state.later.items[0].url, 'https://example.com/long-read');
  await app.run('later add https://blog.example.org/post');
  assert.deepEqual(await app.run('later https://example.com/long-read'), ['# Already saved as l1']);
  assert.equal((await app.run('later javascript:alert(1)'))[0], '# No links match "javascript:alert(1)"'); // not a link, so a filter
  assert.equal(app.data.state.later.items.length, 2);
  assert.match((await app.run('later add javascript:alert(1)'))[0], /^err: 'javascript:alert\(1\)' is not a web address/);
  const l = await app.run('later');
  assert.deepEqual(l.slice(0, 4), ['# 2 links to read', '| id | link | site | saved', 'l2 | blog.example.org/post | blog.example.org | today', 'l1 | A long read | example.com | today']);
  app.ctx.navigateAfter = null;
  await app.run('later l1 open');
  assert.equal(app.ctx.navigateAfter, 'https://example.com/long-read');
  app.ctx.navigateAfter = null;
  assert.equal(app.data.state.later.items[0].read, true);
  await app.run('later l2 done');
  assert.match((await app.run('later'))[0], /^# Nothing left to read · 2 links read/);
  assert.equal((await app.run('later all'))[0], '# 0 links to read · and 2 read');
  await app.run('later l2 edit read no');
  assert.equal((await app.run('later'))[0], '# 1 link to read');
  assert.ok((await app.run('later l1')).includes('read: ✓ read  [later l1 edit read = yes]'));
  assert.equal((await app.run('later l1 edit url not a url'))[0], "err: url 'not a url' is not a web address (https://…)");

  // find sees both.
  const f = await app.run('find long read');
  assert.ok(f.includes('## Read later 1'));
  assert.ok((await app.run('find cheers')).includes('## Snippets 1'));

  // Export, then import into an empty hub: everything comes back; again: nothing doubles.
  const file = await app.store.exportAll();
  assert.equal(file.collections.snippets.items.length, 3);
  const other = await makeApp();
  const { merge: mergeImport } = await import('../../js/core/importer.js');
  const cur = {};
  for (const k of Object.keys(DEFAULTS)) cur[k] = other.data.state[k];
  const r = mergeImport(cur, file, other.commands.isBuiltin, () => MON);
  assert.equal(r.counts.snippets, 3);
  assert.equal(r.counts.later, 2);
  const again = mergeImport(r.collections, file, other.commands.isBuiltin, () => MON);
  assert.deepEqual([again.counts.snippets, again.counts.later], [0, 0]);
  assert.ok(again.lines.includes("skipped snippet 'signature': already exists"));

  // Sync: both made s1 offline; one is renumbered, both kept.
  const gh = fakeGitHub({ tokens: ['tok'], repos: { 'me/data': { private: true } } });
  const dev = async () => {
    const a = await makeApp();
    a.ctx.sync = createSync({ data: a.data, store: a.store, now: () => new Date(MON), fetch: gh.fetch, device: 'test' });
    return a;
  };
  const A = await dev(), B = await dev();
  await A.run('snip one first');
  await B.run('snip two second');
  await B.run('later example.com/x');
  await A.ctx.sync.setup('me/data', null, 'tok');
  const rb = await B.ctx.sync.setup('me/data', null, 'tok');
  assert.deepEqual(rb.renumbered, [{ from: 's1', to: 's2' }]);
  await A.ctx.sync.syncNow();
  for (const x of [A, B]) {
    assert.deepEqual(x.data.state.snippets.items.map((s) => s.id + ':' + s.name), ['s1:one', 's2:two']);
    assert.equal(x.data.state.later.items[0].url, 'https://example.com/x');
  }
});

test('diagrams lib: kinds from the first line, the library file read back', () => {
  assert.equal(Dia.diagramKind('%% a comment\n\ngraph TD\nA-->B'), 'flowchart');
  assert.equal(Dia.diagramKind('---\ntitle: Flow\n---\nsequenceDiagram\nA->>B: hi'), 'sequence');
  assert.equal(Dia.diagramKind('erDiagram\n A ||--o{ B : has'), 'entity relationship');
  assert.equal(Dia.diagramKind('xychart-beta\n'), 'XY chart');
  assert.equal(Dia.diagramKind('hello'), 'unknown');
  assert.equal(Dia.diagramKind(''), 'empty');
  assert.equal(Dia.diagramKind(Dia.STARTER), 'flowchart');
  const file = Dia.libraryFile([{ id: 'd1', name: 'a', code: 'pie\n "x": 1', created: 'c', updated: 'u' }], new Date(MON));
  assert.deepEqual(file.diagrams, [{ name: 'a', code: 'pie\n "x": 1', created: 'c', updated: 'u' }]);
  assert.equal(Dia.readLibrary(JSON.stringify(file)).diagrams.length, 1);
  assert.deepEqual(Dia.readLibrary('[{"name":"x","code":"graph LR"},{"name":"","code":"x"},{"code":"y"}]'), { diagrams: [{ name: 'x', code: 'graph LR', created: undefined, updated: undefined }], invalid: 2 });
  assert.equal(Dia.readLibrary('{"schema":1,"collections":{"diagrams":{"items":[{"name":"z","code":"pie"}]}}}').diagrams[0].name, 'z');
  assert.throws(() => Dia.readLibrary('{"x":1}'), /no diagrams/);
  assert.throws(() => Dia.readLibrary('nope'), /not JSON/);
});

test('diagrams: editor draft on this device, save as, save, rename, code, remove and undo, export/import, find', async () => {
  const app = await makeApp();
  const flow = 'flowchart LR\n  a --> b';
  // The editor opens on a starter draft; typing keeps the draft on this device only.
  const ed = await app.run('mermaid');
  assert.equal(ed[0], '# New diagram · Mermaid');
  assert.equal(ed[1], 'EDITOR new diagram · Save as… · diagrams add  · flowchart LR');
  ed.editor.onChange(flow);
  assert.equal(app.store.getLocal('diagram-draft').code, flow);
  assert.equal(app.data.state.diagrams.items.length, 0);
  // Save as: the draft becomes d1, and the editor now edits d1.
  const added = await app.run('diagrams add "Sign up"');
  assert.deepEqual(added, ['# Added diagram d1 · Sign up', 'DIAGRAM Sign up: flowchart LR']);
  assert.deepEqual(app.data.state.diagrams.items.map((d) => [d.id, d.name, d.code]), [['d1', 'Sign up', flow]]);
  assert.equal(app.store.getLocal('diagram-draft').target, 'd1');
  // Show: the drawing, the name editable in place, the code opening the editor.
  const show = await app.run('diagrams d1');
  assert.equal(show[0], '# Diagram d1 · Sign up · flowchart');
  assert.equal(show[1], 'DIAGRAM Sign up: flowchart LR');
  assert.equal(show[2], 'name: Sign up  [diagrams d1 edit name = Sign up]');
  assert.equal(show[3], 'code: flowchart · 2 lines  live editor');
  // Edit: the editor on d1; Save is a command.
  const e1 = await app.run('diagrams d1 edit');
  assert.equal(e1[1], 'EDITOR Sign up · Save · diagrams d1 save · flowchart LR');
  assert.deepEqual(await app.run('diagrams d1 save'), ['# No changes to d1']);
  e1.editor.onChange(flow + '\n  b --> c');
  assert.equal((await app.run('diagrams d1 save'))[0], '# Saved diagrams d1 · Sign up · 3 lines');
  assert.equal(app.data.state.diagrams.items[0].code, flow + '\n  b --> c');
  // Unsaved changes come back when the editor opens again; saving another one is refused.
  (await app.run('diagrams d1 edit')).editor.onChange('pie\n "a": 1');
  const again = await app.run('diagrams d1 edit code');
  assert.match(again[1], /^warn: Unsaved changes from before are back/);
  assert.equal(again[2], 'EDITOR Sign up · Save · diagrams d1 save · pie');
  assert.equal((await app.run('diagrams add other graph TD\n x-->y'))[0], '# Added diagram d2 · other');
  assert.match((await app.run('diagrams d2 save'))[0], /^err: The editor isn’t open on d2/);
  // Rename, code, list, find.
  assert.equal((await app.run('diagrams d1 edit name Onboarding'))[0], '# Updated diagrams d1 name');
  assert.deepEqual(await app.run('diagrams d2 code'), ['# Code of d2 · other', 'graph TD', ' x-->y']);
  const list = await app.run('diagrams');
  assert.deepEqual(list.slice(0, 4), ['# 2 diagrams · tap one to see it', '| id | name | kind | changed', 'd1 | Onboarding | flowchart | today', 'd2 | other | flowchart | today']);
  assert.equal((await app.run('diagrams onboard'))[0], '# 1 diagram matching "onboard"');
  assert.ok((await app.run('find onboarding')).some((l) => /d1 \| Onboarding  flowchart/.test(l)));
  // Remove and undo.
  assert.equal((await app.run('diagrams d2 rm'))[0], '# Removed diagram d2');
  await app.run('undo');
  assert.equal(app.data.state.diagrams.items.length, 2);
  // Export the library; import it into another device: nothing twice.
  await app.run('diagrams export');
  assert.match(app.ctx.downloaded.name, /^diagrams-\d{4}-\d{2}-\d{2}\.json$/);
  const lib = app.ctx.downloaded.text;
  assert.equal(JSON.parse(lib).diagrams.length, 2);
  const other = await makeApp();
  other.ctx.nextFile = { name: 'diagrams.json', size: lib.length, text: async () => lib };
  const imp = await other.run('diagrams import');
  assert.equal(imp[0], '# Imported 2 diagrams');
  assert.deepEqual(other.data.state.diagrams.items.map((d) => d.id + ':' + d.name), ['d1:Onboarding', 'd2:other']);
  const twice = await other.run('diagrams import');
  assert.deepEqual(twice.slice(0, 2), ['# Imported 0 diagrams', 'dim: 2 diagrams already here, skipped']);
  // The whole-hub export carries them too, and import adds them.
  const file = await app.store.exportAll();
  const third = await makeApp();
  const { merge: mergeImport } = await import('../../js/core/importer.js');
  const cur = {};
  for (const k of Object.keys(DEFAULTS)) cur[k] = third.data.state[k];
  assert.equal(mergeImport(cur, file, third.commands.isBuiltin, () => MON).counts.diagrams, 2);
  // mermaid <code> draws once and makes it the draft, ready for diagrams add.
  const once = await app.run('mermaid sequenceDiagram\n A->>B: hi');
  assert.deepEqual(once.slice(0, 2), ['# Mermaid · sequence', 'DIAGRAM diagram: sequenceDiagram']);
  assert.deepEqual(app.store.getLocal('diagram-draft').target, null);
  assert.equal((await app.run('diagrams add seq'))[0], '# Added diagram d3 · seq');
  assert.match((await app.run('diagrams add'))[0], /^err: diagrams add <name>/);
  const fresh = await makeApp();
  assert.match((await fresh.run('diagrams add x'))[0], /^err: Nothing to keep/);
  assert.equal((await fresh.run('diagrams'))[0], '# No diagrams yet');
  assert.deepEqual(app.commands.byName.get('diagrams').complete(['d1']).map((x) => x.value), ['edit', 'save', 'code', 'rm']);
});

test('diagrams sync between devices, renumbered on a clash', async () => {
  const gh = fakeGitHub({ tokens: ['tok'], repos: { 'me/data': { private: true } } });
  const dev = async () => {
    const a = await makeApp();
    a.ctx.sync = createSync({ data: a.data, store: a.store, now: () => new Date(MON), fetch: gh.fetch, device: 'test' });
    return a;
  };
  const A = await dev(), B = await dev();
  await A.run('diagrams add one graph LR\n a-->b');
  await B.run('diagrams add two pie\n "x": 1');
  await A.ctx.sync.setup('me/data', null, 'tok');
  const rb = await B.ctx.sync.setup('me/data', null, 'tok');
  assert.deepEqual(rb.renumbered, [{ from: 'd1', to: 'd2' }]);
  await A.ctx.sync.syncNow();
  for (const x of [A, B]) assert.deepEqual(x.data.state.diagrams.items.map((d) => d.id + ':' + d.name), ['d1:one', 'd2:two']);
  // The draft stays on its device.
  assert.equal(JSON.stringify(gh.state.repos).includes('diagram-draft'), false);
});
