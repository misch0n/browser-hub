// Sun and moon, computed on the device (no network). Times are Date objects
// (instants); show them in whatever zone you like.
//   sunTimes(day, lat, lon, { zone, tzOffsetMinutes }) -> { dawn, sunrise, noon, sunset, dusk,
//     nauticalDawn, nauticalDusk, astronomicalDawn, astronomicalDusk, dayLength (minutes), polar }
//   moonTimes(day, lat, lon, opts) -> { rise, set, always: null | 'up' | 'down' }
//   solarPosition(date, lat, lon)  -> { altitude, azimuth } in degrees (refraction included)
//   moon(date)       -> { phase (0 new, 0.5 full), illumination (0..1), name, emoji, age (days) }
//   nextPhases(date) -> { newMoon, firstQuarter, fullMoon, lastQuarter }, the next of each
//   CITIES [{ name, lat, lon, zone }], findCity(name) -> city | null
//
// Which day: `day` is 'YYYY-MM-DD' or a Date. A Date is read as a calendar day in
// the place's own zone (`zone`, an IANA name; else `tzOffsetMinutes`; else the
// longitude's solar time), never in the machine's zone, so a far-away city gets
// its own day. Events are those of that local day; an event that doesn't happen
// (polar day or night) is null.
//
// The sun follows NOAA's solar calculator (good to about a minute below the polar
// circles); moon phases follow Meeus, Astronomical Algorithms ch. 49 (within a
// few minutes); the moon's place for rise and set uses a short series (a few minutes).

const RAD = Math.PI / 180, DAY = 86400000;
const sin = (d) => Math.sin(d * RAD), cos = (d) => Math.cos(d * RAD), tan = (d) => Math.tan(d * RAD);
const asin = (x) => Math.asin(Math.max(-1, Math.min(1, x))) / RAD, atan2 = (y, x) => Math.atan2(y, x) / RAD;
const mod = (x, n) => ((x % n) + n) % n;
const jd = (ms) => ms / DAY + 2440587.5;
const toMs = (j) => (j - 2440587.5) * DAY;

function place(lat, lon) {
  if (!(Math.abs(lat) <= 90) || !(Math.abs(lon) <= 180)) throw new RangeError('latitude -90..90 and longitude -180..180');
}
const instant = (date) => {
  const ms = date instanceof Date ? date.getTime() : NaN;
  if (!Number.isFinite(ms)) throw new TypeError('a valid Date is needed');
  return ms;
};

// ---- which day ----------------------------------------------------------------------

function zoneOffset(zone, ms) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: zone, hourCycle: 'h23', year: 'numeric',
    month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric' }).formatToParts(ms).map((x) => [x.type, x.value]));
  return Math.round((Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(ms / 1000) * 1000) / 60000);
}

// The local day as a UTC window [start, start + 24 h), and the offset used.
function localDay(day, lon, { zone, tzOffsetMinutes } = {}) {
  const offsetAt = (ms) => (zone ? zoneOffset(zone, ms) : Number.isFinite(tzOffsetMinutes) ? tzOffsetMinutes : Math.round(lon * 4));
  let y, m, d;
  if (typeof day === 'string') {
    const hit = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day.trim());
    if (!hit) throw new TypeError("day as 'YYYY-MM-DD'");
    [y, m, d] = hit.slice(1).map(Number);
    if (new Date(Date.UTC(y, m - 1, d)).getUTCDate() !== d) throw new RangeError('no such day: ' + day);
  } else {
    const ms = instant(day), local = new Date(ms + offsetAt(ms) * 60000);
    [y, m, d] = [local.getUTCFullYear(), local.getUTCMonth() + 1, local.getUTCDate()];
  }
  const midday = Date.UTC(y, m - 1, d, 12);
  const offset = offsetAt(midday - offsetAt(midday) * 60000);
  return { start: Date.UTC(y, m - 1, d) - offset * 60000, offset };
}

// ---- sun ----------------------------------------------------------------------------

// Declination and the equation of time (minutes), NOAA's formulas.
function sun(ms) {
  const T = (jd(ms) - 2451545) / 36525;
  const L0 = mod(280.46646 + T * (36000.76983 + T * 0.0003032), 360);
  const M = 357.52911 + T * (35999.05029 - 0.0001537 * T);
  const e = 0.016708634 - T * (0.000042037 + 0.0000001267 * T);
  const C = sin(M) * (1.914602 - T * (0.004817 + 0.000014 * T)) + sin(2 * M) * (0.019993 - 0.000101 * T) + sin(3 * M) * 0.000289;
  const om = 125.04 - 1934.136 * T, lambda = L0 + C - 0.00569 - 0.00478 * sin(om);
  const eps = 23 + (26 + (21.448 - T * (46.815 + T * (0.00059 - T * 0.001813))) / 60) / 60 + 0.00256 * cos(om);
  const y = tan(eps / 2) ** 2;
  const eot = (4 / RAD) * (y * sin(2 * L0) - 2 * e * sin(M) + 4 * e * y * sin(M) * cos(2 * L0) - 0.5 * y * y * sin(4 * L0) - 1.25 * e * e * sin(2 * M));
  return { decl: asin(sin(eps) * sin(lambda)), eot };
}

export function solarPosition(date, lat, lon) {
  place(lat, lon);
  const ms = instant(date), { decl, eot } = sun(ms);
  const ha = mod(mod(ms, DAY) / 60000 + eot + 4 * lon, 1440) / 4 - 180;
  let altitude = asin(sin(lat) * sin(decl) + cos(lat) * cos(decl) * cos(ha));
  if (altitude > -1) altitude += 1.02 / tan(altitude + 10.3 / (altitude + 5.11)) / 60; // refraction
  const azimuth = mod(atan2(sin(ha), cos(ha) * sin(lat) - tan(decl) * cos(lat)) + 180, 360);
  return { altitude, azimuth };
}

// cos of the hour angle at which the sun's centre stands at `h` degrees.
const cosHour = (h, lat, decl) => (sin(h) - sin(lat) * sin(decl)) / (cos(lat) * cos(decl));

export function sunTimes(day, lat, lon, opts) {
  place(lat, lon);
  const { start } = localDay(day, lon, opts);
  let n0 = Date.UTC(1970, 0, 1, 12) - lon * 240000 + Math.floor((start - Date.UTC(1970, 0, 1)) / DAY) * DAY;
  while (n0 < start) n0 += DAY;
  while (n0 >= start + DAY) n0 -= DAY;
  let noon = n0;
  for (let i = 0; i < 2; i++) noon = n0 - sun(noon).eot * 60000;
  const event = (h, sign) => {
    let t = noon;
    for (let i = 0; i < 4; i++) {
      const { decl, eot } = sun(t), c = cosHour(h, lat, decl);
      if (Math.abs(c) > 1) return null;
      t = n0 - eot * 60000 + sign * Math.acos(c) / RAD * 240000;
    }
    return new Date(Math.round(t / 1000) * 1000);
  };
  const c = cosHour(-0.833, lat, sun(noon).decl);
  const out = {
    astronomicalDawn: event(-18, -1), nauticalDawn: event(-12, -1), dawn: event(-6, -1), sunrise: event(-0.833, -1),
    noon: new Date(Math.round(noon / 1000) * 1000),
    sunset: event(-0.833, 1), dusk: event(-6, 1), nauticalDusk: event(-12, 1), astronomicalDusk: event(-18, 1),
  };
  out.polar = out.sunrise && out.sunset ? null : c < 0 ? 'day' : 'night';
  out.dayLength = out.polar ? (out.polar === 'day' ? 1440 : 0) : Math.round((out.sunset - out.sunrise) / 60000);
  return out;
}

// ---- moon ---------------------------------------------------------------------------

const deltaT = (y) => { // TT - UT in seconds, NASA's polynomials
  const t = y - 2000;
  if (y >= 2005 && y < 2050) return 62.92 + 0.32217 * t + 0.005589 * t * t;
  if (y >= 1986 && y < 2005) return 63.86 + 0.3345 * t - 0.060374 * t ** 2 + 0.0017275 * t ** 3 + 0.000651814 * t ** 4 + 0.00002373599 * t ** 5;
  return -20 + 32 * ((y - 1820) / 100) ** 2;
};

const NEW = [-0.4072, 0.17241, 0.01608, 0.01039, 0.00739, -0.00514, 0.00208];
const FULL = [-0.40614, 0.17302, 0.01614, 0.01043, 0.00734, -0.00515, 0.00209];

// The time of phase k (an integer plus 0, .25, .5 or .75; k = 0 is the new moon of 6 January 2000). Meeus ch. 49.
function phaseTime(k) {
  const T = k / 1236.85, q = mod(Math.round(mod(k, 1) * 4), 4);
  let j = 2451550.09766 + 29.530588861 * k + 0.00015437 * T * T - 0.00000015 * T ** 3 + 0.00000000073 * T ** 4;
  const E = 1 - 0.002516 * T - 0.0000074 * T * T;
  const M = 2.5534 + 29.1053567 * k - 0.0000014 * T * T - 0.00000011 * T ** 3;
  const Mp = 201.5643 + 385.81693528 * k + 0.0107582 * T * T + 0.00001238 * T ** 3 - 0.000000058 * T ** 4;
  const F = 160.7108 + 390.67050284 * k - 0.0016118 * T * T - 0.00000227 * T ** 3 + 0.000000011 * T ** 4;
  const O = 124.7746 - 1.56375588 * k + 0.0020672 * T * T + 0.00000215 * T ** 3;
  if (q === 0 || q === 2) {
    const c = q === 0 ? NEW : FULL;
    j += c[0] * sin(Mp) + c[1] * E * sin(M) + c[2] * sin(2 * Mp) + c[3] * sin(2 * F) + c[4] * E * sin(Mp - M) + c[5] * E * sin(Mp + M) + c[6] * E * E * sin(2 * M)
      - 0.00111 * sin(Mp - 2 * F) - 0.00057 * sin(Mp + 2 * F) + 0.00056 * E * sin(2 * Mp + M) - 0.00042 * sin(3 * Mp)
      + 0.00042 * E * sin(M + 2 * F) + 0.00038 * E * sin(M - 2 * F) - 0.00024 * E * sin(2 * Mp - M) - 0.00017 * sin(O)
      - 0.00007 * sin(Mp + 2 * M) + 0.00004 * sin(2 * Mp - 2 * F) + 0.00004 * sin(3 * M) + 0.00003 * sin(Mp + M - 2 * F)
      + 0.00003 * sin(2 * Mp + 2 * F) - 0.00003 * sin(Mp + M + 2 * F) + 0.00003 * sin(Mp - M + 2 * F)
      - 0.00002 * sin(Mp - M - 2 * F) - 0.00002 * sin(3 * Mp + M) + 0.00002 * sin(4 * Mp);
  } else {
    j += -0.62801 * sin(Mp) + 0.17172 * E * sin(M) - 0.01183 * E * sin(Mp + M) + 0.00862 * sin(2 * Mp) + 0.00804 * sin(2 * F)
      + 0.00454 * E * sin(Mp - M) + 0.00204 * E * E * sin(2 * M) - 0.0018 * sin(Mp - 2 * F) - 0.0007 * sin(Mp + 2 * F)
      - 0.0004 * sin(3 * Mp) - 0.00034 * E * sin(2 * Mp - M) + 0.00032 * E * sin(M + 2 * F) + 0.00032 * E * sin(M - 2 * F)
      - 0.00028 * E * E * sin(Mp + 2 * M) + 0.00027 * E * sin(2 * Mp + M) - 0.00017 * sin(O) - 0.00005 * sin(Mp - M - 2 * F)
      + 0.00004 * sin(2 * Mp + 2 * F) - 0.00004 * sin(Mp + M + 2 * F) + 0.00004 * sin(Mp - 2 * M) + 0.00003 * sin(Mp + 2 * M)
      + 0.00003 * sin(3 * M) + 0.00002 * sin(2 * Mp - 2 * F) + 0.00002 * sin(Mp - M + 2 * F) - 0.00002 * sin(3 * Mp + M);
    const W = 0.00306 - 0.00038 * E * cos(M) + 0.00026 * cos(Mp) - 0.00002 * cos(Mp - M) + 0.00002 * cos(Mp + M) + 0.00002 * cos(2 * F);
    j += q === 1 ? W : -W;
  }
  const A = [[299.77, 0.107408, 0.000325], [251.88, 0.016321, 0.000165], [251.83, 26.651886, 0.000164], [349.42, 36.412478, 0.000126],
    [84.66, 18.206239, 0.00011], [141.74, 53.303771, 0.000062], [207.14, 2.453732, 0.00006], [154.84, 7.30686, 0.000056],
    [34.52, 27.261239, 0.000047], [207.19, 0.121824, 0.000042], [291.34, 1.844379, 0.00004], [161.72, 24.198154, 0.000037],
    [239.56, 25.513099, 0.000035], [331.55, 3.592518, 0.000023]];
  A.forEach(([a, b, c], i) => { j += c * sin(a + b * k - (i ? 0 : 0.009173 * T * T)); });
  return toMs(j) - deltaT(2000 + k / 12.3685) * 1000;
}

const NAMES = ['New Moon', 'Waxing Crescent', 'First Quarter', 'Waxing Gibbous', 'Full Moon', 'Waning Gibbous', 'Last Quarter', 'Waning Crescent'];
const EMOJI = ['🌑', '🌒', '🌓', '🌔', '🌕', '🌖', '🌗', '🌘'];
const lunation = (ms) => Math.floor((jd(ms) - 2451550.09766) / 29.530588861);

export function moon(date) {
  const ms = instant(date), T = (jd(ms) - 2451545) / 36525;
  const D = 297.8501921 + 445267.1114034 * T - 0.0018819 * T * T;
  const M = 357.5291092 + 35999.0502909 * T - 0.0001536 * T * T;
  const Mp = 134.9633964 + 477198.8675055 * T + 0.0087414 * T * T;
  const i = 180 - D - 6.289 * sin(Mp) + 2.1 * sin(M) - 1.274 * sin(2 * D - Mp) - 0.658 * sin(2 * D) - 0.214 * sin(2 * Mp) - 0.11 * sin(D);
  const phase = mod(180 - i, 360) / 360;
  // Principal phases are named for about a day either side; the rest between them.
  const near = Math.round(phase * 4) % 4, w = 1 / 29.53;
  const n = Math.abs(phase - Math.round(phase * 4) / 4) <= w ? near * 2 : Math.floor(phase * 4) * 2 + 1;
  let k = lunation(ms) + 1;
  while (phaseTime(k) > ms) k--;
  return { phase, illumination: (1 + cos(i)) / 2, name: NAMES[n], emoji: EMOJI[n], age: (ms - phaseTime(k)) / DAY };
}

export function nextPhases(date) {
  const ms = instant(date), k0 = lunation(ms) - 1, out = {};
  ['newMoon', 'firstQuarter', 'fullMoon', 'lastQuarter'].forEach((key, q) => {
    let k = k0 + q / 4;
    while (phaseTime(k) <= ms) k++;
    out[key] = new Date(Math.round(phaseTime(k) / 60000) * 60000);
  });
  return out;
}

// The moon's geocentric altitude above the rise/set threshold, in degrees.
function moonAboveHorizon(ms, lat, lon) {
  const d = jd(ms) - 2451545, T = d / 36525;
  const l = 218.32 + 481267.881 * T + 6.29 * sin(135 + 477198.87 * T) - 1.27 * sin(259.3 - 413335.36 * T) + 0.66 * sin(235.7 + 890534.22 * T)
    + 0.21 * sin(269.9 + 954397.74 * T) - 0.19 * sin(357.5 + 35999.05 * T) - 0.11 * sin(186.5 + 966404.03 * T);
  const b = 5.13 * sin(93.3 + 483202.02 * T) + 0.28 * sin(228.2 + 960400.89 * T) - 0.28 * sin(318.3 + 6003.15 * T) - 0.17 * sin(217.6 - 407332.21 * T);
  const p = 0.9508 + 0.0518 * cos(135 + 477198.87 * T) + 0.0095 * cos(259.3 - 413335.36 * T) + 0.0078 * cos(235.7 + 890534.22 * T) + 0.0028 * cos(269.9 + 954397.74 * T);
  const e = 23.4393 - 0.013 * T;
  const ra = atan2(sin(l) * cos(e) - tan(b) * sin(e), cos(l)), dec = asin(sin(b) * cos(e) + cos(b) * sin(e) * sin(l));
  const H = 280.46061837 + 360.98564736629 * d + lon - ra;
  return asin(sin(lat) * sin(dec) + cos(lat) * cos(dec) * cos(H)) - (0.7275 * p - 0.5667);
}

export function moonTimes(day, lat, lon, opts) {
  place(lat, lon);
  const { start } = localDay(day, lon, opts), step = 600000, f = (t) => moonAboveHorizon(t, lat, lon);
  const out = { rise: null, set: null, always: null };
  let t0 = start, a = f(t0), anyUp = a > 0;
  for (let t1 = start + step; t1 <= start + DAY; t1 += step) {
    const b = f(t1);
    if (b > 0) anyUp = true;
    if ((a <= 0) !== (b <= 0)) {
      let lo = t0, hi = t1;
      for (let i = 0; i < 12; i++) { const mid = (lo + hi) / 2; if ((f(mid) <= 0) === (a <= 0)) lo = mid; else hi = mid; }
      const key = a <= 0 ? 'rise' : 'set';
      if (!out[key]) out[key] = new Date(Math.round(hi / 60000) * 60000);
    }
    t0 = t1; a = b;
  }
  if (!out.rise && !out.set) out.always = anyUp ? 'up' : 'down';
  return out;
}

// ---- places -------------------------------------------------------------------------

export const CITIES = `Sofia 42.6977 23.3219 Europe/Sofia|Plovdiv 42.1354 24.7453 Europe/Sofia|Varna 43.2141 27.9147 Europe/Sofia
|Burgas 42.5048 27.4626 Europe/Sofia|Ruse 43.8356 25.9657 Europe/Sofia|Stara Zagora 42.4258 25.6345 Europe/Sofia
|Veliko Tarnovo 43.0757 25.6172 Europe/Sofia|Bansko 41.8383 23.4885 Europe/Sofia|London 51.5074 -0.1278 Europe/London
|Dublin 53.3498 -6.2603 Europe/Dublin|Lisbon 38.7223 -9.1393 Europe/Lisbon|Madrid 40.4168 -3.7038 Europe/Madrid
|Barcelona 41.3874 2.1686 Europe/Madrid|Paris 48.8566 2.3522 Europe/Paris|Amsterdam 52.3676 4.9041 Europe/Amsterdam
|Zurich 47.3769 8.5417 Europe/Zurich|Berlin 52.52 13.405 Europe/Berlin|Munich 48.1351 11.582 Europe/Berlin
|Rome 41.9028 12.4964 Europe/Rome|Vienna 48.2082 16.3738 Europe/Vienna|Prague 50.0755 14.4378 Europe/Prague
|Warsaw 52.2297 21.0122 Europe/Warsaw|Belgrade 44.7866 20.4489 Europe/Belgrade|Bucharest 44.4268 26.1025 Europe/Bucharest
|Athens 37.9838 23.7275 Europe/Athens|Thessaloniki 40.6401 22.9444 Europe/Athens|Istanbul 41.0082 28.9784 Europe/Istanbul
|Kyiv 50.4501 30.5234 Europe/Kyiv|Moscow 55.7558 37.6173 Europe/Moscow|Stockholm 59.3293 18.0686 Europe/Stockholm
|Oslo 59.9139 10.7522 Europe/Oslo|Helsinki 60.1699 24.9384 Europe/Helsinki|Reykjavik 64.1466 -21.9426 Atlantic/Reykjavik
|Tromsø 69.6496 18.956 Europe/Oslo|Cairo 30.0444 31.2357 Africa/Cairo|Nairobi -1.2921 36.8219 Africa/Nairobi
|Cape Town -33.9249 18.4241 Africa/Johannesburg|Dubai 25.2048 55.2708 Asia/Dubai|Mumbai 19.076 72.8777 Asia/Kolkata
|Delhi 28.6139 77.209 Asia/Kolkata|Singapore 1.3521 103.8198 Asia/Singapore|Hong Kong 22.3193 114.1694 Asia/Hong_Kong
|Shanghai 31.2304 121.4737 Asia/Shanghai|Beijing 39.9042 116.4074 Asia/Shanghai|Seoul 37.5665 126.978 Asia/Seoul
|Tokyo 35.6762 139.6503 Asia/Tokyo|Sydney -33.8688 151.2093 Australia/Sydney|Melbourne -37.8136 144.9631 Australia/Melbourne
|Auckland -36.8485 174.7633 Pacific/Auckland|Honolulu 21.3069 -157.8583 Pacific/Honolulu|Anchorage 61.2181 -149.9003 America/Anchorage
|Vancouver 49.2827 -123.1207 America/Vancouver|Seattle 47.6062 -122.3321 America/Los_Angeles|San Francisco 37.7749 -122.4194 America/Los_Angeles
|Los Angeles 34.0522 -118.2437 America/Los_Angeles|Denver 39.7392 -104.9903 America/Denver|Mexico City 19.4326 -99.1332 America/Mexico_City
|Chicago 41.8781 -87.6298 America/Chicago|Toronto 43.6532 -79.3832 America/Toronto|Washington 38.9072 -77.0369 America/New_York
|New York 40.7128 -74.006 America/New_York|Boston 42.3601 -71.0589 America/New_York|São Paulo -23.5505 -46.6333 America/Sao_Paulo
|Buenos Aires -34.6037 -58.3816 America/Argentina/Buenos_Aires`.split('|').map((row) => {
  const [, name, lat, lon, zone] = /^(.+?) (-?[\d.]+) (-?[\d.]+) (\S+)$/.exec(row.trim());
  return Object.freeze({ name, lat: Number(lat), lon: Number(lon), zone });
});

const fold = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ø/g, 'o').toLowerCase().replace(/[\s_-]+/g, ' ').trim();

// Exact name first, then the first name that starts with it (case and accents ignored).
export function findCity(name) {
  const q = fold(name);
  if (!q) return null;
  return CITIES.find((c) => fold(c.name) === q) || CITIES.find((c) => fold(c.name).startsWith(q)) || null;
}
