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
- Last verified 9 October 2026: unit tests (120) in six time zones, decoder
  tests and 64 e2e checks pass.
- Graph mode (`graph <command>`) is an experiment the owner asked to try,
  refined to the owner's design note (D20); its ranking switch
  (`graph :sort freq|alpha`) is there to compare both orders. Its open
  questions (backward pane, ring, convergence) wait for the owner to try it:
  [exploration/graph-mode.md](exploration/graph-mode.md).
- Command reference: [commands.md](commands.md) (generated from the code).

## In progress

Nothing.

## Dev

Do in order. Each is safe to start without asking, unless its entry says
otherwise. The owner may reorder.

The owner's picks from the suggestion list (7 Oct 2026), in their order.
Each new command: completion, help with examples, `npm run docs`, README,
unit tests (six time zones where dates are involved), e2e when it draws or
interacts. Anything holding something you keep is a synced collection in the
shared grammar ([recipes.md](recipes.md#add-a-collection)).

1. **`hexdump` / `bin`: byte inspector** (owner: "hexdump/bin inspector").
   *What:* `hexdump <text>` (UTF-8; `utf16le`/`utf16be` option): offset, hex
   and printable columns, 16 bytes a row; `hexdump file` picks a local file
   (read on the device, never uploaded) and shows its first 4 KB, size and
   type from its magic number (PNG, JPEG, GIF, PDF, ZIP/Office, gzip, ELF,
   Mach-O, PE, SQLite, …), with "more" to page; `hexdump hex <48 65 6c…>`
   decodes bytes back to text; `bin <number|text>` shows binary (bytes grouped,
   with hex and decimal). *Done when:* unit tests for the dump layout,
   encodings and magic numbers; e2e for the file pick.
2. **`pw check`** (owner: "pw check why not").
   *What:* `pw check` asks for the password with hidden input (`askSecret`,
   never echoed, kept or synced; private and noHistory like `pw`) and
   estimates its strength on the device: length and character classes,
   minus patterns (EFF word-list words from `lib/wordlist.js`, sequences,
   repeats, dates, keyboard runs, common substitutions), as bits and a time
   to crack offline and online, with what weakens it. Says plainly that it's
   an estimate and that a reused or leaked password is weak whatever its score
   (no breach lookup: that would send data off the device).
3. **`sun` / `moon`** (owner: "sun/moon yes").
    *What:* `sun` today's dawn, sunrise, solar noon, sunset, dusk and day
    length (and the change since yesterday); `sun <date>`; `moon` phase,
    illumination, next new and full moon; computed (NOAA / Meeus formulas),
    no network. *Open (ask when starting):* where: a place set once
    (`config location <lat>,<lon>` or a city name from a small built-in list),
    or the browser's location on request. Default: `config location`, with
    Sofia offered.
4. **Timers and stopwatches** (owner, 7 Oct 2026; revives the 5 Oct
    deferral, D21).
    *What:* `timer 10m [name]` starts a timer, `stopwatch [name]` a stopwatch;
    `timer list` / `stopwatch list` list all (running and stopped).
    Each is an entry with its recorded start time (and duration for a
    timer); everything live is worked out from that, so it survives reloads
    and shows the same on every device (synced). They run until stopped:
    `timer tea stop`, `stopwatch run stop` (by name or id), `… rm`; a
    stopwatch can `lap`. A finished timer shows as done (overdue time
    counting) and alerts while the page is open (a line, a sound, the tab
    title); notifications when the page is closed belong to the iOS
    notifications research. A widget shows the running ones.
    *Done when:* unit tests with a fake clock (start, stop, lap, finished,
    reload), e2e for the live display; README and reference updated.
5. **Birthdays with age** (owner: "birthdays with age yes"). After recurring
    events (3). *What:* `birthdays add <name> <date>` (year optional), shown
    yearly in `agenda`, `cal`, `today` and the summary as "Ana turns 40"
    (no age without a year); `birthdays` lists them by next date with days to go.
6. **`lists`: reusable checklists** (owner: "lists yes").
    *What:* `lists add packing`, `lists packing add passport`, `lists packing`
    shows it with tappable checkboxes, `lists packing reset` unchecks all,
    items editable and removable in the shared grammar; synced.
7. **`subs`: subscriptions** (owner: "subs yes").
    *What:* `subs add <name> <price> <currency> every:month|year|<n>m
    next:<date>`; `subs` lists them with the monthly and yearly total per
    currency (no conversion: currency rates are deferred), renewals in
    `agenda` and `today`; the next date moves on by itself.
8. **`log`: a journal** (owner: "log yes").
    *What:* `log <text>` adds a dated entry, `log` shows the last days,
    `log yesterday` / `log <date>` / `log <month>`; entries searchable by
    `find`; synced. *Open (ask when starting):* an "on this day" line in
    `today`? Default: yes, when there is one.
9. **Calorie tracker** (owner: "calorie tracker yes").
    *What:* a daily food log on top of `cook calorie`'s table and your own
    foods: `eat 150 g chicken-breast` (household portions too) adds to today
    with kcal and macros; `eat` shows today's total against a target
    (`eat target 2000`), `eat yesterday`, `eat week` with a daily sparkline;
    entries editable and removable; synced. *Open (ask when starting):* the
    command name (`cal` is taken by the calendar). Default: `eat`.

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
