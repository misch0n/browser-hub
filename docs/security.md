# Security

The hub holds personal notes, tasks and a GitHub token, on a public origin,
with code anyone can read. These rules keep that safe. Changing any of them
needs the owner's agreement and an entry in [decisions.md](decisions.md).

## The owner's rules (verbatim, non-negotiable)

1. **Sync token:** "we will store the key on-device only and if it is evicted
   or expires we need to renew."
   → `cc-device:sync-token`, never exported, synced, echoed or kept in history.
   Entered only through `ctx.askSecret` (masked input). A refused token pauses
   sync with a notice; `sync token` asks for a new one.
2. **Shared storage repo:** "I will be using a shared private repo for
   storage. make sure you save and read from a project scoped directory rather
   than assuming it's for this project exclusively."
   → only `<dir>/data.json` (default `browser-hub/`) is ever read or written;
   a `data.json` there that isn't the hub's is left alone; public repos are refused.
3. **Shared clipboard:** "handle the shared clipboard with care and not persist
   everything, just the last item and temporarily."
   → one item, 15 minutes, then wiped everywhere including the sync file;
   sealed with AES-GCM (key from a per-device passphrase via PBKDF2) before it
   reaches the repo; never in history, ↑, undo, find or export.

## Content Security Policy

GitHub Pages can't send headers, so the policy is a `<meta>` in `index.html`:

```
default-src 'self'; connect-src https: http://localhost:* http://127.0.0.1:*;
img-src 'self' blob:; object-src 'none'; base-uri 'none'
```

| Directive | Why |
| --- | --- |
| `default-src 'self'` | scripts, styles and everything else only from the site; no inline scripts or styles, no `eval` |
| `connect-src https: http://localhost:* http://127.0.0.1:*` | sync (`api.github.com`) and the network tools (`request`, `ping`, `dns`, `ip`), which by nature reach any host. Widened from `https://api.github.com` on 6 October 2026 ([decision](decisions.md)). Plain http only to this machine |
| `img-src 'self' blob:` | Mermaid drawings are shown as images from `blob:` URLs |
| `object-src 'none'`, `base-uri 'none'` | no plugins, no base-URL hijacking |

`mermaid-frame.html` has its own, stricter-for-network policy: inline styles
allowed (Mermaid needs them), `connect-src 'none'`, `form-action 'none'`.

The e2e check "CSP meta blocks outbound connections and inline scripts"
asserts the policy; update it deliberately, never to make a test pass.

## Rules for code

- Text reaches the DOM only through `textContent` (`js/ui/dom.js`). Never
  `innerHTML`, `eval`, `new Function` or inline handlers.
- Generated SVG is parsed as XML (barcodes) or shown as an `<img>` (Mermaid,
  rendered with `securityLevel: 'strict'` and no HTML labels), so nothing in
  it can run.
- Navigation only to `http:`/`https:` URLs (aliases are checked on define,
  edit, import and load; `main.js` checks again before `location.assign`).
- Links from outside can't change data: `?q=` runs aliases and searches, but
  built-in commands are only placed in the prompt to wait for Enter.
- Bounce links are signed with a key in synced settings; unsigned or foreign
  links show the destination and wait for a tap (no open redirect).
- Everything imported, synced or fetched is untrusted: shapes checked, sizes
  capped, bad entries skipped and reported.
- Secrets (tokens, passphrases, keys, plain text to encrypt) are asked for
  with `askSecret` and handled by commands flagged `private` + `noHistory`.
  They are never logged, stored, sent anywhere except their purpose, or put in errors.
- Network requests from tools use `credentials: 'omit'` and
  `referrerPolicy: 'no-referrer'`, and say which third party they ask (ipify,
  ipapi.co, Cloudflare/Google DNS).
- No personal data, tokens or keys in the repository. The test fixtures hold
  only throwaway certificates (no private keys).

## Origin (open question)

Every project site under `<user>.github.io` shares one origin and therefore
one `localStorage`. Another Pages project on the same account could read the
notes and the sync token. The fix is a custom domain or a dedicated GitHub
account/organisation for the hub. The owner was asked and said "not yet";
it stays open in [todo.md](todo.md#waiting-on-the-owner).
