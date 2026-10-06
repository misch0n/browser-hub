import { parseUA, uaSummary } from '../lib/ua.js';
import { deviceInfo, features } from '../lib/device.js';

// ua (read a user-agent string) and device (what this browser says about itself).

export default function register(add) {
  add({
    name: 'ua', group: 'Web', desc: 'read a user-agent string: browser, engine, system, device (yours by default)',
    usage: ['ua', 'ua <user-agent string>'],
    examples: ['ua', 'ua Mozilla/5.0 (iPhone; CPU iPhone OS 17_6 like Mac OS X) AppleWebKit/605.1.15 … Version/17.6 Mobile/15E148 Safari/604.1', 'ua curl/8.4.0'],
    async run(ctx, rest) {
      const { out } = ctx;
      const own = !rest.trim();
      const g = ctx.env || globalThis;
      const text = own ? (g.navigator && g.navigator.userAgent) || '' : (ctx.pasted && ctx.pasted.length === 1 ? ctx.pasted[0] : rest).trim();
      if (!text) return out.err('No user agent to read');
      const p = parseUA(text);
      out.head([[uaSummary(p), 'strong'], [own ? ' · this browser' : '', 'dim']]);
      const v = (x) => (x ? [[x, '']] : [['unknown', 'faint']]);
      const rows = [];
      if (p.bot) rows.push(['bot', [[p.bot.name + (p.bot.version ? ' ' + p.bot.version : ''), 'warn']]]);
      rows.push(
        ['browser', v(p.browser.name && p.browser.name + (p.browser.version ? ' ' + p.browser.version : ''))],
        ['engine', v(p.engine && p.engine.name && p.engine.name + (p.engine.version ? ' ' + p.engine.version : ''))],
        ['system', v(p.os && p.os.name && p.os.name + (p.os.version ? ' ' + p.os.version : ''))],
        ['device', v(p.device && p.device.type && [p.device.type, p.device.vendor, p.device.model].filter(Boolean).join(' · '))],
      );
      // The visitor's own browser may say more through client hints.
      if (own && g.navigator && g.navigator.userAgentData) {
        try {
          const hi = await g.navigator.userAgentData.getHighEntropyValues(['platformVersion', 'model', 'fullVersionList']);
          const brands = (hi.fullVersionList || []).filter((b) => !/Not.?A.?Brand/i.test(b.brand)).map((b) => b.brand + ' ' + b.version);
          if (brands.length) rows.push(['client hints', [[brands.join(', '), '']]]);
          if (hi.platform) {
            let ver = hi.platformVersion || '';
            if (hi.platform === 'Windows' && ver) ver = Number(ver.split('.')[0]) >= 13 ? '11' : '10';
            rows.push(['hinted system', [[hi.platform + (ver ? ' ' + ver : ''), '']]]);
          }
          if (hi.model) rows.push(['hinted model', [[hi.model, '']]]);
        } catch (e) { /* hints refused */ }
      }
      out.kv(rows);
      for (const n of p.notes) out.dim(n);
      out.section('The string');
      out.code(text);
    },
  });

  add({
    name: 'device', group: 'Web', desc: 'this browser and device: screen, window, input, language, hardware, network, features',
    usage: ['device', 'device features'],
    examples: ['device', 'device features'],
    complete: (prev) => (prev.length === 0 ? [{ value: 'features' }] : []),
    async run(ctx, rest) {
      const { out } = ctx;
      const g = ctx.env || globalThis;
      const only = rest.trim().toLowerCase();
      if (only && only !== 'features') return out.err('device, or device features');
      const f = features(g);
      if (only !== 'features') {
        const sections = await deviceInfo(g);
        const p = parseUA(g.navigator && g.navigator.userAgent);
        out.head([[uaSummary(p), 'strong'], [' · as this browser reports it', 'dim']]);
        for (const s of sections) {
          if (!s.rows.length) continue;
          out.section(s.title);
          out.kv(s.rows.map(([k, val, note]) => [k, [[val, ''], [note ? '  ' + note : '', 'faint']]]));
        }
      } else {
        out.head([['Web platform features', 'strong'], [' · ' + f.filter((x) => x.ok).length + ' of ' + f.length + ' here', 'dim']]);
      }
      out.section('Features');
      out.line([[f.filter((x) => x.ok).map((x) => '✓ ' + x.name).join('   '), 'ok']]);
      const missing = f.filter((x) => !x.ok);
      if (missing.length) out.line([[missing.map((x) => '✗ ' + x.name).join('   '), 'faint']]);
      out.dim('Read on this page; nothing is sent · ua reads user-agent strings · ip shows your public address');
    },
  });
}
