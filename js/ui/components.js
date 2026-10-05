import { h } from './dom.js';
import { pad2 } from '../core/util.js';

// Month grid, Monday first. Used by `cal` and by the calendar widget.
// spec: { year, month (1-12), today: 'YYYY-MM-DD', marks: [day numbers with events] }
export function monthGrid(spec) {
  const { year, month, today } = spec;
  const marks = new Set(spec.marks || []);
  const prefix = year + '-' + pad2(month) + '-';
  const lead = (new Date(year, month - 1, 1).getDay() + 6) % 7;
  const days = new Date(year, month, 0).getDate();
  const head = h('tr', null, ...['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'].map((d, i) => h('th', { class: i > 4 ? 'wkend' : '', text: d })));
  const body = h('tbody');
  let row = h('tr');
  for (let i = 0; i < lead; i++) row.appendChild(h('td', { class: 'pad' }));
  for (let d = 1; d <= days; d++) {
    const col = (lead + d - 1) % 7;
    const cls = [
      prefix + pad2(d) === today ? 'today' : '',
      marks.has(d) ? 'mark' : '',
      col > 4 ? 'wkend' : '',
    ].filter(Boolean).join(' ');
    row.appendChild(h('td', { class: cls, title: marks.has(d) ? 'has events' : null }, h('span', { text: String(d) })));
    if (col === 6) { body.appendChild(row); row = h('tr'); }
  }
  if (row.childElementCount) body.appendChild(row);
  return h('table', { class: 'cal' }, h('thead', null, head), body);
}
