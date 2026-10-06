# Sync with Apple Calendar, Reminders and Notes

Status: **dropped** (5 Oct 2026, owner: "dropping that feature for the time
being. I will consider it if it turns into a painpoint.")

## Question

"What are ways we can sync reminders and notes and calendar from the app to apple?"

## Findings

- **No direct iCloud access from a page.** iCloud Calendar speaks CalDAV but
  blocks browser requests (CORS) and needs an app-specific password, which
  also opens mail and contacts; not something to put in a web page.
- **Reminders** haven't been reachable over CalDAV since the iOS 13 upgrade.
- **Notes** has no API; only Shortcuts (iPhone/Mac) and AppleScript (Mac) write to it.

## Options (least to most work)

1. **Hand-offs from the page** (about an hour): `events export` to an `.ics`
   file (a copy, not a sync); `notes n3 share` / `tasks t3 share` via the
   system share sheet into Notes or Reminders, one item at a time.
2. **Calendar subscription** (one-way, automatic; a few hours): sync also
   writes an `.ics`; Calendar subscribes to its URL. Calendar can't send the
   GitHub token, so the file must be reachable elsewhere: a secret Gist
   (simple, readable by anyone with the link) or a small Cloudflare Worker
   that reads the private repo and serves it at a secret URL (more private,
   one more thing to run). Events read-only in Calendar.
3. **Shortcuts for Reminders and Notes**: an iPhone Shortcut reads the synced
   file via the GitHub API on a schedule and adds/updates reminders (a hidden
   marker avoids duplicates); later a second Shortcut sends completions back.
   The owner builds the Shortcuts from written steps. Variant: `tasks t3 send`
   via a `shortcuts://` link, per item.
4. **A helper on a Mac** (full two-way; most work): a background script uses
   Apple's APIs (Notes via AppleScript) and merges with the repo using the
   hub's rules; only syncs while the Mac is awake.

## Recommendation (at the time)

1 and 2 first, then the Reminders Shortcut from 3; 4 only if one-way isn't enough.

## Open questions for the owner (if revived)

- Calendar feed: secret Gist or Cloudflare Worker?
- Reminders: one-way (hub → Reminders) or both ways?
