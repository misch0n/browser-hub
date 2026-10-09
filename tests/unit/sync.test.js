import test from 'node:test';
import assert from 'node:assert/strict';
import * as A from '../../js/core/aliases.js';
import { edit, actionFor, historySearch } from '../../js/core/lineedit.js';
import { loadDevice, defaultDeviceName, detectBrowser } from '../../js/core/device.js';
import * as Merge from '../../js/core/merge.js';
import * as Log from '../../js/core/log.js';
import { createSync } from '../../js/sync.js';
import * as Sync from '../../js/sync.js';
import { fakeGitHub } from '../fake-github.mjs';
import * as C from '../../js/core/completion.js';
import { merge } from '../../js/core/importer.js';
import { MON, makeApp } from '../helpers.mjs';

test('merge: three-way, per item and per setting', () => {
  const docs = (o) => ({
    meta: { schema: 1, created: '2026-01-01T00:00:00.000Z', lastExport: null, counters: { t: o.t || 0, n: 0, e: 0 } },
    aliases: { entries: o.aliases || [{ name: 'g', base: 'https://g.com/', template: 'https://g.com/?q={}', escape: 'query' }], defaultEngine: 'g' },
    notes: { items: [] }, events: { items: [] },
    tasks: { items: o.tasks || [] },
    settings: { zones: o.zones || [], zoneNames: {}, theme: o.theme || 'auto', widgets: ['clock'], panel: true, summary: 'on', summaryDismissed: o.dismissed || null },
  });
  const t = (id, text, extra) => ({ id, text, due: null, tags: [], done: false, created: 'x', doneAt: null, ...extra });
  const base = docs({ t: 2, tasks: [t('t1', 'one'), t('t2', 'two')], zones: ['Asia/Tokyo'] });
  // Device A edits t1 and adds t3; the repo (device B) edits t2, adds its own t3, and a zone.
  const local = docs({ t: 3, tasks: [t('t1', 'one!'), t('t2', 'two'), t('t3', 'mine')], zones: ['Asia/Tokyo'], theme: 'nord' });
  const remote = docs({ t: 3, tasks: [t('t1', 'one'), t('t2', 'two?'), t('t3', 'theirs')], zones: ['Asia/Tokyo', 'Europe/Paris'], dismissed: '2026-10-05' });
  const m = Merge.merge3(base, local, remote);
  const tasks = m.collections.tasks.items.map((x) => x.id + ':' + x.text);
  assert.deepEqual(tasks, ['t1:one!', 't2:two?', 't3:theirs', 't4:mine']); // both edits kept; local t3 renumbered
  assert.deepEqual(m.renumbered, [{ from: 't3', to: 't4' }]);
  assert.equal(m.collections.meta.counters.t, 4);
  assert.deepEqual(m.collections.settings.zones, ['Asia/Tokyo', 'Europe/Paris']);
  assert.equal(m.collections.settings.theme, 'nord');
  assert.equal(m.collections.settings.summaryDismissed, '2026-10-05'); // dismissed elsewhere: dismissed here
  assert.deepEqual(m.conflicts, []);
  // Same item changed on both sides: this device's version, reported.
  const c = Merge.merge3(base, docs({ t: 2, tasks: [t('t1', 'A'), t('t2', 'two')] }), docs({ t: 2, tasks: [t('t1', 'B'), t('t2', 'two')] }));
  assert.equal(c.collections.tasks.items[0].text, 'A');
  assert.deepEqual(c.conflicts, ['t1']);
  // Deleted on one side, untouched on the other: deleted. Deleted vs changed: kept.
  const d = Merge.merge3(base, docs({ t: 2, tasks: [t('t2', 'two')] }), docs({ t: 2, tasks: [t('t1', 'one'), t('t2', 'two changed')] }));
  assert.deepEqual(d.collections.tasks.items.map((x) => x.text), ['two changed']);
  const e = Merge.merge3(base, docs({ t: 2, tasks: [t('t2', 'two')] }), docs({ t: 2, tasks: [t('t1', 'one edited'), t('t2', 'two')] }));
  assert.deepEqual(e.collections.tasks.items.map((x) => x.text), ['one edited', 'two']);
  // First sync (no base): union of items, settings from the repo.
  const f = Merge.merge3(null, docs({ t: 1, tasks: [t('t1', 'phone task')], theme: 'nord' }), docs({ t: 1, tasks: [t('t1', 'laptop task')], theme: 'dracula' }));
  assert.deepEqual(f.collections.tasks.items.map((x) => x.id + ':' + x.text), ['t1:laptop task', 't2:phone task']);
  assert.equal(f.collections.settings.theme, 'dracula');
  // No remote yet: local as is. Key order never matters.
  assert.ok(Merge.sameData(Merge.merge3(null, local, null).collections, local));
  assert.ok(Merge.sameDoc({ a: 1, b: [1, { c: 2, d: 3 }] }, { b: [1, { d: 3, c: 2 }], a: 1 }));
});

test('sync: setup, two devices, conflicts, races, expired tokens', async () => {
  const gh = fakeGitHub({ tokens: ['tok-a', 'tok-b'], repos: { 'me/data': { private: true }, 'me/open': { private: false }, 'me/ro': { push: false } } });
  const device = async () => {
    const app = await makeApp();
    const sync = createSync({ data: app.data, store: app.store, now: () => new Date(MON), fetch: gh.fetch, device: 'test' });
    return { app, sync };
  };
  const A = await device();
  // Refusals: bad repo name, public repo, read-only token, unknown repo, bad token.
  await assert.rejects(A.sync.setup('nope', null, 'tok-a'), /not owner\/repository/);
  await assert.rejects(A.sync.setup('me/open', null, 'tok-a'), /is public/);
  await assert.rejects(A.sync.setup('me/ro', null, 'tok-a'), /not write/);
  await assert.rejects(A.sync.setup('me/none', null, 'tok-a'), /not found/);
  await assert.rejects(A.sync.setup('me/data', null, 'wrong'), (e) => e.kind === 'auth');
  assert.equal(A.app.store.getLocal('sync-token'), null); // nothing kept from a failed setup

  await A.app.run('t from laptop');
  await A.app.run('alias gh https://github.com/ https://github.com/{} --path');
  const first = await A.sync.setup('me/data', null, 'tok-a');
  assert.equal(first.pushed, true);
  assert.equal(gh.file('me/data').collections.tasks.items[0].text, 'from laptop');
  assert.equal(gh.file('me/data').collections.history, undefined); // history stays on the device
  assert.equal(A.sync.status.state, 'ok');
  // The token lives on the device only: not in exports, not in the repo.
  assert.equal(A.app.store.getLocal('sync-token'), 'tok-a');
  assert.ok(!JSON.stringify(await A.app.store.exportAll()).includes('tok-a'));
  assert.ok(!JSON.stringify(gh.state.repos).includes('tok-a'));

  // A second device with its own task joins: it gets everything, and the repo gets its task.
  const B = await device();
  await B.app.run('t from phone');
  await B.sync.setup('me/data', null, 'tok-b');
  const texts = (app) => app.data.state.tasks.items.map((t) => t.id + ':' + t.text);
  assert.deepEqual(texts(B.app), ['t1:from laptop', 't2:from phone']); // renumbered, nothing lost
  assert.ok(B.app.data.state.aliases.entries.some((e) => e.name === 'gh'));
  await A.sync.syncNow();
  assert.deepEqual(texts(A.app), ['t1:from laptop', 't2:from phone']);

  // Edits on both, different items: both kept. A quiet sync pushes nothing.
  await A.app.run('t edit t1.text laptop edit');
  await B.app.run('t done t2');
  await B.app.run('today dismiss');
  await A.sync.syncNow();
  await B.sync.syncNow();
  await A.sync.syncNow();
  for (const d of [A, B]) {
    assert.deepEqual(d.app.data.state.tasks.items.map((t) => [t.text, t.done]), [['laptop edit', false], ['from phone', true]]);
    assert.equal(d.app.data.state.settings.summaryDismissed, '2026-10-05');
  }
  const puts = () => gh.state.requests.filter((r) => r.startsWith('PUT')).length;
  const before = puts();
  const quiet = await A.sync.syncNow();
  assert.equal(puts(), before);
  assert.deepEqual([quiet.pulled, quiet.pushed], [false, false]);
  // Undo still works after a sync touched other items.
  await A.app.run('n note on laptop');
  await A.sync.syncNow();
  await B.sync.syncNow();
  await B.app.run('undo'); // B's last step: today dismiss
  assert.equal(B.app.data.state.settings.summaryDismissed, null);

  // Two tabs on one device: the second tab's sync uses the first's record of
  // the last sync, so a third device's edit isn't mistaken for a conflict.
  const A2 = createSync({ data: A.app.data, store: A.app.store, now: () => new Date(MON), fetch: gh.fetch, device: 'tab 2' });
  await A.app.run('t two tabs');
  await A.sync.syncNow(); // tab 1 syncs
  const id = A.app.data.state.tasks.items.find((t) => t.text === 'two tabs').id;
  await B.sync.syncNow();
  await B.app.run('t edit ' + id + '.text edited on the phone');
  await B.sync.syncNow();
  await A2.syncNow(); // tab 2, created before tab 1's sync
  assert.equal(A.app.data.state.tasks.items.find((t) => t.id === id).text, 'edited on the phone');
  assert.deepEqual(A2.status.conflicts, []);
  assert.deepEqual(A2.status.renumbered, []); // no duplicate of the old version either
  assert.equal(A.app.data.state.tasks.items.filter((t) => /two tabs|edited on the phone/.test(t.text)).length, 1);

  // Another device pushes between our read and our write: start over, nothing lost.
  await A.app.run('t race');
  gh.state.failNextPut = 1;
  await A.sync.syncNow();
  assert.ok(gh.file('me/data').collections.tasks.items.some((t) => t.text === 'race'));

  // Token revoked: sync stops and says so; a new token resumes it.
  gh.revoke('tok-a');
  await assert.rejects(A.sync.syncNow(), (e) => e.kind === 'auth');
  assert.equal(A.sync.status.state, 'auth');
  gh.allow('tok-a2');
  await A.sync.setToken('tok-a2');
  assert.equal(A.sync.status.state, 'ok');
  assert.equal(A.app.store.getLocal('sync-token'), 'tok-a2');
  // Off: forgets the token and settings, keeps the data.
  A.sync.off();
  assert.equal(A.app.store.getLocal('sync-token'), null);
  assert.equal(A.sync.status.state, 'off');
  assert.ok(A.app.data.state.tasks.items.length >= 3);
});

test('sync in a shared repository: its own directory only, never other files', async () => {
  const gh = fakeGitHub({ tokens: ['tok'], repos: { 'me/shared': { private: true } } });
  const others = {
    'README.md': '# my private stuff\n',
    'notes/journal.md': 'dear diary',
    'other-app/data.json': '{"app":"something-else","collections":{"tasks":{"items":[]}}}', // looks a lot like ours
    'data.json': '{"mine":"not the hub"}',
  };
  for (const [p, t] of Object.entries(others)) gh.seed('me/shared', p, t);
  const device = async () => {
    const app = await makeApp();
    return { app, sync: createSync({ data: app.data, store: app.store, now: () => new Date(MON), fetch: gh.fetch, device: 'test' }) };
  };
  const A = await device();
  await A.app.run('t from the hub');
  await A.sync.setup('me/shared', undefined, 'tok');
  assert.equal(A.sync.config.path, 'browser-hub/data.json'); // the default directory
  assert.equal(gh.file('me/shared').collections.tasks.items[0].text, 'from the hub');
  for (const [p, t] of Object.entries(others)) assert.equal(gh.raw('me/shared', p), t, p); // untouched
  const touched = gh.state.requests.filter((r) => r.includes('/contents/')).map((r) => r.replace(/^\w+ /, ''));
  assert.deepEqual([...new Set(touched)], ['/repos/me/shared/contents/browser-hub/data.json']);
  assert.ok(gh.state.requests.every((r) => !r.startsWith('PUT') || r.endsWith('/browser-hub/data.json')));

  // A directory of your choice; a second device finds it there.
  const B = await device();
  await B.sync.setup('me/shared', 'apps/hub/', 'tok');
  assert.equal(B.sync.config.path, 'apps/hub/data.json');
  assert.ok(gh.file('me/shared', 'apps/hub/data.json'));

  // A directory whose data.json belongs to something else: refused, nothing written, nothing kept.
  const C = await device();
  await assert.rejects(C.sync.setup('me/shared', 'other-app', 'tok'), (e) => e.kind === 'bad-file' && /isn't the hub's file; it was left untouched/.test(e.message));
  assert.equal(gh.raw('me/shared', 'other-app/data.json'), others['other-app/data.json']);
  assert.equal(C.sync.config, null);
  assert.equal(C.app.store.getLocal('sync-token'), null);
  // Directory names: no files, no climbing out, no .git.
  for (const bad of ['../up', 'a/../b', '.git', '.github/x', 'has space', 'x.json', 'browser-hub/data.json']) {
    assert.ok(Sync.syncDir(bad).error, bad);
  }
  assert.equal(Sync.syncDir('/apps/hub/'), 'apps/hub');
  assert.equal(Sync.syncDir(undefined), 'browser-hub');
  // Commits in the shared history say what made them.
  assert.equal(gh.message('me/shared'), 'browser-hub: sync from test');
});

test('sync command: status, setup asks for the token, cancel, errors, off', async () => {
  const gh = fakeGitHub({ tokens: ['tok'], repos: { 'me/data': { private: true } } });
  const app = await makeApp();
  app.ctx.sync = createSync({ data: app.data, store: app.store, now: () => new Date(MON), fetch: gh.fetch, device: 'test' });
  let answer = null;
  const asked = [];
  app.ctx.askSecret = async (label) => { asked.push(label); return answer; };
  assert.match((await app.run('sync'))[0], /^# Sync is off/);
  assert.equal((await app.run('sync setup not-a-repo'))[0], "err: 'not-a-repo' is not owner/repository");
  assert.match((await app.run('sync setup me/data ../elsewhere'))[0], /not a directory name/);
  assert.match((await app.run('sync setup me/data notes.json'))[0], /give a directory, not a file/);
  assert.equal((await app.run('sync setup me/data'))[0], '# Cancelled; nothing was saved'); // Esc
  assert.deepEqual(asked, ['GitHub token for me/data (hidden)']);
  answer = 'bad';
  const bad = await app.run('sync setup me/data');
  assert.ok(bad.includes('err: GitHub refused the token (expired or revoked)'));
  answer = 'tok';
  const ok = await app.run('sync setup me/data');
  assert.ok(ok.includes('# Syncing with me/data · browser-hub/data.json'));
  assert.ok(ok.includes('dim: Only browser-hub/data.json is read and written; the rest of me/data is left alone'));
  assert.ok(!ok.join('\n').includes('tok '));
  const st = await app.run('sync');
  assert.equal(st[0], '# Sync · in sync');
  assert.ok(st.includes('repository: me/data'));
  assert.ok(st.some((l) => /^token: tok… · on this device only$/.test(l) || /^token: .*….* · on this device only$/.test(l)));
  assert.equal(app.data.steps().undo.some((x) => x.label.startsWith('sync')), false); // sync is never an undo step
  assert.match((await app.run('sync off'))[0], /Sync is off · the token is forgotten/);
  assert.equal((await app.run('sync now'))[0], 'err: Sync is not set up · sync setup <owner/repo>');
});

test('config: your name (synced) and this device (local); device names and ids', async () => {
  const mac = { platform: 'MacIntel', userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/18.0 Safari/605.1.15' };
  assert.equal(defaultDeviceName(mac), 'Mac · Safari');
  assert.equal(defaultDeviceName({ platform: 'iPhone', userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) CriOS/130.0 Safari/604.1' }), 'iPhone · Chrome');
  assert.equal(detectBrowser({ userAgent: 'Mozilla/5.0 (Windows NT 10.0) Chrome/130.0 Safari/537.36 Edg/130.0' }), 'Edge');
  const app = await makeApp();
  const dev = app.ctx.device;
  assert.match(dev.id, /^[a-z0-9]{8}$/);
  assert.equal(dev.name, 'Mac · Chrome');
  assert.deepEqual(app.store.getLocal('device'), dev); // the same id next time
  const shown = await app.run('config');
  assert.deepEqual(shown.slice(0, 4), ['# Config', 'name: not set  [config edit name = ]', 'device: Mac · Chrome  [config edit device = Mac · Chrome]', 'device id: ' + dev.id + ' · fixed, marks what this device did']);
  assert.equal((await app.run('config edit name Michael'))[0], '# Updated config name');
  assert.equal(app.data.state.settings.name, 'Michael'); // a setting: synced, exported
  await app.run('config edit device Work laptop');
  assert.equal(app.store.getLocal('device').name, 'Work laptop'); // this device only
  assert.ok(!JSON.stringify(app.data.state.settings).includes('Work laptop'));
  await app.run('config edit name');
  assert.equal(app.ctx.inputSet, 'config edit name Michael');
  await app.run('config edit name none');
  assert.equal(app.data.state.settings.name, null);
  assert.equal((await app.run('config edit colour red'))[0], 'err: config has no field colour');
  assert.equal((await app.run('config edit device ""'))[0], 'err: A device needs a name');
  assert.match((await app.run('config edit'))[0], /^# Editing config/);
});

test('visual history: entries, views, clear marks, merging, limits', () => {
  const e = (id, at, device, extra) => ({ id, at, device, deviceName: device === 'pc' ? 'Mac · Chrome' : 'iPhone · Safari', input: id, ops: [['head', id]], ...extra });
  const log = { entries: [e('b', '2026-10-05T10:02:00Z', 'phone'), e('a', '2026-10-05T10:01:00Z', 'pc'), e('c', '2026-10-05T10:03:00Z', 'pc')], cleared: { all: null, devices: {} } };
  assert.deepEqual(Log.visible(log, 'all', 'pc').map((x) => x.id), ['a', 'b', 'c']); // merged, by time
  assert.deepEqual(Log.visible(log, 'current', 'pc').map((x) => x.id), ['a', 'c']);
  assert.deepEqual(Log.visible(log, 'phone', 'pc').map((x) => x.id), ['b']);
  assert.deepEqual(Log.sessions(log).map((x) => [x.device, x.count]), [['pc', 2], ['phone', 1]]);
  // clear current hides one device's entries up to a time; clear all hides everything up to it.
  const c1 = { ...log, cleared: { all: null, devices: { pc: '2026-10-05T10:01:30Z' } } };
  assert.deepEqual(Log.visible(c1, 'all', 'pc').map((x) => x.id), ['b', 'c']);
  const c2 = { ...log, cleared: { all: '2026-10-05T10:02:00Z', devices: {} } };
  assert.deepEqual(Log.visible(c2, 'all', 'pc').map((x) => x.id), ['c']);
  // Merge: every entry from both sides; marks three-way (an undone clear stays undone).
  const base = { entries: [log.entries[1]], cleared: { all: null, devices: { pc: '2026-10-05T09:00:00Z' } } };
  const local = { entries: [log.entries[1], log.entries[2]], cleared: { all: null, devices: {} } }; // undid its clear
  const remote = { entries: [log.entries[1], log.entries[0]], cleared: { all: null, devices: { pc: '2026-10-05T09:00:00Z' } } };
  const m = Log.mergeLog(base, local, remote);
  assert.deepEqual(m.entries.map((x) => x.id), ['a', 'b', 'c']);
  assert.deepEqual(m.cleared.devices, {});
  const both = Log.mergeLog(null, { ...local, cleared: { all: '2026-10-05T10:00:00Z', devices: {} } }, { ...remote, cleared: { all: '2026-10-05T11:00:00Z', devices: {} } });
  assert.equal(both.cleared.all, '2026-10-05T11:00:00Z'); // both cleared: the later one
  // Limits: huge output is cut to its heading; oldest entries drop first.
  const big = Log.makeEntry({ id: 'x', at: '2026-10-05T10:00:00Z', device: 'pc', deviceName: 'pc', input: 'zones all', ops: [['head', 'many'], ['dim', 'x'.repeat(30000)]] });
  assert.deepEqual(big.ops, [['head', 'many'], ['dim', 'The output was too long to keep in history · run it again to see it']]);
  const many = { entries: Array.from({ length: 320 }, (_, i) => e('n' + i, new Date(Date.UTC(2026, 9, 5, 0, i)).toISOString(), 'pc')), cleared: { all: null, devices: {} } };
  const kept = Log.compact(many).entries;
  assert.equal(kept.length, Log.MAX_ENTRIES);
  assert.equal(kept[0].id, 'n20');
  assert.match(Log.newEntryId('pc', '2026-10-05T10:00:00Z'), /^pc-[a-z0-9]+-[a-z0-9]+$/);
});

test('clear and session: per device, undoable, synced across devices', async () => {
  const gh = fakeGitHub({ tokens: ['tok'], repos: { 'me/data': { private: true } } });
  const device = async (name, minute) => {
    const app = await makeApp();
    app.ctx.device.name = name;
    const sync = createSync({ data: app.data, store: app.store, now: () => new Date(MON), fetch: gh.fetch, device: name });
    // What the page does after each command: keep it in the history.
    const say = async (input, at) => {
      await app.data.appendLog(Log.makeEntry({ id: Log.newEntryId(app.ctx.device.id, at), at, device: app.ctx.device.id, deviceName: name, input, ops: [['head', input]] }));
    };
    return { app, sync, say, minute };
  };
  const pc = await device('Mac · Chrome');
  const phone = await device('iPhone · Safari');
  await pc.say('tasks', '2026-10-05T10:01:00Z');
  await phone.say('notes', '2026-10-05T10:02:00Z');
  await pc.say('find milk', '2026-10-05T10:03:00Z');
  await pc.sync.setup('me/data', null, 'tok');
  await phone.sync.setup('me/data', null, 'tok');
  await pc.sync.syncNow();
  const inputs = (d, view = 'all') => Log.visible(d.app.data.state.log, view, d.app.ctx.device.id).map((x) => x.input);
  assert.deepEqual(inputs(pc), ['tasks', 'notes', 'find milk']); // what the phone did, here too, in time order
  assert.deepEqual(inputs(phone), ['tasks', 'notes', 'find milk']);
  assert.deepEqual(inputs(pc, 'current'), ['tasks', 'find milk']);
  // session lists them; session show switches the view (this device only).
  const ls = await pc.app.run('session');
  assert.match(ls[0], /^# 2 sessions · showing every device$/);
  assert.ok(ls.some((l) => /^Mac · Chrome \| ● this device \| 2 \|/.test(l)));
  assert.ok(ls.some((l) => /^iPhone · Safari \|  \| 1 \|/.test(l)));
  let view = 'all';
  pc.app.ctx.logView = () => view;
  pc.app.ctx.setLogView = (v) => { view = v; };
  assert.deepEqual(await pc.app.run('session show current'), ['# Showing this device']);
  assert.equal(view, 'current');
  await pc.app.run('session show iphone · safari');
  assert.equal(view, phone.app.ctx.device.id);
  assert.equal((await pc.app.run('session show nowhere'))[0], "err: No session 'nowhere' · session lists them");
  // clear current: this device's entries, on every device once synced; undo brings them back.
  let now = new Date('2026-10-05T10:05:00Z');
  pc.app.ctx.now = () => now;
  await pc.app.run('clear');
  assert.deepEqual(inputs(pc), ['notes']);
  await pc.sync.syncNow();
  await phone.sync.syncNow();
  assert.deepEqual(inputs(phone), ['notes']);
  await pc.app.run('undo');
  assert.deepEqual(inputs(pc), ['tasks', 'notes', 'find milk']);
  await pc.sync.syncNow();
  await phone.sync.syncNow();
  assert.deepEqual(inputs(phone), ['tasks', 'notes', 'find milk']); // the undo reached the phone too
  // clear all: everything, everywhere.
  phone.app.ctx.now = () => new Date('2026-10-05T10:06:00Z'); // after every entry, in any time zone
  await phone.app.run('clear all');
  await phone.sync.syncNow();
  await pc.sync.syncNow();
  assert.deepEqual(inputs(pc), []);
  assert.equal((await pc.app.run('clear sometimes'))[0], '# Usage · clear');
});

test('clip: sealed with a passphrase, one item, gone after 15 minutes, never kept', async () => {
  const Clip = await import('../../js/core/clip.js');
  // Sealing: only the right passphrase opens it, and only on the times and device it was made with.
  const meta = { at: '2026-10-05T10:00:00.000Z', expires: '2026-10-05T10:15:00.000Z', device: 'd1', deviceName: 'Mac · Chrome' };
  const item = await Clip.seal('secret text ✓', 'correct horse battery', meta);
  assert.ok(!JSON.stringify(item).includes('secret'));
  assert.equal(await Clip.unseal(item, 'correct horse battery'), 'secret text ✓');
  assert.equal(await Clip.unseal(item, 'wrong horse battery'), null);
  assert.equal(await Clip.unseal({ ...item, expires: '2027-01-01T00:00:00.000Z' }, 'correct horse battery'), null); // moved: refused
  // Expiry and merging: the newer wins; an expired one is wiped the same way everywhere.
  const t = (iso) => new Date(iso);
  assert.equal(Clip.isLive(item, t('2026-10-05T10:14:59Z')), true);
  assert.equal(Clip.isLive(item, t('2026-10-05T10:15:00Z')), false);
  assert.deepEqual(Clip.expire(item, t('2026-10-05T10:20:00Z')), { at: '2026-10-05T10:15:00.000Z', cleared: true });
  const newer = { ...item, at: '2026-10-05T10:05:00.000Z', expires: '2026-10-05T10:20:00.000Z' };
  assert.equal(Clip.mergeClip(item, newer, t('2026-10-05T10:06:00Z'), Merge.canonical).at, newer.at);
  assert.equal(Clip.mergeClip(newer, item, t('2026-10-05T10:06:00Z'), Merge.canonical).at, newer.at);
  assert.deepEqual(Clip.mergeClip(newer, { at: null }, t('2026-10-05T11:00:00Z'), Merge.canonical), { at: '2026-10-05T10:20:00.000Z', cleared: true });
  const wiped = { at: '2026-10-05T10:07:00.000Z', cleared: true }; // `clip clear` after the newer one
  assert.deepEqual(Clip.mergeClip(newer, wiped, t('2026-10-05T10:08:00Z'), Merge.canonical), wiped);

  // Two devices through the fake GitHub.
  const gh = fakeGitHub({ tokens: ['tok'], repos: { 'me/data': { private: true } } });
  const device = async (name) => {
    const app = await makeApp();
    app.ctx.device.name = name;
    app.ctx.sync = createSync({ data: app.data, store: app.store, now: () => app.ctx.now(), fetch: gh.fetch, device: name });
    let answer = null;
    app.ctx.askSecret = async () => answer;
    app.answer = (a) => { answer = a; };
    await app.ctx.sync.setup('me/data', null, 'tok');
    return app;
  };
  const A = await device('laptop');
  const B = await device('phone');

  // Without a passphrase a clip stays on the device: nothing synced.
  const local = await A.run('clip on this device only');
  assert.match(local[0], /^# Clipped · 19 characters · on this device only/);
  assert.deepEqual(await A.run('clip'), ['# Clip · from this device · 15 min left · this device only', '= on this device only', 'clip clear wipes it now']);
  assert.ok(!JSON.stringify(gh.state.repos).includes('this device only'));
  assert.equal(A.store.getLocal('clip').text, 'on this device only');

  // A passphrase: too short is refused; Esc cancels; a good one is kept on the device only.
  A.answer('short');
  assert.match((await A.run('clip key'))[0], /^err: Use at least 10 characters/);
  A.answer(null);
  assert.equal((await A.run('clip key'))[0], '# Cancelled; the passphrase is unchanged');
  A.answer('two devices one secret');
  assert.match((await A.run('clip key'))[0], /^# Passphrase saved on this device/);

  // Shared: sealed in the repo, opened on the other device once it has the passphrase.
  const sent = await A.run('clip add https://example.com/path?token=abc');
  assert.match(sent[0], /^# Clipped · 34 characters · sent sealed to your other devices · wiped in 15 minutes/);
  assert.equal(A.store.getLocal('clip'), null); // the local-only one is replaced
  const repo = JSON.stringify(gh.state.repos);
  assert.ok(!repo.includes('example.com') && !repo.includes('two devices one secret'));
  assert.ok(gh.file('me/data').collections.clip.sealed);
  await B.ctx.sync.syncNow();
  assert.deepEqual((await B.run('clip')).slice(0, 2), ['# A clip from laptop · sealed · 15 min left', 'Run clip key with the passphrase your other devices use']);
  B.answer('not the same secret');
  const wrongKey = await B.run('clip key');
  assert.ok(wrongKey.includes('warn: It does not open the clip from laptop: is it the same passphrase?'));
  assert.match((await B.run('clip'))[1], /passphrase isn't the one it was sealed with/);
  B.answer('two devices one secret');
  assert.ok((await B.run('clip key')).includes('It opens the clip from laptop · clip'));
  const got = await B.run('clip');
  assert.deepEqual(got.slice(0, 2), ['# Clip · from laptop · 15 min left', '= https://example.com/path?token=abc']);
  assert.equal(got.copied, 'https://example.com/path?token=abc');

  // One item: a newer clip from either side replaces it.
  B.setNow(new Date(MON.getTime() + 60000));
  await B.run('clip from the phone');
  await A.ctx.sync.syncNow();
  assert.equal((await A.run('clip'))[1], '= from the phone');

  // Kept out of everything that lasts.
  assert.equal(A.data.steps().undo.some((x) => x.label.startsWith('clip')), false);
  assert.equal(A.commands.byName.get('clip').private, true);
  assert.equal(A.commands.byName.get('clip').noHistory, true);
  assert.ok(!JSON.stringify(await A.store.exportAll()).includes('"clip"'));
  assert.ok(!JSON.stringify(A.data.state.log).includes('from the phone'));

  // 15 minutes on: wiped here, and the wipe reaches the repository.
  A.setNow(new Date(MON.getTime() + 60000 + Clip.CLIP_TTL));
  assert.equal((await A.run('clip'))[0], '# The clipboard is empty');
  assert.deepEqual(A.data.state.clip, { at: new Date(MON.getTime() + 60000 + Clip.CLIP_TTL).toISOString(), cleared: true });
  await A.ctx.sync.syncNow();
  assert.deepEqual(gh.file('me/data').collections.clip, A.data.state.clip);
  // The other device, if it never swept, still agrees at its next sync (no conflict).
  B.setNow(new Date(MON.getTime() + 60000 + Clip.CLIP_TTL + 1000));
  const r = await B.ctx.sync.syncNow();
  assert.deepEqual(r.conflicts, []);
  assert.deepEqual(B.data.state.clip, A.data.state.clip);

  // clip clear wipes it everywhere before then; a word after clip is text unless it is the whole command.
  await A.run('clip add clear');
  assert.equal((await A.run('clip'))[1], '= clear');
  assert.match((await A.run('clip clear'))[0], /^# Clip wiped · on every device/);
  await A.ctx.sync.syncNow();
  assert.equal(gh.file('me/data').collections.clip.cleared, true);
  assert.equal((await A.run('clip clear'))[0], '# The clipboard was already empty');
  A.answer(null);
  assert.match((await A.run('clip key off'))[0], /^# Passphrase forgotten on this device/);
  assert.equal(A.store.getLocal('clip-key'), null);
});
