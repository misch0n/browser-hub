import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import * as U from '../../js/core/util.js';
import * as A from '../../js/core/aliases.js';
import { jsonLines, dueSeg, dayLabel } from '../../js/core/format.js';
import * as F from '../../js/core/format.js';
import * as Z from '../../js/lib/zones.js';
import { parseICS } from '../../js/lib/ics.js';
import { MON, makeApp } from '../helpers.mjs';

test('dates: iso, keywords, weekdays, offsets', () => {
  assert.equal(U.parseDate('2026-10-31', MON), '2026-10-31');
  assert.equal(U.parseDate('2026-02-30', MON), null);
  assert.equal(U.parseDate('today', MON), '2026-10-05');
  assert.equal(U.parseDate('Tomorrow', MON), '2026-10-06');
  assert.equal(U.parseDate('fri', MON), '2026-10-09');
  assert.equal(U.parseDate('monday', MON), '2026-10-12'); // next occurrence, never today
  assert.equal(U.parseDate('+3d', MON), '2026-10-08');
  assert.equal(U.parseDate('+2w', MON), '2026-10-19');
  assert.equal(U.parseDate('someday', MON), null);
  // Any start of a day name, two letters on; any start of a month name, three on.
  for (const w of ['fr', 'fri', 'frid', 'friday', 'FRIDAY', 'Fri.']) assert.equal(U.parseDate(w, MON), '2026-10-09', w);
  assert.equal(U.parseDate('th', MON), '2026-10-08');
  assert.equal(U.parseDate('tu', MON), '2026-10-06');
  assert.equal(U.parseDate('t', MON), null); // tuesday or thursday?
  assert.equal(U.parseDate('s', MON), null);
  assert.equal(U.parseDate('next friday', MON), '2026-10-16');
  assert.equal(U.parseDate('12 oct', MON), '2026-10-12');
  assert.equal(U.parseDate('Oct 12', MON), '2026-10-12');
  assert.equal(U.parseDate('october 3', MON), '2027-10-03'); // passed this year: the next one
  assert.equal(U.parseDate('3 October 2027', MON), '2027-10-03');
  assert.equal(U.parseDate('31 feb', MON), null);
  assert.equal(U.parseDate('ju 3', MON), null); // june or july?
  assert.equal(U.parseDate('in 3 days', MON), '2026-10-08');
  assert.equal(U.parseDate('in 2 weeks', MON), '2026-10-19');
  assert.equal(U.parseDate('in 1 month', MON), '2026-11-05');
  assert.equal(U.parseDate('tmr', MON), '2026-10-06');
  assert.equal(U.parseDate('yesterday', MON), '2026-10-04');
  assert.deepEqual(U.leadingDate(['next', 'friday', 'lunch'], MON), { date: '2026-10-16', used: 2 });
  assert.deepEqual(U.leadingDate(['fri', '3', 'friends'], MON), { date: '2026-10-09', used: 1 });
  // Shown in full, always.
  assert.equal(F.longDate('2026-10-09', '2026-10-05'), 'Friday 9 October');
  assert.equal(F.longDate('2027-01-01', '2026-10-05'), 'Friday 1 January 2027');
  assert.equal(U.parseTime('9:05'), '09:05');
  assert.equal(U.parseTime('24:00'), null);
  assert.equal(U.parseId('t', 'T12'), 't12');
  assert.equal(U.parseId('t', 'n12'), null);
  assert.equal(U.daysBetween('2026-03-28', '2026-03-30'), 2); // across DST
});

test('format: due labels and json colouring', () => {
  assert.deepEqual(dueSeg('2026-10-03', '2026-10-05'), ['2 days overdue', 'err']);
  assert.deepEqual(dueSeg('2026-10-05', '2026-10-05'), ['today', 'warn']);
  assert.deepEqual(dueSeg('2026-10-06', '2026-10-05'), ['tomorrow', 'info']);
  assert.deepEqual(dueSeg('2026-10-08', '2026-10-05'), ['Thursday 8 October', 'date']);
  assert.equal(dayLabel('2027-01-02', '2026-10-05'), 'Saturday 2 January 2027');
  const lines = jsonLines('{\n  "a": [1, true, null, "x"]\n}');
  assert.deepEqual(lines[1].map((s) => s[1]), ['dim', 'id', 'dim', 'dim', 'num', 'dim', 'accent', 'dim', 'faint', 'dim', 'ok', 'dim']);
  assert.equal(lines.map((l) => l.map((s) => s[0]).join('')).join('\n'), '{\n  "a": [1, true, null, "x"]\n}');
});

test('zones: rows, offsets, overlap, zoned wall time', () => {
  const instant = new Date(Date.UTC(2026, 0, 15, 14, 30));
  const rows = Z.zoneRows(instant, ['UTC', 'Asia/Tokyo', 'America/Los_Angeles']);
  // Earliest wall clock first; the reference zone keeps its `ref` mark wherever it lands.
  assert.deepEqual(rows.map((r) => [r.zone, r.time, r.offset, r.ref]),
    [['America/Los_Angeles', '06:30', '-08:00', false], ['UTC', '14:30', '+00:00', true], ['Asia/Tokyo', '23:30', '+09:00', false]]);
  assert.deepEqual(rows.map((r) => r.date), ['', '', '']);
  // A different calendar day shows the date; the same day shows nothing.
  const late = Z.zoneRows(new Date(Date.UTC(2026, 0, 15, 20)), ['UTC', 'Asia/Tokyo', 'Pacific/Honolulu']);
  assert.deepEqual(late.map((r) => [r.zone, r.date]), [['Pacific/Honolulu', ''], ['UTC', ''], ['Asia/Tokyo', 'Friday 16 January']]);
  const early = Z.zoneRows(new Date(Date.UTC(2026, 0, 15, 3)), ['Asia/Tokyo', 'America/New_York']);
  assert.deepEqual(early.map((r) => [r.zone, r.date]), [['America/New_York', 'Wednesday 14 January'], ['Asia/Tokyo', '']]);
  assert.ok(Z.allZones().includes('Europe/Sofia') && Z.allZones().includes('UTC'));
  assert.equal(Z.resolveZone('tokyo'), 'Asia/Tokyo');
  assert.equal(Z.resolveZone('new york'), 'America/New_York');
  assert.equal(Z.resolveZone('america/los_angeles'), 'America/Los_Angeles');
  assert.equal(Z.resolveZone('Atlantis'), null);
  assert.equal(Z.zoneLabel('America/New_York', {}), 'New York');
  assert.equal(Z.zoneLabel('America/New_York', { 'America/New_York': 'NYC office' }), 'NYC office');
  assert.equal(Z.zonedToDate(2026, 10, 5, 9, 0, 0, 'America/New_York').toISOString(), '2026-10-05T13:00:00.000Z');
  assert.equal(Z.zonedToDate(2026, 1, 5, 9, 0, 0, 'America/New_York').toISOString(), '2026-01-05T14:00:00.000Z');
});

test('zones: work overlap is right on DST change days (review #3)', () => {
  const here = fileURLToPath(new URL('../../js/lib/zones.js', import.meta.url));
  const script = "import('" + here + "').then((Z) => console.log(JSON.stringify([" +
    "Z.workOverlap(new Date(2026, 2, 29), ['Europe/Sofia'])," +
    "Z.workOverlap(new Date(2026, 9, 25), ['Europe/Sofia'])," +
    "Z.workOverlap(new Date(2026, 9, 25), ['Europe/Sofia', 'Asia/Tokyo'])])))";
  const out = execFileSync(process.execPath, ['-e', script], { env: { ...process.env, TZ: 'Europe/Sofia' } }).toString();
  // Sofia 09:00 (UTC+2 after the change) is 16:00 in Tokyo: one shared hour.
  assert.deepEqual(JSON.parse(out), [['09:00-17:00'], ['09:00-17:00'], ['09:00-10:00']]);
});

test('ics: timezones, all-day, folding, VALARM, recurrence (review #2)', () => {
  const ics = [
    'BEGIN:VCALENDAR', 'BEGIN:VEVENT', 'SUMMARY:Team sync\\, weekly', 'DTSTART:20261005T093000', 'END:VEVENT',
    'BEGIN:VEVENT', 'SUMMARY:All day', 'DTSTART;VALUE=DATE:20261006', 'END:VEVENT',
    'BEGIN:VEVENT', 'SUMMARY:Folded long', ' title here', 'DTSTART:20261007T180000', 'END:VEVENT',
    'BEGIN:VEVENT', 'SUMMARY:Repeats', 'DTSTART:20261008T100000', 'RRULE:FREQ=WEEKLY', 'END:VEVENT',
    'BEGIN:VEVENT', 'SUMMARY:No start', 'END:VEVENT',
    'BEGIN:VEVENT', 'SUMMARY:Gone', 'STATUS:CANCELLED', 'DTSTART:20261009T100000', 'END:VEVENT',
    'BEGIN:VEVENT', 'SUMMARY:Has alarm', 'DTSTART:20261010T080000', 'BEGIN:VALARM', 'SUMMARY:Reminder email', 'ACTION:EMAIL', 'END:VALARM', 'END:VEVENT',
    'BEGIN:VEVENT', 'SUMMARY:Bad date', 'DTSTART:20260231T100000', 'END:VEVENT',
    'BEGIN:VEVENT', 'SUMMARY:Windows zone', 'DTSTART;TZID=Pacific Standard Time:20261011T100000', 'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n');
  const r = parseICS(ics);
  assert.deepEqual(r.events.map((e) => e.title), ['Team sync, weekly', 'All day', 'Folded longtitle here', 'Has alarm', 'Windows zone']);
  assert.deepEqual(r.events[1], { date: '2026-10-06', time: null, title: 'All day' });
  assert.equal(r.events[3].time, '08:00');
  assert.equal(r.recurring, 1);
  assert.equal(r.invalid, 2);
  assert.equal(r.guessedZones, 1);
  // A TZID wall time becomes the right local instant.
  const ny = parseICS('BEGIN:VEVENT\nSUMMARY:NY\nDTSTART;TZID=America/New_York:20261005T090000\nEND:VEVENT').events[0];
  const want = new Date(Date.UTC(2026, 9, 5, 13, 0));
  assert.equal(ny.date, U.toISO(want));
  assert.equal(ny.time, U.pad2(want.getHours()) + ':' + U.pad2(want.getMinutes()));
});

test('date maths: steps, workdays, ISO weeks, differences, looking back', async () => {
  const D = await import('../../js/core/datemath.js');
  const now = MON; // Monday 5 October 2026
  const at = (s, o) => D.point(s, now, o).date;
  assert.equal(at(''), '2026-10-05');
  assert.equal(at('+ 90d'), '2027-01-03');
  assert.equal(at('today - 3d'), '2026-10-02');
  assert.equal(at('3 days ago'), '2026-10-02');
  assert.equal(at('2 weeks ago'), '2026-09-21');
  assert.equal(at('2026-01-31 + 1m'), '2026-02-28'); // the month's last day
  assert.equal(at('2024-01-31 + 1 month'), '2024-02-29');
  assert.equal(at('2024-02-29 + 1y'), '2025-02-28');
  assert.equal(at('2026-10-05 + 1w + 2d'), '2026-10-14');
  assert.equal(at('2026-10-05 - 1m - 1d'), '2026-09-04');
  // Workdays: Monday to Friday; from a weekend, the next Monday.
  assert.equal(at('fri + 1 wd'), '2026-10-12');
  assert.equal(at('2026-10-10 + 1wd'), '2026-10-12'); // Saturday
  assert.equal(at('2026-10-12 - 1 workday'), '2026-10-09');
  assert.equal(at('2026-10-05 + 10 workdays'), '2026-10-19');
  assert.equal(D.workdaysBetween('2026-10-05', '2026-10-09'), 4);
  assert.equal(D.workdaysBetween('2026-10-09', '2026-10-12'), 1);
  assert.equal(D.workdaysBetween('2026-10-10', '2026-10-11'), 0);
  assert.equal(D.workdaysBetween('2026-10-12', '2026-10-05'), -5);
  for (let n = 0; n < 40; n++) assert.equal(D.workdaysBetween('2026-10-05', D.step('2026-10-05', '+', n, 'wd')), n);
  // Looking back: the last Friday, the last 12 October.
  assert.equal(at('fri', { past: true }), '2026-10-02');
  assert.equal(at('mon', { past: true }), '2026-09-28');
  assert.equal(at('last fri'), '2026-10-02');
  assert.equal(at('25 dec', { past: true }), '2025-12-25');
  assert.equal(at('1 oct', { past: true }), '2026-10-01');
  assert.match(D.point('someday', now).error, /don't know the date 'someday'/);
  // ISO weeks: Monday first, week 1 holds the first Thursday.
  assert.deepEqual(D.isoWeek('2026-10-05'), { year: 2026, week: 41 });
  assert.deepEqual(D.isoWeek('2026-01-01'), { year: 2026, week: 1 }); // a Thursday
  assert.deepEqual(D.isoWeek('2027-01-01'), { year: 2026, week: 53 }); // a Friday
  assert.deepEqual(D.isoWeek('2024-12-30'), { year: 2025, week: 1 });
  assert.deepEqual(D.isoWeek('2021-01-03'), { year: 2020, week: 53 });
  assert.deepEqual([2020, 2025, 2026, 2027].map(D.weeksIn), [53, 52, 53, 52]);
  assert.equal(D.weekMonday(2026, 41), '2026-10-05');
  assert.equal(D.weekMonday(2025, 1), '2024-12-30');
  assert.equal(D.weekMonday(2026, 53), '2026-12-28');
  // Differences: `to` from first to second, `-` second to first; a calendar's sense of years.
  assert.deepEqual(D.difference('1 jan to 25 dec', now), { from: '2026-01-01', to: '2026-12-25' });
  assert.deepEqual(D.difference('25 dec - 1 jan', now), { from: '2026-01-01', to: '2026-12-25' });
  assert.deepEqual(D.difference('1 dec to 1 feb', now), { from: '2026-12-01', to: '2027-02-01' });
  assert.deepEqual(D.difference('2026-10-05 - 2026-01-01', now), { from: '2026-01-01', to: '2026-10-05' });
  assert.equal(D.difference('today - 3d', now), null); // a step, not a difference
  assert.deepEqual(D.calendarSpan('2026-01-31', '2026-03-01'), { years: 0, months: 1, days: 1 });
  assert.deepEqual(D.calendarSpan('2020-02-29', '2026-10-05'), { years: 6, months: 7, days: 6 });
  assert.equal(D.dayOfYear('2026-10-05'), 278);
  assert.equal(D.daysInYear(2024), 366);
});

test('date, days and week commands', async () => {
  const app = await makeApp();
  const today = await app.run('date');
  assert.deepEqual(today, ['# Monday 5 October 2026 · today', 'date: 2026-10-05', 'week: week 41', 'day: 278 of 365 · 87 days left in 2026', 'quarter: Q4']);
  assert.equal(today.copied, '2026-10-05');
  assert.deepEqual((await app.run('date fri + 3 wd')).slice(0, 2), ['# Friday 9 October + 3 workdays = Wednesday 14 October', 'date: 2026-10-14 · in 9 days']);
  assert.deepEqual(await app.run('date 1 jan to 25 dec'), ['# 358 days from Thursday 1 January to Friday 25 December',
    'weeks: 51 weeks 1 day', 'calendar: 11 months 24 days', 'workdays: 256 · Monday to Friday']);
  assert.equal((await app.run('days until 25 dec'))[0], '# 81 days until Friday 25 December');
  assert.equal((await app.run('days since 1 jan'))[0], '# 277 days since Thursday 1 January');
  assert.equal((await app.run('days since 25 dec'))[0], '# 284 days since Thursday 25 December 2025');
  assert.equal((await app.run('days since fri'))[0], '# 3 days since Friday 2 October');
  assert.equal((await app.run('days until fri')).copied, '4');
  assert.match((await app.run('days'))[0], /^# Usage/);
  assert.deepEqual((await app.run('date blah')).slice(0, 2), ["err: don't know the date 'blah'", '# Usage · date']);
  const week = await app.run('week');
  assert.equal(week[0], '# Week 41 of 2026 · Monday 5 October to Sunday 11 October · this week');
  assert.equal(week[1], 'Monday 5 October | today');
  assert.equal(week[8], 'week 40 2026 ← · → week 42 2026');
  assert.equal((await app.run('week 53'))[0], '# Week 53 of 2026 · Monday 28 December to Sunday 3 January 2027 · in 12 weeks');
  assert.equal((await app.run('week 53'))[8], 'week 52 2026 ← · → week 1 2027');
  assert.equal((await app.run('week 1 2027'))[8], 'week 53 2026 ← · → week 2 2027');
  assert.equal((await app.run('week 2026-W10'))[0].slice(0, 25), '# Week 10 of 2026 · Monda');
  assert.equal((await app.run('week 25 dec'))[0].slice(0, 19), '# Week 52 of 2026 ·');
  assert.equal((await app.run('week 54'))[0], 'err: 2026 has weeks 1 to 53');
});

test('day: the weekday of a date, this year unless one is given; day.month too', async () => {
  const app = await makeApp(); // Monday 5 October 2026
  let out = await app.run('day 12 march');
  assert.equal(out[0], '# Thursday · 12 March 2026 · 207 days ago'); // this year, though it has passed
  assert.ok(out.includes('other years: 2025 Wed   2027 Fri   2028 Sun   2029 Mon   '));
  assert.equal(out.copied, 'Thursday');
  assert.equal((await app.run('day march 12 2027'))[0], '# Friday · 12 March 2027 · in 158 days');
  assert.equal((await app.run('day 12.03'))[0], '# Thursday · 12 March 2026 · 207 days ago'); // day.month, European order
  assert.equal((await app.run('day 24/12/2030'))[0], '# Tuesday · 24 December 2030 · in 1541 days');
  assert.equal((await app.run('day 1.1.27'))[0], '# Friday · 1 January 2027 · in 88 days');
  assert.equal((await app.run('day 2027-03-12'))[0], '# Friday · 12 March 2027 · in 158 days');
  assert.equal((await app.run('day'))[0], '# Monday · 5 October 2026 · today');
  assert.equal((await app.run('day tomorrow'))[0], '# Tuesday · 6 October 2026 · tomorrow');
  out = await app.run('day 10 oct');
  assert.ok(out.includes('week: week 41 · a weekend day'));
  out = await app.run('day 29 feb 2028');
  assert.ok(out.includes('quarter: Q1 · 2028 is a leap year'));
  assert.equal((await app.run('day 29.02'))[0], 'err: There is no 29.02 in 2026');
  assert.equal((await app.run('day 31 feb'))[0], 'err: There is no 31 feb in 2026');
  assert.match((await app.run('day someday'))[0], /^err: Don't know the date 'someday'/);
});
