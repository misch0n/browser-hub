import { plural, todayISO, parseDate, addDays, monthIndex, pad2 } from '../core/util.js';
import { longDate, dayLabel, MONTH_NAMES } from '../core/format.js';
import { oneValue } from '../core/args.js';
import { parseBirthday, nextBirthday, perMonth, LIST_NAME } from '../core/personal.js';
import { readCurrency } from '../core/records.js';
import { parseRepeat, repeatLabel, nextOn } from '../core/repeat.js';
import { foodAmount } from './cook.js';
import { mealParts } from '../lib/nutrition.js';

// birthdays, lists, subs, log, eat: the personal collections (core/personal.js)
// in the shared grammar (commands/records.js). Birthdays and renewals also show
// as entries on their days in cal, agenda, today and the widgets (core/agenda.js).

const r1 = (v) => (typeof v === 'number' ? Math.round(v * 10) / 10 : null);
const kcalFmt = (v) => Math.round(v).toLocaleString('en');
const SPARK = '▁▂▃▄▅▆▇█';
const spark = (vals) => {
  const max = Math.max(...vals, 1);
  return vals.map((v) => (v ? SPARK[Math.min(7, Math.floor((v / max) * 7.999))] : ' ')).join('');
};

// A whole argument that names days: a date, 'week', or a month. -> { from, to, label } | null
function daysOf(text, now) {
  const t = text.trim().toLowerCase();
  if (!t) return null;
  const today = todayISO(now);
  if (t === 'week' || t === 'this week' || t === 'last 7 days') return { from: addDays(today, -6), to: today, label: 'the last 7 days' };
  const m = /^([a-z]+)\.?(?:\s+(\d{4}))?$/.exec(t);
  if (m && monthIndex(m[1]) >= 0 && m[1].length >= 3 && !parseDate(t, now)) {
    const mi = monthIndex(m[1]);
    let y = m[2] ? +m[2] : now.getFullYear();
    if (!m[2] && mi > now.getMonth()) y--; // 'december' in October: the one just gone
    const last = new Date(y, mi + 1, 0).getDate();
    return { from: y + '-' + pad2(mi + 1) + '-01', to: y + '-' + pad2(mi + 1) + '-' + pad2(last), label: MONTH_NAMES[mi] + ' ' + y };
  }
  if (/^(january|february|march|april|may|june|july|august|september|october|november|december)$/.test(t)) return null;
  const d = parseDate(t, now);
  return d ? { from: d, to: d, label: longDate(d, today) } : null;
}

export default function register(add, { st, usage, records }) {
  // ---- birthdays ----------------------------------------------------------------------
  function listBirthdays(ctx) {
    const { out } = ctx;
    const today = todayISO(ctx.now());
    const items = st().birthdays.items.map((b) => ({ b, n: nextBirthday(b, today) })).sort((a, c) => a.n.days - c.n.days);
    if (!items.length) {
      out.head('No birthdays', 'dim');
      return out.dim('Add one: birthdays add Ana 12 mar 1986 (the year is optional; with it, the age shows)');
    }
    out.head([[plural(items.length, 'birthday'), 'strong'], [items[0].n.days === 0 ? ' · ' + items.filter((x) => !x.n.days).length + ' today' : '', 'accent']]);
    out.table(['id', 'who', 'birthday', 'age', 'when'], items.map(({ b, n }) => [
      [[b.id, 'id', { run: 'birthdays ' + b.id }]], [[b.name, n.days === 0 ? 'accent' : 'strong']],
      [[longDate(n.date, today).replace(/ \d{4}$/, ''), 'date']],
      [[n.age !== null ? 'turns ' + n.age : '', 'num']],
      [[n.days === 0 ? 'today 🎂' : n.days === 1 ? 'tomorrow' : 'in ' + n.days + ' days', n.days <= 7 ? 'warn' : 'dim']],
    ]));
  }
  async function addBirthday(ctx, rest) {
    const { out } = ctx;
    const words = rest.trim().split(/\s+/).filter(Boolean);
    for (const k of [3, 2, 1]) {
      if (words.length <= k) continue;
      const b = parseBirthday(words.slice(-k).join(' '), monthIndex, ctx.now().getFullYear());
      if (!b) continue;
      const name = oneValue(words.slice(0, -k).join(' '));
      if (name.length > 100) return out.err('The name is too long (100 characters at most)');
      const id = await ctx.data.allocId('b');
      await ctx.data.mutate('birthdays', (d) => { d.items.push({ id, name, date: b.date, year: b.year, created: ctx.now().toISOString() }); });
      const n = nextBirthday(b, todayISO(ctx.now()));
      out.head([['Added birthday ', ''], [id, 'id', { run: 'birthdays ' + id }], [' · ' + name, 'strong']], 'ok');
      return out.line([[longDate(n.date, todayISO(ctx.now())).replace(/ \d{4}$/, ''), 'date'],
        [(n.age !== null ? ' · turns ' + n.age : '') + (n.days === 0 ? ' today' : ' in ' + plural(n.days, 'day')), 'dim'], [' · shows in agenda, cal and today', 'faint']]);
    }
    out.err('Give a name and a date: birthdays add Ana 12 mar 1986 (or 12 mar, 1986-03-12, 12.03)');
  }
  const bdSpec = { list: listBirthdays, add: addBirthday, addArgs: '<name> <date> (12 mar 1986, 12 mar, 1986-03-12)' };
  add({
    name: 'birthdays', group: 'Calendar', desc: 'birthdays with the age they turn; they show in agenda, cal and today',
    usage: records.usageFor('birthday', bdSpec),
    examples: ['birthdays', 'birthdays add Ana 12 mar 1986', 'birthdays add Grandma Rosa 3 august', 'birthdays b1', 'birthdays b1 edit date 1986-03-12', 'birthdays b1 rm'],
    complete: (prev) => records.complete('birthday', prev),
    run: (ctx, rest) => records.route(ctx, 'birthday', rest, bdSpec),
  });

  // ---- lists ----------------------------------------------------------------------------
  const listRef = (l) => 'lists ' + l.name;
  function listLists(ctx) {
    const { out } = ctx;
    const items = st().lists.items;
    if (!items.length) {
      out.head('No lists', 'dim');
      return out.dim('Make one: lists add packing passport, charger, toothbrush');
    }
    out.head([[plural(items.length, 'list'), 'strong']]);
    out.table(['list', 'done', ''], items.map((l) => {
      const done = l.entries.filter((e) => e.done).length;
      return [[[l.name, 'accent', { run: listRef(l) }]], [[done + ' of ' + l.entries.length, done === l.entries.length && done ? 'ok' : 'num']],
        [[l.entries.filter((e) => !e.done).slice(0, 4).map((e) => e.text).join(', '), 'dim']]];
    }));
  }
  function showList(ctx, l, head) {
    const { out } = ctx;
    const done = l.entries.filter((e) => e.done).length;
    out.head(head || [[l.name, 'strong'], [' · ' + done + ' of ' + l.entries.length + ' done', 'dim']], l.entries.length && done === l.entries.length ? 'ok' : undefined);
    if (!l.entries.length) return out.dim('Empty · ' + listRef(l) + ' add <item>, <item> …');
    out.table(null, l.entries.map((e, i) => [
      [[e.done ? '☑' : '☐', e.done ? 'ok' : 'dim', { run: listRef(l) + ' ' + (e.done ? 'uncheck ' : 'check ') + (i + 1) }]],
      [[String(i + 1), 'faint']], [[e.text, e.done ? 'gone' : '']],
    ]));
    out.line([['reset', 'accent', { run: listRef(l) + ' reset' }], [' unchecks all · tap a box to tick it · ', 'faint'], [listRef(l) + ' add …', 'faint']]);
  }
  const splitItems = (text) => text.split(/\s*[,;\n]\s*/).map((x) => oneValue(x.trim())).filter(Boolean);
  async function addList(ctx, rest) {
    const { out } = ctx;
    const m = /^(\S+)(?:\s+([\s\S]*))?$/.exec(rest.trim());
    if (!m) return out.err('lists add <name> [item, item …]');
    const name = m[1].toLowerCase();
    if (!LIST_NAME.test(name) || /^c\d+$/.test(name)) return out.err("A list's name is one word (letters, digits, . _ -), like packing or groceries");
    if (st().lists.items.some((l) => l.name === name)) return out.err("A list named '" + name + "' already exists · " + 'lists ' + name + ' add <item>');
    const entries = m[2] ? splitItems(m[2]).slice(0, 500).map((text) => ({ text: text.slice(0, 200), done: false })) : [];
    const id = await ctx.data.allocId('c');
    const now = ctx.now().toISOString();
    await ctx.data.mutate('lists', (d) => { d.items.push({ id, name, entries, created: now, updated: now }); });
    showList(ctx, st().lists.items.find((l) => l.id === id), [['Added list ', ''], [name, 'accent', { run: 'lists ' + name }], [' · ' + plural(entries.length, 'item'), 'dim']]);
    ctx.out.tone('ok');
  }
  // Which entry `word` means: its number, or the first whose text starts with it.
  const entryAt = (l, word) => {
    const w = word.trim().toLowerCase();
    if (/^\d+$/.test(w)) return +w - 1 < l.entries.length && +w >= 1 ? +w - 1 : -1;
    return l.entries.findIndex((e) => e.text.toLowerCase() === w) >= 0 ? l.entries.findIndex((e) => e.text.toLowerCase() === w)
      : l.entries.findIndex((e) => e.text.toLowerCase().startsWith(w));
  };
  async function changeList(ctx, l, fn) {
    await ctx.data.mutate('lists', (d) => { const x = d.items.find((y) => y.id === l.id); if (x) { fn(x); x.updated = ctx.now().toISOString(); } });
    return st().lists.items.find((y) => y.id === l.id);
  }
  const tick = (to) => async (ctx, l, rest) => {
    if (!rest) return ctx.out.err('Which item? ' + listRef(l) + (to ? ' check' : ' uncheck') + ' <number or text>');
    const i = entryAt(l, rest);
    if (i < 0) return ctx.out.err('No item ' + rest + ' in ' + l.name);
    const next = await changeList(ctx, l, (x) => { x.entries[i].done = to; });
    showList(ctx, next);
  };
  const listSpec = {
    list: listLists, add: addList, addArgs: '<name> [item, item …]', id: '<name>',
    verbs: {
      add: async (ctx, l, rest) => {
        const items = splitItems(rest);
        if (!items.length) return ctx.out.err(listRef(l) + ' add <item>, <item> …');
        if (l.entries.length + items.length > 500) return ctx.out.err('500 items at most');
        showList(ctx, await changeList(ctx, l, (x) => { x.entries.push(...items.map((text) => ({ text: text.slice(0, 200), done: false }))); }));
      },
      check: tick(true),
      uncheck: tick(false),
      reset: async (ctx, l) => showList(ctx, await changeList(ctx, l, (x) => { x.entries.forEach((e) => { e.done = false; }); })),
      drop: async (ctx, l, rest) => {
        const i = entryAt(l, rest || '');
        if (i < 0) return ctx.out.err('Which item? ' + listRef(l) + ' drop <number or text>');
        showList(ctx, await changeList(ctx, l, (x) => { x.entries.splice(i, 1); }));
      },
    },
    verbUsage: ['add <item>, <item> …', 'check <n | text>', 'uncheck <n | text>', 'reset', 'drop <n | text>'],
    show: (ctx, l) => showList(ctx, l),
  };
  add({
    name: 'lists', group: 'Notes', desc: 'reusable checklists (packing, groceries): tick items off, reset for next time',
    usage: records.usageFor('list', listSpec),
    examples: ['lists', 'lists add packing passport, charger, toothbrush', 'lists packing', 'lists packing add socks', 'lists packing check 2',
      'lists packing check pass', 'lists packing reset', 'lists packing drop 3', 'lists packing edit name travel', 'lists packing rm'],
    complete: (prev) => {
      if (prev.length === 2 && ['check', 'uncheck', 'drop'].includes(prev[1])) {
        const l = st().lists.items.find((x) => x.name === prev[0]);
        return l ? l.entries.map((e, i) => ({ value: String(i + 1), label: e.text })) : [];
      }
      return records.complete('list', prev, listSpec);
    },
    run: (ctx, rest) => records.route(ctx, 'list', rest, listSpec),
  });

  // ---- subs -----------------------------------------------------------------------------
  function listSubs(ctx) {
    const { out } = ctx;
    const today = todayISO(ctx.now());
    const items = st().subs.items.map((s) => ({ s, next: nextOn(s.every, s.next, today) })).sort((a, b) => (a.next < b.next ? -1 : 1));
    if (!items.length) {
      out.head('No subscriptions', 'dim');
      return out.dim('Add one: subs add Netflix 15.99 EUR every:month next:3 nov');
    }
    const totals = {};
    for (const { s } of items) totals[s.currency] = (totals[s.currency] || 0) + perMonth(s);
    out.head([[plural(items.length, 'subscription'), 'strong'], [' · ' + Object.entries(totals).sort().map(([c, v]) => v.toFixed(2) + ' ' + c + ' a month').join(' + '), 'dim']]);
    out.table(['id', 'name', 'price', 'every', 'next', 'a month'], items.map(({ s, next }) => [
      [[s.id, 'id', { run: 'subs ' + s.id }]], [[s.name, 'strong']], [[s.price.toFixed(2) + ' ' + s.currency, 'num']],
      [[repeatLabel(s.every).replace(/^every /, ''), 'dim']], [[longDate(next, today), next <= addDays(today, 7) ? 'warn' : 'date']],
      [[perMonth(s).toFixed(2), 'faint']],
    ]));
    out.kv(Object.entries(totals).sort().map(([c, v]) => [c, [[v.toFixed(2) + ' a month', 'num strong'], [' · ' + (v * 12).toFixed(2) + ' a year', 'dim']]]));
    out.dim('Totals per currency (no conversion) · renewals show in agenda and today');
  }
  async function addSub(ctx, rest) {
    const { out } = ctx;
    const words = rest.trim().split(/\s+/).filter(Boolean);
    let every = 'month', next = todayISO(ctx.now()), price = null, currency = null;
    const name = [];
    for (let i = 0; i < words.length; i++) {
      const w = words[i];
      if (/^(every|repeat):/i.test(w)) {
        const r = parseRepeat(w.slice(w.indexOf(':') + 1));
        if (!r || !/^(week|month|year|\d{1,2}[wmy])$/.test(r)) return out.err("Can't read '" + w + "' (every:month, every:year, every:3m, every:week)");
        every = r;
      } else if (/^next:/i.test(w)) {
        // next: takes as many words as make a date (next:3 nov)
        let d = null, k = i;
        for (let j = Math.min(words.length, i + 3); j > i && !d; j--) {
          d = parseDate([w.slice(5), ...words.slice(i + 1, j)].join(' '), ctx.now());
          if (d) k = j - 1;
        }
        if (!d) return out.err("Can't read the date in '" + w + "'");
        next = d;
        i = k;
      } else if (price === null && /^[€$£]?\d+(?:[.,]\d{1,2})?[€$£]?$/.test(w)) {
        price = Number(w.replace(/[€$£]/g, '').replace(',', '.'));
        const sym = /[€$£]/.exec(w);
        if (sym) currency = readCurrency(sym[0]);
      } else if (price !== null && !currency && readCurrency(w)) {
        currency = readCurrency(w);
      } else name.push(w);
    }
    if (!name.length || price === null) return out.err('subs add <name> <price> [currency] [every:month|year|3m] [next:<date>]');
    const last = st().subs.items[st().subs.items.length - 1];
    currency = currency || (last ? last.currency : 'EUR');
    const id = await ctx.data.allocId('p');
    const sub = { id, name: oneValue(name.join(' ')).slice(0, 100), price: Math.round(price * 100) / 100, currency, every, next, created: ctx.now().toISOString() };
    await ctx.data.mutate('subs', (d) => { d.items.push(sub); });
    out.head([['Added subscription ', ''], [id, 'id', { run: 'subs ' + id }], [' · ' + sub.name, 'strong']], 'ok');
    out.line([[sub.price.toFixed(2) + ' ' + currency, 'num'], [' ' + repeatLabel(every) + ' · next ' + longDate(next, todayISO(ctx.now())) + ' · ' + perMonth(sub).toFixed(2) + ' a month', 'dim']]);
  }
  const subSpec = { list: listSubs, add: addSub, addArgs: '<name> <price> [currency] [every:month|year|3m] [next:<date>]' };
  add({
    name: 'subs', group: 'Calendar', desc: 'subscriptions: price, renewal, monthly and yearly totals; renewals show in agenda',
    usage: records.usageFor('sub', subSpec),
    examples: ['subs', 'subs add Netflix 15.99 EUR every:month next:3 nov', 'subs add iCloud 2.99', 'subs add domain 12 USD every:year next:2027-02-01', 'subs p1 edit price 17.99', 'subs p1 rm'],
    complete: (prev) => records.complete('sub', prev),
    run: (ctx, rest) => records.route(ctx, 'sub', rest, subSpec),
  });

  // ---- log (journal) ----------------------------------------------------------------------
  function showDays(ctx, range) {
    const { out } = ctx;
    const today = todayISO(ctx.now());
    const items = st().journal.items.filter((j) => j.date >= range.from && j.date <= range.to)
      .sort((a, b) => (a.date === b.date ? (a.created < b.created ? -1 : 1) : a.date < b.date ? 1 : -1));
    if (!items.length) {
      out.head([['Nothing written', ''], [' · ' + range.label, 'dim']], 'dim');
      return out.dim('log <text> writes for today · log j3 edit date yesterday moves one');
    }
    out.head([[plural(items.length, 'entry', 'entries'), 'strong'], [' · ' + range.label, 'dim']]);
    let day = null;
    for (const j of items) {
      if (j.date !== day) {
        day = j.date;
        out.section([[longDate(j.date, today), 'date'], [' · ' + dayLabel(j.date, today), 'faint']]);
      }
      out.line([[j.id, 'id', { run: 'log ' + j.id }], ['  ' + j.text, '']]);
    }
  }
  async function addEntry(ctx, rest) {
    const { out } = ctx;
    const text = oneValue(rest.trim());
    if (!text) return out.err('log <text> writes an entry for today');
    if (text.length > 10000) return out.err('Too long (10,000 characters at most)');
    const id = await ctx.data.allocId('j');
    const today = todayISO(ctx.now());
    await ctx.data.mutate('journal', (d) => { d.items.push({ id, date: today, text, created: ctx.now().toISOString() }); });
    const n = st().journal.items.filter((j) => j.date === today).length;
    out.head([['Written ', ''], [id, 'id', { run: 'log ' + id }], [' · ' + plural(n, 'entry', 'entries') + ' today', 'dim']], 'ok');
  }
  const logSpec = {
    short: true, add: addEntry, addArgs: '<text>', filter: '[<date> | <month> | week]',
    list: (ctx, rest) => showDays(ctx, rest ? daysOf(rest, ctx.now()) || { from: '0000', to: '0000', label: rest } : { from: addDays(todayISO(ctx.now()), -6), to: todayISO(ctx.now()), label: 'the last 7 days' }),
  };
  add({
    name: 'log', group: 'Notes', desc: 'a journal: log <text> writes for today; log yesterday, log october, log week read back',
    usage: ['log <text>', 'log', 'log <date> | <month> | week', 'log j<n> [edit [<field> [<value>]] | rm]'],
    examples: ['log finished the report, long walk after', 'log', 'log yesterday', 'log october', 'log week', 'log j3 edit date yesterday', 'log j3 rm'],
    complete: (prev) => (prev.length === 0 ? [{ value: 'yesterday' }, { value: 'week' }, ...st().journal.items.slice(-10).map((j) => ({ value: j.id, label: j.text.slice(0, 40) }))]
      : records.complete('entry', prev)),
    run(ctx, rest) {
      const range = daysOf(rest, ctx.now());
      if (range) return showDays(ctx, range); // a date alone reads that day; more words are an entry
      return records.route(ctx, 'entry', rest, logSpec);
    },
  });

  // ---- eat (calorie tracker) ------------------------------------------------------------------
  function dayMeals(date) {
    return st().meals.items.filter((m) => m.date === date).sort((a, b) => ((a.time || '') < (b.time || '') ? -1 : 1));
  }
  // The day's meals; under a meal just logged (`after`), as a section rather than the turn's heading.
  function showDay(ctx, date, after = false) {
    const { out } = ctx;
    const today = todayISO(ctx.now());
    const meals = dayMeals(date);
    const target = st().settings.kcalTarget || null;
    const tot = { kcal: 0, protein: 0, fat: 0, carbs: 0 };
    for (const m of meals) for (const k of Object.keys(tot)) tot[k] += m[k] || 0;
    const label = date === today ? 'Today' : longDate(date, today);
    const head = [[label, 'strong'], [' · ' + kcalFmt(tot.kcal) + (target ? ' of ' + kcalFmt(target) : '') + ' kcal', 'num'],
      [target ? (tot.kcal <= target ? ' · ' + kcalFmt(target - tot.kcal) + ' left' : ' · ' + kcalFmt(tot.kcal - target) + ' over') : '', target && tot.kcal > target ? 'warn' : 'dim']];
    if (after) out.section(head);
    else out.head(head, target && tot.kcal > target ? 'warn' : undefined);
    if (!meals.length) return out.dim('Nothing logged · eat 150 g chicken breast · eat 2 eggs + 1 slice bread');
    // Macros per meal are in each meal's details (tap its id); the table stays narrow enough for a phone.
    out.table(['id', 'time', 'food', 'amount', 'kcal'], meals.map((m) => [
      [[m.id, 'id', { run: 'eat ' + m.id }]], [[m.time || '', 'dim']], [[m.food, '']], [[m.label || r1(m.grams) + ' g', 'dim']],
      [[kcalFmt(m.kcal), 'num']],
    ]));
    const e = tot.protein * 4 + tot.fat * 9 + tot.carbs * 4;
    const share = (x) => (e ? Math.round((x / e) * 100) + '%' : '–');
    out.kv([['total', [[kcalFmt(tot.kcal) + ' kcal', 'num strong'], [' · protein ' + r1(tot.protein) + ' g (' + share(tot.protein * 4) + ') · fat ' + r1(tot.fat) + ' g (' + share(tot.fat * 9) + ') · carbs ' + r1(tot.carbs) + ' g (' + share(tot.carbs * 4) + ')', 'dim']]]]);
    if (!target && date === today) out.dim('Set a daily target: eat target 2000');
  }
  function showWeek(ctx) {
    const { out } = ctx;
    const today = todayISO(ctx.now());
    const days = Array.from({ length: 7 }, (_, i) => addDays(today, i - 6));
    const kcal = days.map((d) => dayMeals(d).reduce((n, m) => n + m.kcal, 0));
    const logged = kcal.filter(Boolean);
    const target = st().settings.kcalTarget || null;
    out.head([['The last 7 days', 'strong'], [logged.length ? ' · ' + kcalFmt(logged.reduce((a, b) => a + b, 0) / logged.length) + ' kcal a day on average' : '', 'dim']]);
    out.line([[spark(kcal), 'accent'], ['  ' + days.map((d) => longDate(d, today).slice(0, 2)).join(' '), 'faint']]);
    out.table(['day', 'kcal', ''], days.map((d, i) => [[[longDate(d, today), 'date', { run: 'eat ' + d }]],
      [[kcal[i] ? kcalFmt(kcal[i]) : '–', 'num']], [[target && kcal[i] ? (kcal[i] <= target ? 'within ' + kcalFmt(target) : kcalFmt(kcal[i] - target) + ' over') : '', target && kcal[i] > target ? 'warn' : 'faint']]]).reverse());
  }
  async function addMeal(ctx, rest) {
    const { out } = ctx;
    const parts = mealParts(rest) || [rest];
    const now = ctx.now();
    const time = pad2(now.getHours()) + ':' + pad2(now.getMinutes());
    const found = [];
    for (const p of parts) {
      const r = await foodAmount(st(), p);
      if (r.error) return out.err((parts.length > 1 ? '"' + p + '": ' : '') + r.error);
      found.push(r);
    }
    const ids = await ctx.data.allocIds('m', found.length);
    const rows = found.map((r, i) => {
      const v = (k) => (r.values[k] === null || r.values[k] === undefined ? null : Math.round(((r.values[k] * r.grams) / 100) * 10) / 10);
      return { id: ids[i], date: todayISO(now), time, food: r.name.slice(0, 100), grams: Math.round(r.grams * 10) / 10, kcal: v('kcal') || 0,
        protein: v('protein'), fat: v('fat'), carbs: v('carbs'), ...(r.label && !/^[\d.,]+ g$/.test(r.label) ? { label: r.label.slice(0, 60) } : {}), created: now.toISOString() };
    });
    await ctx.data.mutate('meals', (d) => { d.items.push(...rows); });
    const added = rows.reduce((n, m) => n + m.kcal, 0);
    out.head([['Logged ', ''], [rows.map((m) => m.food).join(' + '), 'strong'], [' · ' + kcalFmt(added) + ' kcal', 'num']], 'ok');
    for (const r of found) if (r.others) out.dim('"' + r.name + '": the first of ' + (r.others + 1) + ' foods that match; add words for another (cook calorie shows them)');
    showDay(ctx, todayISO(now), true);
  }
  const eatSpec = {
    short: true, add: addMeal, addArgs: '<amount> <food> [+ <amount> <food> …]',
    list: (ctx) => showDay(ctx, todayISO(ctx.now())),
  };
  add({
    name: 'eat', group: 'Kitchen', desc: 'a calorie tracker: eat 150 g chicken breast logs it (from cook calorie and your foods); eat shows the day',
    usage: ['eat <amount> <food> [+ <amount> <food> …]', 'eat', 'eat <date> | week', 'eat target <kcal> | none', 'eat m<n> [edit [<field> [<value>]] | rm]'],
    examples: ['eat 150 g chicken breast', 'eat 2 eggs + 1 slice bread', 'eat 1 cup rice cooked', 'eat', 'eat yesterday', 'eat week', 'eat target 2000', 'eat m3 edit grams 200', 'eat m3 rm'],
    complete: (prev) => (prev.length === 0 ? ['yesterday', 'week', 'target'].map((v) => ({ value: v })) : records.complete('meal', prev)),
    async run(ctx, rest) {
      const { out } = ctx;
      const t = rest.trim();
      const tm = /^target(?:\s+(\S+))?$/i.exec(t);
      if (tm) {
        if (!tm[1]) return out.head(st().settings.kcalTarget ? [['Daily target ', ''], [kcalFmt(st().settings.kcalTarget) + ' kcal', 'num']] : 'No daily target · eat target 2000', 'info');
        const none = /^(none|off|-)$/i.test(tm[1]);
        const n = Number(tm[1]);
        if (!none && !(Number.isInteger(n) && n >= 500 && n <= 10000)) return out.err('A target is 500 to 10,000 kcal (or none)');
        await ctx.data.mutate('settings', (d) => { d.kcalTarget = none ? null : n; });
        return out.head(none ? 'No daily target' : [['Daily target ', ''], [kcalFmt(n) + ' kcal', 'num'], [' · on every device', 'dim']], 'ok');
      }
      if (/^(week|this week|last 7 days)$/i.test(t)) return showWeek(ctx);
      const d = t && !/\d\s*(g|kg|oz)\b/i.test(t) ? parseDate(t, ctx.now()) : null;
      if (d) return showDay(ctx, d);
      return records.route(ctx, 'meal', rest, eatSpec);
    },
  });
}
