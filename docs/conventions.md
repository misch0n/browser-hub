# Conventions

What the owner has asked for, and how the code is written. These are settled;
follow them without asking. Where a rule came from the owner, it's marked ★.

## Product principles

- ★ **Feels like Claude's CLI.** One prompt; each command echoed, then a reply
  with a coloured bullet, a bold summary line, and a body hanging off a
  connector. Colour coding and hierarchy carry meaning. Functional first.
- ★ **Uniform, predictable grammar.** Everything you keep follows
  `<noun>`, `<noun> add`, `<noun> <id>`, `<noun> <id> edit [<field> [<value>]]`,
  `<noun> <id> rm`, `<noun> <id> <verb>` (see [architecture.md](architecture.md#the-shared-grammar-records)).
  Short names (`t`, `n`, `ev`, `snip`, `alias`) do exactly the same as the
  full ones, but must never be the *only* way in. Older word orders keep
  working once shipped.
- ★ **Hybrid CLI.** Output is interactive: ids link to their entry, list rows
  open their item, values can be tapped and edited in place. Every tap runs a
  real command, so the transcript and history show exactly what happened.
- ★ **Help:** `help` lists commands by category, one line each, with a ⚙
  built-in tag (⌕ engines, ↗ aliases). `help <command>` and a command run
  without enough input show the full usage. Tapping a command in help opens
  its full help. Help is ephemeral: not in the shared history, gone after
  the next command.
- ★ **Completion everywhere.** Any command whose next input is knowable
  completes it on Tab; Tab twice lists the choices temporarily (gone on
  input). On phones, the same letter tapped twice quickly acts as Tab where
  it can't be typing.
- ★ **Dates: accept anything, show in full.** Every prefix of a day or month
  name is accepted (`fr`, `fri`, `friday`; `oct`, `october`); output always
  says "Friday 16 October", never "Fri".
- ★ **Quotes are optional**; they exist to state intent (`n "rm the weeds"`).
- ★ **Synced data and visual history.** What you did on one device shows on
  the others, tagged by device; conflicts resolve by timestamp. Sessions can
  be filtered (`session show current|all|<device>`).
- ★ **Phones are first-class.** Responsive layout; the prompt sits on top of
  the keyboard; tapping outside the prompt dismisses the keyboard; no zoom on
  focus (16px inputs); a toggleable key bar; adjustable text size (`font`).
- ★ **Long pastes collapse** to `[Pasted text #1 +12 lines]`, as in Claude's CLI.
- ★ **Thorough tests** for every change (see [testing.md](testing.md)).
- Prefer offline. A feature that needs the network says what it sends where;
  one that a browser can't do properly says so plainly instead of guessing.

## Working rules

- ★ **Push to `main`.** No feature branches or pull requests unless asked.
- ★ **Security rules** in [security.md](security.md) are non-negotiable.
- When the owner asks for something a browser can't do well, build the honest
  version, explain the limit in the UI, and record it in [deferred.md](deferred.md).
- When asked for ideas, give a short ranked list and wait for a choice;
  record the answers (yes / defer / skip) in [todo.md](todo.md) or
  [deferred.md](deferred.md) so nobody asks twice.

## Writing (UI text and docs)

- Plain words, short sentences, British spelling (colour, fibre, organisation).
- Say what happened and what to do next: `Sync paused · GitHub refused the
  token`, then the command that fixes it, as a link.
- Name things the same way everywhere (`help`, palette, Tab lists, hints).
- Usage lines: `<placeholder>`, `[optional]`, `a|b` for alternatives.
- Docs describe current behaviour. History belongs in [changelog.md](changelog.md)
  and [decisions.md](decisions.md), not in feature descriptions.

## Code

- Vanilla ES modules, no framework, no build step, no runtime dependencies.
  A library is vendored (as published, versioned folder) only when writing it
  ourselves would be unreasonable (Mermaid).
- Layering: `lib/` and `core/` are pure and DOM-free; `commands/` talk only to
  `ctx`; only `ui/` and `main.js` touch the DOM. See [architecture.md](architecture.md).
- Every module starts with a header comment: what it is for, its main
  exports' shapes. Comments explain *why* and the non-obvious; keep them
  short and current.
- Match the surrounding style: 2-space indent, single quotes, semicolons,
  `const` by default, small functions, early returns, descriptive names.
  Lines up to about 160 characters are fine.
- Text into the DOM only via `textContent` / `h()` from `js/ui/dom.js`. No
  `innerHTML`, no `eval`/`Function`, no inline styles or scripts (CSP).
- Data from storage, imports, sync, the network or pastes is untrusted:
  validate shapes, cap sizes, and skip and report bad entries.
- Errors a user can cause are reported in the output (`out.err`) with what to
  do; they don't throw past the command.
- Numbers and limits get named constants near the top of their module.

## Commits

- One logical change per commit, tests and docs included.
- Subject: what changed for the user, in plain words
  (`Network tools: request, ping, dns, ip`). Body: what and why, briefly.
- Agents end the message with the attribution lines their environment
  requires. Never put model names or secrets in commits or code.
