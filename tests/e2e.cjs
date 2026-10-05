// Browser tests for the real page. Needs Playwright + Chromium:
//   NODE_PATH=$(npm root -g) node tests/e2e.cjs
// Starts its own static server; never touches the network (navigations are intercepted).
const http = require('http');
const fs = require('fs');
const path = require('path');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');

const root = path.join(__dirname, '..');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
const server = http.createServer((req, res) => {
  const file = path.join(root, req.url.split('?')[0] === '/' ? 'index.html' : req.url.split('?')[0]);
  if (!file.startsWith(root) || !fs.existsSync(file)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': types[path.extname(file)] || 'application/octet-stream' });
  res.end(fs.readFileSync(file));
});

let passed = 0;
async function check(name, fn) {
  try { await fn(); passed++; console.log('ok   ' + name); }
  catch (e) { console.log('FAIL ' + name + '\n     ' + String(e.message).split('\n').join('\n     ')); process.exitCode = 1; }
}

(async () => {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + server.address().port + '/';
  const browser = await chromium.launch({ executablePath: process.env.CHROME || undefined });
  const context = await browser.newContext({ acceptDownloads: true });
  const external = [];
  await context.route('**/*', (route) => {
    const u = route.request().url();
    if (u.startsWith(base)) return route.continue();
    external.push(u);
    return route.fulfill({ status: 200, contentType: 'text/html', body: '<title>external</title>external page' });
  });

  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(base);

  const prompt = page.locator('#prompt');
  const output = page.locator('#output');
  const type = async (s) => { await prompt.fill(''); await prompt.pressSequentially(s); };
  const send = async (s) => { await type(s); await page.keyboard.press('Enter'); await page.waitForTimeout(60); };
  const text = () => output.innerText();
  const focused = () => page.evaluate(() => document.activeElement && document.activeElement.id);

  await check('page loads with prompt focused and no console errors', async () => {
    assert.equal(await focused(), 'prompt');
    assert.match(await text(), /type 'help'/);
    assert.deepEqual(errors, []);
  });

  await check('CSP meta is present and blocks outbound connections', async () => {
    const csp = await page.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute('content');
    assert.match(csp, /connect-src 'none'/);
    const blocked = await page.evaluate(() => fetch('https://example.com/').then(() => false, () => true));
    assert.equal(blocked, true);
    // inline scripts must not run (the CSP has no 'unsafe-inline')
    const ran = await page.evaluate(() => new Promise((resolve) => {
      const s = document.createElement('script');
      s.textContent = 'window.__inlineRan = true';
      document.head.appendChild(s);
      setTimeout(() => resolve(window.__inlineRan === true), 50);
    }));
    assert.equal(ran, false);
  });

  await check('clicking the output returns focus to the prompt', async () => {
    await page.locator('body').click({ position: { x: 300, y: 200 } });
    assert.equal(await focused(), 'prompt');
  });

  await check('tasks, notes, events render via textContent (no HTML injection)', async () => {
    await send('n <img src=x onerror=window.pwned=1> hi');
    await send('notes');
    assert.match(await text(), /<img src=x onerror=window\.pwned=1> hi/);
    assert.equal(await page.evaluate(() => window.pwned), undefined);
    assert.equal(await page.locator('#output img').count(), 0);
  });

  await check('t / tasks / done work end to end', async () => {
    await send('t buy flour due:tomorrow #home');
    assert.match(await text(), /added t1 \(due \d{4}-\d\d-\d\d\)/);
    await send('tasks');
    assert.match(await text(), /t1\s+\[ \]\s+\d{4}-\d\d-\d\d\s+buy flour\s+#home/);
    await send('t done t1');
    assert.match(await text(), /done t1: buy flour/);
  });

  await check('ghost text, Tab: unique, common prefix, list; focus stays', async () => {
    await type('hel');
    assert.equal(await page.locator('#ghost-rest').innerText(), 'p');
    assert.equal(await page.locator('#ghost-typed').textContent(), 'hel');
    await page.keyboard.press('Tab');
    assert.equal(await prompt.inputValue(), 'help ');
    assert.equal(await focused(), 'prompt');
    await type('ca');
    await page.keyboard.press('Tab'); // cal, calc -> common prefix is 'cal'
    assert.equal(await prompt.inputValue(), 'cal');
    await page.keyboard.press('Tab');
    assert.match(await text(), /calc\s+arithmetic/);
    assert.equal(await focused(), 'prompt');
    await type('zzz');
    assert.equal(await page.locator('#ghost-rest').innerText(), '');
    await page.keyboard.press('Tab');
    assert.equal(await prompt.inputValue(), 'zzz');
    assert.equal(await focused(), 'prompt');
    await type('t d');
    await page.keyboard.press('Tab');
    assert.equal(await prompt.inputValue(), 't done ');
    await prompt.fill('');
  });

  await check('argument completion shows ids and text for t rm', async () => {
    await send('t second task');
    await type('t rm ');
    await page.keyboard.press('Tab'); // completes the common prefix 't'
    assert.equal(await prompt.inputValue(), 't rm t');
    await page.keyboard.press('Tab'); // no further progress: lists candidates
    assert.match(await text(), /t1\s+buy flour/);
    assert.match(await text(), /t2\s+second task/);
    await prompt.fill('');
  });

  await check('history with arrow keys, Esc clears', async () => {
    await send('calc 1+1');
    await prompt.focus();
    await page.keyboard.press('ArrowUp');
    assert.equal(await prompt.inputValue(), 'calc 1+1');
    await page.keyboard.press('ArrowUp');
    assert.equal(await prompt.inputValue(), 't second task');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    assert.equal(await prompt.inputValue(), '');
    await type('abc');
    await page.keyboard.press('Escape');
    assert.equal(await prompt.inputValue(), '');
  });

  await check('palette: / opens on empty prompt, fuzzy filter, Enter inserts, Esc closes', async () => {
    await prompt.fill('');
    await page.keyboard.press('/');
    assert.equal(await page.locator('#palette').isVisible(), true);
    assert.equal(await prompt.inputValue(), '');
    await page.keyboard.type('agd');
    assert.equal(await page.locator('#palette-list li.selected .name').innerText(), 'agenda');
    await page.keyboard.press('Enter');
    assert.equal(await page.locator('#palette').isVisible(), false);
    assert.equal(await prompt.inputValue(), 'agenda ');
    assert.equal(await focused(), 'prompt');
    await prompt.fill('');
    await page.keyboard.press('/');
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#palette').isVisible(), false);
    assert.equal(await focused(), 'prompt');
    await type('a/b'); // slash inside text must type normally
    assert.equal(await prompt.inputValue(), 'a/b');
    await prompt.fill('');
  });

  await check('search fallback and alias redirects navigate (with history saved first)', async () => {
    await send('vitosha weather');
    await page.waitForURL(/google\.com\/search/);
    assert.equal(external.at(-1), 'https://www.google.com/search?q=vitosha%20weather');
    await page.goBack();
    await page.waitForSelector('#prompt');
    assert.equal(await focused(), 'prompt');
    assert.equal(await prompt.inputValue(), '');
    await send('alias gh https://github.com/ https://github.com/{} --path');
    await send('gh org/repo');
    await page.waitForURL(/github\.com/);
    assert.equal(external.at(-1), 'https://github.com/org/repo');
    await page.goBack();
    await page.waitForSelector('#prompt');
    await prompt.focus();
    await page.keyboard.press('ArrowUp'); // history survived the navigation
    assert.equal(await prompt.inputValue(), 'gh org/repo');
    await page.keyboard.press('Escape');
    await send('g how to proof sourdough');
    await page.waitForURL(/google\.com/);
    assert.equal(external.at(-1), 'https://www.google.com/search?q=how%20to%20proof%20sourdough');
    await page.goBack();
    await page.waitForSelector('#prompt');
  });

  await check('javascript: aliases are rejected on define', async () => {
    await send('alias evil javascript:alert(1)');
    assert.match(await text(), /only http: and https:/);
    await send('alias evil2 https://a.com/ javascript:{}');
    assert.match(await text(), /template: only http/);
  });

  await check('multi-tab: a task added in one tab shows up in another without reload', async () => {
    const other = await context.newPage();
    await other.goto(base);
    await other.waitForSelector('#prompt');
    await page.bringToFront();
    await send('t from tab one');
    await other.bringToFront();
    await other.waitForTimeout(150);
    await other.locator('#prompt').fill('tasks');
    await other.keyboard.press('Enter');
    await other.waitForTimeout(100);
    assert.match(await other.locator('#output').innerText(), /from tab one/);
    // and ids do not collide when both tabs add
    await other.locator('#prompt').fill('t from tab two');
    await other.keyboard.press('Enter');
    await other.waitForTimeout(100);
    await page.bringToFront();
    await send('t from tab one again');
    const ids = await page.evaluate(async () => (await CC.store.createLocalStore().get('tasks')).items.map((t) => t.id));
    assert.equal(new Set(ids).size, ids.length);
    await other.close();
    await page.bringToFront();
  });

  await check('export, clear storage, import: all data comes back', async () => {
    await send('ev 2026-12-24 18:00 dinner');
    await send('tz add Asia/Tokyo');
    await send('engine default ddg');
    const before = await page.evaluate(async () => {
      const s = CC.store.createLocalStore();
      const o = {};
      for (const c of ['notes', 'tasks', 'events', 'aliases', 'settings']) o[c] = await s.get(c);
      return o;
    });
    const [download] = await Promise.all([page.waitForEvent('download'), send('export')]);
    assert.match(download.suggestedFilename(), /^control-center-\d{4}-\d\d-\d\d\.json$/);
    const file = path.join(require('os').tmpdir(), 'cc-export-' + process.pid + '.json');
    await download.saveAs(file);
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await page.waitForSelector('#prompt');
    await send('notes');
    assert.match(await text(), /no notes yet/);
    const [chooser] = await Promise.all([page.waitForEvent('filechooser', { timeout: 3000 }), send('import')]);
    await chooser.setFiles(file);
    await page.waitForFunction(() => /imported \d+ notes/.test(document.getElementById('output').innerText));
    const after = await page.evaluate(async () => {
      const s = CC.store.createLocalStore();
      const o = {};
      for (const c of ['notes', 'tasks', 'events', 'aliases', 'settings']) o[c] = await s.get(c);
      return o;
    });
    const strip = (o) => JSON.stringify({
      notes: o.notes.items.map((n) => n.text), tasks: o.tasks.items.map((t) => [t.text, t.due, t.tags, t.done]),
      events: o.events.items.map((e) => [e.date, e.time, e.title]),
      aliases: o.aliases.entries.map((e) => e.name).sort(), engine: o.aliases.defaultEngine, zones: o.settings.zones,
    });
    assert.equal(strip(after), strip(before));
    // importing the same file again reports collisions and never overwrites aliases
    const [chooser2] = await Promise.all([page.waitForEvent('filechooser', { timeout: 3000 }), send('import')]);
    await chooser2.setFiles(file);
    await page.waitForFunction(() => /skipped alias 'gh'.*already exists/.test(document.getElementById('output').innerText));
    fs.unlinkSync(file);
  });

  await check('ics import reads a local file', async () => {
    const f = path.join(require('os').tmpdir(), 'cc-' + process.pid + '.ics');
    fs.writeFileSync(f, 'BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nSUMMARY:Board meeting\r\nDTSTART:20270105T090000\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n');
    const [chooser] = await Promise.all([page.waitForEvent('filechooser', { timeout: 3000 }), send('ics import')]);
    await chooser.setFiles(f);
    await page.waitForFunction(() => /imported 1 event/.test(document.getElementById('output').innerText));
    await send('cal 2027-01');
    assert.match(await text(), /2027-01-05 09:00\s+Board meeting/);
    fs.unlinkSync(f);
  });

  await check('pageshow clears stale input and refocuses', async () => {
    await prompt.fill('stale');
    await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })));
    assert.equal(await prompt.inputValue(), '');
    assert.equal(await focused(), 'prompt');
  });

  await check('layout: prompt pinned to bottom, output scrolls', async () => {
    for (let i = 0; i < 40; i++) await send('calc ' + i);
    const m = await page.evaluate(() => {
      const o = document.getElementById('output'), p = document.getElementById('promptline');
      return { bottom: p.getBoundingClientRect().bottom, vh: innerHeight, scrolled: o.scrollTop > 0, atEnd: o.scrollHeight - o.scrollTop - o.clientHeight < 2 };
    });
    assert.ok(Math.abs(m.bottom - m.vh) < 2);
    assert.ok(m.scrolled && m.atEnd);
  });

  await check('no console errors during the whole run', async () => {
    assert.deepEqual(errors.filter((e) => !/Content Security Policy|Refused to (connect|evaluate)|Failed to fetch/i.test(e)), []);
  });

  await page.screenshot({ path: process.env.SHOT || path.join(require('os').tmpdir(), 'cc.png') });
  await browser.close();
  server.close();
  console.log(passed + ' browser checks passed' + (process.exitCode ? ' (with failures)' : ''));
})().catch((e) => { console.error(e); process.exit(1); });
