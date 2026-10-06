# Testing

Every change ships with tests, and everything below passes before a push to
`main`. CI runs the same and won't deploy otherwise.

## Setup (once per machine or cloud session)

```sh
npm run setup      # Playwright 1.56.1, jsQR 1.4.0, @zxing/library 0.21.3 (test-only, not saved)
```

- **Cloud sessions** (claude.ai/code): the SessionStart hook
  (`.claude/hooks/session-start.sh`, registered in `.claude/settings.json`)
  runs `npm run setup` for you, and skips it when the packages are already
  there. Chromium is pre-installed
  (`PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers`); don't run `playwright install`.
  A global Playwright also exists (`NODE_PATH=$(npm root -g)`), but `npm run
  setup` is what makes the decoders available.
- **A Mac or other machine:** also run `npx playwright install chromium` once.

## Running

| Command | What | Time |
| --- | --- | --- |
| `npm test` | unit tests (Node's runner): libs, core, every command through a fake page | ~3 s |
| `npm run test:tz` | the unit tests in six time zones (UTC, Sofia, Los Angeles, Tokyo, Kiritimati +14, Pago Pago −11) | ~20 s |
| `npm run test:decoders` | QR codes read back by jsQR, barcodes by ZXing, X.509 against OpenSSL-made fixtures | ~5 s |
| `npm run test:e2e` | the deployable build in headless Chromium: 58 checks | ~3 min |
| `npm run test:all` | all of the above, as CI runs it | ~4 min |
| `node tools/docs-commands.mjs` | is the command reference current? (`npm run docs` rewrites it) | instant |

Run one unit test: `node --test --test-name-pattern="diagrams" tests/unit.test.js`.
The e2e suite has no filter; to debug one check, copy its body into a scratch
script (see "e2e harness" for the setup it needs) rather than running all 58.

## Unit tests (`tests/unit.test.js`)

Grouped by `// ---- section ----` comments; search, don't read the whole file.

- `makeApp(storage?)` builds the real data layer and command registry over a
  fake `localStorage`, with the clock fixed at `MON` (a Monday). It returns
  `{ run, data, store, storage, ctx, commands, setNow }`.
- `await app.run('tasks add x')` dispatches like the page and returns the
  output as lines, drawn by `recorder()`:
  `'# head'`, `'## section'`, `'ok: …'`, `'warn: …'`, `'err: …'`, `'dim: …'`,
  table rows `'a | b'`, key-values `'key: value'`, editable fields
  `'key: value  [command = current]'`, `'= value'`, code lines as they are,
  and tags for drawings (`QR`, `BARCODE`, `DIAGRAM`, `EDITOR`, `JSONTREE`, `DATATABLE`, `SWATCH`, `CAL`).
  The array also has `.tone` (the head's outcome), `.copied` (what the copy
  button would copy) and `.editor` (the last `diagramEditor` spec).
- Stand-ins on `app.ctx`: `askSecret` (answers), `fetch` (see `fakeNet` in the
  network tests), `env` (browser globals for `ua`/`device`), `pageURL`,
  `nextFile` (for `pickFile`), `downloaded` (what `download` got), `sync`.
- Sync tests use `tests/fake-github.mjs`, an in-memory GitHub API, and run
  two `makeApp()` "devices" against it.
- A new `out` method must be added to `recorder()`, or command tests can't see it.
- Dates: never depend on the machine's time zone; the six-zone run catches it.

## Decoder tests

Generated codes are checked by independent implementations, not by our own
reader: `tests/qr.test.mjs` (jsQR; version 23 at level L is skipped because of
a known jsQR bug), `tests/barcode.test.mjs` (ZXing), `tests/x509.test.mjs`
(expected values taken from OpenSSL; `tests/fixtures/x509/gen.sh` remakes the fixtures).

## e2e harness (`tests/e2e.cjs`)

- Builds the site with `tools/build-site.mjs` into a temp dir and serves it
  on `127.0.0.1` (the page is `http:` there, so mixed-content rules differ
  from production; `net.js` takes the page's protocol into account).
- Every request leaving the origin is intercepted (`routeAll`): GitHub goes
  to the fake API; DoH, ipify and an echo host are faked; anything else is
  answered with a dummy page and recorded in `external` (navigation checks
  assert on it). The tests never touch the real network.
- Playwright's `route.fulfill` responses skip the browser's CORS check. To
  simulate a server without CORS headers, abort the request that carries an
  `Origin` header (the cors attempt) and fulfil the no-cors one.
- Helpers: `check(name, fn)`, `send(cmd)`, `type(text)`, `lastTurn()`,
  `lastText()`, `lastTone()`; a paste is simulated by dispatching a
  `ClipboardEvent` (see the CSV check).
- Downloads: `page.waitForEvent('download')`. PNG pixels are decoded in a
  separate blank page (`createImageBitmap` + `OffscreenCanvas`), away from the
  hub's CSP and state.
- The last check fails on any console error. Expected ones (GitHub 401/404 in
  the sync test, the refused CORS attempt) are filtered by URL in the `console`
  handler; add to that filter only for errors the test causes on purpose.
- Checks share one page and run in order; later checks may rely on state
  (theme, data) from earlier ones. Leave the page as you found it when you can.

## CI (`.github/workflows/pages.yml`)

Ubuntu, Node 22: unit tests in six zones → `npm install` of Playwright, jsQR
and ZXing → `playwright install --with-deps chromium` → decoder tests → e2e.
The deploy job needs the test job and runs on `main` only. Check the run after
pushing (GitHub Actions for `misch0n/browser-hub`); a red run on `main` is
fixed before anything else.

## By hand, in Safari and on the iPhone

The automated tests run in Chromium, partly emulating a phone. They can't
cover Safari's own engine (WebKit), its address bar and storage policies, a
real iPhone keyboard, or the real GitHub API. These checks can only run on
the owner's devices. Record the result and the date in the last column;
anything that fails becomes a todo item. First run: 6 October 2026 (no
failures; rows without a result haven't been tried yet).

Part of this list (engine features: crypto, compression, canvas, layout)
will also be covered by running the e2e suite in WebKit on CI (a confirmation task in [todo.md](todo.md#confirmation)).
The rest stays manual.

### Mac, Safari

| # | Check | How | Expect | Result |
| --- | --- | --- | --- | --- |
| M1 | New tab focus | Safari Settings → General: Homepage = the hub, New windows/tabs open with Homepage. Press ⌘T and type at once | Typing goes into the prompt without a click. The known risk is that Safari keeps focus in the address bar, which the page can't take back | ✓ 6 Oct 2026 |
| M2 | Back from a redirect | Run `g weather`, then press Back | The prompt is focused and empty; ↑ recalls `g weather` | ✓ 6 Oct 2026 |
| M3 | Fresh files after a deploy | After a push goes live, open a new tab (no hard reload) | The new version, with no mix of old styles and new page | ✓ 6 Oct 2026 |
| M4 | Mac keys | Ctrl+A/E/W/U/K/Y, Option+B/F, Ctrl+R, Tab, → in the prompt; `keys` | Each edits as listed, labelled ⌃ and ⌥; Option+B doesn't type "∫" | ✓ 6 Oct 2026 |
| M5 | Copy and downloads | A copy button; `export`; the SVG/PNG buttons on `qr`, `barcode` and a `mermaid` drawing | Clipboard holds the text; files land in Downloads and open correctly | copy ✓ 6 Oct 2026; downloads not yet |
| M6 | Web Crypto in WebKit | `crypt keygen ed25519`, `crypt encrypt hi` then decrypt, `jwt sign HS256 {"a":1}`, `hmac sha256 k m` | All succeed (Ed25519 needs Safari 17 or later) | not yet |
| M7 | Mermaid | `mermaid`, edit the code, then the PNG button | Drawing updates as you type; the PNG isn't blank (Safari is strictest about drawing SVG into a canvas) | not yet |
| M8 | Bounce links | `bounce https://example.com`, open the link in a private window | Shows the destination and waits for a tap (compression APIs need Safari 16.4 or later) | not yet |
| M9 | Real sync | `sync setup <you>/<repo>` with a real fine-grained token; add a task | `sync ✓`; the private repo gets `browser-hub/data.json`; the task appears on the iPhone after its sync | ✓ 6 Oct 2026 (owner: "session sync between devices" works) |
| M10 | Storage eviction | Use the hub normally for 8+ days | Data and the token survive. If they're wiped, sync restores the data and `sync token` asks again (the owner's rule) | running since 6 Oct 2026; check after 14 Oct |

### iPhone, Safari

| # | Check | How | Expect | Result |
| --- | --- | --- | --- | --- |
| P1 | Keyboard and focus | Open the hub, tap the prompt, type; tap the output; tap the prompt again | The prompt rests on top of the keyboard; tapping outside hides the keyboard; no zoom on focus | ✓ 6 Oct 2026 |
| P2 | Double tap as Tab | Type `ta`, then tap `s` twice quickly | Both s's go and it completes to `tasks` | ✓ 6 Oct 2026 |
| P3 | Key bar and text size | The **keys** button; `font bigger`, `font reset` | Esc, Tab, arrows and Ctrl act on the prompt without dropping the keyboard; text size changes and is remembered | |
| P4 | Phone layout | `help`, `tasks`, `csv` (paste a table), `cook calorie chicken` | Nothing squeezed or wider than the screen; rows tappable | ✓ 6 Oct 2026 |
| P5 | Long paste | Paste 20 lines after `n ` | A `[Pasted text #1 +20 lines]` placeholder; the note keeps the lines | |
| P6 | Clip across devices | `clip key` (same passphrase) on both; `clip hello` on the Mac; `clip` on the iPhone | The text arrives with a copy button and is gone after 15 minutes | not yet |
| P7 | Scanning | `qr https://example.com` on the Mac; point the iPhone camera at the screen | The camera offers the link | |
| P8 | Mermaid on the phone | `mermaid`, edit, PNG | Editor stacks above the drawing; PNG saves (to Files or Photos) | |
| P9 | Visual history | Run a few commands on the Mac, then open the hub on the iPhone | They show, tagged with the Mac's name; `session show current` filters | ✓ 6 Oct 2026 |
