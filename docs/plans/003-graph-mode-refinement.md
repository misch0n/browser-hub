# 003 · Graph mode refinement: explicit graph, forward pane, additive input

Status: **in progress** (7 Oct 2026) · Todo: [todo.md](../todo.md#in-progress) ·
Design: [exploration/graph-mode.md](../exploration/graph-mode.md)

## Goal

Apply the owner's design note (7 Oct 2026) to the graph mode built earlier
that day (D19):
1. Graph mode is **additive**: the input behaves exactly as in normal mode
   (ghost text, Tab, ↑↓ history, Backspace, Esc); the panel is a display.
   Enter still runs the resolved command (resolution is the one thing graph
   mode changes, and it is shown before you press Enter).
2. The command structure is an **explicit, queryable graph** (single source of
   truth), built from what the commands declare (`usage`, `complete()`).
3. A **forward pane**: the letter trie of the word being typed, rooted at the
   cursor, with each name's next slot and the complete commands still
   reachable, drawn **fisheye** (near: large and sharp; far: smaller, still there).
4. **Parameters** as typed slots with a few recent values from history.
5. The **backward pane**: for words already passed, their siblings as plain
   sorted lists (the earlier columns, simplified).

Not built (parked in the exploration): the ring, command-graph convergence,
normal-mode autocomplete on the graph (normal mode is the control).

## Approach

- `core/graph.js`: `buildGraph(defs, entries)` merges each command's usage
  forms into a trie of element nodes `{ id, kind, el, children, end, lines,
  depth }`; positions while reading the input are node ids (a free-text node
  can repeat). `graphView` walks positions instead of (form, index) pairs, so
  its results (path, fan, run, ambiguity, counts) stay the same; tests guard that.
- `graphView(...).forward`: `{ cursor, branches: [{ typed, rest, value, kind,
  best, next: [words], reach: [complete commands] }], slots: [{ display,
  recent: [values] }], typo }`.
- `ui/graph.js`: two panes in the overlay; fisheye by distance from the cursor.
- `ui/prompt.js`: no graph-specific keys except Enter's resolved command;
  ghost text and Tab use normal completion on the text after `graph `;
  ↑↓ recall history and stay in graph mode.

## Steps

- [ ] 1. Explicit graph + walk over it; existing graph tests still pass.
- [ ] 2. Forward-pane data (letter trie, next slots, reachable commands, recent values) + unit tests.
- [ ] 3. Additive input in `prompt.js`; tests (unit where possible, e2e).
- [ ] 4. Overlay: backward pane (plain lists) + forward pane (fisheye); e2e on desktop and phone width.
- [ ] 5. Docs: README, architecture, decisions (amend D19), changelog, todo.

## Log

- 7 Oct 2026: plan written from the owner's design note; starting step 1.
