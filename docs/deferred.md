# Deferred

Things deliberately not done, with who decided and why, so nobody proposes
them again without new information. To revive one, ask the owner, then move
it to [todo.md](todo.md) (or write an [exploration](exploration/README.md) first).

## Deferred by the owner

| Idea | Decided | Owner's answer | Notes |
| --- | --- | --- | --- |
| An extra backup (e.g. a private Gist) and showing in the backup widget whether storage is persistent | 5 Oct 2026 | "skip for now" | Persistence is requested silently at start-up (`main.js`) and `device` shows whether it was granted; sync to the private repo covers backup. |
| Working hours per time zone (`tz hours nyc 08-16`) for the overlap view | 5 Oct 2026 | "defer" | Overlap still assumes 09:00–17:00 everywhere. |
| Custom domain / dedicated account for an isolated origin | 5 Oct, confirmed 6 Oct 2026 | "not yet", then "no separate domain for now" | Accepted risk, see [D15](decisions.md) and [security.md](security.md#origin-decided-shared-for-now). |
| Sync with Apple Calendar, Reminders and Notes | 5 Oct 2026 | "dropping that feature for the time being… if it turns into a painpoint" | Options researched: [exploration/apple-sync.md](exploration/apple-sync.md). |
| `pomodoro`, and timer notifications while the page is closed | 5 Oct 2026 | "Easier on the phone but not a bad idea. Defer." | Timers and stopwatches themselves were approved on 7 Oct 2026 (D21, Dev task); closed-page alerts depend on the iOS notifications research. |
| `holiday`: Bulgarian holidays read from почивнидни.com (`holiday`, `holiday <week>`, `holiday <month>`, `holiday year`) | 8 Oct 2026 | "putting holiday on hold for now. mark it as an implement later when details have been provided." | Implement once the owner provides the details. Known so far: the agent environment's network policy blocks the site, and it must allow cross-origin reads (test with `request https://xn--b1aekbb1acci5f.com`); otherwise the fallback is computing the Labour Code holidays, which misses declared bridge days. Fetched HTML is untrusted: `DOMParser`, validated, cached on the device. |
| `cook scale` (scale a recipe by servings) | 7 Oct 2026 | "cook scale is a yes. i have another project which handles scale work. we will reference from there. mark for later on." | Later, building on the owner's other project; ask them for it when starting. |
| `events export` to an `.ics` file (and sharing a note or task via the share sheet, proposed with it) | 6 Oct 2026 | "events export - defer" | The cheap end of [apple-sync](exploration/apple-sync.md). |
| Redirect chain in `request` (each hop's status and address) | 6 Oct 2026 | "keep it as today" | `request` shows the final address when redirected; browsers hide the hops unless every server allows it. |
| Internet-backed tools: weather widget, currency in `units`, GitHub PRs/issues (`gh prs`) | 5 Oct 2026 | "all. without the internet ones." | The network tools since widened the CSP (D10), so these are technically possible now; still not requested. |

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
- **Raw TCP/UDP and ICMP.** `request` and `ping` speak HTTP(S) (and soon
  WebSocket, a Dev task in [todo.md](todo.md#dev)); browsers allow nothing lower.
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
- **Fresher nutrition data.** The table is USDA SR28 (2015). USDA's servers
  were unreachable from the build environment; `tools/build-nutrition.mjs` can
  rebuild from a newer export where they're reachable.
