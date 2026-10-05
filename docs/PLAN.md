# New-Tab Control Center — v1 Spec

Oct 5, 2026 · @Mihail

## Overview

v1 is a single static page, set as Safari's homepage and new-tab page, that works as a command line: every feature is a command typed at one prompt. It runs with no server and no extension; a server-backed store may be added later, so the storage layer must be swappable.

**Hard constraints**

- Static files only, deployed to GitHub Pages.
- No background process, no browser extension, no build-time secrets.
- No network requests from the page except navigations (redirects).
- All state in `localStorage`, behind a store interface (see Storage).
- Target browser: Safari on macOS. Other browsers are nice-to-have, not tested.

**Feature set**

- Notes, tasks, calendar, small tools.
- URL aliases and search engines, in one shared table.
- A default search engine for anything that isn't a known command.

## UI

The page is a TUI in the style of Claude's CLI: one prompt line at the bottom, command output scrolling above it, monospace throughout.

**Layout**

- Prompt line pinned to the bottom, with a prompt glyph and the input.
- Output area above it, newest at the bottom, scrollable.
- Each executed command is echoed into the output, followed by its result.
- Plain monospace, light and dark following the system setting. No icons or images required.

**Keys**

- Enter: execute.
- Tab: accept completion (see Completion).
- ↑ / ↓: walk command history, persisted in storage.
- `/` on an empty prompt: open a fuzzy command palette.
- Esc: clear the input or close the palette.

**Focus**

- Opening the page focuses the prompt line: `autofocus` on the input plus an explicit `focus()` on load.
- On `pageshow` (including a restore from Safari's back-forward cache), refocus the prompt and clear any stale input.
- Clicking anywhere in the output that isn't a link or selectable text returns focus to the prompt.
- Known limit: if Safari gives focus to the address bar on ⌘T, the page cannot take it back. This must be tested in real Safari before other work (see Acceptance tests).

## Dispatch

Every input resolves to exactly one of three outcomes: run a built-in, redirect through an alias or engine, or search with the default engine.

**Parsing**

- Trim the input. Empty input does nothing.
- The hint under the prompt states the outcome before Enter: the command, `open <url>`, or `search <site> for "<phrase>"`, with `(default)` when nothing matched and the default engine takes the whole input.
- Split on the first run of whitespace into `head` and `rest`. `rest` may be empty and is kept whole, including internal spaces.
- `head` matching is case-insensitive.

**Resolution order**

1. `head` is a built-in command → run it in the page and print its output.
2. `head` is an alias or engine → build the target URL and redirect.
3. Otherwise → send the whole trimmed input to the default engine and redirect.

**Redirects**

- Use `location.assign(url)`. The control center stays in Back history.
- No rewriting of the target URL beyond the template substitution and escaping defined in Aliases and engines.
- Before navigating, append the command to history so ↑ recalls it after Back.

**Fallback**

- Unknown `head` always falls through to search, including typos such as `gihtub`.
- No "did you mean" prompt in v1; the fall-through is the behavior.

**Examples**

| Input | Outcome |
| --- | --- |
| `t buy flour` | Built-in: adds a task |
| `gh` | Alias, bare: opens the alias base URL |
| `gh org/repo` | Alias with argument: fills the template |
| `g how to proof sourdough` | Engine: searches the whole `rest` |
| `vitosha weather` | Unknown `head`: default engine with the full input |

## Aliases and engines

Aliases and search engines are one table: an engine is an alias whose template is a search URL. Every name in it is unique, and no name may equal a built-in command.

**Entry fields**

| Field | Type | Notes |
| --- | --- | --- |
| `name` | string | Lowercase; letters, digits, `.`, `_`, `-`; no whitespace |
| `base` | URL | Opened when the alias is used with no argument |
| `template` | URL with `{}` | Optional; `{}` is replaced by `rest` |
| `escape` | `query` or `path` | How `rest` is encoded into `{}`; default `query` |

**Behavior**

- Bare use (`gh`) opens `base`.
- Use with an argument (`gh org/repo`) fills `template`. An alias with no `template` ignores the argument and opens `base`, printing a one-line note.
- `query` escaping encodes the whole `rest` with `encodeURIComponent`, so `a/b c` becomes `a%2Fb%20c`.
- `path` escaping encodes each `/`-separated segment but keeps the slashes, so `org/repo` stays `org/repo`.
- Exactly one entry is the default engine; it must have a `template`. Unknown input is sent to it.
- The app ships a few starter engines (for example Google and DuckDuckGo) in code. Nothing personal is shipped.

**Commands**

- `alias <name> <base> [template] [--path]`: create.
- `alias <name> <template>`: create an engine from its template alone; `base` is the template's site root (`https://host/`). `%s` is accepted as a placeholder and stored as `{}`.
- `alias set <name> … --force`: overwrite an existing alias.
- `alias rm <name>`, `alias ls [filter]`, `alias show <name>`.
- `engine default <name>`: set the default engine; `engine` alone prints the current one.

**Conflict detection**

- **On define:** reject a name that equals a built-in, or an existing alias unless `--force` is given. Print which one it collides with.
- **On import:** report every colliding entry and skip it. Never overwrite silently.
- **On load:** re-check stored aliases against the current built-in list, since a later version may add a built-in. The built-in wins, the alias stays stored but inactive, and the page prints a one-line warning naming it.
- **On default:** refuse `engine default` for a name with no `template`, or one that is shadowed by a built-in.

## Completion

Completion is offered while typing for anything known, shown as inline ghost text and accepted with Tab. Unknown words get no completion and go to search on Enter.

**First token**

- Candidates: built-in commands, then aliases and engines.
- Ghost text shows the remainder of the best candidate after the cursor, dimmed.
- One candidate: Tab completes it fully and adds a trailing space.
- Several candidates: the first Tab completes to their longest common prefix; a second Tab lists them in the output.
- Prefix matching only, case-insensitive. Fuzzy matching is for the `/` palette only.

**Arguments**

- `t done`, `t rm`: task ids, with the task text shown in the candidate list.
- `n rm`, `n edit`: note ids, with the first line of the note.
- `alias rm`, `alias show`, `alias set`, `engine default`: alias names.
- Subcommands of any built-in that has them.
- No completion for free text (task text, note bodies, search queries).

**Rules**

- Tab always calls `preventDefault`, so focus never leaves the prompt.
- Ghost text never changes what Enter executes: Enter runs exactly what was typed.
- Ranking within candidates: built-ins first, then by use count from history, then alphabetical.

## Built-in commands

Built-ins are a fixed list compiled into the page; it is the list conflict detection checks against. Command names below are proposals and can be renamed before implementation.

**Shared conventions**

- Ids are short, per collection, never reused after deletion (for example `t3`, `n12`, `e7`).
- One date parser for every command: ISO dates, `today`, `tomorrow`, weekday names (next occurrence), and offsets such as `+3d`.
- Times are 24-hour `HH:MM` in the browser's local time zone.
- Every write command prints what it changed, with the new id.

**Notes**

| Command | Does |
| --- | --- |
| `n <text>` | Capture a note |
| `notes [filter]` | List notes, newest first, optional text filter |
| `n edit <id>` | Load the note into the prompt for editing; Enter saves |
| `n rm <id>` | Delete a note |

**Tasks**

| Command | Does |
| --- | --- |
| `t <text> [due:<date>] [#tag]` | Add a task |
| `tasks [#tag] [all]` | List open tasks, overdue first then by due date; `all` includes done |
| `t done <id>` | Complete a task |
| `t rm <id>` | Delete a task |

**Calendar**

| Command | Does |
| --- | --- |
| `cal [YYYY-MM]` | Month grid, days with events marked |
| `agenda [n]` | Events and due tasks for the next n days, default 7 |
| `ev <date> [HH:MM] <title>` | Add an event |
| `ev rm <id>` | Delete an event |
| `ics import` | Pick a local `.ics` file and import its events |

The calendar is local only. Reminders appear only as page output when the page is open; there is no background notification.

**Tools**

| Command | Does |
| --- | --- |
| `calc <expr>` | Arithmetic, evaluated by a small parser, never `eval` |
| `tz [time]` | Current or given time across configured zones, with working-hours overlap |
| `tz add <IANA zone>` / `tz rm <zone>` | Manage zones |
| `epoch [value]` | Unix time now, or convert to and from a date |
| `uuid` | Generate a v4 UUID |
| `b64 enc <text>` / `b64 dec <text>` | Base64 encode or decode |
| `json <text>` | Validate and pretty-print |
| `units <value> <from> to <to>` | Common unit conversions |

**Meta**

| Command | Does |
| --- | --- |
| `help [command]` | List commands, or detail for one |
| `clear` | Clear the output area |
| `history [n]` | Show recent commands |
| `export` | Download all state as one JSON file |
| `import` | Load a JSON export, reporting conflicts |
| `/` | Fuzzy command palette |

## Storage

v1 stores everything in `localStorage`, behind a small store interface so a server-backed store can replace it later without touching any command.

**Store interface**

- `get(collection)`, `put(collection, value)`, `exportAll()`, `importAll(data)`.
- Promise-returning even though `localStorage` is synchronous, so a later network store fits the same signatures.
- Commands talk only to the store, never to `localStorage` directly.

**Layout**

| Key | Holds |
| --- | --- |
| `cc:meta` | Schema version, id counters, last export time |
| `cc:aliases` | Alias and engine table, default engine name |
| `cc:notes` | Notes |
| `cc:tasks` | Tasks |
| `cc:events` | Calendar events |
| `cc:settings` | Time zones and other preferences |
| `cc:history` | Command history, capped (for example 500 entries) |

- One key per collection, each a JSON document. A write replaces the whole key.
- `cc:meta` carries a schema version; on load, migrate older data forward before anything else runs.
- Writes catch `QuotaExceededError` and print an error rather than failing silently.

**Multiple tabs**

- Several new tabs may be open at once. Listen for the `storage` event, which fires in other tabs when a key changes, and reload that collection.
- Also reload all collections on `pageshow` and `visibilitychange` to visible.
- Conflict model: last write wins per collection. Acceptable for a single user; revisit with a server.

**Export and import**

- `export` downloads one JSON file with the schema version and every collection.
- `import` reads such a file, migrates it if older, and merges: notes, tasks and events are added with new ids; aliases follow the conflict rules.
- Export is the only backup in v1.

**Eviction risk**

- Safari can delete script-written storage for a site after about seven days of browser use without interaction with that site. Typing into the page should count as interaction, but this is unverified.
- Mitigation: if the last export is older than a set number of days, print a one-line reminder at the top of the output on load.

## Deployment and security

The page is deployed to GitHub Pages; the code is public and the data stays in the browser, so the main risks are origin sharing and the page's own handling of stored text and URLs.

**Origin**

- Every project site under `<user>.github.io` shares one origin, and so one `localStorage`. Any other Pages project on that account can read the notes.
- Use a custom domain, or a dedicated GitHub account or organization, so the control center has an origin of its own. Decision needed before first deploy (see Open questions).

**Repository**

- Public code, no personal data committed: no default notes, tasks, events or personal aliases. Starter engines only.
- No secrets or tokens anywhere in the repo.

**Page hardening**

- Ship HTML, JS and CSS as separate static files so a strict Content Security Policy can be set through a `<meta>` tag (GitHub Pages cannot set headers). Suggested policy: `default-src 'self'; connect-src 'none'; object-src 'none'; base-uri 'none'`. `connect-src 'none'` enforces the no-network rule.
- Render all stored text with `textContent`, never `innerHTML`. Imported files are untrusted input.
- Alias `base` and `template` must use `http:` or `https:`. Reject `javascript:`, `data:` and anything else on define and on import, since `location.assign` with a `javascript:` URL would run code with access to all stored data.
- `calc` uses its own parser, never `eval` or `Function`.

## Scope boundary, open questions and tests

**Out of scope for v1**

- Routing from Safari's address bar (needs an extension or a local server).
- Background reminders and notifications.
- Calendar sync with Google, iCloud or Reminders.
- History indexing, page archiving, feeds, watchers, anything server-side.
- Storage other than `localStorage`.

**Open questions**

- [ ] Custom domain or dedicated GitHub account for an isolated origin?
- [ ] Final command names, especially the one-letter ones (`n`, `t`)?
- [ ] Which starter engines ship, and which is the default?
- [ ] Days before the export reminder appears?

**Acceptance tests (real Safari on macOS)**

Run the first two before building anything else; they decide whether the page approach works at all.

- [ ] ⌘T with the page as new-tab page: typing goes into the prompt without a click.
- [ ] Typing into the page resets Safari's storage eviction timer (check after 7+ days, or confirm from WebKit documentation).
- [ ] Page load and Back from a redirect both leave the prompt focused and empty.
- [ ] `gh org/repo` with `--path` escaping opens `…/org/repo`, not `…/org%2Frepo`.
- [ ] A multi-word unknown input searches the full text with the default engine.
- [ ] Defining an alias named like a built-in is rejected with the collision named.
- [ ] Importing a file with a colliding alias skips it and reports it.
- [ ] An alias with a `javascript:` URL is rejected on define and on import.
- [ ] A task added in one tab appears in a second open tab without reload.
- [ ] Tab completes a unique prefix, a common prefix, then lists candidates; focus never leaves the prompt.
- [ ] Export, clear storage, import: all data comes back.
