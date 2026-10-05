// Runs the unit tests in several time zones: date code that is right in one
// zone can be off by a day in another (UTC+14, UTC-11, DST zones).
//   node tests/run-tz.mjs
import { spawnSync } from 'node:child_process';

const ZONES = ['UTC', 'Europe/Sofia', 'America/Los_Angeles', 'Asia/Tokyo', 'Pacific/Kiritimati', 'Pacific/Pago_Pago'];
let failed = 0;
for (const tz of ZONES) {
  const r = spawnSync(process.execPath, ['--test', 'tests/unit.test.js'], { env: { ...process.env, TZ: tz }, encoding: 'utf8' });
  const ok = r.status === 0;
  if (!ok) failed++;
  console.log((ok ? 'ok   ' : 'FAIL ') + tz);
  if (!ok) console.log(r.stdout.split('\n').filter((l) => /^not ok|^\s+(error|expected|actual|location)|^\s+[+-] /.test(l)).join('\n'));
}
process.exit(failed ? 1 : 0);
