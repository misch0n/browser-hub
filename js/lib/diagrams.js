// Mermaid diagrams kept in the hub: their kind (from the first line), a
// starter, and the library file (export and import).

import { KINDS } from '../core/records.js';

const KIND_NAMES = [
  [/^(flowchart|graph)\b/i, 'flowchart'], [/^sequenceDiagram\b/, 'sequence'], [/^classDiagram(-v2)?\b/, 'class'],
  [/^stateDiagram(-v2)?\b/, 'state'], [/^erDiagram\b/, 'entity relationship'], [/^journey\b/, 'user journey'], [/^gantt\b/, 'Gantt'],
  [/^pie\b/, 'pie'], [/^quadrantChart\b/, 'quadrant'], [/^requirementDiagram\b/, 'requirement'], [/^gitGraph\b/, 'git graph'],
  [/^C4(Context|Container|Component|Dynamic|Deployment)\b/, 'C4'], [/^mindmap\b/, 'mind map'], [/^timeline\b/, 'timeline'],
  [/^zenuml\b/, 'ZenUML'], [/^sankey(-beta)?\b/, 'Sankey'], [/^xychart(-beta)?\b/, 'XY chart'], [/^block(-beta)?\b/, 'block'],
  [/^packet(-beta)?\b/, 'packet'], [/^kanban\b/, 'kanban'], [/^architecture(-beta)?\b/, 'architecture'], [/^radar(-beta)?\b/, 'radar'],
  [/^treemap(-beta)?\b/, 'treemap'],
];

// The diagram's kind from its first real line (front matter and %% comments skipped).
export function diagramKind(code) {
  const lines = String(code).split('\n');
  let i = 0;
  if (/^---\s*$/.test(lines[0] || '')) {
    const end = lines.findIndex((l, k) => k > 0 && /^---\s*$/.test(l));
    i = end > 0 ? end + 1 : lines.length;
  }
  for (; i < lines.length; i++) {
    const l = lines[i].trim();
    if (!l || l.startsWith('%%')) continue;
    const k = KIND_NAMES.find(([re]) => re.test(l));
    return k ? k[1] : 'unknown';
  }
  return 'empty';
}

export const STARTER = 'flowchart LR\n  idea[An idea] --> plan{Worth it?}\n  plan -->|yes| build[Build it]\n  plan -->|no| idea';

// The library as a file: { type, version, exported, diagrams: [{ name, code, created, updated }] }
export function libraryFile(items, now) {
  return {
    type: 'control-center diagrams', version: 1, exported: now.toISOString(),
    diagrams: items.map((d) => ({ name: d.name, code: d.code, created: d.created, updated: d.updated })),
  };
}

// A library file, a whole hub export, or a plain list -> { diagrams: [{ name, code, created?, updated? }], invalid }
export function readLibrary(text) {
  let j;
  try { j = JSON.parse(text); } catch (e) { throw new Error('not JSON'); }
  const list = Array.isArray(j) ? j : j && Array.isArray(j.diagrams) ? j.diagrams
    : j && j.collections && j.collections.diagrams && Array.isArray(j.collections.diagrams.items) ? j.collections.diagrams.items : null;
  if (!list) throw new Error('no diagrams in this file');
  const diagrams = [];
  let invalid = 0;
  for (const d of list) {
    const name = KINDS.diagram.fields.name.parse(d && typeof d.name === 'string' ? d.name : '');
    const code = KINDS.diagram.fields.code.parse(d && typeof d.code === 'string' ? d.code : '');
    if (name.error || code.error) { invalid++; continue; }
    diagrams.push({ name: name.value, code: code.value, created: d.created, updated: d.updated });
  }
  return { diagrams, invalid };
}
