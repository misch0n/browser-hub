# Changelog

What shipped, newest first, by feature. One line per change; the commit has
the detail (`git show <hash>`). Add a line here with every change you push.

## 6 October 2026

- Decisions recorded: no separate domain for now (D15); iOS notifications
  approved and planned ([plan 001](plans/001-ios-notifications.md), D16). Manual
  Safari and iPhone checks written out with steps and expected results.
- Documentation for agents and contributors: `AGENTS.md`, `docs/` (architecture,
  conventions, security, testing, recipes, todo, decisions, deferred,
  exploration, plans); command reference generated from the code and checked
  by a test; `npm run setup` / `test:all`; a SessionStart hook installs the
  test packages in cloud sessions. The v1 spec moved to `docs/plans/archive/`.
  Fixed a timing race in the e2e sync check that failed CI on `15ed8fd`.
- `15ed8fd` Deferred items listed with reasons (now [deferred.md](deferred.md)).
- `224fa36` Mermaid diagrams: live editor with autosaved draft, synced
  `diagrams` library in the shared grammar, SVG/PNG export, JSON library export/import.
- `b15d136` `barcode` (Code 128, Code 39, EAN-13/8, UPC-A, ITF, Codabar); SVG/PNG export for barcodes and QR codes.
- `e7d8432` Network tools: `request`, `ping`, `dns` (DoH), `ip` (ipify, ipapi.co). CSP `connect-src` widened.
- `f9cad8b` `crypt` (AES-GCM/CBC, PBKDF2, RSA-OAEP, keygen, PEM⇄JWK), `cert` (X.509, CSR), `ua`, `device`.
- `cc6744c` `json` tree and errors with position, `csv` table, `jwt` verify/sign, `base`, `text`, `hmac`, `escape`, `http`, `mime`.
- `428dad5` Help by category with tags; full help per command; Tab completion for every known next word; double tap as Tab on phones.
- `ce639fd` `font` size per device; help is ephemeral; prompt rests on the keyboard.
- `4652268` `cook calorie`: own foods (synced), household portions, meal totals.
- `245d3c9` `random`, `roll`.
- `4a7d20b` `cook calorie`: 365 foods from USDA SR28.
- `957251f` `cook target|oven|convert`.

## 5 October 2026

- `025a3ee` `bounce` links (signed).
- `6ab742d` `snippets`, `later`.
- `08bd17b` `pw`, `count`, `case`, `cidr`.
- `f0c7213` `hash`, `jwt` (decode), `url`, `regex`, `diff`, `cron`, `color`.
- `d89b0ae` `date`, `days`, `week`.
- `2c8abda` `qr`.
- `12e0b18` `clip`: one sealed item for 15 minutes.
- `9038883` Sync keeps to its own directory in a shared repository.
- `5f65683` Vocabulary pass: one word per idea, older forms still understood.
- `d43fde5` Long pastes collapse into placeholders.
- `e1a91a4` Visual history on every device, merged by time; sessions.
- `b53b4a3` `config`: name and device name; device ids.
- `3cc9b20` Tap a list row to open its item.
- `56d98aa` Any day/month prefix accepted; full names shown.
- `38508b6`, `e242339` One grammar for notes, tasks, events, aliases, zones, widgets.
- `7457395` Sync with a private GitHub repository.
- `d614d1b` Pinned daily summary.
- `029da17` `find`: fuzzy, regex, grouped, ranked.
- `898a1a0` Recurring tasks.
- `870f8f6` Undo and redo.
- `2fed2b1`, `38aab34` Labels for every name; `keys`; phone key bar; phone layout of help.
- `eff3340` Full-width layout.
- `5a3dd18` Ctrl+R, did-you-mean, `tz <time> <zone>`, copy button.
- `9272f62` Edit any field (CLI or in place); optional quotes; richer alias templates.
- `107412f` `?q=` from the address bar; OpenSearch.
- `a3de9ae` CI gates the deploy on all tests.
- `d40dfd9` Readline editing keys.
- `118bada` `tz` zones, names, order, dates; widget order.
- `3da05d9` Engines from a template alone; hint names the search.
- `90db4f4`, `f5146f0` Cache-busting build; touch keyboard dismissal; no zoom on focus.
- `c7a103a` Front end rebuilt: CLI-style output, themes, widgets, responsive.
- `e79e12e` v1 implemented from the spec.
- `229d002` v1 spec.
- `6bae4ad` Repository and Pages deployment.
