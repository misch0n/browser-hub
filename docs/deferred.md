# Deferred

Things deliberately not done, with who decided and why, so nobody proposes
them again without new information. To revive one, ask the owner, then move
it to [todo.md](todo.md) (or write an [exploration](exploration/README.md) first).

## Deferred by the owner

| Idea | Decided | Owner's answer | Notes |
| --- | --- | --- | --- |
| Persistent storage request (`navigator.storage.persist()`) and an extra backup (e.g. a private Gist) | 5 Oct 2026 | "skip for now" | Sync to the private repo now covers backup. |
| Working hours per time zone (`tz hours nyc 08-16`) for the overlap view | 5 Oct 2026 | "defer" | Overlap still assumes 09:00–17:00 everywhere. |
| Custom domain / dedicated account for an isolated origin | 5 Oct 2026 | "not yet" | Security-relevant: see [security.md](security.md#origin-open-question). Kept as an open question in todo. |
| Sync with Apple Calendar, Reminders and Notes | 5 Oct 2026 | "dropping that feature for the time being… if it turns into a painpoint" | Options researched: [exploration/apple-sync.md](exploration/apple-sync.md). |
| `timer` / `pomodoro` / `stopwatch` with notifications | 5 Oct 2026 | "Easier on the phone but not a bad idea. Defer." | Browsers only fire timers reliably while the tab is open. |
| Internet-backed tools: weather widget, currency in `units`, GitHub PRs/issues (`gh prs`) | 5 Oct 2026 | "all. without the internet ones." | The network tools since widened the CSP (D10), so these are technically possible now; still not requested. |
| Notifications on iOS (Home Screen web app, Web Push) | 6 Oct 2026 | "Not now. Mark it for exploration." | [exploration/ios-notifications.md](exploration/ios-notifications.md). |

## Left out for technical reasons

- **Certificate checking.** `cert` decodes but doesn't verify signatures, chains
  or revocation: without the platform's trust store a page would be guessing,
  and a wrong "trusted" is worse than none.
- **Long RSA messages.** `crypt encrypt rsa` takes what one RSA-OAEP block holds
  (190 bytes with a 2048-bit key). More would need a hybrid format (an AES key
  wrapped with RSA) that only this hub could read.
- **Other key formats.** SEC1 `EC PRIVATE KEY` and passphrase-protected
  `ENCRYPTED PRIVATE KEY` files aren't read; `crypt` names the `openssl`
  command that converts them to PKCS#8.
- **WebSocket, raw TCP/UDP and ICMP.** `request` and `ping` only speak HTTP(S).
  Browsers allow nothing lower; a WebSocket check could come later.
- **Telling network failures apart.** A page can't tell DNS failure, a refused
  connection, a bad TLS certificate and a CORS refusal apart beyond the
  no-cors retry; `request` says so rather than guessing.
- **A device database for `ua`.** Models are named only when the string says
  so (Samsung, Pixel and a few others); reduced user agents hide the rest, and
  a full list would go stale.
- **Synced editor drafts.** The Mermaid editor's unsaved draft stays on the
  device (D13).
- **Geolocation without a third party.** `ip more` asks ipapi.co (free tier,
  daily limit); there's no offline alternative.
- **Recurring events.** Only tasks repeat (`every:`); events don't yet. Not
  requested; would reuse `core/repeat.js`.
- **Fresher nutrition data.** The table is USDA SR28 (2015). USDA's servers
  were unreachable from the build environment; `tools/build-nutrition.mjs` can
  rebuild from a newer export where they're reachable.
