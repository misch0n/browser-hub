# browser-hub

A command-line new-tab page: one prompt, every feature is a command. Static
files only, deployed to GitHub Pages. See [docs/PLAN.md](docs/PLAN.md) for the
v1 spec.

Type `help` at the prompt. Anything that isn't a command (or alias) is sent to
the default search engine.

| Area | Commands |
| --- | --- |
| Notes | `n`, `notes`, `n edit`, `n rm` |
| Tasks | `t`, `tasks`, `t done`, `t rm` |
| Calendar | `cal`, `agenda`, `ev`, `ics import` |
| Tools | `calc`, `tz`, `epoch`, `uuid`, `b64`, `json`, `units` |
| Aliases & engines | `alias`, `engine` |
| Meta | `help`, `clear`, `history`, `export`, `import`, `/` palette |

All data lives in `localStorage` (keys `cc:*`), behind the store interface in
`js/store.js`. **`export` is the only backup**: Safari can evict site storage,
so the page reminds you when your last export is more than 14 days old.

## Development

No build step. Serve the directory locally:

```sh
python3 -m http.server 8000
```

Tests:

```sh
node --test tests/unit.test.js                      # logic, no dependencies
NODE_PATH=$(npm root -g) node tests/e2e.cjs         # real page in Chromium (needs Playwright)
```

Safari-only behaviour (⌘T focus, storage eviction) can't be covered by these;
see the acceptance tests in the plan and run them by hand.

## Deployment

Pushes to `main` are deployed automatically by `.github/workflows/pages.yml`.
In the repository settings, set **Pages → Source** to **GitHub Actions**.

All project sites under `<user>.github.io` share one origin and therefore one
`localStorage`. Use a custom domain or a dedicated account/org before storing
anything real (see "Origin" in the plan).
