# 002 · Command aliases, help listing, redirect delay

Status: **done** (6 Oct 2026)

## Goal (owner, 6 Oct 2026)

- "command aliases need to be listed with comma next to the command itself.
  some are listed on separate lines today. a command should know which are its
  aliases when an alias is for that command only."
- "we can introduce command alias x and scan alias x and verify if it refers to
  a single known command."
- "we need to be able to define aliases for commands on the page in addition to
  urls. they should support placeholders."
- "triggering a redirecting alias through the cli should wait for 1 second
  before redirecting. tapping escape should cancel the redirect."

## Approach

1. **Built-in short names know their command.** Defs get `aliasOf`
   (`n`→`notes`, `t`→`tasks`, `ev`→`events`, `snip`→`snippets`,
   `alias`→`aliases`). `help` shows one row per command: `notes, n` (each
   name tappable for its own help); the short names get no rows of their own.
2. **Command aliases** (the owner's own): an alias entry may hold a `command`
   instead of URLs: `alias groc tasks add {} #groceries`, then `groc milk` runs
   `tasks add milk #groceries`.
   - Told apart from URL aliases by its first word being a built-in command.
   - Placeholders as for URL templates: `{}` (or `%s`) for everything typed,
     `{1}`, `{2}` … for single words. With no placeholder, whatever is typed is
     appended: `alias tt tasks` makes `tt t3 done` run `tasks t3 done`.
   - Text is inserted as typed (no URL encoding).
   - The target must be a built-in command, not another alias, so there are no
     loops. The scan ("does it refer to a single known command?") happens on
     define, edit, import and in help: an alias whose command is no longer
     built in is listed as broken instead of next to a command.
   - Dispatch expands it to the built-in it names. The built-in's flags apply
     (private, no history). The transcript shows `→ <expanded command>` so
     history says what ran.
   - Help lists it next to its command: `tasks, t, groc`, marked as yours.
   - From the address bar (`?q=`) it is only put in the prompt, like any
     built-in (security rule: links can't change data).
   - Grammar: `aliases groc` shows the fields name and command,
     `aliases groc edit command tasks add {} #shop`, `aliases groc rm`. It is
     synced, undoable, imported and found by `find` like other aliases.
3. **Redirects wait a second.** Anything typed that opens another page (an
   alias, an engine search, the default search, `later l2 open`) says
   "opening <site> in 1 s · esc cancels" under the prompt, then goes. Esc (or
   the key bar's Esc, or running another command) cancels and the turn says
   "Cancelled". The address bar (`?q=`) and bounce links still go straight away.

## Steps

- [x] 1. `aliasOf` on built-ins; help rows `notes, n`; tests.
- [x] 2. Command aliases: model (`core/aliases.js`), dispatch, `aliases` grammar
      and fields, help/find/palette/completion/hint, importer; tests (unit + e2e).
- [x] 3. Redirect delay with Esc to cancel; e2e (proceeds after 1 s; Esc cancels).
- [x] 4. Docs: README, command reference, architecture, security (address-bar
      rule), decisions, changelog, todo.

## Log

- 6 Oct 2026: plan written; starting step 1.
- 6 Oct 2026: all steps done. The `→ <command>` line sits in the reply's body under its heading. Tests: unit (model, dispatch, fields, help, import), e2e (delay, Esc, command alias run, help row, address bar).
