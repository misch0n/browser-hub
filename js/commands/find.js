import { search, documents, highlight, CATEGORIES } from '../core/search.js';
import { plural, todayISO } from '../core/util.js';
import { dueSeg, longDate, kindSeg } from '../core/format.js';
import { repeatLabel } from '../core/repeat.js';
import { diagramKind } from '../lib/diagrams.js';

// Long text is cut to a window around the first hit.
function excerpt(text, ranges, max = 140) {
  if (text.length <= max) return { text, ranges };
  const first = ranges && ranges.length ? Math.min(...ranges.map((r) => r[0])) : 0;
  const start = Math.max(0, Math.min(first - 30, text.length - max));
  const cut = text.slice(start, start + max);
  const shifted = (ranges || []).map(([a, b]) => [a - start, b - start]).filter(([a, b]) => b > 0 && a < cut.length)
    .map(([a, b]) => [Math.max(0, a), Math.min(cut.length, b)]);
  const pre = start > 0 ? '…' : '';
  return { text: pre + cut + (start + max < text.length ? '…' : ''), ranges: shifted.map(([a, b]) => [a + pre.length, b + pre.length]) };
}

const hl = (text, ranges, cls) => {
  const e = excerpt(text, ranges);
  return highlight(e.text, e.ranges, cls);
};

export default function register(add, { st, defs, isBuiltin }) {
  add({
    name: 'find', group: 'Find', desc: 'search everything: tasks, notes, events, snippets, links, diagrams, aliases, commands, history',
    usage: ['find <words>', 'find "<phrase>"', 'find /<regex>/[flags]', 'find <words> in:<category>'],
    examples: ['find flour', 'find pmt', 'find "oat milk"', 'find /^buy\\s/', 'find standup in:events', 'find #home'],
    complete: () => CATEGORIES.map((c) => ({ value: 'in:' + c.id, label: c.label })),
    async run(ctx, rest) {
      const { out } = ctx;
      if (!rest.trim()) {
        out.head([['Usage', ''], [' · find', 'dim']], 'err');
        out.table(null, this.usage.map((u) => [[[u, '']]]));
        out.dim('Categories: ' + CATEGORIES.map((c) => c.id).join(', '));
        return;
      }
      const r = search(rest, documents(st(), defs, isBuiltin));
      if (r.error) return out.err(r.error);
      const q = rest.trim();
      if (!r.total) {
        out.head([['Nothing matches ', 'dim'], ['“' + q + '”', 'strong']], 'dim');
        if (!r.regex) out.dim('Words match whole, from the start, inside a word, or loosely (pmt finds payment) · /regex/ for patterns');
        return;
      }
      out.head([[plural(r.total, 'result'), 'strong'], [' for ', 'dim'], ['“' + q + '”', 'strong'],
        [r.regex ? ' · regular expression' : '', 'dim'], [r.groups.length > 1 ? ' · ' + plural(r.groups.length, 'group') + ', best first' : '', 'dim']]);
      const today = todayISO(ctx.now());
      for (const g of r.groups) {
        out.section([[g.label, ''], [' ' + g.total, 'faint']]);
        out.table(null, g.results.map(({ doc, hits }) => {
          const link = (text, cls) => [text, cls, doc.run ? { run: doc.run } : undefined];
          switch (doc.category) {
            case 'tasks': {
              const t = doc.task;
              return [[link(t.id, t.done ? 'faint' : 'id')], [...hl(t.text, hits.text, t.done ? 'gone' : ''),
                [t.repeat ? '  ↻ ' + repeatLabel(t.repeat) : '', 'faint'],
                ...(t.tags.length ? [['  ', ''], ...hl(t.tags.map((x) => '#' + x).join(' '), hits.tags, 'tag')] : [])],
              t.due ? [dueSeg(t.due, today, t.done)] : []];
            }
            case 'notes':
              return [[link(doc.key, 'id')], hl(doc.note.text, hits.text), []];
            case 'events': {
              const e = doc.event;
              return [[link(e.id, 'id')], hl(e.title, hits.title), [[longDate(e.date, today), 'date'], [e.time ? ' ' + e.time : '', 'num']]];
            }
            case 'snippets':
              return [[link(doc.key, 'id')], [...hl(doc.snippet.name, hits.name, 'accent'), ['  ', ''], ...hl(doc.snippet.text.split('\n')[0], hits.text, 'dim')], []];
            case 'diagrams':
              return [[link(doc.key, 'id')], [...hl(doc.diagram.name, hits.name, 'strong'), ['  ' + diagramKind(doc.diagram.code), 'dim']], []];
            case 'journal':
              return [[link(doc.key, 'id')], hl(doc.entry.text.split('\n')[0], hits.text), [[longDate(doc.entry.date, today), 'date']]];
            case 'lists':
              return [[link(doc.list.name, 'accent')], hl(doc.list.entries.map((e) => e.text).join(' · ') || 'empty', hits.items, 'dim'), []];
            case 'birthdays':
              return [[link(doc.key, 'id')], hl(doc.birthday.name, hits.name, 'strong'), []];
            case 'subs':
              return [[link(doc.key, 'id')], [...hl(doc.sub.name, hits.name, 'strong'), ['  ' + doc.sub.price.toFixed(2) + ' ' + doc.sub.currency, 'dim']], []];
            case 'later': {
              const l = doc.link;
              return [[link(l.id, l.read ? 'faint' : 'id')], [...(l.title ? [...hl(l.title, hits.title, l.read ? 'gone' : ''), ['  ', '']] : []), ...hl(l.url, hits.url, 'url')], []];
            }
            case 'links': {
              const a = doc.alias;
              return [[...highlight(a.name, hits.name, 'accent').map((s) => [s[0], s[1], { run: doc.run }])],
                [kindSeg(a.command ? 'command' : a.template ? 'engine' : 'alias'), ['  ', ''], ...hl(a.command || a.template || a.base, hits.url, a.command ? 'dim' : 'url')], []];
            }
            case 'commands':
              return [[...highlight(doc.def.name, hits.name, 'accent').map((s) => [s[0], s[1], { run: doc.run }])],
                [kindSeg(doc.def.group), ['  ', ''], ...hl(doc.def.desc, hits.about, 'dim')], []];
            default:
              return [[['›', 'faint']], hl(doc.title, hits.command), []];
          }
        }), { stack: true });
        if (g.results.length < g.total) {
          const more = 'find ' + q + ' in:' + g.category;
          out.line([['+' + (g.total - g.results.length) + ' more · ', 'faint'], [more, 'accent', { run: more }]]);
        }
      }
    },
  });
}

