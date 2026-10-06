# iOS notifications

Status: **open: research task** (6 Oct 2026, owner: "ios notifications - research
task"; earlier: "Not now. Mark it for exploration.", then "ios notifications as
todo"). A draft plan exists: [plans/001-ios-notifications.md](../plans/001-ios-notifications.md).

## Question

"Is it possible to have the page deliver iOS notifications after I install it
to the homescreen?"

## Findings

- Since iOS/iPadOS 16.4, a site added to the Home Screen from Safari can use
  the Push API and Notifications API: real notifications on the lock screen,
  with the app's name and icon, and an icon badge (Badging API,
  `navigator.setAppBadge`). Not available to a page in a Safari tab.
- Requirements:
  - a web app manifest with `display: standalone`, plus icons;
  - a service worker;
  - permission requested from a user gesture *inside the installed app*;
  - a push subscription (`PushManager.subscribe`) with VAPID keys.
- iOS gives web apps no scheduled local notifications (Notification Triggers
  never shipped), no Periodic Background Sync and no Background Sync. A
  notification while the app is closed therefore needs **a server that sends
  a push** (to Apple's endpoint, `web.push.apple.com`, signed with VAPID).
- While the app is open it can notify itself (`registration.showNotification`).
- The installed app has **separate storage** from Safari: the sync token must
  be entered again there (fits the on-device token rule). Home Screen apps are
  not subject to Safari's 7-day storage eviction.
- Notifications obey iOS settings (mute, focus modes) like any app.
- The hub has neither a manifest nor a service worker today (and gets a
  harmless favicon 404).

## Options

1. **In the page only.** Manifest, icons, service worker, `notify on|off|test`,
   badge with the overdue count, notifications only while the app is open.
   Small; no server; doesn't cover "remind me when closed".
2. **Option 1 + a scheduled GitHub Action in the private data repo.** The
   Action reads `<dir>/data.json`, works out what's due (morning summary, due
   tasks, starting events) and sends pushes with the `web-push` library. VAPID
   private key as a repo secret; the phone's subscription stored in the
   synced data (useless without the private key). No new service. Timing:
   schedules run every 5 minutes at best and are often 5–30 minutes late, so
   fine for "due today" and a morning summary, poor for "at 14:00 sharp".
   Cost: private repos get 2,000 free Actions minutes a month (GitHub Free);
   a check every 30 minutes uses about 1,440, every 15 minutes about 2,880.
3. **Option 1 + a Cloudflare Worker on a one-minute cron.** Punctual and
   free, but another account, and it needs read access to the data repo (its
   own fine-grained token).

## Recommendation

Option 2: no new service, matches the existing sync design. Start with the
morning summary and due-task reminders.

## Open questions for the owner

- Go ahead at all, and with which sender (GitHub Action or Cloudflare Worker)?
- Which events notify: morning summary, due tasks, events starting, clip arrived?
- Quiet hours?
- An app icon: any preference?
