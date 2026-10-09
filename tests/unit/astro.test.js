import test from 'node:test';
import assert from 'node:assert/strict';
import * as A from '../../js/lib/astro.js';

// Reference times from an independent ephemeris (PyEphem, VSOP87/ELP), checked
// against published almanac times where known. All in UTC so any zone passes.
const near = (got, want, minutes, label) => {
  assert.ok(got instanceof Date, label + ': no time');
  const off = Math.abs(got - new Date(want)) / 60000;
  assert.ok(off <= minutes, `${label}: ${got.toISOString()} is ${off.toFixed(1)} min from ${want}`);
};
const SOFIA = [42.6977, 23.3219];

test('astro: sunrise and sunset in Sofia on the June solstice', () => {
  const s = A.sunTimes('2026-06-21', ...SOFIA, { zone: 'Europe/Sofia' });
  near(s.sunrise, '2026-06-21T02:48:45Z', 3, 'sunrise (05:49 EEST)');
  near(s.sunset, '2026-06-21T18:08:17Z', 3, 'sunset (21:08 EEST)');
  near(s.dawn, '2026-06-21T02:13:36Z', 3, 'civil dawn');
  near(s.dusk, '2026-06-21T18:43:25Z', 3, 'civil dusk');
  near(s.noon, '2026-06-21T10:28:31Z', 2, 'solar noon');
  assert.ok(s.astronomicalDawn < s.nauticalDawn && s.nauticalDawn < s.dawn && s.dusk < s.nauticalDusk && s.nauticalDusk < s.astronomicalDusk);
  assert.equal(s.polar, null);
  assert.ok(Math.abs(s.dayLength - 920) <= 2, 'about 15 h 20 min');
  // The same day however it's asked: a Date late on the 21st in Sofia is still the 21st there.
  const late = A.sunTimes(new Date('2026-06-21T20:30:00Z'), ...SOFIA, { zone: 'Europe/Sofia' });
  assert.equal(late.sunrise.getTime(), s.sunrise.getTime());
  const offset = A.sunTimes(new Date('2026-06-21T20:30:00Z'), ...SOFIA, { tzOffsetMinutes: 180 });
  assert.equal(offset.sunrise.getTime(), s.sunrise.getTime());
  assert.equal(A.sunTimes('2026-06-21', ...SOFIA).sunrise.getTime(), s.sunrise.getTime(), 'solar time picks the same day');
});

test('astro: the day is the place\'s own, whatever the machine\'s zone', () => {
  // 23:30 UTC on the 21st is already the 22nd in Tokyo and still the 21st in Los Angeles.
  const at = new Date('2026-06-21T23:30:00Z');
  const tokyo = A.sunTimes(at, 35.6762, 139.6503, { zone: 'Asia/Tokyo' });
  near(tokyo.sunrise, '2026-06-21T19:26:04Z', 3, 'Tokyo sunrise on the 22nd (04:25 JST)');
  const la = A.sunTimes(at, 34.0522, -118.2437, { zone: 'America/Los_Angeles' });
  near(la.sunset, '2026-06-22T03:07:38Z', 3, 'Los Angeles sunset on the 21st (20:08 PDT)');
  const sydney = A.sunTimes('2026-01-15', -33.8688, 151.2093, { zone: 'Australia/Sydney' });
  near(sydney.sunrise, '2026-01-14T18:59:28Z', 3, 'Sydney sunrise (05:59 AEDT)');
  near(sydney.sunset, '2026-01-15T09:09:00Z', 3, 'Sydney sunset (20:09 AEDT)');
  const la2 = A.sunTimes('2026-11-03', 34.0522, -118.2437, { zone: 'America/Los_Angeles' });
  near(la2.sunset, '2026-11-04T00:58:06Z', 3, 'Los Angeles sunset falls on the next UTC day');
  assert.throws(() => A.sunTimes('2026-02-30', ...SOFIA), /no such day/);
  assert.throws(() => A.sunTimes('21 June', ...SOFIA), /YYYY-MM-DD/);
  assert.throws(() => A.sunTimes('2026-06-21', 91, 0), /latitude/);
  assert.throws(() => A.sunTimes(new Date('nope'), ...SOFIA), /valid Date/);
});

test('astro: London at the March equinox, about twelve hours of day', () => {
  const s = A.sunTimes('2026-03-20', 51.5074, -0.1278, { zone: 'Europe/London' });
  near(s.sunrise, '2026-03-20T06:03:24Z', 3, 'sunrise');
  near(s.sunset, '2026-03-20T18:13:30Z', 3, 'sunset');
  assert.ok(s.dayLength > 720 && s.dayLength < 740, 'a little over 12 h with refraction');
});

test('astro: Tromsø has polar day in June and polar night in December', () => {
  const june = A.sunTimes('2026-06-21', 69.6496, 18.956, { zone: 'Europe/Oslo' });
  assert.deepEqual([june.polar, june.sunrise, june.sunset, june.dusk, june.dayLength], ['day', null, null, null, 1440]);
  assert.ok(june.noon instanceof Date);
  const dec = A.sunTimes('2026-12-21', 69.6496, 18.956, { zone: 'Europe/Oslo' });
  assert.deepEqual([dec.polar, dec.sunrise, dec.sunset, dec.dayLength], ['night', null, null, 0]);
  near(dec.dawn, '2026-12-21T08:31:16Z', 3, 'civil twilight still comes');
  near(dec.dusk, '2026-12-21T12:53:09Z', 3, 'and goes');
});

test('astro: where the sun stands', () => {
  const p = A.solarPosition(new Date('2026-06-21T10:28:31Z'), ...SOFIA);
  assert.ok(Math.abs(p.altitude - (90 - 42.6977 + 23.44)) < 0.1, 'noon altitude ' + p.altitude);
  assert.ok(Math.abs(p.azimuth - 180) < 0.5, 'due south at noon');
  const morning = A.solarPosition(new Date('2026-06-21T04:00:00Z'), ...SOFIA);
  assert.ok(morning.azimuth > 45 && morning.azimuth < 90 && morning.altitude > 5 && morning.altitude < 20);
  assert.ok(A.solarPosition(new Date('2026-06-21T22:00:00Z'), ...SOFIA).altitude < -10, 'night');
});

test('astro: moon phases on known dates, within an hour', () => {
  const a = A.nextPhases(new Date('2024-04-01T00:00:00Z'));
  near(a.newMoon, '2024-04-08T18:21:00Z', 60, 'the eclipse new moon');
  near(a.lastQuarter, '2024-04-02T03:15:00Z', 60, 'last quarter');
  near(A.nextPhases(new Date('2024-09-10T00:00:00Z')).fullMoon, '2024-09-18T02:34:00Z', 60, 'full moon (partial eclipse)');
  const b = A.nextPhases(new Date('2026-10-09T00:00:00Z'));
  near(b.newMoon, '2026-10-10T15:50:00Z', 60, 'new moon');
  near(b.firstQuarter, '2026-10-18T16:12:36Z', 60, 'first quarter');
  near(b.fullMoon, '2026-10-26T04:11:45Z', 60, 'full moon');
  near(b.lastQuarter, '2026-11-01T20:28:22Z', 60, 'last quarter');
  near(A.nextPhases(new Date('2030-01-01T00:00:00Z')).fullMoon, '2030-01-19T15:54:15Z', 60, '2030');
  // "Next" means strictly after: a minute past the full moon gives the following one.
  near(A.nextPhases(new Date('2026-10-26T04:13:00Z')).fullMoon, '2026-11-24T14:53:29Z', 60, 'the one after');
});

test('astro: moon phase, illumination, names', () => {
  const full = A.moon(new Date('2026-10-26T04:12:00Z'));
  assert.deepEqual([full.name, full.emoji], ['Full Moon', '🌕']);
  assert.ok(full.illumination > 0.99 && Math.abs(full.phase - 0.5) < 0.01);
  assert.ok(Math.abs(full.age - 15.5) < 0.2, 'age ' + full.age);
  const nw = A.moon(new Date('2024-04-08T18:21:00Z'));
  assert.ok(nw.name === 'New Moon' && nw.illumination < 0.01 && nw.age < 0.05);
  const names = ['2026-10-12T12:00Z', '2026-10-18T16:00Z', '2026-10-22T00:00Z', '2026-10-29T00:00Z', '2026-11-01T20:00Z', '2026-11-05T00:00Z']
    .map((d) => A.moon(new Date(d)).name);
  assert.deepEqual(names, ['Waxing Crescent', 'First Quarter', 'Waxing Gibbous', 'Waning Gibbous', 'Last Quarter', 'Waning Crescent']);
  const q = A.moon(new Date('2026-10-18T00:00:00Z'));
  assert.ok(Math.abs(q.illumination - 0.4388) < 0.01, 'illumination ' + q.illumination);
  assert.equal(A.moon(new Date('2026-10-09T12:00:00Z')).emoji, '🌘');
});

test('astro: moonrise and moonset', () => {
  const sofia = A.moonTimes('2026-10-09', ...SOFIA, { tzOffsetMinutes: 0 });
  near(sofia.rise, '2026-10-09T03:06:16Z', 5, 'moonrise');
  near(sofia.set, '2026-10-09T15:06:51Z', 5, 'moonset');
  const london = A.moonTimes('2026-10-26', 51.5074, -0.1278, { zone: 'Europe/London' });
  near(london.rise, '2026-10-26T16:20:36Z', 5, 'full moon rises at dusk');
  near(london.set, '2026-10-26T07:16:28Z', 5, 'and sets at dawn');
  assert.equal(london.always, null);
});

test('astro: cities', () => {
  assert.ok(A.CITIES.length >= 40);
  for (const c of A.CITIES) {
    assert.ok(Math.abs(c.lat) <= 90 && Math.abs(c.lon) <= 180, c.name);
    assert.doesNotThrow(() => new Intl.DateTimeFormat('en', { timeZone: c.zone }), c.zone);
  }
  assert.deepEqual(A.findCity('sofia'), { name: 'Sofia', lat: 42.6977, lon: 23.3219, zone: 'Europe/Sofia' });
  assert.equal(A.findCity('PLOV').name, 'Plovdiv');
  assert.equal(A.findCity('san f').name, 'San Francisco');
  assert.equal(A.findCity('tromso').name, 'Tromsø');
  assert.equal(A.findCity('sao paulo').name, 'São Paulo');
  assert.equal(A.findCity('new_york').name, 'New York');
  assert.equal(A.findCity('Atlantis'), null);
  assert.equal(A.findCity(''), null);
});
