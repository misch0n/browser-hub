(function (CC) {
  'use strict';

  const { pad2, toISO } = CC.util;

  function unescapeText(s) {
    return s.replace(/\\([nN,;\\])/g, (m, c) => (c === 'n' || c === 'N' ? ' ' : c));
  }

  // 20261005 | 20261005T093000 | 20261005T093000Z -> { date, time|null } in local time.
  function parseStart(value) {
    const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/i.exec(value.trim());
    if (!m) return null;
    const [, y, mo, d, h, mi, s, z] = m;
    if (h === undefined) {
      const date = y + '-' + mo + '-' + d;
      return CC.util.parseISO(date) ? { date, time: null } : null;
    }
    const dt = z
      ? new Date(Date.UTC(+y, +mo - 1, +d, +h, +mi, +(s || 0)))
      : new Date(+y, +mo - 1, +d, +h, +mi, +(s || 0)); // floating or TZID: taken as local
    if (isNaN(dt.getTime())) return null;
    return { date: toISO(dt), time: pad2(dt.getHours()) + ':' + pad2(dt.getMinutes()) };
  }

  // -> { events: [{date, time, title}], recurring: n, invalid: n }
  function parseICS(text) {
    const lines = text.replace(/\r\n?/g, '\n').replace(/\n[ \t]/g, '').split('\n');
    const events = [];
    let recurring = 0, invalid = 0;
    let cur = null;
    for (const line of lines) {
      const upper = line.toUpperCase();
      if (upper === 'BEGIN:VEVENT') { cur = { start: null, title: '', rrule: false, cancelled: false }; continue; }
      if (upper === 'END:VEVENT') {
        if (cur) {
          if (cur.cancelled) { /* skip */ }
          else if (cur.rrule) recurring++;
          else if (!cur.start) invalid++;
          else events.push({ date: cur.start.date, time: cur.start.time, title: (cur.title || '(no title)').slice(0, 200) });
        }
        cur = null;
        continue;
      }
      if (!cur) continue;
      const colon = line.indexOf(':');
      if (colon < 0) continue;
      const name = line.slice(0, colon).split(';')[0].toUpperCase();
      const value = line.slice(colon + 1);
      if (name === 'DTSTART') cur.start = parseStart(value);
      else if (name === 'SUMMARY') cur.title = unescapeText(value).trim();
      else if (name === 'RRULE') cur.rrule = true;
      else if (name === 'STATUS' && value.trim().toUpperCase() === 'CANCELLED') cur.cancelled = true;
    }
    return { events, recurring, invalid };
  }

  CC.ics = { parseICS };
})((globalThis.CC = globalThis.CC || {}));
