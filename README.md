# browser-hub

A command-line new-tab page: one prompt, every feature is a command, styled
after Claude's CLI. Static files only, deployed to GitHub Pages. The v1 spec is
in [docs/PLAN.md](docs/PLAN.md).

Type `help` at the prompt. Anything that isn't a command or alias is sent to
the default search engine.

Notes, tasks, events and aliases all work the same way:

```
tasks                          list them                 (tasks all, tasks #home)
tasks add <text>               add one
tasks t3                       show one; ids in any list link here
tasks t3 edit                  edit it in place
tasks t3 edit due friday       change one field          (edit due alone: current value in the prompt)
tasks t3 rm                    remove it                 (undo brings it back)
tasks t3 done                  actions of its own        (aliases: gh default)
```

Swap `tasks` for `notes`, `events`, `snippets`, `later`, `aliases`, `zones` or
`widgets`; the item is named by its id (`t3`), or for the others by name
(snippets by either): `aliases gh edit template …`,
`zones tokyo edit name Kenji`, `widgets zones move top`. Their own actions:
`tasks t3 done`, `later l2 open|done`, `aliases ddg default`, `widgets zones on|off|move <where>`;
`zones all`, `tasks all` and `later all` list everything. Notes, tasks, events,
snippets and aliases have a short name that does exactly the same and also adds
from plain text: `t buy milk`, `n call mum`, `ev fri 19:00 dinner`,
`snip sig Cheers, M`, `alias gh https://github.com/`; `later <url> [title]` saves a link.
The older orders (`t done t3`, `n rm n2`, `tz add tokyo`, `widgets move zones top`)
still work.

| Area | Commands |
| --- | --- |
| Find | `find` |
| Notes | `notes` (`n`) |
| Tasks | `tasks` (`t`) |
| Calendar | `events` (`ev`), `cal`, `agenda`, `today` |
| Dates | `date`, `days`, `week` |
| Snippets | `snippets` (`snip`) |
| Read later | `later` |
| Tools | `zones`, `tz`, `calc`, `epoch`, `uuid`, `b64`, `json`, `units`, `qr`, `pw` |
| Text | `count`, `case` |
| Developer | `cidr`, `hash`, `jwt`, `url`, `regex`, `diff`, `cron`, `color` |
| Share | `clip`, `bounce` |
| Kitchen | `cook target`, `cook oven`, `cook convert`, `cook calorie` |
| Aliases & engines | `aliases` (`alias`), `engine` |
| View | `theme`, `widgets` |
| Sync | `sync` |
| Meta | `help`, `keys`, `config`, `session`, `undo`, `redo`, `clear`, `history`, `export`, `import` (a backup, an xsearch export or an `.ics` calendar) |

Keys: **Tab** completes (again to list), **→** accepts the grey suggestion,
**↑/↓** history, **/** command palette, **?** shortcuts, **Esc** clears.
The prompt has readline editing keys: Ctrl+A/E (start/end), Ctrl+W (cut
word), Ctrl+U/K (cut to start/end), Ctrl+Y (paste), Alt+B/F (word back/forward),
and **Ctrl+R** searches history (Ctrl+R again for older, Enter runs, Tab edits).
Press `?` on an empty prompt (or run `keys`) for the full list, labelled for
your computer: ⌃R and ⌥B on a Mac, Ctrl+R and Alt+B elsewhere. On a phone, the
**keys** button under the prompt shows a row of Esc, Tab, arrows and Ctrl
buttons (off until you turn it on; remembered per device).

Every name is labelled with what it is, the same way in `help`, the `/`
palette, Tab lists and the hint under the prompt: built-in commands by their
group (`tools`, `notes` …), **your alias** (opens a page), **your engine**
(searches), and settings (`theme`, `widget`). `help` lists your own engines and
aliases after the built-in commands. A word one typo away from a
command or alias gets a "did you mean" in the hint, and Tab fixes it. The
**copy** button at the right of the prompt copies the latest result (a `calc`
answer, a `uuid`, pretty JSON …).

`tz` shows the time across your zones; `tz 15:00 tokyo` shows 15:00 Tokyo
time across them (any zone, by city, IANA name or your name for it). Manage the
zones themselves with `zones`.

**Editing**: every field of a note, task, event or alias can be changed from
the command line (`tasks t3 edit due fri`, `aliases gh edit template https://github.com/{}`)
or by tapping it: `tasks t3` shows the entry with its values tappable, and
`tasks t3 edit` opens the first one straight away. A tapped edit runs the
matching `edit` command, so the transcript and history show exactly what
changed. Field names have friendly synonyms (`name` for a task's or note's
text, `title` for an event's).

**Daily summary**: a card pinned at the top shows today's overdue tasks,
events and due tasks (ids link to them) and a line about tomorrow. It stays
until you dismiss it with × (or `today dismiss`) and comes back the next day.
The dismissal is a setting, so with sync it applies on every device. `today`
prints it, `today pin` brings it back, `today off` stops pinning it.

**Find**: `find <words>` searches everything (tasks, notes, events, your
aliases and engines, built-in commands, your command history) and shows the
results grouped by kind, best group first, best match first, with the matches
highlighted. Every word has to match somewhere in an item; a word matches whole,
at the start of a word, inside one, or loosely (`find pmt` finds "payment").
`find "oat milk"` matches a phrase, `find /^buy\s/` takes a regular expression
(`i` unless you give flags), and `find milk in:notes` lists just one group, in full.
Ids in the results open the entry.

**Dates** are read loosely and written out in full: `friday`, `fri` or `fr`
(the coming one), `next friday` (a week later), `12 oct`, `oct 12`,
`12 october 2027`, `tomorrow`, `in 3 days`, `+2w`, `2026-10-31`; they show as
"Friday 16 October". `t pay rent due:next friday`, `events add 12 oct 19:00 dinner`.

**Recurring tasks**: `t water the plants every:mon,thu`, `t pay rent every:month due:2026-11-01`,
`t stand-up notes every:weekday`; rules are day, weekday, week, month, year,
`2w` / `10d` / `3m`, or weekdays. `t done` moves the due date to the next
occurrence (finishing late doesn't leave it overdue; finishing early skips the
one done). `t edit t3.repeat none` makes it a normal task again.

**History on every device**: the page keeps what you ran *and what it
printed*, and with sync on, every device shows every device's history merged
in time order; a command from another device carries its name (`iPhone · Safari`).
Reload, or open the page on your phone, and it's all there.

- `session` lists the devices (sessions) in the history; `session show current`
  shows only this device, `session show all` every device (the default),
  `session show <device>` one other device. The choice is per device.
- `clear` (or `clear current`) clears this device's session, `clear all` every
  device's, everywhere once synced; `undo` brings it back.
- `config` sets your name (greeting) and this device's name (`config edit device Work laptop`).
- Kept: the last 300 commands, within about 800 KB; very long output (`zones all`)
  is kept as its heading only. `sync` output is never kept.

**Undo**: `undo` takes back the last change (any command: an edit, a
removal, a theme switch, a whole import), again for the one before; `redo`
puts it back, `undo ls` lists the steps. Removals offer an undo link right in
their output. Undo works item by item, so it isn't blocked by unrelated
changes since; if the same item was changed again (say in another tab), it
says so and `undo force` overrides. Steps are kept per device (the last 30).

**Quotes** are optional. Plain words work; quotes say what you mean when it
matters: `n "rm the weeds"` is a note, not a removal, `t "due:friday"` is task
text, `zones add tokyo "Kenji's team"` names a clock. A quote only counts at the
start of a word, so text like `project="APP"` needs no escaping.

**Aliases** take `{}` (or `%s`) for everything typed after the name, and
`{1}`, `{2}` … for single arguments: `alias jira https://jira.example.com/browse/{1}-{2}`
then `jira APP 42`. Templates may contain spaces and quotes, pasted as they
are: `alias bug https://jira.example.com/issues/?jql=project="APP" AND text ~ "%s"`.
`alias edit <name>` puts the whole definition in the prompt. `import` also
reads an xsearch export (a JSON object of name to URL).

**Pasting**: a paste of several lines (or a very long one) shows as a
placeholder, `[Pasted text #1 +12 lines]`, as in Claude's CLI. Move the cursor
into it (click it, or arrow into it) to see and edit the text, where line
breaks show as ⏎; Backspace right after it removes the whole paste. Enter runs
the command with the full text (`n` keeps the line breaks), and the history
shows the placeholder.

On touch screens, tap outside the prompt box to put the keyboard away and tap
the box to bring it back.

**Themes**: `theme` lists them with colour swatches; `theme nord` switches.
`auto` follows the system's light/dark setting.

**Widgets**: the right-hand panel shows live widgets (clock, agenda, tasks,
calendar, time zones, notes, backup). `widgets` lists them, `widgets zones`
shows one, `widgets zones on|off` turns it on or off, `widgets zones move top`
(or `up|down|bottom|<n>`) and `widgets order zones clock` reorder them,
`widgets hide|show` toggles the panel. On narrow screens the
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
`js/core/store.js`. Safari can evict site storage, so keep a copy elsewhere:
`export` downloads one, and **sync** keeps one in a private GitHub repository.

**Sync**: notes, tasks, events, snippets, links, aliases, settings and the shared history are
kept in one JSON file in a private repository of yours, so every device sees
the same data. The repository can be shared with other projects: the hub keeps
to its own directory, `browser-hub/` unless you choose another, and only ever
reads and writes `<directory>/data.json`. If a `data.json` already there isn't
the hub's, sync refuses to touch it. Its commits say `browser-hub: sync from <device>`.

1. Use a private repository: a new one, or one you already keep private data in.
2. Make a [fine-grained token](https://github.com/settings/personal-access-tokens/new)
   for just that repository, with **Contents: Read and write**, and an expiry.
3. Run `sync setup <you>/<repository>` (or `sync setup <you>/<repository> apps/hub`
   for another directory). The prompt asks for the token with the input hidden;
   it is never shown, kept in history, exported or synced.

The token stays on that device only (each device gets its own, or the same one
entered again). Changes go to the repo a few seconds after you make them and
come in when the page opens or comes back into view. Each sync merges item by
item against what was last synced, so edits on two devices both survive; an
item changed on both keeps this device's version and says so, and two items
created offline under the same id get renumbered. When GitHub refuses the token
(it expired or was revoked), sync pauses and says so; `sync token` enters a new
one. `sync` shows the state (also the `sync ✓` button under the prompt),
`sync now` syncs right away, `sync off` forgets the token on this device. Sync
refuses public repositories. The page may only connect to `api.github.com`
(its Content Security Policy blocks everything else).

**Snippets** are named pieces of text you paste often (a signature, an
address, a command): `snip sig` shows one with a copy button. **Later** keeps
links to read: `later` lists the unread ones, `later l2 open` opens one and
marks it read. Both sync, undo and turn up in `find` like everything else.

**Date maths**: `date` describes a day (week number, day of the year,
quarter); `date fri + 3 wd`, `date + 90d`, `date 31 jan + 1m` count forward
or back in days, weeks, months, years or workdays (Monday to Friday);
`date 1 jan to 25 dec` and `days until 25 dec` / `days since last fri` give
the distance in days, weeks, months and workdays. `week` shows this ISO week
(`week 52`, `week 1 2027`, `week 25 dec` for others), each day linking to
`date`. Dates are written any way the rest of the hub understands them.

**Developer tools**, all offline: `hash` (MD5, SHA-1/256/384/512), `jwt`
(header, claims and expiry; the signature isn't checked, and the token is kept
nowhere, not even for ↑), `url` (a URL taken apart, `url encode|decode`),
`regex /pattern/flags <text>` (every match and its groups), `diff` (paste two
texts after it, or quote two lines: line by line or word by word), `cron`
(a schedule in words and its next runs in your time) and `color` (hex, rgb,
hsl, and WCAG contrast: `color #777 on #fff`). `hash` input stays out of the
shared history.

**Text and networks**: `pw` makes a password (`pw 32`, `pw simple` without
symbols), a passphrase (`pw words`, from the EFF word list) or a PIN, with the
browser's secure random numbers; it never goes into the shared history.
`count` gives words, characters, lines and reading time; `case` rewrites text
as camelCase, snake_case, kebab-case, Title Case and the rest; `cidr` takes an
IPv4 or IPv6 range or address apart (`cidr 10.0.0.0/22 10.0.3.9` says
whether the address is inside).

**QR codes**: `qr <text>` draws one for a link or any text, made on the page
(nothing is sent anywhere), always dark on white so phones can scan it in any
theme. Error correction is raised as far as the size allows.

**Kitchen**: `cook target [food]` gives the inside temperature to cook to:
the safe one (USDA) and the best one for taste and texture, with a warning
wherever the best is below the safe one or where undercooking is dangerous
(poultry, mince, sausages, leftovers). `cook oven chicken 500g at 200`
answers how long, and without a temperature also at what; joints go by weight,
pieces by thickness, and every answer ends in the temperature to check for.
It understands fan ovens (`fan 160`), °F (`400f`), gas marks and doneness
(`beef 1.5kg medium-rare`). `cook convert 1 spoon sugar`, `½ stick butter`,
`2 cups flour`, `8 oz cream cheese` give grams for a kitchen scale (and
`250 g flour` gives cups back); `cook convert` alone is the table, and
`cook convert 350f` converts oven temperatures.

`cook calorie chicken` lists every kind of chicken, raw and cooked, with
calories, protein, fat and carbohydrate per 100 g; `cook calorie chicken
breast` narrows it down, and one food (`cook calorie chicken breast skinless
raw 250g`, or a tap on its row) shows everything: energy, fat (saturated),
carbohydrate (sugars), fibre, salt, cholesterol, then 9 minerals and 13
vitamins with the share of the daily value, and household portions. Add
`raw` or `cooked` to choose, and a weight (`150g`, `8 oz`) to scale. The
365 foods (meat, fish, eggs, dairy, grains, legumes, vegetables, fruit,
nuts, oils, sweets, snacks like crisps and chocolate, drinks, condiments)
come from the USDA National Nutrient Database for Standard Reference (SR28,
public domain); the table loads only when first used.

**Bounce links**: `bounce <url>` gives a link to this page that sends whoever
opens it on to the address. The address travels inside the link (packed, and
compressed when that helps), so nothing is stored and it works for anyone;
it is longer than the address, not shorter. The link is signed with a key in
your synced settings: on your devices it bounces straight away, while anyone
else's browser (or a link not made with your key) shows where it goes and
waits for a tap, so the page can't be used to send people somewhere they didn't
choose. `bounce <bounce link>` tells you where one leads.

**Shared clip**: `clip <text>` hands one piece of text to your other devices
(`clip` there shows it, with a copy button; a device that gets a new clip
says so). It is handled with care, because git keeps every version of the
sync file for ever:

- One item only: a new clip replaces the old one, from whichever device.
- For 15 minutes: then it is wiped on every device and in the sync file
  (`clip clear` wipes it sooner), and it disappears from the screen.
- Sealed: the text goes to the repository encrypted (AES-GCM, with a key made
  from a passphrase by PBKDF2). Give each device the same passphrase once with
  `clip key` (asked hidden, kept on that device only, never synced). Without
  one, a clip stays on the device it was made on.
- Never kept: not in the shared history, ↑ recall, undo, `find` or `export`.

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
NODE_PATH=$(npm root -g) npm run test:e2e        # the real page in Chromium (needs Playwright, and jsqr below)
npm i --no-save jsqr@1.4.0 && node --test tests/qr.test.mjs   # QR codes read back by an independent decoder
```

The nutrition table is generated: list foods in `tools/nutrition-foods.mjs`
(each by its USDA NDB number, which FoodData Central also shows for "SR Legacy"
foods) and run `node tools/build-nutrition.mjs <SR28 data directory>` (the
`data/` of the npm package `fda-nutrient-database`, or USDA's sr28abbr.zip).
The tests check the result against the list and against itself.

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
