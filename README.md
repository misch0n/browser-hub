# browser-hub

A command-line new-tab page: one prompt, every feature is a command, styled
after Claude's CLI. Static files only, deployed to GitHub Pages. The v1 spec is
in [docs/PLAN.md](docs/PLAN.md).

Type `help` at the prompt. Anything that isn't a command or alias is sent to
the default search engine.

| Area | Commands |
| --- | --- |
| Notes | `n`, `notes`, `n edit`, `n rm` |
| Tasks | `t`, `tasks`, `t done`, `t rm` |
| Calendar | `cal`, `agenda`, `ev`, `ics import` |
| Tools | `calc`, `tz`, `epoch`, `uuid`, `b64`, `json`, `units` |
| Aliases & engines | `alias`, `engine` |
| View | `theme`, `widgets` |
| Meta | `help`, `clear`, `history`, `export`, `import` |

Keys: **Tab** completes (again to list), **→** accepts the grey suggestion,
**↑/↓** history, **/** command palette, **?** shortcuts, **Esc** clears.

**Themes**: `theme` lists them with colour swatches; `theme nord` switches.
`auto` follows the system's light/dark setting.

**Widgets**: the right-hand panel shows live widgets (clock, agenda, tasks,
calendar, time zones, notes, backup). `widgets` lists them, `widgets zones`
toggles one, `widgets hide|show` toggles the panel. On narrow screens the
panel becomes a drawer opened from the `widgets` button under the prompt.

All data lives in `localStorage` (keys `cc:*`), behind the store interface in
`js/core/store.js`. **`export` is the only backup**: Safari can evict site
storage, so the page reminds you when your last export is more than 14 days
old, and the backup widget shows how long it has been.

## Code layout

No build step and no dependencies; the page loads native ES modules.

```
index.html, style.css, themes.css
js/boot.js        applies the saved theme before first paint
js/main.js        wiring: prompt, transcript, palette, widgets, lifecycle
js/core/          data model: store, collections, dispatch, completion, import
js/lib/           pure helpers: calc, units, time zones, ics, base64, epoch
js/commands/      built-in commands; they write structured output only
js/ui/            DOM: transcript renderer, prompt, palette, widgets
```

Commands never touch the DOM. They describe their result through `ctx.out`
(`head`, `table`, `kv`, `code`, ...), and `js/ui/transcript.js` renders it,
so all output shares one visual language: a coloured bullet for the outcome,
a bold summary line, and a body hanging off a connector.

## Development

Serve the directory locally (ES modules don't load from `file://`):

```sh
python3 -m http.server 8000
```

Tests:

```sh
npm test                                         # unit tests, no dependencies
NODE_PATH=$(npm root -g) npm run test:e2e        # the real page in Chromium (needs Playwright)
```

Safari-only behaviour (⌘T focus, storage eviction) can't be covered by these;
see the acceptance tests in the plan and run them by hand.

## Deployment

Pushes to `main` are deployed automatically by `.github/workflows/pages.yml`.
In the repository settings, set **Pages → Source** to **GitHub Actions**.

All project sites under `<user>.github.io` share one origin and therefore one
`localStorage`. Use a custom domain or a dedicated account or organisation
before storing anything real (see "Origin" in the plan).
