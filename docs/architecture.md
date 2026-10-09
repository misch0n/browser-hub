# Architecture

How the hub is put together. Read this before changing anything outside one
command. Each module also opens with a header comment saying what it is for;
those comments are kept current and are the detail behind this overview.

## The shape of it

A static site (GitHub Pages), no build step, no runtime dependencies. The page
is `index.html` plus native ES modules under `js/`. State lives in the
browser's `localStorage`, optionally synced to one JSON file in a private
GitHub repository. There is no server of our own.

```
keystroke ─► ui/prompt.js ─► main.js run() ─► core/dispatch.js
                                                 │
            ┌────────────── builtin ─────────────┤── alias / engine / search ─► location.assign(url)
            ▼                                    │
  commands/index.js run(name, rest, ctx)         └── error ─► out.err
            │  (one undo transaction)
            ▼
  a command's run(ctx, rest) ── reads/writes ─► ctx.data (core/data.js) ─► core/store.js ─► localStorage cc:*
            │                                        │
            │  describes its result                  └─► js/sync.js ⇄ api.github.com (private repo, <dir>/data.json)
            ▼
  ctx.out (ui/transcript.js): head, table, kv, code, … ─► DOM
            │  recorded as plain data ("ops")
            ▼
  core/log.js visual history (synced) ─► replayed on reload and on other devices
```

## Directories

| Path | What lives there | Rules |
| --- | --- | --- |
| `index.html` | the page, its CSP, the DOM skeleton | entry points are stamped by the build |
| `js/boot.js` | applies theme, panel state and text size before first paint | classic script, tiny, read-only |
| `js/main.js` | wiring: prompt, transcript, palette, widgets, sync, `ctx`, lifecycle | the only place that knows all parts |
| `js/core/` | data model and logic: store, data, dispatch, completion, graph mode, records, merge, log, undo, search, dates | pure where possible; no DOM |
| `js/lib/` | self-contained helpers for features (calc, qr, barcode, x509, jose, crypt, net, nutrition, …) | pure, testable in Node; no DOM, no `ctx` |
| `js/commands/` | built-in commands, one file per area, registered in `index.js` | never touch the DOM; talk only through `ctx` |
| `js/ui/` | DOM: transcript renderer, prompt, palette, graph panel, widgets, export, Mermaid host | the only code that builds elements |
| `js/vendor/` | third-party code as published (Mermaid 12.1.0) | never edit; don't read (5.5 MB) |
| `mermaid-frame.html`, `js/mermaid-frame.js` | the hidden page Mermaid draws in | own CSP; see Security |
| `tools/` | build-site (deploy build), docs-commands (command reference), nutrition table builder | Node scripts |
| `tests/` | unit (Node), decoders (QR, barcode, X.509), e2e (Playwright) | see [testing.md](testing.md) |
| `docs/` | this documentation | see [README.md](README.md) |

Large files to **search, not read**: `js/lib/nutrition-data.js` (generated,
110 KB), `js/lib/wordlist.js` (EFF word list), `js/vendor/**`,
and `tests/e2e.cjs` (1,500+ lines). Unit tests are split by area (`tests/unit/`).

## Commands

`js/commands/index.js` documents the contract in its header comment; in short:

- A command is a def: `{ name, group, desc, usage: [...], examples?: [...], complete?(prevArgs), run(ctx, rest) }`.
  `group` is the category `help` lists it under (first-seen order is the order shown).
- Flags on the def:
  - `private`: kept out of the shared (synced) visual history.
  - `noHistory`: not kept for ↑ recall either (anything holding a secret).
  - `ephemeral`: shown, then removed when the next command runs (`help`, `keys`).
  - `noUndo`: never an undo step.
  - `hidden`: an older name that still works but isn't listed.
  - `aliasOf: '<command>'`: a short name for that command (`n`, `t`, `ev`,
    `snip`, `alias`); `help` shows it after the command, not on its own line.
- Each area file exports `register(add, helpers)`; `helpers` is
  `{ st, usage, fullHelp, isBuiltin, defs, byName, records }`. `usage(ctx, def)`
  prints the command's full help headed "Usage", which is what a command does
  when it lacks what it needs.
- `run` is wrapped in an undo transaction: every `ctx.data.mutate` it makes
  becomes one undo step. Anything thrown is printed as an error.
- `docs/commands.md` and the README's table are generated from the defs
  (`npm run docs`); a unit test fails when they're stale.

### `ctx`

Built in `main.js` (`ctxBase` plus per-run fields); the full list with types is
in the header of `js/commands/index.js`. The ones most commands use: `out`,
`data`, `now()`, `store` (device-local values), `pasted` (the full text of
paste placeholders, in order), `askSecret(label)` (hidden input; never
echoed or kept), `setInput(text)`, `navigateAfter` (a URL to open once the
command is recorded), `pickFile(accept)` (call before any `await`),
`download(name, text, mime)`, `fetch` and `env` (tests replace the network and
the browser globals).

### The shared grammar (records)

Everything you keep follows one grammar, implemented once in
`js/commands/records.js` (routing, completion, usage) and `js/core/records.js`
(fields: parse, validate, apply):

```
<noun>                         list            <noun> <id>             show (values tappable)
<noun> add <…>                 add             <noun> <id> edit        edit in place
<noun> <id> edit <field> <v>   set a field     <noun> <id> rm          remove (undo link)
<noun> <id> <verb>             its own actions (tasks t3 done, later l2 open, diagrams d1 save)
```

`KINDS` in `core/records.js` defines each kind's collection, id prefix and
fields; `NOUNS` in `commands/records.js` its command names. Kinds: note `n`,
task `t`, event `e`, snippet `s` (also by name), link `l` (`later`), food `f`
(`cook calorie`), diagram `d`, alias (by name). Zones and widgets bring their
own adapters to the same router. A tapped value runs the matching
`<noun> <id> edit <field> <value>` command, so history shows every change as a
command.

### Aliases

`js/core/aliases.js` holds one table: URL aliases and engines (opened with
`location.assign` after `main.js`'s one-second wait, which Esc cancels; `go <url>`
and `later <id> open` reach the same wait through `ctx.navigateAfter`; `refresh`
sets `ctx.reloadAfter` and reloads at `?fresh=<time>`, dropped on load) and
command aliases, which `core/dispatch.js` expands into the built-in they name
(`{ kind: 'builtin', name, rest, alias, expanded }`). A command alias can't
name another alias, so expansion is one step and can't loop.

## Graph mode (experimental)

A prompt mode, on while the text starts with `graph `. It changes how input is
resolved and displayed, never what a command does.

- `core/graph.js` (pure) builds the **command graph** from what commands already
  declare: each def's `usage` lines (words, `<placeholders>`, `[optional]`,
  `a|b`) are expanded into linear forms and merged into one tree per command
  (`commandNode(def)`; nodes are words and typed placeholders, a free-text node
  can repeat); known values (ids, fields, foods) come from `complete(prev)`
  (`neighbors(node, prev)`).
- Reading the input walks that graph word by word (positions are nodes): a
  literal word beats a placeholder, a known id beats free text; mistyped words
  resolve by tier (prefix, one typo, letters in order) only where no
  placeholder could take them; an ambiguous word stops the path.
- `graphView` returns the path, a column per word (the level's choices and the
  one taken), what Enter runs, and `forward`: the **letter tree** of the words
  that can stand at the cursor (radix-compressed), each with its next slot and
  the usage lines still reachable, typos apart, and open slots with recent
  values from history.
- `ui/graph.js` draws a full-screen overlay (`#graph`, outside `#app`;
  `.graph-on` lifts the composer above it): the path, the backward pane (each
  passed word's siblings, a to z) and the forward pane (the letter tree,
  fisheye: size and opacity by depth from the cursor, far branches folded).
  Taps put a node into the prompt (`take`, `pick`).
- The input is **additive**: `ui/prompt.js` keeps ghost text, Tab, ↑↓,
  Backspace and Esc as in normal mode (completion sees through `graph `, and ↑↓
  keep the prefix); only Enter differs, running the text after `graph ` through
  the usual `run()` with resolved words put right. `run()` also unwraps
  `graph <command>` arriving another way. Nothing in commands or dispatch changes.
- Use counts per node path and the ranking (`graph :sort`) are device-local
  (`cc-device:graph`).

## Output

Commands describe results; `js/ui/transcript.js` draws them. The `out` methods:

- Recorded (stored in the visual history and replayed, so arguments must be
  plain JSON): `head, tone, line, ok, info, warn, err, dim, section, table, kv,
  fields, code, value, calendar, qr, barcode, diagram, swatch, jsonTree, dataTable`
  (the `RECORDED` list in `transcript.js`).
- Not recorded (may take functions; skipped on replay): `copyable(text)`,
  `transient(ms, text)` (output that expires, e.g. the clip), `diagramEditor(spec)`.
- Text is rich segments `[[text, tone, { run }?], …]`; a `{ run: 'command' }`
  makes it a link that runs that command. Tones are semantic (`strong`, `dim`,
  `faint`, `accent`, `id`, `num`, `ok`, `warn`, `err`, `url`, …) and themes colour them.
- Everything goes in through `textContent`/text nodes (`js/ui/dom.js`), never
  `innerHTML`. The two SVG producers (barcode, Mermaid) are parsed as XML or
  shown as images, never inserted as HTML.

## Data

`js/core/data.js` owns the in-memory state, `mutate(collection, fn)` (serialised,
writes through the store, feeds undo), id allocation (`allocId(prefix)`),
migrations (`SCHEMA`, `MIGRATIONS`) and repair of damaged documents.

| Collection | Holds | Synced | Undo | Id |
| --- | --- | --- | --- | --- |
| `meta` | schema, id counters, last export | yes (counters) | – | – |
| `aliases` | alias/engine entries `{ name, base, template?, escape }`, command aliases `{ name, command }`, default engine | yes | yes | name |
| `notes`, `tasks`, `events` | items | yes | yes | `n`, `t`, `e` |
| `snippets`, `later`, `foods`, `diagrams` | items | yes | yes | `s`, `l`, `f`, `d` |
| `timers`, `birthdays`, `lists`, `subs`, `journal`, `meals` | the personal collections, one table in `core/personal.js` (prefix, import checks) | yes | yes | `w`, `b`, `c`, `p`, `j`, `m` |
| `settings` | theme, widgets, zones, summary, name, bounce keys | yes (per key) | yes | – |
| `history` | ↑ command history (500) | no | – | – |
| `log` | the visual history: entries of replayable ops (300 / 800 KB) | yes | yes (clear marks) | entry id |
| `clip` | the shared clip, sealed (AES-GCM), 15 minutes | yes | no | – |

Stored as `cc:<collection>` in `localStorage`. Device-local values
(`store.getLocal/setLocal`, key `cc-device:<name>`, never exported or synced):
`sync` (settings), `sync-token`, `clip-key`, `clip`, `clip-seen`, `device`
(id and name), `undo` (last 30 steps), `logView`, `fontScale`,
`diagram-draft`, `graph` (graph mode's ranking and use counts), `timers-rung` (timers this device has already rung for). One more, `browser-hub:keybar`, is read directly by `main.js`.

Adding a collection touches about ten places; follow
[recipes.md](recipes.md#add-a-collection).

## Sync

`js/sync.js` (transport) + `js/core/merge.js` (pure three-way merge).

- One file, `<dir>/data.json` (default dir `browser-hub/`), in a private repo
  that may hold other projects' files too. A `data.json` that isn't the hub's
  is never read as data or overwritten. The fine-grained token is kept on the
  device only (see [security.md](security.md)).
- Each sync: GET the file, merge three-way against the last-synced copy (kept
  locally), write locally if changed, PUT if the repo's copy differs; a 409
  (another device pushed) starts over.
- Merge rules (header of `merge.js`): per item by id (aliases by name),
  settings per key, conflicts keep this device's version and are reported,
  delete-vs-edit keeps the item, ids created offline on two devices are
  renumbered on this side. The log merges by entry; the clip by newest
  (a wipe wins ties). Collections in the file that this version doesn't know
  (written by a newer page) are carried along untouched, so a page left open
  from before an update can't drop them.
- When: a few seconds after a change, on open/visibility, every 5 minutes while visible.

## Visual history

`js/core/log.js`. Every command's output is recorded as ops (see Output) and
stored as an entry `{ id, at, device, deviceName, input, ops }`; private and
ephemeral commands aren't. With sync, every device shows all devices' entries
merged by time; `session` filters by device, `clear` sets marks rather than
deleting (so undo works).

## Undo

`js/core/undo.js`: each command's changes as per-item patches. Undo refuses
when the same item has changed since (another tab, a sync) unless forced.
Steps are per device (`cc-device:undo`, last 30).

## Rendering in frames (Mermaid)

Mermaid needs inline styles, which the page's CSP forbids. `js/ui/mermaid.js`
creates a hidden same-origin iframe (`mermaid-frame.html`, its own CSP:
inline styles allowed, no connections), calls its `renderDiagram(code)`, and
shows the returned SVG as an `<img>` from a `blob:` URL. PNG export draws that
image on a canvas. Barcodes and QR codes need no frame: their PNGs are painted
directly from the same geometry as their SVG.

## Build and deploy

`.github/workflows/pages.yml`: the test job (unit tests in six time zones,
decoder tests, browser tests) gates the deploy job, which runs on `main` only.
`tools/build-site.mjs` copies the site and stamps every entry point and every
relative `.js` import with `?v=<commit>` (GitHub Pages can't set cache headers
and Safari keeps stale files). Vendored `.mjs` files aren't stamped; they live in
a versioned folder instead. The e2e tests run against this build.
