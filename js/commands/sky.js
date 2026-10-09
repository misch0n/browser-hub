import { parseDate, todayISO, addDays } from '../core/util.js';
import { longDate } from '../core/format.js';
import { sunTimes, moon, nextPhases, moonTimes, solarPosition, findCity } from '../lib/astro.js';

// sun and moon: computed for your place (config edit place sofia), offline.
//   sun [date] [in <city>]     dawn, sunrise, noon, sunset, dusk, day length
//   moon [date] [in <city>]    phase, illumination, next phases, rise and set
// Times are shown in the place's own time zone.

const DEFAULT = { name: 'Sofia', lat: 42.6977, lon: 23.3219, zone: 'Europe/Sofia' };

// '06:52' in the place's zone (or this device's when a place has no zone).
const hm = (d, zone) => (d ? new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', ...(zone ? { timeZone: zone } : {}) }).format(new Date(Math.round(d.getTime() / 60000) * 60000)) : '—');
const dayOf = (d, zone) => new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit', ...(zone ? { timeZone: zone } : {}) }).format(d);
const hmin = (min) => Math.floor(min / 60) + ' h ' + String(Math.round(min % 60)).padStart(2, '0') + ' min';

// A place from settings, `in <city>` / a bare city, or Sofia. -> { place, rest, set (from settings) } | { error }
export function placeFrom(rest, settings) {
  let words = rest.trim();
  let city = null;
  const m = /^(.*?)\s*\bin\s+(.+)$/i.exec(words);
  if (m) {
    city = findCity(m[2]);
    if (!city) return { error: "No city '" + m[2] + "' in the list; set an exact place with config edit place <lat>,<lon>" };
    words = m[1];
  } else if (words && !parseDate(words, new Date()) && findCity(words)) {
    city = findCity(words);
    words = '';
  }
  if (city) return { place: city, rest: words, set: true };
  const p = settings.place;
  return { place: p || DEFAULT, rest: words, set: !!p };
}

export default function register(add, { st, usage }) {
  function where(ctx, rest, def) {
    const r = placeFrom(rest, st().settings);
    if (r.error) { ctx.out.err(r.error); return null; }
    const today = todayISO(ctx.now());
    const day = r.rest ? parseDate(r.rest, ctx.now()) : null;
    if (r.rest && !day) { usage(ctx, def); return null; }
    return { ...r, day: day || (r.place.zone ? dayOf(ctx.now(), r.place.zone) : today), today };
  }

  add({
    name: 'sun', group: 'Dates', desc: 'sunrise, sunset, twilight and day length for your place (or any city), worked out offline',
    usage: ['sun', 'sun <date>', 'sun [date] in <city>'],
    examples: ['sun', 'sun tomorrow', 'sun 21 dec', 'sun in london', 'sun 2026-06-21 in tromsø'],
    complete: (prev) => (prev.length === 0 ? ['tomorrow', 'in'].map((v) => ({ value: v })) : []),
    run(ctx, rest) {
      const { out } = ctx;
      const w = where(ctx, rest, this);
      if (!w) return;
      const { place, day } = w;
      const z = place.zone;
      const t = sunTimes(day, place.lat, place.lon, { zone: z });
      const before = sunTimes(addDays(day, -1), place.lat, place.lon, { zone: z });
      out.head([['☀ ' + place.name, 'strong'], [' · ' + longDate(day, w.today), 'dim']]);
      if (t.polar) {
        out.line([[t.polar === 'day' ? 'The sun doesn’t set: polar day' : 'The sun doesn’t rise: polar night', 'warn']]);
      }
      const noonAlt = t.noon ? Math.round(solarPosition(t.noon, place.lat, place.lon).altitude) : null;
      const diff = Math.round((t.dayLength - before.dayLength) * 60);
      out.kv([
        ['dawn', [[hm(t.dawn, z), 'num'], ['  civil twilight', 'faint']]],
        ['sunrise', [[hm(t.sunrise, z), 'num strong']]],
        ['noon', [[hm(t.noon, z), 'num'], [noonAlt !== null ? '  the sun at ' + noonAlt + '°' : '', 'faint']]],
        ['sunset', [[hm(t.sunset, z), 'num strong']]],
        ['dusk', [[hm(t.dusk, z), 'num']]],
        ['day length', [[t.polar ? (t.polar === 'day' ? '24 h' : '0 h') : hmin(t.dayLength), ''],
          [t.polar ? '' : '  ' + (diff >= 0 ? '+' : '−') + (Math.abs(diff) >= 60 ? Math.floor(Math.abs(diff) / 60) + ' min ' : '') + (Math.abs(diff) % 60) + ' s on the day before', 'faint']]],
        ['nautical', [[hm(t.nauticalDawn, z) + ' – ' + hm(t.nauticalDusk, z), 'dim']]],
        ['astronomical', [[hm(t.astronomicalDawn, z) + ' – ' + hm(t.astronomicalDusk, z), 'dim']]],
      ]);
      out.dim(place.lat.toFixed(2) + ', ' + place.lon.toFixed(2) + (z ? ' · times in ' + z : '') +
        (w.set ? '' : ' · set your place: config edit place <city or lat,lon>'));
    },
  });

  add({
    name: 'moon', group: 'Dates', desc: 'the moon: phase, how much is lit, the next new and full moons, rise and set',
    usage: ['moon', 'moon <date>', 'moon [date] in <city>'],
    examples: ['moon', 'moon next friday', 'moon in tokyo'],
    complete: (prev) => (prev.length === 0 ? ['tomorrow', 'in'].map((v) => ({ value: v })) : []),
    run(ctx, rest) {
      const { out } = ctx;
      const w = where(ctx, rest, this);
      if (!w) return;
      const { place, day } = w;
      const z = place.zone;
      // At noon of that day in the place (now, for today).
      const when = w.rest ? sunTimes(day, place.lat, place.lon, { zone: z }).noon || new Date(day + 'T12:00:00Z') : ctx.now();
      const m = moon(when);
      const next = nextPhases(when);
      const rs = moonTimes(day, place.lat, place.lon, { zone: z });
      out.head([[m.emoji + ' ' + m.name, 'strong'], [' · ' + Math.round(m.illumination * 100) + '% lit · ' + m.age.toFixed(1) + ' days old', 'dim'],
        [w.rest ? ' · ' + longDate(day, w.today) : '', 'dim']]);
      const at = (d) => [[longDate(dayOf(d, z), w.today) + ' ' + hm(d, z), 'date']];
      out.kv([
        ['new moon', at(next.newMoon)],
        ['first quarter', at(next.firstQuarter)],
        ['full moon', at(next.fullMoon)],
        ['last quarter', at(next.lastQuarter)],
        ['rises', rs.always ? [[rs.always === 'up' ? 'up all day' : 'below the horizon all day', 'dim']] : [[hm(rs.rise, z), 'num']]],
        ['sets', rs.always ? [['', '']] : [[hm(rs.set, z), 'num']]],
      ].filter((r) => r[1][0][0] !== ''));
      out.dim(place.name + (z ? ' · times in ' + z : '') + (w.set ? '' : ' · set your place: config edit place <city or lat,lon>'));
    },
  });
}
