# Todo

The work queue, in three kinds of task:

- **Dev**: building or changing code. **"The next task" (or "the next
  implementation") is the first Dev item.** Take it unless the owner names another.
- **Research**: finding out and proposing; ends with findings and questions
  for the owner, never with built features (see [exploration/](exploration/README.md)).
  Only when the owner asks for research.
- **Confirmation**: verifying that what's built works (CI coverage, checks on
  the owner's devices). Never picked as the next implementation; only when the
  owner asks for it.

How to use this file:

- Starting: move the item to **In progress** with the date. If it needs more
  than one commit or sitting, write a [plan](plans/README.md) first and link it.
- Finishing: delete the item here, add a line to [changelog.md](changelog.md),
  update **State** below.
- Stopping partway: leave it in progress with a note of exactly where you
  stopped and what's next (or update its plan's log).
- New work from the owner goes under its kind, in the order they want it.
  Ideas of your own go under Ideas (never straight into a task list).

## State

- Live: <https://misch0n.github.io/browser-hub/> (deployed from `main` by CI).
- Last verified 7 October 2026: unit tests (98) in six time zones, decoder
  tests and 59 e2e checks pass.
- Graph mode (`graph <command>`) is an experiment the owner asked to try; its
  ranking switch (`graph :sort freq|alpha`) is there to compare both orders.
- Command reference: [commands.md](commands.md) (generated from the code).

## In progress

Nothing.

## Dev

Do in order. Each is safe to start without asking, unless its entry says
otherwise. The owner may reorder.

1. **Split `tests/unit.test.js` (3,300+ lines) by area.**
   *Why:* agents load less context to find and add tests.
   *Done when:* `tests/unit/<area>.test.js` files share a `tests/helpers.mjs`
   (`makeApp`, `recorder`, `fakeStorage`, `fakeNet`, `MON`); the same tests
   pass (same count); `run-tz.mjs`, npm scripts, CI and [testing.md](testing.md) updated.
2. **CI calls the npm scripts** (`npm run setup`, `test:tz`, `test:decoders`,
   `test:e2e`) so commands live in one place. *Done when:* the workflow uses
   them and stays green.
3. **Recurring events** (owner: "recurring events yes", 6 Oct 2026).
   *What:* `events add fri 19:00 book club every:week` and `ev …`, with the same
   rules as tasks (`day`, `weekday`, `week`, `2w`, `month`, `year`, `mon,thu`;
   `js/core/repeat.js`), and an editable `repeat` field
   (`events e2 edit repeat none` ends it). An event repeats from its date onward.
   *Done when:* `events`, `agenda`, `cal` (the grid's marks and the
   calendar/agenda widgets), `today` and the pinned summary all show
   occurrences on the right days, with ↻ and the rule; editing or removing
   acts on the whole series (say so in the output); import, sync and undo carry
   the field; unit tests in six time zones, an e2e check of `cal` and `agenda`;
   README and command reference updated.
   *Open (ask when starting):* is "skip one occurrence" or an end date needed now?
   Default: no, whole series only.
4. **WebSocket check in `request`** (owner: "web socket - yes", 6 Oct 2026).
   *What:* `request wss://host/path` (and `ws://` to localhost) opens a
   connection, reports whether the handshake was accepted, its time, and the
   close code/reason, then closes it; `timeout` works as for HTTP. Browsers
   expose no status or headers for a refused handshake, so say so (as `request`
   does for CORS). Mixed content: `ws://` only to localhost from the https page.
   *Check first:* whether the CSP's `https:` source also allows `wss:` in Safari
   and Chromium; if not, add `wss:` to `connect-src` (security.md, decision D10, and the e2e CSP check).
   *Done when:* `lib/net.js` has a testable `probeSocket` (WebSocket injected
   like `fetch`), unit tests cover accepted / refused / timeout / mixed content,
   an e2e check runs against a local WebSocket server started by the harness,
   README and command reference updated, and the "WebSocket" line in
   [deferred.md](deferred.md) updated.

## Research

Only when the owner asks; ends with findings in [exploration/](exploration/README.md)
and questions for the owner.

- **iOS notifications** (owner: "research task", 6 Oct 2026). Draft plan:
  [plan 001](plans/001-ios-notifications.md); findings so far:
  [exploration/ios-notifications.md](exploration/ios-notifications.md). To
  settle: the sender (GitHub Action vs Cloudflare Worker: timing, Actions
  minutes, setup), what should notify, quiet hours, the icon. Output: a
  recommendation and the owner's answers, which turn the plan into Dev tasks.

## Confirmation

Verifying what's built. Not a next implementation; only when the owner asks.

- **Browser tests in WebKit on CI** (agent): run `tests/e2e.cjs` in WebKit as
  well as Chromium (a `BROWSER=webkit` switch in the harness, `playwright
  install --with-deps webkit` in CI). A check that can't pass in WebKit for a
  real platform reason gets a documented browser-specific expectation, never a
  silent skip. The cloud environment can't download WebKit, so iterate through
  CI runs. Automates most of M6–M8 below.
- **Manual checks in Safari and on the iPhone** (owner; first run 6 Oct 2026,
  nothing failed). Still to run: Mac downloads (M5), Safari engine features
  (M6–M8), storage after a week (M10, check after 14 Oct), and on the iPhone
  the key bar and text size (P3), long paste (P5), clip (P6), QR scan (P7) and
  Mermaid (P8). List and results in
  [testing.md](testing.md#by-hand-in-safari-and-on-the-iphone).

Decided recently: no separate domain for now ([D15](decisions.md)).

## Ideas

Not requested; propose to the owner before building. Deferred items have
their own list in [deferred.md](deferred.md); don't re-propose those without
new information.

None open.
