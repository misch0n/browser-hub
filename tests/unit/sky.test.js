import test from 'node:test';
import assert from 'node:assert/strict';
import { makeApp } from '../helpers.mjs';

test('sun and moon for your place; config place', async () => {
  const app = await makeApp();
  app.setNow(new Date(Date.UTC(2026, 5, 21, 9, 0))); // 21 June 2026, morning in Sofia
  let out = await app.run('sun');
  assert.match(out[0], /^# ☀ Sofia · Sunday 21 June/);
  assert.ok(out.includes('sunrise: 05:49'), out.join('\n'));
  assert.ok(out.some((l) => /^sunset: 21:0[78]$/.test(l)));
  assert.ok(out.some((l) => /^day length: 15 h 2\d min  \+\d+ s on the day before$/.test(l)));
  assert.match(out[out.length - 1], /set your place: config edit place/);
  out = await app.run('sun in tromsø');
  assert.ok(out.includes('The sun doesn’t set: polar day'), out.join('\n'));
  out = await app.run('sun 21 dec in london');
  assert.match(out[0], /^# ☀ London · Monday 21 December/);
  assert.ok(out.some((l) => /^sunrise: 08:0\d$/.test(l)));
  assert.match((await app.run('sun in atlantis'))[0], /^err: No city 'atlantis'/);
  // config place: a city or coordinates; synced with the settings.
  assert.equal((await app.run('config edit place varna'))[0], '# Updated config place');
  assert.deepEqual(app.data.state.settings.place, { name: 'Varna', lat: 43.2141, lon: 27.9147, zone: 'Europe/Sofia' });
  out = await app.run('sun');
  assert.match(out[0], /^# ☀ Varna/);
  assert.ok(!/set your place/.test(out[out.length - 1]));
  await app.run('config edit place 40.71,-74.01');
  assert.equal(app.data.state.settings.place.lat, 40.71);
  assert.match((await app.run('config edit place narnia'))[0], /^err: No city 'narnia'/);
  await app.run('config edit place none');
  assert.equal(app.data.state.settings.place, null);
  // moon: the phase now and the next ones, in the place's zone.
  app.setNow(new Date(Date.UTC(2026, 9, 26, 6, 0))); // hours after the full moon of 26 Oct 2026 (04:12 UTC)
  out = await app.run('moon');
  assert.match(out[0], /^# 🌕 Full Moon · (99|100)% lit/);
  assert.ok(out.some((l) => /^new moon: .*November/.test(l)), out.join('\n'));
  assert.ok(out.some((l) => /^rises: \d\d:\d\d$/.test(l)));
});
