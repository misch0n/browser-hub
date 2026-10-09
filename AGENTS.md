# Working on browser-hub

Instructions for any agent (or person) working in this repository. Read this
file, then [docs/todo.md](docs/todo.md). That is usually all the context you
need before starting; the rest of `docs/` is for the area you touch.

## What this is

A command-line new-tab page in the style of Claude's CLI: one prompt, every
feature a command (notes, tasks, calendar, tools for developers, security,
networks, cooking, diagrams, …). Static files on GitHub Pages
(<https://misch0n.github.io/browser-hub/>), vanilla ES modules, no build step,
no runtime dependencies. Data in `localStorage`, optionally synced through a
private GitHub repo. One owner, who uses it on a Mac and an iPhone.

## Ground rules

1. **Push to `main`.** No branches or pull requests unless the owner asks.
2. **Never push red.** Run the tests (below) first; after pushing, check the
   GitHub Actions run for `misch0n/browser-hub` and fix a failure before
   anything else. A flaky test is a bug in the test: fix it, don't re-run it.
3. **Security rules are non-negotiable:** [docs/security.md](docs/security.md)
   (token on the device only; the sync repo is shared, stay in the project
   directory; the shared clip is one item, temporary and sealed; strict CSP;
   no `innerHTML`/`eval`; untrusted input validated). No secrets, personal
   data or model names in the repo.
4. **Follow the owner's conventions** in [docs/conventions.md](docs/conventions.md):
   uniform `<noun> <id> <verb>` grammar, hybrid CLI (tappable values run
   commands), full day/month names, completion everywhere, phones first-class,
   thorough tests.
5. **Ask the owner only for real decisions** (scope, product choices, anything
   in "Waiting on the owner"). Everything else has a default in these docs.
6. **Don't build what's deferred or only explored** ([docs/deferred.md](docs/deferred.md),
   [docs/exploration/](docs/exploration/README.md)) without the owner's go-ahead.

## Doing a task

1. Read [docs/todo.md](docs/todo.md): the State section, then take the first
   **Dev** item (or the one the owner named). Research and Confirmation tasks
   are only done when the owner asks for them. Move it to In progress.
2. Read only what the task needs: [docs/architecture.md](docs/architecture.md)
   for where things live, the matching recipe in [docs/recipes.md](docs/recipes.md),
   and the header comments of the modules you touch.
3. Build it with its tests: unit tests always, e2e when it draws, interacts or
   needs real browser APIs.
4. Update the docs as part of the same change (this is part of "done"):
   - `npm run docs` if commands changed (a test fails otherwise);
   - the user README's section for the feature;
   - [docs/changelog.md](docs/changelog.md): one line;
   - [docs/todo.md](docs/todo.md): remove the item, update State;
   - architecture / security / decisions / deferred when they're affected.
5. Commit (one logical change, plain-words subject), push to `main`, check CI.
6. Report to the owner: what changed for them, what was verified, anything
   left open. Short.

## Commands

```sh
npm run setup          # test-only packages (Playwright, jsQR, ZXing); automatic in cloud sessions
npm test               # unit tests, ~3 s; one area: node --test tests/unit/<area>.test.js; filter: --test-name-pattern="<name>"
npm run test:all       # what CI runs: six time zones, decoders, e2e in Chromium (~4 min)
npm run docs           # regenerate docs/commands.md and the README command table
python3 -m http.server 8000   # serve the page locally
```

Details, harness helpers and gotchas: [docs/testing.md](docs/testing.md).

## Finding your way

```
index.html            the page and its CSP          js/main.js       wiring and ctx
js/commands/          one file per command area      js/commands/index.js   the command contract (header comment)
js/core/              data, store, sync merge, records grammar, undo, log, search, dates
js/lib/               pure helpers per feature        js/ui/           DOM: transcript, prompt, widgets
tests/                unit/<area>.test.js, helpers.mjs, e2e.cjs, decoders     tools/   build-site, docs-commands, nutrition
docs/                 everything about building it (index: docs/README.md)
```

Save context: every module starts with a header comment saying what it does;
read those before whole files. Search, don't read: `tests/e2e.cjs`, `js/lib/nutrition-data.js` (generated), `js/lib/wordlist.js`,
`js/vendor/` (Mermaid, never edit). Unit tests are one file per area in
`tests/unit/`; open only the area you touch.

## Environment notes

- Cloud sessions (claude.ai/code) run `.claude/hooks/session-start.sh` at start,
  which installs the test packages (`npm run setup`). Chromium is pre-installed for Playwright;
  WebKit can't be downloaded there. USDA's servers are unreachable (the
  nutrition data came from an npm copy; see decisions D9).
- GitHub access from agents goes through the GitHub tools of the environment
  (no `gh` CLI in cloud sessions). CI logs are readable that way.
