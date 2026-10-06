# Todo

The work queue. **"The next task" is the first item under Ready.** Take it
unless the owner names another.

How to use this file:

- Starting: move the item to **In progress** with the date. If it needs more
  than one commit or sitting, write a [plan](plans/README.md) first and link it.
- Finishing: delete the item here, add a line to [changelog.md](changelog.md),
  update **State** below.
- Stopping partway: leave it in progress with a note of exactly where you
  stopped and what's next (or update its plan's log).
- New work from the owner goes into Ready, in the order they want it.
  Ideas of your own go under Ideas (never straight into Ready).

## State

- Live: <https://misch0n.github.io/browser-hub/> (deployed from `main` by CI).
- Last verified 6 October 2026: unit tests in six time zones, decoder tests
  and 57 e2e checks pass locally. CI was green on `224fa36` (Mermaid). The
  next commit, `15ed8fd`, failed on a timing race in the e2e sync check,
  fixed alongside this documentation.
- Command reference: [commands.md](commands.md) (generated from the code).

## In progress

Nothing.

## Ready

Do in order; each is safe to do without asking.

1. **Run the e2e suite in WebKit on CI as well as Chromium.**
   *Why:* the target browser is Safari; only Chromium is tested today.
   *Done when:* the workflow runs `tests/e2e.cjs` in both (a `BROWSER=webkit`
   switch in the harness, `playwright install --with-deps webkit` in CI), both
   green. A check that can't pass in WebKit for a real platform reason gets a
   documented browser-specific expectation, never a silent skip.
   *Note:* the cloud environment can't download WebKit, so iterate through CI runs.
2. **Split `tests/unit.test.js` (3,300+ lines) by area.**
   *Why:* agents load less context to find and add tests.
   *Done when:* `tests/unit/<area>.test.js` files share a `tests/helpers.mjs`
   (`makeApp`, `recorder`, `fakeStorage`, `fakeNet`, `MON`); the same tests
   pass (same count); `run-tz.mjs`, npm scripts, CI and [testing.md](testing.md) updated.
3. **CI calls the npm scripts** (`npm run setup`, `test:tz`, `test:decoders`,
   `test:e2e`) so commands live in one place. *Done when:* the workflow uses
   them and stays green.
4. **A favicon** (an SVG `›` prompt glyph in the accent colour). Removes the
   404 every page load causes, and is the first step if Home Screen
   install is ever approved. *Done when:* linked in `index.html`, stamped by
   the build, served by the e2e server.

## Waiting on the owner

Decisions only the owner can make. Don't start these; mention them if relevant.

- **Isolated origin** (custom domain or dedicated account): other `github.io`
  projects share the hub's storage, including the sync token.
  Owner: "not yet". See [security.md](security.md#origin-open-question).
- **iOS notifications**: parked; findings and options in
  [exploration/ios-notifications.md](exploration/ios-notifications.md).
- **Manual checks in real Safari and on an iPhone**: the list in
  [testing.md](testing.md#by-hand-in-real-safari-not-automatable-here) has
  never been confirmed. Only the owner's devices can run them.

## Ideas

Not requested; propose to the owner before building. Deferred items have
their own list in [deferred.md](deferred.md); don't re-propose those without
new information.

- `events export` to `.ics`, and `tasks t3 share` / `notes n3 share` via the
  share sheet (the cheap end of [apple-sync](exploration/apple-sync.md)).
- Recurring events (`every:` like tasks).
- A WebSocket reachability check in `request` (`ws://`, `wss://`).
- `request`: show the redirect chain when the server allows it.
