import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from '../../js/lib/timers.js';
import { makeApp, MON } from '../helpers.mjs';

const at = (s) => new Date(MON.getTime() + s * 1000); // MON plus s seconds

test('timers lib: durations, live status from the start time, laps, clocks', () => {
  assert.equal(T.parseDuration('10m'), 600000);
  assert.equal(T.parseDuration('1h30m'), 5400000);
  assert.equal(T.parseDuration('90s'), 90000);
  assert.equal(T.parseDuration('1:30'), 90000);
  assert.equal(T.parseDuration('1:02:03'), 3723000);
  assert.equal(T.parseDuration('25'), 1500000); // minutes
  assert.equal(T.parseDuration('2 min'), 120000);
  for (const bad of ['', 'soon', '0', '8d', '1:75', '10x']) assert.equal(T.parseDuration(bad), null, bad);
  const t = { kind: 'timer', start: MON.toISOString(), duration: 60000, stop: null };
  assert.deepEqual(T.status(t, at(15)), { running: true, elapsed: 15000, remaining: 45000, done: false, over: 0, end: MON.getTime() + 60000 });
  const late = T.status(t, at(75));
  assert.deepEqual([late.done, late.over, late.running], [true, 15000, true]); // keeps counting until stopped
  const stopped = T.status({ ...t, stop: at(20).toISOString() }, at(500));
  assert.deepEqual([stopped.running, stopped.remaining], [false, 40000]);
  const sw = { kind: 'stopwatch', start: MON.toISOString(), stop: null, laps: [at(10).toISOString(), at(25.5).toISOString()] };
  assert.deepEqual(T.laps(sw), [{ n: 1, at: 10000, split: 10000 }, { n: 2, at: 25500, split: 15500 }]);
  assert.equal(T.clock(65000), '1:05');
  assert.equal(T.clock(3723000), '1:02:03');
  assert.equal(T.clock(5400, true), '0:05.4');
  assert.equal(T.spoken(3720000), '1 h 2 min');
  assert.equal(T.spoken(45000), '45 s');
});

test('timer and stopwatch commands: start, list, show, stop, laps, restart, rm; synced items', async () => {
  const app = await makeApp();
  let out = await app.run('timer 10m tea');
  assert.equal(out[0], '# Timer started · tea · 10 min');
  assert.equal(out[1], 'TICKER timer w1');
  const w1 = app.data.state.timers.items[0];
  assert.deepEqual([w1.kind, w1.name, w1.duration, w1.stop], ['timer', 'tea', 600000, null]);
  await app.run('timer 25m');
  app.setNow(at(120));
  out = await app.run('timer list');
  assert.equal(out[0], '# 2 timers · 2 running');
  assert.ok(out.includes('w1 | tea | 10:00 | 8:00 left'));
  out = await app.run('timer tea');
  assert.match(out[0], /^# tea · timer w1/);
  assert.ok(out.includes('TICKER timer w1'));
  app.setNow(at(700)); // past the end: still running, says how long it has been done
  assert.ok((await app.run('timer list')).includes('w1 | tea | 10:00 | done 1 min 40 s ago'));
  assert.equal((await app.run('timer tea stop'))[0], '# Stopped tea · done 1 min 40 s before');
  assert.equal((await app.run('timer tea stop'))[0], '# tea is already stopped · timer tea restart');
  assert.match((await app.run('timer stop'))[0], /^# Stopped timer w2 · 13:20 was left/); // the only running one
  assert.match((await app.run('timer 10x'))[0], /^err: Can't read the time '10x'/);
  assert.match((await app.run('timer 5m list'))[0], /^err: 'list' is a word the command uses/);
  await app.run('timer w2 restart');
  assert.equal(app.data.state.timers.items[1].stop, null);
  assert.equal((await app.run('timer w2 rm'))[0], '# Removed timer w2');
  await app.run('undo');
  assert.equal(app.data.state.timers.items.length, 2);
  // Stopwatch: plain invocation starts one; a name shows it while it runs.
  out = await app.run('stopwatch');
  assert.equal(out[0], '# Stopwatch started · stopwatch w3');
  await app.run('stopwatch run');
  app.setNow(at(712.3));
  assert.equal((await app.run('stopwatch run lap'))[0], '# Lap 1  0:12.3 · total 0:12.3');
  assert.match((await app.run('stopwatch run'))[0], /^# run · stopwatch w4/); // shows, doesn't start another
  assert.match((await app.run('stopwatch lap'))[0], /^err: Which one\? stopwatch w3, stopwatch run/);
  app.setNow(at(800));
  assert.equal((await app.run('stopwatch run stop'))[0], '# Stopped run · 1:40');
  out = await app.run('stopwatch list');
  assert.ok(out.includes('w4 | run | 1:40 | stopped'));
  assert.match((await app.run('timer lap'))[0], /Usage/); // lap isn't a timer verb
  assert.match((await app.run('timer'))[0], /^# 2 timers/);
  // Completion: names, then the verbs.
  const def = app.commands.defs.find((d) => d.name === 'stopwatch');
  assert.ok(def.complete([]).some((c) => c.value === 'run'));
  assert.deepEqual(def.complete(['run']).map((c) => c.value), ['lap', 'stop', 'restart', 'rm']);
});
