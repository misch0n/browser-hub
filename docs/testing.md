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
| `npm run test:e2e` | the deployable build in headless Chromium: 57 checks | ~3 min |
| `npm run test:all` | all of the above, as CI runs it | ~4 min |
| `node tools/docs-commands.mjs` | is the command reference current? (`npm run docs` rewrites it) | instant |

Run one unit test: `node --test --test-name-pattern="diagrams" tests/unit.test.js`.
The e2e suite has no filter; to debug one check, copy its body into a scratch
script (see "e2e harness" for the setup it needs) rather than running all 57.

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

## By hand, in real Safari (not automatable here)

Tests run in Chromium only: the cloud environment can't download WebKit, and
CI doesn't run it yet (a [todo](todo.md) item). These came from the original spec and have **not been confirmed**;
see [todo.md](todo.md):

- [ ] ⌘T with the page as new-tab page: typing goes into the prompt without a click.
- [ ] Typing into the page resets Safari's 7-day storage eviction timer.
- [ ] Page load, and Back from a redirect, leave the prompt focused and empty.
- [ ] iPhone: the prompt sits on top of the keyboard; tapping outside dismisses it; no zoom on focus.
- [ ] iPhone: help and tables don't overflow at phone width; double-tap-as-Tab works.
- [ ] Sync between a Mac and an iPhone with a real fine-grained token.
- [ ] Mermaid draws and exports PNG in Safari (canvas from an SVG image).
