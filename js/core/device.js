// Who and where: every device has a fixed random id and a name (default
// "Mac · Chrome", "iPhone · Safari"; change it with config), kept on the
// device only. Your own name is a setting, the same on every device.
// The id marks what each device did, in the shared history.

import { detectOS } from './keys.js';

const OS_NAMES = { mac: 'Mac', ios: 'iPhone', windows: 'Windows', android: 'Android', linux: 'Linux', other: 'Browser' };

export function detectBrowser(nav) {
  const ua = String((nav && nav.userAgent) || '');
  if (/Edg\//.test(ua)) return 'Edge';
  if (/Firefox\/|FxiOS/.test(ua)) return 'Firefox';
  if (/OPR\//.test(ua)) return 'Opera';
  if (/Chrome\/|CriOS/.test(ua)) return 'Chrome';
  if (/Safari\//.test(ua)) return 'Safari';
  return '';
}

export function defaultDeviceName(nav) {
  const os = detectOS(nav);
  const ua = String((nav && nav.userAgent) || '');
  const what = os === 'ios' && /iPad/.test(ua) ? 'iPad' : OS_NAMES[os];
  const browser = detectBrowser(nav);
  return browser ? what + ' · ' + browser : what;
}

export function newDeviceId(random = Math.random) {
  let s = '';
  for (let i = 0; i < 8; i++) s += 'abcdefghijklmnopqrstuvwxyz0123456789'[Math.floor(random() * 36)];
  return s;
}

// This device, created on first use. store: getLocal/setLocal.
export function loadDevice(store, nav) {
  let d = store.getLocal('device');
  if (!d || typeof d.id !== 'string' || !d.id) {
    d = { id: newDeviceId(), name: defaultDeviceName(nav) };
    store.setLocal('device', d);
  }
  if (typeof d.name !== 'string' || !d.name.trim()) d.name = defaultDeviceName(nav);
  return d;
}
