import { bounceTarget, makeBounce, readBounce, goParam, newBounceKey } from '../lib/bounce.js';

// bounce: a link to this page that sends you on to another address
// (lib/bounce.js). The address travels inside the link; nothing is stored.

const DEFAULT_BASE = 'https://misch0n.github.io/browser-hub/';

export default function register(add, { st, usage }) {
  add({
    name: 'bounce', group: 'Share', desc: 'a link to this page that bounces to another address (the address travels inside it)',
    usage: ['bounce <url>', 'bounce <bounce link>'],
    examples: ['bounce https://example.com/a/rather/long/path?with=query', 'bounce ' + DEFAULT_BASE + '?go=…'],
    async run(ctx, rest) {
      const { out } = ctx;
      const base = ctx.pageURL || DEFAULT_BASE;
      const text = rest.trim();
      if (!text) {
        usage(ctx, this);
        out.dim('Opening the link here goes straight to the address on your devices; anyone else sees where it goes first and taps to continue');
        return;
      }
      const keys = st().settings.bounceKeys || [];

      // A bounce link: where does it go?
      const go = goParam(text, base);
      if (go !== null) {
        let r;
        try {
          r = await readBounce(go, keys);
        } catch (e) {
          return out.err('This bounce link is damaged: ' + e.message);
        }
        out.head([['Goes to ', ''], [new URL(r.url).host, 'strong']], r.signed ? 'ok' : 'warn');
        out.value(r.url);
        out.dim(r.signed ? 'Made with your key: it bounces straight away on your devices' : 'Not made with your key: it shows where it goes and waits for a tap');
        return;
      }

      const url = bounceTarget(text);
      if (!url) return out.err("'" + text + "' is not a web address (https://…, at most 2,000 characters)");
      let key = keys[0];
      if (!key) {
        key = newBounceKey();
        // Kept in the synced settings, so every device of yours trusts the links.
        await ctx.data.mutate('settings', (d) => { d.bounceKeys = [...(d.bounceKeys || []), key]; }, { record: false });
        key = st().settings.bounceKeys[0];
      }
      const link = await makeBounce(base, url, key);
      const diff = link.length - url.length;
      out.head([['Bounce link', 'strong'], [' to ' + new URL(url).host + ' · ' + link.length + ' characters', 'dim'],
        [diff < 0 ? ' (' + -diff + ' fewer than the address)' : '', 'ok']], 'ok');
      out.value(link);
      out.line([['On your devices it goes straight there; anyone else sees where it leads first · ', 'dim'], ['qr', 'accent', { run: 'qr ' + link }]]);
    },
  });
}
