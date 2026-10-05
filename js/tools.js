(function (CC) {
  'use strict';

  const { pad2 } = CC.util;

  function uuid() {
    const c = globalThis.crypto;
    if (c && c.randomUUID) return c.randomUUID();
    const b = c.getRandomValues(new Uint8Array(16));
    b[6] = (b[6] & 0x0f) | 0x40;
    b[8] = (b[8] & 0x3f) | 0x80;
    const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
    return [h.slice(0, 8), h.slice(8, 12), h.slice(12, 16), h.slice(16, 20), h.slice(20)].join('-');
  }

  function b64encode(text) {
    const bytes = new TextEncoder().encode(text);
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) {
      bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    }
    return btoa(bin);
  }

  function b64decode(text) {
    let s = text.replace(/\s+/g, '').replace(/-/g, '+').replace(/_/g, '/');
    while (s.length % 4) s += '=';
    let bin;
    try {
      bin = atob(s);
    } catch (e) {
      throw new Error('not valid base64');
    }
    const bytes = Uint8Array.from(bin, (ch) => ch.charCodeAt(0));
    try {
      return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch (e) {
      throw new Error('decoded bytes are not valid UTF-8 text');
    }
  }

  function prettyJson(text) {
    return JSON.stringify(JSON.parse(text), null, 2);
  }

  // --- epoch ---------------------------------------------------------------

  function fmtUTC(d) { return d.toISOString().replace('.000Z', 'Z'); }

  function fmtLocal(d) {
    const off = -d.getTimezoneOffset();
    const sign = off < 0 ? '-' : '+';
    const a = Math.abs(off);
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()) + ' ' +
      pad2(d.getHours()) + ':' + pad2(d.getMinutes()) + ':' + pad2(d.getSeconds()) +
      ' ' + sign + pad2(Math.floor(a / 60)) + ':' + pad2(a % 60);
  }

  // Number -> Date (seconds, or milliseconds when it is clearly too large for seconds).
  // 'YYYY-MM-DD[ T]HH:MM[:SS][Z|+HH:MM]' -> Date (local time when no zone given).
  function parseEpochInput(s) {
    s = s.trim();
    if (/^-?\d+(\.\d+)?$/.test(s)) {
      const n = parseFloat(s);
      const d = new Date(Math.abs(n) >= 1e11 ? n : n * 1000);
      if (isNaN(d.getTime())) throw new Error('timestamp out of range');
      return d;
    }
    const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?\s*(Z|[+-]\d{2}:?\d{2})?)?$/i.exec(s);
    if (!m) throw new Error('expected a unix timestamp or YYYY-MM-DD[ HH:MM[:SS]][Z]');
    const [y, mo, da, h = '0', mi = '0', se = '0'] = m.slice(1, 7);
    let d;
    if (m[7]) {
      let off = 0;
      if (m[7].toUpperCase() !== 'Z') {
        const t = m[7].replace(':', '');
        off = (t[0] === '-' ? -1 : 1) * (+t.slice(1, 3) * 60 + +t.slice(3, 5));
      }
      d = new Date(Date.UTC(+y, +mo - 1, +da, +h, +mi, +se) - off * 60000);
    } else {
      d = new Date(+y, +mo - 1, +da, +h, +mi, +se);
    }
    if (isNaN(d.getTime())) throw new Error('invalid date');
    return d;
  }

  function epochLines(d) {
    const ms = d.getTime();
    return [
      'seconds  ' + Math.floor(ms / 1000),
      'millis   ' + ms,
      'utc      ' + fmtUTC(d),
      'local    ' + fmtLocal(d),
    ];
  }

  // --- time zones ----------------------------------------------------------

  const WORK_START = 9 * 60;
  const WORK_END = 17 * 60;

  function localZone() {
    return new Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  }

  function partsIn(date, zone) {
    const f = new Intl.DateTimeFormat('en-GB', {
      timeZone: zone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit',
    });
    const p = {};
    for (const x of f.formatToParts(date)) p[x.type] = x.value;
    return { date: p.year + '-' + p.month + '-' + p.day, minutes: (+p.hour % 24) * 60 + +p.minute };
  }

  const clock = (minutes) => pad2(Math.floor(minutes / 60)) + ':' + pad2(minutes % 60);

  // Rows for `instant` in each zone; the first zone is the local one.
  function zoneRows(instant, zones) {
    const base = partsIn(instant, zones[0]);
    return zones.map((zone) => {
      const p = partsIn(instant, zone);
      const dayDiff = Math.round((Date.parse(p.date) - Date.parse(base.date)) / 86400000);
      return {
        zone,
        time: clock(p.minutes),
        day: dayDiff === 0 ? '' : (dayDiff > 0 ? '+' : '') + dayDiff + 'd',
        working: p.minutes >= WORK_START && p.minutes < WORK_END,
      };
    });
  }

  // Ranges of the local day (as 'HH:MM-HH:MM') when every zone is within 09:00-17:00.
  function workOverlap(day, zones) {
    const midnight = new Date(day.getFullYear(), day.getMonth(), day.getDate());
    const ranges = [];
    let start = null;
    for (let step = 0; step <= 96; step++) {
      const t = new Date(midnight.getTime() + step * 15 * 60000);
      const ok = step < 96 && zones.every((z) => {
        const m = partsIn(t, z).minutes;
        return m >= WORK_START && m < WORK_END;
      });
      if (ok && start === null) start = step;
      if (!ok && start !== null) {
        ranges.push(clock(start * 15) + '-' + clock(step * 15 % 1440));
        start = null;
      }
    }
    return ranges;
  }

  CC.tools = {
    uuid, b64encode, b64decode, prettyJson, parseEpochInput, epochLines,
    localZone, zoneRows, workOverlap,
  };
})((globalThis.CC = globalThis.CC || {}));
