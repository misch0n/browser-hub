# browser-hub

A command-line new-tab page: one prompt, every feature is a command, styled
after Claude's CLI. Static files only, deployed to GitHub Pages. The v1 spec is
in [docs/PLAN.md](docs/PLAN.md).

Type `help` at the prompt. Anything that isn't a command or alias is sent to
the default search engine.

| Area | Commands |
| --- | --- |
| Notes | `n`, `notes`, `n show`, `n edit`, `n rm` |
| Tasks | `t`, `tasks`, `t show`, `t edit`, `t done`, `t rm` |
| Calendar | `cal`, `agenda`, `ev`, `ev show`, `ev edit`, `ics import` |
| Tools | `calc`, `tz`, `epoch`, `uuid`, `b64`, `json`, `units` |
| Aliases & engines | `alias`, `engine` |
| View | `theme`, `widgets` |
| Meta | `help`, `clear`, `history`, `export`, `import` |

Keys: **Tab** completes (again to list), **→** accepts the grey suggestion,
**↑/↓** history, **/** command palette, **?** shortcuts, **Esc** clears.
The prompt has readline editing keys: Ctrl+A/E (start/end), Ctrl+W (cut
word), Ctrl+U/K (cut to start/end), Ctrl+Y (paste), Alt+B/F (word back/forward).
Press `?` on an empty prompt for the full list.

**Editing**: every note, task, event and alias can be changed field by field,
from the command line or by tapping. `n edit n1.text new words`,
`t edit t3.due fri`, `t edit t3.tags #home #errands`, `ev edit e2.time none`,
`alias edit gh.template https://github.com/{}`. `show` prints an entry with
its fields editable in place (ids in lists link to it): tap a value, change it,
press Enter, and the page runs the matching `edit` command, so the transcript
and history show exactly what changed.

**Quotes** are optional. Plain words work; quotes say what you mean when it
matters: `n "rm the weeds"` is a note, not a removal, `t "due:friday"` is task
text, `tz add tokyo "Kenji's team"` names a clock. A quote only counts at the
start of a word, so text like `project="APP"` needs no escaping.

**Aliases** take `{}` (or `%s`) for everything typed after the name, and
`{1}`, `{2}` … for single arguments: `alias jira https://jira.example.com/browse/{1}-{2}`
then `jira APP 42`. Templates may contain spaces and quotes, pasted as they
are: `alias bug https://jira.example.com/issues/?jql=project="APP" AND text ~ "%s"`.
`alias edit <name>` puts the whole definition in the prompt. `import` also
reads an xsearch export (a JSON object of name to URL).

On touch screens, tap outside the prompt box to put the keyboard away and tap
the box to bring it back.

**Themes**: `theme` lists them with colour swatches; `theme nord` switches.
`auto` follows the system's light/dark setting.

**Widgets**: the right-hand panel shows live widgets (clock, agenda, tasks,
calendar, time zones, notes, backup). `widgets` lists them, `widgets zones`
toggles one, `widgets move zones top` (or `up|down|bottom|<n>`) and
`widgets order zones clock` reorder them, `widgets hide|show` toggles the panel. On narrow screens the
panel becomes a drawer opened from the `widgets` button under the prompt.

**From the address bar**: `https://misch0n.github.io/browser-hub/?q=<input>`
runs an alias, engine or search straight away, so the page works as a browser
search engine. In Chrome, open Settings → Search engine → Manage search engines
→ Site search → Add, and use `https://misch0n.github.io/browser-hub/?q=%s` as
the URL (make it the default, or give it a shortcut such as `cc`). Firefox
offers to add it from the address bar's search menu, since the page advertises
an OpenSearch description. Built-in commands (`t …`, `n …`) are only put into
the prompt and wait for Enter, so a link from another site can never change
your data.

All data lives in `localStorage` (keys `cc:*`), behind the store interface in
`js/core/store.js`. **`export` is the only backup**: Safari can evict site
storage, so the page reminds you when your last export is more than 14 days
old, and the backup widget shows how long it has been.

## Code layout

No build step and no dependencies; the page loads native ES modules.

```
index.html, style.css, themes.css
js/boot.js        applies the saved theme before first paint
tools/            build-site.mjs: cache-busted copy of the site for deploys
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
npm run test:tz                                  # unit tests in six time zones (UTC-11 … UTC+14)
NODE_PATH=$(npm root -g) npm run test:e2e        # the real page in Chromium (needs Playwright)
```

Safari-only behaviour (⌘T focus, storage eviction) can't be covered by these;
see the acceptance tests in the plan and run them by hand.

## Deployment

`.github/workflows/pages.yml` runs every test on each push and pull request
(unit tests in six time zones, then the browser tests in Chromium). Pushes to
`main` are deployed only when all of them pass.
In the repository settings, set **Pages → Source** to **GitHub Actions**.

The workflow runs `node tools/build-site.mjs _site <commit>`, which stamps
every stylesheet, script and module import with the commit
(`style.css?v=…`). GitHub Pages can't control caching, and Safari otherwise
keeps serving old files after a deploy, which mixes a new page with stale
styles. The browser tests run against this build.

All project sites under `<user>.github.io` share one origin and therefore one
`localStorage`. Use a custom domain or a dedicated account or organisation
before storing anything real (see "Origin" in the plan).
