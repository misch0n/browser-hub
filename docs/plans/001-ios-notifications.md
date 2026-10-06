# 001 · iOS notifications

Status: **draft, research first** (6 Oct 2026, owner: "ios notifications as todo", then
"ios notifications - research task"). Becomes Dev tasks once the research
questions are answered
· Todo: [todo.md](../todo.md#research) · Research: [exploration/ios-notifications.md](../exploration/ios-notifications.md)

## Goal

The hub, installed on the iPhone's Home Screen, delivers real notifications
(lock screen, app icon badge), including while it is closed: at least the
morning summary and things that are due. Done when the owner gets them on
their iPhone and can turn them on, test and off by command.

## Approach

- **Installable app:** web app manifest (`display: standalone`), icons,
  favicon. CSP unchanged (`manifest-src`/`worker-src` fall back to `'self'`).
- **Service worker** `sw.js` at the site root (scope `/browser-hub/`): handles
  `push` (show the notification) and `notificationclick` (focus the app, or
  open it on a command such as `?q=today`). **No asset caching**: the
  cache-busting build (D3) stays the only caching story. Stamped by the build.
- **`notify` command**, in the shared grammar where it fits:
  - `notify`: status (installed? permission? subscribed? sender last seen?);
  - `notify on`: in the installed app only, ask permission (Enter is the user
    gesture iOS requires), then subscribe;
  - `notify off`, `notify test` (a local notification now).
  Outside the installed app it explains how to Add to Home Screen.
- **Subscription storage:** the push subscription (endpoint + keys) per
  device goes into synced settings (e.g. `settings.notify.devices[deviceId]`)
  so the sender can read it from the data repo. It is useless without the
  VAPID private key. The **VAPID public key** goes into synced settings too
  (`notify key <public key>`), so the public repo holds no owner-specific config.
- **Badge:** `navigator.setAppBadge(<overdue + due today>)` on load and after
  changes; cleared at zero.
- **Sender** (per the owner's answer below; default GitHub Action):
  `tools/notify/send.mjs` in this repo (reads `<dir>/data.json`, works out
  what is due in the owner's time zone, sends Web Push with VAPID, records
  what it sent in `<dir>/notify-state.json` to avoid repeats). The owner adds
  a small workflow to the private data repo that checks out this repo and
  runs it; secrets there: `VAPID_PRIVATE_KEY` (and `VAPID_SUBJECT`). The
  hub's sync never reads `notify-state.json` (it only touches `data.json`).
- **Security:** VAPID private key only in the data repo's secrets; payloads
  carry titles only (no note bodies); Apple's push service sees the payload
  encrypted. Update [security.md](../security.md).

## Steps

- [ ] 0. Ask the owner the open questions below (defaults proposed); record answers here and in decisions.
- [ ] 1. Icons (SVG + 180/192/512 PNG), favicon, `manifest.webmanifest`, `apple-touch-icon`, theme colour; build stamps them; e2e: served, linked, no 404s.
- [ ] 2. `sw.js` (push, notificationclick), registration in `main.js`; e2e: registers in Chromium.
- [ ] 3. `notify` command and subscription in synced settings; standalone detection; unit tests with fake `Notification`/`PushManager`; e2e with permission granted.
- [ ] 4. App badge.
- [ ] 5. Sender `tools/notify/send.mjs` + workflow template + `notify setup` instructions; unit tests on due computation, quiet hours and de-duplication with fake data and a fake push endpoint.
- [ ] 6. Docs: README section (install on iPhone, `notify`), architecture, security, decisions, changelog; command reference.
- [ ] 7. Owner verifies on the iPhone (install, `notify on`, `notify test`, a real scheduled push); record in testing.md.

## Tests

Unit: settings shape, `notify` flows, due/quiet-hours logic, payloads.
e2e (Chromium): manifest and icons, service worker registration, `notify on`
with granted permission, `notify test`. Real push to iOS can only be checked
by the owner (step 7).

## Open questions (ask in step 0)

1. **Sender.**
   - (a) GitHub Action in the private data repo. No new account; private repos
     get 2,000 free Actions minutes a month (GitHub Free, Dec 2025 pricing):
     a check every 30 minutes uses ≈1,440, every 15 minutes ≈2,880 (over the
     free amount, roughly $5 a month at $0.006/min). Runs are often 5–30 minutes late.
   - (b) Cloudflare Worker on a one-minute cron: punctual, free, but another account.
   - *Default: (a) every 30 minutes.*
2. **What notifies:**
   - morning summary at 08:00 (*default yes*);
   - tasks due today, in that summary (*default yes*);
   - events with a time, 15 minutes before (*default yes, needs (b) to be punctual*);
   - a clip from another device (*default no*).
3. **Quiet hours.** *Default 22:00–07:00.*
4. **Icon.** *Default: the `›` prompt glyph on the accent colour.*

## Log

- 6 Oct 2026: plan written from the exploration; not started.
- 6 Oct 2026: owner made it a research task; the open questions come first.
