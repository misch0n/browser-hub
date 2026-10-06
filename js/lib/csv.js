// CSV and other delimited text: the delimiter worked out from the text,
// quoted fields (RFC 4180: "a ""quoted"" field", line breaks inside quotes).

const CANDIDATES = [',', ';', '\t', '|'];

// Parse with one delimiter -> rows of fields.
export function parseDelimited(text, delim) {
  const rows = [];
  let row = [], field = '', i = 0, quoted = false;
  const s = String(text).replace(/^﻿/, '');
  while (i < s.length) {
    const ch = s[i];
    if (quoted) {
      if (ch === '"') {
        if (s[i + 1] === '"') { field += '"'; i += 2; continue; }
        quoted = false; i++; continue;
      }
      field += ch; i++; continue;
    }
    if (ch === '"' && field === '') { quoted = true; i++; continue; }
    if (ch === delim) { row.push(field); field = ''; i++; continue; }
    if (ch === '\r' || ch === '\n') {
      row.push(field); rows.push(row); row = []; field = '';
      i += ch === '\r' && s[i + 1] === '\n' ? 2 : 1;
      continue;
    }
    field += ch; i++;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => !(r.length === 1 && r[0] === ''));
}

// The delimiter that splits the most lines into the same number (more than one) of fields.
export function detectDelimiter(text) {
  const sample = String(text).slice(0, 20000);
  let best = { delim: ',', score: -1 };
  for (const d of CANDIDATES) {
    const rows = parseDelimited(sample, d).slice(0, 50);
    if (!rows.length) continue;
    const counts = rows.map((r) => r.length);
    const mode = counts.sort((a, b) => counts.filter((x) => x === b).length - counts.filter((x) => x === a).length)[0];
    const same = rows.filter((r) => r.length === mode).length;
    const score = mode > 1 ? same * 10 + mode : 0;
    if (score > best.score) best = { delim: d, score };
  }
  return best.delim;
}

const isNum = (v) => /^\s*-?(\d+([.,]\d+)?|\.\d+)([eE][+-]?\d+)?\s*%?\s*$/.test(v);

// -> { delimiter, columns: [names], rows: [[cells]], numeric: [bool], header: bool }
export function readCsv(text, opts = {}) {
  const delimiter = opts.delimiter || detectDelimiter(text);
  const all = parseDelimited(text, delimiter);
  if (!all.length) throw new Error('no rows');
  const width = Math.max(...all.map((r) => r.length));
  const norm = all.map((r) => r.concat(Array(width - r.length).fill('')));
  // A header when the first row has no numbers where the rest mostly do, or opts say so.
  const numericCol = (rows, c) => rows.length > 0 && rows.filter((r) => r[c] !== '' && isNum(r[c])).length >= rows.filter((r) => r[c] !== '').length * 0.8 && rows.some((r) => r[c] !== '');
  const looksHeader = norm.length > 1 && norm[0].every((v) => v !== '' && !isNum(v)) && norm[0].some((v, c) => numericCol(norm.slice(1), c) || !norm.slice(1).some((r) => r[c] === v));
  const header = opts.header ?? looksHeader;
  const columns = header ? norm[0].map((v, i) => v || 'column ' + (i + 1)) : Array.from({ length: width }, (_, i) => 'column ' + (i + 1));
  const rows = header ? norm.slice(1) : norm;
  return { delimiter, columns, rows, numeric: columns.map((_, c) => numericCol(rows, c)), header };
}

export const delimiterName = (d) => ({ ',': 'comma', ';': 'semicolon', '\t': 'tab', '|': 'pipe' }[d] || JSON.stringify(d));
export const numberOf = (v) => Number(String(v).replace(',', '.').replace(/%$/, ''));
