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
  and 57 e2e checks pass; CI green on `e87922e` (which also fixed the flaky
  e2e sync check that failed `15ed8fd`).
- Command reference: [commands.md](commands.md) (generated from the code).

## In progress

Nothing.

## Ready

Do in order. Each is safe to start without asking, unless its entry says
otherwise. The owner may reorder.

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
4. **iOS notifications** (approved 6 Oct 2026). Follow
   [plan 001](plans/001-ios-notifications.md); its step 0 asks the owner four
   questions (sender, what notifies, quiet hours, icon) with proposed defaults,
   so **ask before building**. Step 1 (icons, favicon, manifest) also removes
   the favicon 404 every page load causes.

## Waiting on the owner

Decisions only the owner can make. Don't start these; mention them if relevant.

- **Remaining manual checks in Safari and on the iPhone** (first run 6 Oct
  2026, nothing failed): Mac downloads (M5), Safari engine features (M6–M8),
  storage after a week (M10, check after 14 Oct), and on the iPhone the key bar
  and text size (P3), long paste (P5), clip (P6), QR scan (P7) and Mermaid
  (P8). List and results in
  [testing.md](testing.md#by-hand-in-safari-and-on-the-iphone). Only the
  owner's devices can run them.

Decided recently (no longer waiting): no separate domain for now
([D15](decisions.md)); iOS notifications go ahead ([D16](decisions.md)).

## Ideas

Not requested; propose to the owner before building. Deferred items have
their own list in [deferred.md](deferred.md); don't re-propose those without
new information.

- `events export` to `.ics`, and `tasks t3 share` / `notes n3 share` via the
  share sheet (the cheap end of [apple-sync](exploration/apple-sync.md)).
- Recurring events (`every:` like tasks).
- A WebSocket reachability check in `request` (`ws://`, `wss://`).
- `request`: show the redirect chain when the server allows it.
