# Recipes

Checklists for the changes that come up again and again. Each lists every
place to touch, so nothing is forgotten and nothing needs rediscovering.

## Add a command

1. **Logic** in `js/lib/<area>.js` (or `js/core/` if it's about the hub's own
   data): pure functions, no DOM, no `ctx`. Header comment says what it is.
2. **Command** in the matching `js/commands/<area>.js`, or a new file whose
   `register(add, helpers)` you add to the list in `js/commands/index.js`
   (order there = order of groups in `help`).
   - `group`: an existing one if it fits (`help` shows groups in first-seen order).
   - `desc`: one line, lower case, what it does for the user.
   - `usage`: every form, `<placeholders>` and `[optional]`, uniform with similar commands.
   - `examples`: real, runnable ones.
   - `complete(prev)`: offer the next word wherever the choices are known
     (subcommands, ids, names, units, …). Every command with known next input
     must complete it.
   - Flags: `private` if output could hold something sensitive; add
     `noHistory` if the *input* could (keys, tokens, plain text to encrypt).
   - With too little input, `return usage(ctx, this)`.
   - Output through `ctx.out` only; one `head` that summarises, then the body.
     Tone the head (`'ok'`, `'warn'`, `'err'`, `'info'`) when it's an outcome.
   - Use `out.copyable(text)` for the result someone will want to paste.
   - Secrets: ask with `ctx.askSecret(label)`, never take them from the command line.
   - Network: use `ctx.fetch || fetch` so tests can fake it; say what a browser can't do.
3. **Tests** in `tests/unit/<area>.test.js` (a new file for a new area): the lib functions directly, and the
   command through `makeApp().run('…')` (it returns the output as lines; see
   [testing.md](testing.md)). Add an e2e check in `tests/e2e.cjs` when the
   command draws something new, needs real browser APIs, or is interactive.
4. **Docs**: `npm run docs` (regenerates `docs/commands.md` and the README
   table); describe it for users in the README's feature sections; add a line
   to [changelog.md](changelog.md); tick it off in [todo.md](todo.md).

## Add a collection

Something the user keeps: a new kind of record in the shared grammar (like
`diagrams` or `foods`).

Shortcut for a simple one (no special merge or import rules): add a row to
`PERSONAL` in `js/core/personal.js` (collection, single-letter id prefix,
`normalize` for imported items). That alone covers steps 1–4, 7 and 9 below
(store, defaults, sync, undo, import, export counts); then do 5, 6, 8, 10–12.
The timers, birthdays, lists, subs, journal and meals collections work this way.

Every place, in order:

1. `js/core/store.js`: add to `COLLECTIONS`.
2. `js/core/data.js`: a default in `DEFAULTS` (`() => ({ items: [] })`), and
   include it in `hasUserData()`.
3. `js/core/merge.js`: add to `SYNCED` and to the `[collection, prefix]` list
   in the merge (ids renumbered on clash); update the header comment.
4. `js/core/undo.js`: add to `UNDOABLE` and `LISTS`.
5. `js/core/records.js`: a `KINDS` entry (`col`, `cmd`, `prefix`, `label`,
   `fields` with `parse`/`raw`/`aliases`); limits as constants.
6. `js/commands/records.js`: a `NOUNS` entry; add the kind to the
   `created`/`updated` lists in `extras`, `setField` and `remove` if it has
   timestamps and a name; `display` cases for its fields.
7. `js/core/importer.js`: validate and add imported items (fresh ids via
   `nextId`, skip duplicates), and count them in `added`/`counts`.
8. `js/core/search.js`: a category in `CATEGORIES` and documents in
   `documents()`; then its row in `js/commands/find.js`.
9. `js/commands/meta.js`: its count in `export`'s summary.
10. The command itself, routed through `records.route(ctx, kindOrAdapter, rest, spec)`
    (see `js/commands/keep.js` or `diagrams.js`), with `records.usageFor` and
    `records.complete`.
11. Tests: the import counts test (`import: conflicts reported…`) lists every
    collection's count; add one for sync between two devices (copy the
    `diagrams sync between devices` test).
12. Docs: [architecture.md](architecture.md) data table; README (grammar
    paragraph, sync list, find list).

## Add an output op

1. `js/ui/transcript.js`: the method inside `makeOut`. If it's part of the
   result, add its name to `RECORDED` and keep its arguments plain JSON (it is
   replayed from storage on every device, possibly by a newer or older
   version). Interactive or function-taking ones are not recorded and should
   `return` when `mode.replay` is set.
2. Styles in `style.css`, using the theme variables (`--fg`, `--dim`,
   `--accent`, `--border`, `--bg-elev`, …) and `calc(Npx * var(--scale))` for
   font sizes; touch inputs get the 16px rule near the end of the file (iOS zooms otherwise).
3. `tests/helpers.mjs`: add it to `recorder()` so command tests can see it.
4. e2e: draw it, replay it after a reload, and check phone width.
5. [architecture.md](architecture.md) Output list.

## Change the Content Security Policy

The CSP is a `<meta>` in `index.html` (and its own in `mermaid-frame.html`).
Widening it is a security decision: record it in [decisions.md](decisions.md),
explain it in the README and [security.md](security.md), and update the e2e
check "CSP meta blocks …" which asserts the exact `connect-src`.

## Record a decision, a deferral, or an idea

- Decided something with lasting consequences → [decisions.md](decisions.md).
- Left something out on purpose → [deferred.md](deferred.md) (with who decided and why).
- Researched something not yet approved → a file in [exploration/](exploration/README.md).
- Approved multi-step work → a plan in [plans/](plans/README.md), linked from [todo.md](todo.md).
