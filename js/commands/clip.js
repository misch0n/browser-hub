import { CLIP_TTL, CLIP_MAX, seal, unseal, isLive, expire, timeLeft } from '../core/clip.js';
import { plural } from '../core/util.js';

// clip: one piece of text shared between your devices for 15 minutes
// (core/clip.js). It is kept out of everything that lasts: the shared
// history, ↑ recall, undo, export and find.

const KEY = 'clip-key'; // this device's passphrase (store.getLocal)
const LOCAL = 'clip';   // a clip kept on this device only: { at, expires, text }

const replaceWith = (item) => (d) => {
  for (const k of Object.keys(d)) delete d[k];
  Object.assign(d, item);
};

// A time for a new clip or wipe: now, but always after the one it replaces,
// so it wins the merge even within the same millisecond.
function stamp(prev, now) {
  const t = Math.max(now().getTime(), (Date.parse((prev && prev.at) || '') || 0) + 1);
  return new Date(t);
}

// Wipes what has expired: this device's clip, and the shared one (which then
// syncs as wiped). Safe to call often.
export async function sweepClip(data, store, now) {
  const t = now();
  const local = store.getLocal(LOCAL);
  if (local && !isLive(local, t)) store.removeLocal(LOCAL);
  const shared = data.state.clip;
  const wiped = expire(shared, t);
  if (wiped !== shared) await data.mutate('clip', replaceWith(wiped), { record: false });
}

// The newest live clip: { item, text, from: 'here' | 'shared', locked? }, or null.
export async function currentClip(data, store, now) {
  const t = now();
  const local = store.getLocal(LOCAL);
  const shared = data.state.clip;
  const l = isLive(local, t) ? local : null;
  const s = isLive(shared, t) ? shared : null;
  if (l && (!s || l.at >= s.at)) return { item: l, text: l.text, from: 'here' };
  if (!s) return null;
  const pass = store.getLocal(KEY);
  if (!pass) return { item: s, text: null, from: 'shared', locked: 'no-key' };
  const text = await unseal(s, pass);
  return text === null ? { item: s, text: null, from: 'shared', locked: 'wrong-key' } : { item: s, text, from: 'shared' };
}

export default function register(add, { usage }) {
  add({
    name: 'clip', group: 'Share', noUndo: true, private: true, noHistory: true,
    desc: 'share one piece of text with your other devices, for 15 minutes, encrypted',
    usage: ['clip', 'clip <text>', 'clip add <text>', 'clip clear', 'clip key', 'clip key off'],
    examples: ['clip https://example.com/a/long/link', 'clip', 'clip clear', 'clip key'],
    complete: (prev) => (prev.length === 0 ? ['add', 'clear', 'key'].map((v) => ({ value: v })) : prev[0] === 'key' && prev.length === 1 ? [{ value: 'off' }] : []),
    async run(ctx, rest) {
      const { out, data, store, now } = ctx;
      const device = ctx.device || { id: 'here', name: 'this device' };
      const sync = ctx.sync && ctx.sync.config ? ctx.sync : null;
      await sweepClip(data, store, now);
      const m = /^(\S+)(?:\s+([\s\S]*))?$/.exec(rest.trim());
      const word = m ? m[1].toLowerCase() : '';

      // Gone from the screen, and from the copy button, once it expires.
      const shown = (text, item) => {
        if (/\n/.test(text)) out.code(text); else out.value(text);
        if (out.transient) out.transient(Date.parse(item.expires) - now().getTime(), text);
      };

      if (!rest.trim()) {
        const c = await currentClip(data, store, now);
        if (!c) {
          out.head([['The clipboard is empty', 'dim']]);
          out.line([['clip <text>', 'accent'], [' shares text with your other devices for 15 minutes', 'dim']]);
          if (!store.getLocal(KEY)) out.dim('clip key sets the passphrase that lets devices share it; until then clips stay on this device');
          return;
        }
        const from = c.item.device === device.id || c.from === 'here' ? 'this device' : c.item.deviceName || 'another device';
        if (c.locked) {
          out.head([['A clip from ' + from, 'strong'], [' · sealed · ' + timeLeft(c.item, now()) + ' left', 'dim']], 'warn');
          if (c.locked === 'no-key') out.line([['Run ', 'dim'], ['clip key', 'accent', { run: 'clip key' }], [' with the passphrase your other devices use', 'dim']]);
          else out.warn("this device's passphrase isn't the one it was sealed with · clip key sets it again");
          return;
        }
        out.head([['Clip', 'strong'], [' · from ' + from + ' · ' + timeLeft(c.item, now()) + ' left', 'dim'],
          [c.from === 'here' ? ' · this device only' : '', 'faint']]);
        shown(c.text, c.item);
        out.line([['clip clear', 'accent', { run: 'clip clear' }], [' wipes it now', 'faint']]);
        return;
      }

      if (word === 'clear' && !m[2]) {
        const had = !!(await currentClip(data, store, now));
        store.removeLocal(LOCAL);
        if (isLive(data.state.clip, now())) {
          await data.mutate('clip', replaceWith({ at: stamp(data.state.clip, now).toISOString(), cleared: true }), { record: false });
        }
        out.head(had ? [['Clip wiped', 'ok'], [sync ? ' · on every device, at their next sync' : '', 'dim']] : [['The clipboard was already empty', 'dim']], had ? 'ok' : null);
        return;
      }

      if (word === 'key') {
        const arg = (m[2] || '').trim().toLowerCase();
        if (arg === 'off' || arg === 'forget') {
          store.removeLocal(KEY);
          out.head([['Passphrase forgotten on this device', 'ok'], [' · clips from here stay here; shared ones can\'t be opened', 'dim']], 'ok');
          return;
        }
        if (arg) return usage(ctx, this);
        const pass = await ctx.askSecret('Clipboard passphrase, the same on each device (hidden)');
        if (!pass) return out.head('Cancelled; the passphrase is unchanged', 'dim');
        if (pass.length < 10) return out.err('Use at least 10 characters (a few words is easiest): the repository keeps the sealed clips, so a short passphrase could be guessed');
        store.setLocal(KEY, pass);
        out.head([['Passphrase saved on this device', 'ok'], [' · never synced or shown', 'dim']], 'ok');
        const s = data.state.clip;
        if (isLive(s, now()) && s.device !== device.id) {
          if ((await unseal(s, pass)) === null) out.warn('It does not open the clip from ' + (s.deviceName || 'another device') + ': is it the same passphrase?');
          else out.line([['It opens the clip from ' + (s.deviceName || 'another device') + ' · ', 'dim'], ['clip', 'accent', { run: 'clip' }]]);
        }
        if (!sync) out.dim('Sync is off, so clips stay on this device until it is set up (sync setup)');
        return;
      }

      const text = word === 'add' ? (m[2] || '') : rest.trim();
      if (!text.trim()) return usage(ctx, this);
      if (text.length > CLIP_MAX) return out.err('Too long to share: ' + text.length.toLocaleString('en') + ' characters (at most ' + CLIP_MAX.toLocaleString('en') + ')');
      const at = stamp(data.state.clip, now);
      const meta = { at: at.toISOString(), expires: new Date(at.getTime() + CLIP_TTL).toISOString(), device: device.id, deviceName: device.name };
      const pass = store.getLocal(KEY);
      const size = plural(text.length, 'character');
      if (!pass) {
        store.setLocal(LOCAL, { ...meta, text });
        out.head([['Clipped', 'ok'], [' · ' + size + ' · on this device only, for 15 minutes', 'dim']], 'ok');
        out.line([['clip key', 'accent', { run: 'clip key' }], [' sets a passphrase so your other devices get clips too', 'dim']]);
        return;
      }
      await data.mutate('clip', replaceWith(await seal(text, pass, meta)), { record: false });
      store.removeLocal(LOCAL);
      if (!sync) {
        out.head([['Clipped', 'ok'], [' · ' + size + ' · for 15 minutes', 'dim']], 'ok');
        out.dim('Sync is off, so your other devices won\'t get it (sync setup)');
        return;
      }
      try {
        await sync.syncNow();
        out.head([['Clipped', 'ok'], [' · ' + size + ' · sent sealed to your other devices · wiped in 15 minutes', 'dim']], 'ok');
      } catch (e) {
        out.head([['Clipped', 'ok'], [' · ' + size + ' · for 15 minutes', 'dim']], 'ok');
        out.warn('Not sent yet: ' + e.message);
      }
    },
  });
}
