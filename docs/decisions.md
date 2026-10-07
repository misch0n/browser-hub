# Decisions

Choices with lasting consequences, and why. Newest last. Before reversing one,
read its reasons; to change it, add a new entry that supersedes it (keep the old).

Format: **D<n>. Title** (date, status). Context → decision → consequences.

---

**D1. Static site, no build step, no runtime dependencies** (5 Oct 2026, active)
The hub is a new-tab page on GitHub Pages; no server, no extension. Native ES
modules, vanilla JS. → Anyone can read and run the code as-is; tests run in
plain Node. Libraries are vendored only when writing our own is unreasonable (D11).

**D2. All state in localStorage, behind a store interface** (5 Oct 2026, active)
`js/core/store.js` is the only module touching storage; promise-based so a
server store could replace it. → Commands never see `localStorage`. Device-only
values go through `getLocal/setLocal` (`cc-device:*`).

**D3. Cache-busting build for deploys** (5 Oct 2026, active)
Safari served stale CSS after deploys and Pages can't set cache headers. →
`tools/build-site.mjs` stamps every asset and relative import with `?v=<commit>`;
e2e runs against the build; a test checks every module loads versioned.

**D4. One grammar for everything you keep** (5 Oct 2026, active)
The owner found per-command syntaxes confusing. → `<noun> <id> <verb>` everywhere,
implemented once (`commands/records.js`); short names equal the long ones;
older orders keep working.

**D5. Sync through a private GitHub repo, token on the device** (5 Oct 2026, active)
Needed cross-device data without a server. → Fine-grained token per device,
never synced or exported (owner's rule); one file under a project directory
in a possibly shared repo (owner's rule); three-way merge per item with
renumbering; visual history and settings sync too. Caveat: the origin is
shared with other `github.io` projects (open question, see security.md).

**D6. Visual history as replayable data** (5 Oct 2026, active)
The owner wants to see on the phone what happened on the PC. → Output is
recorded as `out` method calls with JSON arguments, not HTML; replayed on any
device by the current renderer. New drawing ops must stay JSON-only and
re-derive their visuals (QR, barcode, diagram are re-encoded on replay).

**D7. Shared clip: one sealed item for 15 minutes** (5 Oct 2026, active)
Git keeps every version of the sync file for ever. → One item, wiped after
15 minutes everywhere, AES-GCM sealed with a passphrase key per device;
never in history, undo, find or export.

**D8. Bounce links signed, not stored** (5 Oct 2026, active)
A redirector must not become an open redirect. → The target travels in the link;
an HMAC with a synced key lets your devices bounce instantly, everyone else
gets a "continue to …" page.

**D9. Nutrition data from USDA SR28, generated** (6 Oct 2026, active)
Numbers must come from a reputable source, not memory. USDA's servers were
unreachable from the build environment; SR28 (public domain, = "SR Legacy")
came via an npm package and was validated (known values, energy vs macros). →
`tools/build-nutrition.mjs` generates `js/lib/nutrition-data.js` from a
curated list; household portions entered by hand.

**D10. Network tools: CSP connect-src widened to any https** (6 Oct 2026, active)
The owner asked for a request tester, DNS-over-HTTPS and a public-IP lookup,
which must reach arbitrary hosts. → `connect-src https: http://localhost:*
http://127.0.0.1:*` (was `https://api.github.com`). Script sources stay
`'self'`, so no other code can use it; tools omit credentials and referrers.
Supersedes the v1 spec's "no network requests" and the "without the internet
ones" answer of 5 Oct for these tools only.

**D11. Mermaid vendored, rendered in a frame, shown as an image** (6 Oct 2026, active)
Writing a diagram renderer is unreasonable; Mermaid needs inline styles that
the page's CSP forbids. → Mermaid 12.1.0 (MIT, 5.5 MB, no source maps) in
`js/vendor/mermaid-12.1.0/`, loaded on first use inside `mermaid-frame.html`
(own CSP: inline styles, no connections), output shown via `blob:` image;
`img-src 'self' blob:` added to the page. Upgrade = new versioned folder.

**D12. Codes drawn as geometry, PNG painted on canvas** (6 Oct 2026, active)
Exporting PNG through an `<img>` of the SVG would need more CSP. → QR and
barcodes share one geometry for SVG and canvas; no CSP change for them.

**D13. Diagram drafts stay on the device; saving is a command** (6 Oct 2026, active)
A half-typed diagram synced from one device could overwrite another's. →
The editor's draft is `cc-device:diagram-draft`; Save runs `diagrams d1 save`
or `diagrams add <name>`, so keeping is undoable and in the history.

**D14. Documentation for agents, command reference generated** (6 Oct 2026, active)
Any agent must be able to pick up the next task without rediscovery. →
`AGENTS.md` entry point (Claude's `CLAUDE.md` imports it), `docs/` as the
single place for plans, todo, decisions, deferrals and explorations; the
command reference is generated from code and a unit test fails on drift.

**D15. No separate domain for now** (6 Oct 2026, active)
The hub shares the `misch0n.github.io` origin, and so its `localStorage`
(notes, tasks, the sync token), with every other Pages project on the
account. Owner: "no separate domain for now." → Accepted risk: only the
owner's own Pages projects share the origin, so the exposure is to code in
those projects (or anything they load). Keep the hub's CSP strict, and don't
publish other Pages projects on this account that run third-party code.
Revisit if that changes, or before storing anything more sensitive than today.

**D16. iOS notifications approved as a todo** (6 Oct 2026, active)
Owner: "ios notifications as todo" (it was parked as an exploration). → Planned in
[plans/001-ios-notifications.md](plans/001-ios-notifications.md); the
plan's first step settles its open questions with the owner (sender, what
notifies, quiet hours, icon), with proposed defaults.

**D17. Three kinds of todo task** (6 Oct 2026, active)
The owner doesn't want verification work showing up as the next thing to
build. → [todo.md](todo.md) splits tasks into Dev (the only source of "the
next task"), Research (findings and questions, only on request) and
Confirmation (verifying what's built, only on request). iOS notifications
became a research task (amends D16); WebKit on CI became a confirmation task.

**D18. Command aliases; pages opened from the prompt wait a second** (6 Oct 2026, active)
Owner: aliases for commands with placeholders, listed next to their command;
"a redirecting alias … should wait for 1 second … escape should cancel". →
An alias whose first word is a built-in runs it (same table, same grammar, same
placeholders, text inserted as typed, no aliases of aliases). Built-in short
names carry `aliasOf`. Every page opened from the prompt (aliases, searches,
`later <id> open`) waits one second; Esc or another command cancels. The
address bar and bounce links don't wait (they were asked for by a click or a
browser search).

**D19. Graph mode reads the existing grammar; it never changes what runs** (7 Oct 2026, experimental)
Owner asked to try a graph mode for the prompt: `graph ` before a command shows
every reachable next step, fuzzy-matched, ranked switchably by use or a to z;
normal mode unchanged, no changes to execution or the grammar. → The graph
is derived from each command's `usage` lines and `complete()`, so it can't
drift from the commands and needs nothing new from them. Enter runs the text
after `graph ` unchanged except for words that resolve to exactly one known
word; free text (anything a placeholder can take) is never corrected, and an
ambiguous word stops the path until chosen. Counts and the ranking stay on the
device. Keep it, change it or drop it once the owner has compared the orders.
