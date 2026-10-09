// Browser tests for the real page, against the deployable build. Needs
// `npm run setup` (Playwright, jsQR, ZXing) and Chromium; run: npm run test:e2e.
// Harness notes and gotchas: docs/testing.md.
// Starts its own static server; never touches the network (navigations are intercepted).
const http = require('http');
const fs = require('fs');
const path = require('path');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');

// Test the deployable build: the same cache-busting step the Pages workflow runs.
const root = fs.mkdtempSync(path.join(require('os').tmpdir(), 'cc-site-'));
require('child_process').execFileSync(process.execPath, ['tools/build-site.mjs', root, 'e2e'], { cwd: path.join(__dirname, '..'), stdio: 'ignore' });
const types = { '.xml': 'application/opensearchdescription+xml', '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
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
  const context = await browser.newContext({ acceptDownloads: true, viewport: { width: 1440, height: 900 } });
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const external = [];
  // GitHub's API, faked in memory for the sync tests (with CORS, as the real one has).
  const { fakeGitHub } = await import(require('url').pathToFileURL(path.join(__dirname, 'fake-github.mjs')).href);
  const gh = fakeGitHub({ tokens: ['tok-a', 'tok-b'], repos: { 'me/data': { private: true } } });
  const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'authorization, content-type, accept, x-github-api-version',
    'access-control-allow-methods': 'GET, PUT, OPTIONS' };
  const github = (route) => {
    const req = route.request();
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    const r = gh.handle(req.method(), req.url(), req.headers(), req.postData() || '');
    return route.fulfill({ status: r.status, headers: { ...cors, 'content-type': 'application/json' }, body: JSON.stringify(r.json) });
  };
  const routeAll = (ctx) => ctx.route('**/*', (route) => {
    const u = route.request().url();
    if (u.startsWith(base)) return route.continue();
    if (u.startsWith('https://api.github.com/')) return github(route);
    // The network tools' services, faked: DNS over HTTPS, ipify, and a CORS echo server.
    const json = (body) => route.fulfill({ status: 200, headers: { 'access-control-allow-origin': '*', 'content-type': 'application/json' }, body: JSON.stringify(body) });
    if (u.startsWith('https://cloudflare-dns.com/dns-query?')) {
      const q = new URL(u).searchParams;
      return json({ Status: 0, AD: false, Answer: q.get('type') === 'A' ? [{ name: q.get('name') + '.', type: 1, TTL: 300, data: '192.0.2.10' }] : [] });
    }
    if (u.startsWith('https://api.ipify.org')) return json({ ip: '198.51.100.23' });
    if (u.startsWith('https://api64.ipify.org')) return json({ ip: '2001:db8::23' });
    if (u.startsWith('https://echo.test/')) return json({ path: new URL(u).pathname, method: route.request().method() });
    // A server without CORS headers: fulfilled responses skip the browser's CORS check, so refuse the cors attempt (it carries Origin) here.
    if (u.startsWith('https://nocors.test/')) {
      return route.request().allHeaders().then((h) => (h.origin ? route.abort('failed') : route.fulfill({ status: 200, contentType: 'text/html', body: 'hidden' })));
    }
    external.push(u);
    return route.fulfill({ status: 200, contentType: 'text/html', body: '<title>external</title>external page' });
  });
  await routeAll(context);

  const page = await context.newPage();
  const unstamped = [];
  context.on('request', (r) => {
    const u = r.url();
    if (u.startsWith(base) && /\.(js|css)(\?|$)/.test(u) && !u.includes('?v=e2e')) unstamped.push(u);
  });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    // The browser logs every 4xx response; GitHub's 404 (no sync file yet) and
    // 401 (the revoked-token test) are expected answers, handled by the page; so
    // is the refused CORS attempt of the network test.
    if (m.type() === 'error' && !/^https:\/\/(api\.github\.com|nocors\.test)\//.test(m.location().url || '')) errors.push(m.text());
  });
  await page.goto(base);

  const prompt = page.locator('#prompt');
  const output = page.locator('#turns');
  const type = async (s) => { await prompt.fill(''); await prompt.pressSequentially(s); };
  const send = async (s) => { await type(s); await page.keyboard.press('Enter'); await page.waitForTimeout(60); };
  const text = () => output.innerText();
  const lastTurn = () => page.locator('#turns .turn').last();
  const lastText = () => lastTurn().innerText();
  const lastTone = () => lastTurn().locator('.reply').getAttribute('data-tone');
  const focused = () => page.evaluate(() => document.activeElement && document.activeElement.id);

  await check('page loads: welcome box, prompt focused, widgets shown, no console errors', async () => {
    assert.equal(await focused(), 'prompt');
    assert.match(await page.locator('.welcome').innerText(), /Control Center[\s\S]*help for commands/);
    assert.deepEqual(await page.locator('#widgets .widget').evaluateAll((els) => els.map((e) => e.dataset.widget)), ['clock', 'agenda', 'tasks']);
    assert.match(await page.locator('[data-widget=clock] .w-time').innerText(), /^\d\d:\d\d:\d\d$/);
    assert.deepEqual(errors, []);
  });

  await check('CSP meta blocks outbound connections and inline scripts', async () => {
    const csp = await page.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute('content');
    // https anywhere (sync, and the network tools), plain http only to this machine.
    assert.match(csp, /connect-src https: http:\/\/localhost:\* http:\/\/127\.0\.0\.1:\*;/);
    assert.equal(await page.evaluate(() => fetch('http://example.com/', { mode: 'no-cors' }).then(() => false, () => true)), true);
    const ran = await page.evaluate(() => new Promise((resolve) => {
      const s = document.createElement('script');
      s.textContent = 'window.__inlineRan = true';
      document.head.appendChild(s);
      setTimeout(() => resolve(window.__inlineRan === true), 50);
    }));
    assert.equal(ran, false);
  });

  await check('clicking the output returns focus to the prompt', async () => {
    await page.locator('#transcript').click({ position: { x: 300, y: 300 } });
    assert.equal(await focused(), 'prompt');
  });

  await check('stored text is rendered as text, never HTML', async () => {
    await send('n <img src=x onerror=window.pwned=1> hi');
    await send('notes');
    assert.match(await lastText(), /<img src=x onerror=window\.pwned=1> hi/);
    assert.equal(await page.evaluate(() => window.pwned), undefined);
    assert.equal(await page.locator('#turns img, #widgets img').count(), 0);
  });

  await check('replies are structured: echo, coloured bullet, head, connector body, table', async () => {
    await send('t buy flour due:tomorrow #home');
    assert.equal(await lastTone(), 'ok');
    assert.equal(await lastTurn().locator('.you-text').innerText(), 't buy flour due:tomorrow #home');
    assert.equal(await lastTurn().locator('.head').innerText(), 'Added task t1');
    await send('tasks');
    const t = lastTurn();
    assert.equal(await t.locator('.reply').evaluate((e) => e.classList.contains('has-head')), true);
    assert.deepEqual(await t.locator('.tbl th').allInnerTexts(), ['ID', '', 'DUE', 'TASK', 'TAGS']);
    assert.equal(await t.locator('.tbl td .t-tag').innerText(), '#home');
    assert.equal(await t.locator('.tbl td .t-info').innerText(), 'tomorrow');
    await send('t nope due:whenever');
    assert.equal(await lastTone(), 'err');
    const colours = await page.evaluate(() => {
      const c = (sel) => getComputedStyle(document.querySelector(sel)).color;
      return { err: c('#turns .turn:last-child .reply .bullet'), id: c('#turns .t-id') };
    });
    assert.notEqual(colours.err, colours.id);
  });

  await check('tasks widget updates live and its circle completes a task', async () => {
    await page.waitForFunction(() => /buy flour/.test(document.querySelector('[data-widget=tasks]').innerText));
    await page.locator('[data-widget=tasks] .w-check').first().click();
    await page.waitForFunction(() => /All done/.test(document.querySelector('[data-widget=tasks]').innerText));
    assert.match(await lastText(), /t done t1[\s\S]*Completed t1/);
    assert.equal(await focused(), 'prompt');
  });

  await check('ghost text, Tab, → accept; focus stays in the prompt', async () => {
    await type('hel');
    assert.equal(await page.locator('#ghost-rest').innerText(), 'p');
    assert.equal(await page.locator('#ghost-typed').textContent(), 'hel');
    assert.match(await page.locator('#hint').innerText(), /tab → help/);
    await page.keyboard.press('Tab');
    assert.equal(await prompt.inputValue(), 'help ');
    await type('ep');
    await page.keyboard.press('Tab');
    assert.equal(await prompt.inputValue(), 'epoch ');
    await type('cal');
    await page.keyboard.press('Tab');
    assert.equal(await prompt.inputValue(), 'cal');
    await page.keyboard.press('Tab');
    assert.match(await lastText(), /2 completions[\s\S]*calc/);
    await type('the');
    await page.keyboard.press('ArrowRight');
    assert.equal(await prompt.inputValue(), 'theme');
    await type('zzz');
    await page.keyboard.press('Tab');
    assert.equal(await prompt.inputValue(), 'zzz');
    assert.equal(await focused(), 'prompt');
    await prompt.fill('');
  });

  await check('live hint says what Enter will do', async () => {
    await type('calc 1+1');
    assert.match(await page.locator('#hint').innerText(), /calc · arithmetic/);
    await type('vitosha weather');
    assert.match(await page.locator('#hint').innerText(), /search google\.com \(default\) for “vitosha weather”/);
    await type('gtg');
    assert.match(await page.locator('#hint').innerText(), /search google\.com \(default\) for “gtg”/);
    await type('ddg x');
    assert.match(await page.locator('#hint').innerText(), /search duckduckgo\.com for “x”/);
    await type('g');
    assert.match(await page.locator('#hint').innerText(), /open https:\/\/www\.google\.com\//);
    await prompt.fill('');
  });

  await check('readline keys edit the prompt: Ctrl+A/E/W/U/K/Y, Alt+B', async () => {
    await type('gh org/repo issues');
    const caret = () => prompt.evaluate((el) => el.selectionStart);
    await page.keyboard.press('Control+a');
    assert.equal(await caret(), 0);
    assert.equal(await page.evaluate(() => getSelection().toString()), ''); // not select-all
    await page.keyboard.press('Control+e');
    assert.equal(await caret(), 18);
    await page.keyboard.press('Alt+b');
    assert.equal(await caret(), 12);
    await page.keyboard.press('Control+e');
    await page.keyboard.press('Control+w');
    assert.equal(await prompt.inputValue(), 'gh org/repo ');
    assert.match(await page.locator('#hint').innerText(), /for “gh org\/repo”/); // hint follows the edit
    await page.keyboard.press('Control+a');
    await page.keyboard.press('Control+k');
    assert.equal(await prompt.inputValue(), '');
    await page.keyboard.press('Control+y');
    assert.equal(await prompt.inputValue(), 'gh org/repo ');
    await page.keyboard.press('Control+u');
    assert.equal(await prompt.inputValue(), '');
    assert.equal(await focused(), 'prompt');
  });

  await check('pasting many lines: a placeholder; the cursor going in shows it; Enter runs the full text', async () => {
    // -> true when the page left the paste to the browser (a short one)
    const paste = (text) => prompt.evaluate((el, t) => {
      const dt = new DataTransfer();
      dt.setData('text/plain', t);
      return el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
    }, text);
    await type('n ');
    await paste('first line\nsecond line\nthird line');
    assert.equal(await prompt.inputValue(), 'n [Pasted text #1 +3 lines]');
    // Backspace right after it removes the whole paste.
    await page.keyboard.press('Backspace');
    assert.equal(await prompt.inputValue(), 'n ');
    await paste('first line\nsecond line\nthird line');
    const label = await prompt.inputValue();
    // Arrow into it: the text itself, line breaks as ⏎.
    await page.keyboard.press('ArrowLeft');
    await page.waitForFunction(() => document.getElementById('prompt').value !== '' && !/Pasted/.test(document.getElementById('prompt').value), null, { timeout: 2000 });
    assert.equal(await prompt.inputValue(), 'n first line⏎second line⏎third line');
    await page.keyboard.press('End');
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => /Added note/.test([...document.querySelectorAll('.turn')].pop().innerText));
    const note = await page.evaluate(() => JSON.parse(localStorage.getItem('cc:notes')).items.pop());
    assert.equal(note.text, 'first line\nsecond line\nthird line'); // real line breaks
    // Unexpanded: the transcript echoes the placeholder, the note gets the text.
    await type('n ');
    await paste('alpha\nbeta');
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => /Added note/.test([...document.querySelectorAll('.turn')].pop().innerText));
    assert.match(await page.locator('.you-text').last().textContent(), /^n \[Pasted text #\d+ \+2 lines\]$/);
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('cc:notes')).items.pop().text), 'alpha\nbeta');
    // Editing it in place keeps its line breaks (shown as ⏎).
    const nid = await page.evaluate(() => JSON.parse(localStorage.getItem('cc:notes')).items.pop().id);
    await send('notes ' + nid + ' edit');
    await page.waitForSelector('.turn:last-child .edit-input');
    assert.equal(await lastTurn().locator('.edit-input').inputValue(), 'alpha⏎beta');
    await lastTurn().locator('.edit-input').press('End');
    await lastTurn().locator('.edit-input').pressSequentially('⏎gamma');
    await lastTurn().locator('.edit-input').press('Enter');
    await page.waitForFunction(() => /Updated/.test([...document.querySelectorAll('.turn')].pop().innerText));
    assert.equal(await page.evaluate((i) => JSON.parse(localStorage.getItem('cc:notes')).items.find((n) => n.id === i).text, nid), 'alpha\nbeta\ngamma');
    // Short pastes go in as they are: the page leaves them to the browser.
    await type('');
    assert.equal(await paste('hello'), true);
    assert.equal(await prompt.inputValue(), '');
    assert.ok(label);
  });

  await check('developer tools: diff of two pastes, colour swatches, a JWT kept nowhere', async () => {
    const paste = (text) => prompt.evaluate((el, t) => {
      const dt = new DataTransfer();
      dt.setData('text/plain', t);
      return el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
    }, text);
    await type('diff ');
    await paste('one\ntwo\nthree');
    await prompt.pressSequentially(' ');
    await paste('one\n2\nthree');
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => /Differs/.test([...document.querySelectorAll('.turn')].pop().innerText));
    const lines = await lastTurn().locator('pre.code > div').allInnerTexts();
    assert.deepEqual(lines, ['  one', '- two', '+ 2', '  three']);
    assert.equal(await lastTurn().locator('pre.code > div').nth(1).locator('.t-err').count(), 1);
    await send('color #777 on #fff');
    assert.equal(await lastTurn().locator('.swatches svg rect').getAttribute('fill'), '#ffffff');
    assert.equal(await lastTurn().locator('.swatches svg text').getAttribute('fill'), '#777777');
    const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
    const token = b64({ alg: 'HS256' }) + '.' + b64({ sub: 'secret-subject' }) + '.sig';
    await send('jwt ' + token);
    assert.match(await lastText(), /secret-subject/);
    const kept = await page.evaluate(() => Object.keys(localStorage).map((k) => localStorage.getItem(k)).join('\n'));
    assert.ok(!kept.includes('secret-subject') && !kept.includes(token.slice(0, 20)));
    // The word list loads on demand (through a versioned URL, checked later); the passphrase is kept nowhere.
    await send('pw words');
    await page.waitForFunction(() => /New passphrase/.test([...document.querySelectorAll('.turn')].pop().innerText));
    const phrase = await lastTurn().locator('.value-text').textContent();
    assert.match(phrase, /^[a-z-]+(-[a-z-]+){5}$/);
    assert.ok(!(await page.evaluate(() => localStorage.getItem('cc:log'))).includes(phrase));
  });

  await check('history with arrows; Esc clears; ? shows shortcuts', async () => {
    await send('calc 1+1');
    await page.keyboard.press('ArrowUp');
    assert.equal(await prompt.inputValue(), 'calc 1+1');
    assert.match(await page.locator('#hint').innerText(), /history \d+\/\d+/);
    await page.keyboard.press('ArrowDown');
    assert.equal(await prompt.inputValue(), '');
    await type('abc');
    await page.keyboard.press('Escape');
    assert.equal(await prompt.inputValue(), '');
    await page.keyboard.press('?');
    assert.match(await lastText(), /Keyboard shortcuts[\s\S]*Ctrl\+R/);
    assert.equal(await prompt.inputValue(), '');
  });

  await check('palette: / opens, fuzzy filter, Enter inserts; themes run directly', async () => {
    await page.keyboard.press('/');
    assert.equal(await page.locator('#palette').isVisible(), true);
    await page.keyboard.type('agd');
    assert.equal(await page.locator('#palette-list li.selected .p-name').innerText(), 'agenda');
    await page.keyboard.press('Enter');
    assert.equal(await page.locator('#palette').isVisible(), false);
    assert.equal(await prompt.inputValue(), 'agenda ');
    await prompt.fill('');
    await page.keyboard.press('/');
    await page.keyboard.type('theme gruv');
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => document.documentElement.dataset.theme === 'gruvbox');
    await page.keyboard.press('/');
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#palette').isVisible(), false);
    assert.equal(await focused(), 'prompt');
    await type('a/b');
    assert.equal(await prompt.inputValue(), 'a/b');
    await prompt.fill('');
  });

  await check('themes: switch, colours change, survive reload without a flash', async () => {
    await send('theme nord');
    const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    assert.equal(bg, 'rgb(46, 52, 64)');
    await send('theme');
    assert.equal(await lastTurn().locator('.swatch').count(), 9);
    await page.reload();
    await page.waitForSelector('#prompt');
    // boot.js applies the stored theme before the module code runs
    assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), 'nord');
    await send('theme auto');
  });

  await check('widgets: toggle by command and by ×, hide and show the panel', async () => {
    await send('widgets add calendar');
    await page.waitForSelector('[data-widget=calendar] .cal td.today');
    await send('widgets zones on');
    await page.waitForSelector('[data-widget=zones]');
    const order = () => page.locator('#widgets .widget').evaluateAll((els) => els.map((e) => e.dataset.widget));
    assert.deepEqual(await order(), ['clock', 'agenda', 'tasks', 'calendar', 'zones']);
    await send('widgets zones move top');
    await page.waitForFunction(() => document.querySelector('#widgets .widget').dataset.widget === 'zones');
    assert.deepEqual(await order(), ['zones', 'clock', 'agenda', 'tasks', 'calendar']);
    await send('zones add Pacific/Kiritimati Kiri');
    await page.waitForFunction(() => /Kiri/.test(document.querySelector('[data-widget=zones]').innerText));
    const names = await page.locator('[data-widget=zones] .w-zone-name > span:first-child').allInnerTexts();
    assert.equal(names[names.length - 1], 'Kiri'); // UTC+14 is always the latest clock
    await send('zones kiri rm');
    await send('widgets zones move bottom');
    await page.locator('[data-widget=zones]').hover();
    await page.locator('[data-widget=zones] .w-close').click();
    await page.waitForFunction(() => !document.querySelector('[data-widget=zones]'));
    await send('widgets hide');
    assert.equal(await page.locator('#panel').isVisible(), false);
    const w = await page.evaluate(() => document.getElementById('main').getBoundingClientRect().width);
    assert.ok(w > 1200);
    await page.locator('#panel-toggle').click();
    await page.waitForFunction(() => getComputedStyle(document.getElementById('panel')).display !== 'none');
  });

  await check('search fallback and alias redirects navigate (history saved first)', async () => {
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
    await page.keyboard.press('ArrowUp');
    assert.equal(await prompt.inputValue(), 'gh org/repo');
    await page.keyboard.press('Escape');
  });

  await check('a page opened from the prompt waits a second; Esc cancels it; command aliases run and show in help', async () => {
    // Waits: nothing has opened half a second in, the hint says how to stop it.
    const before = external.length;
    await type('gh wait/here');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(400);
    assert.equal(external.length, before);
    assert.match(await page.locator('#hint').innerText(), /opening github\.com in 1 s\s+esc cancels/);
    await page.waitForURL(/github\.com\/wait\/here/, { timeout: 3000 });
    await page.goBack();
    await page.waitForSelector('#prompt');
    // Esc in time: it stays here, and the turn says so (kept in the history).
    const n = external.length;
    await type('vitosha weather');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(200);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(1300);
    assert.equal(external.length, n);
    assert.match(await lastText(), /Cancelled: google\.com not opened/);
    // A command alias runs its command; the turn shows what ran.
    await send('alias groc tasks add {} #groceries');
    assert.match(await page.locator('#hint').innerText(), /^(?![\s\S]*opening)/);
    await type('groc oat milk');
    assert.match(await page.locator('#hint').innerText(), /your command alias groc\s+↵ runs tasks add oat milk #groceries/);
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => /Added task/.test([...document.querySelectorAll('.turn')].pop().innerText));
    assert.match(await lastText(), /Added task[\s\S]*→ tasks add oat milk #groceries/);
    // Help: short names and your aliases after the command, one row.
    await send('help');
    const row = await page.locator('#turns .turn').last().locator('tr', { hasText: 'groc' }).first().innerText();
    assert.match(row, /^tasks, t, groc↗/);
    // From the address bar it is only put in the prompt, like any built-in: a link can't add a task.
    const tasksBefore = await page.evaluate(() => JSON.parse(localStorage.getItem('cc:tasks')).items.length);
    await page.goto(base + '?q=groc%20bread');
    await page.waitForFunction(() => document.getElementById('prompt').value === 'groc bread');
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('cc:tasks')).items.length), tasksBefore);
    await prompt.fill('');
    await send('aliases groc rm');
  });

  await check('go <url>: any address opens like an alias (after the wait), Esc cancels, ↑ and Back find it', async () => {
    await type('go example.com/went-there');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(300);
    assert.match(await page.locator('#hint').innerText(), /opening example\.com in 1 s\s+esc cancels/);
    await page.waitForURL(/example\.com\/went-there/, { timeout: 3000 });
    assert.equal(external.at(-1), 'https://example.com/went-there');
    await page.goBack();
    await page.waitForSelector('#prompt');
    await page.keyboard.press('ArrowUp');
    assert.equal(await prompt.inputValue(), 'go example.com/went-there');
    const n = external.length;
    await type('go example.org/not-now');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(200);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(1300);
    assert.equal(external.length, n);
    assert.match(await lastText(), /Cancelled: example\.org not opened/);
    await send('go javascript:alert(1)');
    assert.match(await lastText(), /Only http and https addresses open from here/);
    // Tab completes from addresses opened before.
    await type('go example.c');
    await page.keyboard.press('Tab');
    assert.equal(await prompt.inputValue(), 'go example.com/went-there ');
    await prompt.fill('');
  });

  await check('snippets copy; later saves links and opens one once it is in the history', async () => {
    await send('snip sig Cheers, M');
    await send('snippets');
    await lastTurn().locator('tr.tr-run').first().click();
    await page.waitForFunction(() => /Cheers, M/.test([...document.querySelectorAll('.turn')].pop().querySelector('.value-text')?.textContent || ''));
    await send('later example.com/read-me Read me');
    await send('later');
    assert.match(await lastText(), /1 link to read[\s\S]*Read me/);
    await send('later l1 open');
    await page.waitForURL(/example\.com\/read-me/);
    assert.equal(external.at(-1), 'https://example.com/read-me');
    await page.goBack();
    await page.waitForSelector('#prompt');
    const log = await page.evaluate(() => JSON.parse(localStorage.getItem('cc:log')).entries.map((e) => e.input));
    assert.ok(log.includes('later l1 open'));
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('cc:later')).items[0].read), true);
  });

  await check('bounce: your link goes straight there; elsewhere it shows the target and waits; damaged ones say so', async () => {
    await send('bounce example.com/bounced?x=1');
    const link = await lastTurn().locator('.value-text').textContent();
    assert.ok(link.startsWith(base + '?go='));
    // This device made it: straight to the target, and Back skips the bounce page.
    await page.goto(link);
    await page.waitForURL('https://example.com/bounced?x=1');
    assert.equal(external.at(-1), 'https://example.com/bounced?x=1');
    await page.goBack();
    await page.waitForSelector('#prompt');
    assert.equal(new URL(page.url()).search, '');
    // Someone else's browser: no key, so it shows where it goes and waits for a tap.
    const stranger = await browser.newContext();
    await routeAll(stranger);
    const s = await stranger.newPage();
    await s.goto(link);
    await s.waitForSelector('.bounce-continue');
    assert.match(await s.locator('.turn.notice').last().innerText(), /This link goes to example\.com[\s\S]*https:\/\/example\.com\/bounced\?x=1/);
    assert.equal(new URL(s.url()).search, ''); // the ?go= is gone from the address bar
    await s.waitForTimeout(500);
    assert.ok(!s.url().startsWith('https://example.com')); // no automatic jump
    await s.locator('.bounce-continue').click();
    await s.waitForURL('https://example.com/bounced?x=1');
    // Damaged.
    await s.goto(base + '?go=x!!');
    await s.waitForFunction(() => /This bounce link is damaged/.test(document.getElementById('turns').innerText));
    await stranger.close();
  });

  await check('cook: tap a food in the table for its details; oven and convert answer in place', async () => {
    await send('cook target');
    await lastTurn().locator('tr.tr-run', { hasText: 'Burgers' }).click();
    await page.waitForFunction(() => /cook target ground-meat/.test([...document.querySelectorAll('.turn .you-text')].pop().textContent));
    assert.match(await lastText(), /safe\s+71°C \(160°F\)[\s\S]*no pink burgers/);
    assert.equal(await lastTone(), 'warn');
    await send('cook oven whole chicken 1.6kg');
    assert.match(await lastText(), /about 1 h 25 min/);
    await send('cook convert 1 spoon sugar');
    assert.match(await lastText(), /1 tablespoon sugar = 12\.5 g/);
    // Calories: the table loads on demand (through a versioned URL); a row opens the food.
    await send('cook calorie chicken breast');
    await page.waitForFunction(() => /6 foods for "chicken breast"/.test([...document.querySelectorAll('.turn')].pop().innerText));
    await lastTurn().locator('tr.tr-run').first().click();
    await page.waitForFunction(() => /cook calorie 05062/.test([...document.querySelectorAll('.turn .you-text')].pop().textContent));
    await page.waitForFunction(() => /energy\s+120 kcal/.test([...document.querySelectorAll('.turn')].pop().innerText));
    assert.match(await lastText(), /Minerals[\s\S]*selenium[\s\S]*Vitamins[\s\S]*niacin/);    // Your own food: added, edited in place, counted by its portion in a meal.
    await send('cook calorie add "oat bar" kcal 190 protein 4 fat 7 carbs 27 per 1 bar = 45 g');
    assert.match(await lastText(), /Added food f\d+ · oat bar/);
    const fid = (await lastText()).match(/Added food (f\d+)/)[1];
    await send('cook calorie ' + fid);
    await lastTurn().locator('button.editable').nth(1).click();
    await lastTurn().locator('.edit-input').fill('400');
    await lastTurn().locator('.edit-input').press('Enter');
    await page.waitForFunction((id) => new RegExp('^cook calorie ' + id + ' edit kcal 400$').test([...document.querySelectorAll('.turn .you-text')].pop().textContent), fid);
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('cc:foods')).items.pop().kcal), 400);
    await send('cook calorie 2 bars oat bar + a banana');
    await page.waitForFunction(() => /Meal · 2 items/.test([...document.querySelectorAll('.turn')].pop().innerText));
    assert.match(await lastText(), /2 × 1 bar · 90 g[\s\S]*1 medium · 118 g[\s\S]*Total\s+465/);
  });

  await check('roll: one of each die, tap a die to roll it again; random numbers', async () => {
    await send('roll');
    assert.equal(await lastTurn().locator('tr.tr-run').count(), 7);
    await lastTurn().locator('tr.tr-run', { hasText: 'd20' }).click();
    await page.waitForFunction(() => /^roll d20$/.test([...document.querySelectorAll('.turn .you-text')].pop().textContent));
    assert.match(await lastText(), /d20 = \d+/);
    await send('random 1-49 x6 unique');
    assert.match(await lastTurn().locator('.value-text').textContent(), /^(\d+, ){5}\d+$/);
  });

  await check('help is for now: shown, recalled with ↑, kept out of the shared history, gone after the next command or ×', async () => {
    await send('help');
    assert.equal(await lastTurn().getAttribute('class'), 'turn ephemeral');
    assert.match(await lastText(), /⚙ built-in/);
    await send('calc 2+2');
    assert.equal(await page.locator('article.turn.ephemeral').count(), 0);
    const log = await page.evaluate(() => JSON.parse(localStorage.getItem('cc:log')).entries.map((e) => e.input));
    assert.ok(!log.includes('help') && log.includes('calc 2+2'));
    await prompt.fill('');
    await page.keyboard.press('ArrowUp');
    await page.keyboard.press('ArrowUp');
    assert.equal(await prompt.inputValue(), 'help');
    await page.keyboard.press('Escape');
    await send('keys');
    await lastTurn().locator('.turn-close').click();
    assert.equal(await page.locator('article.turn.ephemeral').count(), 0);
    assert.equal(await focused(), 'prompt');
  });

  await check('help: by category, tap a command for its full help; a Tab list goes as soon as you type', async () => {
    await send('help');
    assert.match(await lastText(), /Tools\s+⚙ built-in/);
    await lastTurn().locator('tr.tr-run', { hasText: /^roll/ }).first().click();
    await page.waitForFunction(() => /^help roll$/.test([...document.querySelectorAll('.turn .you-text')].pop().textContent));
    assert.match(await lastText(), /roll · roll dice[\s\S]*Usage[\s\S]*roll d20 adv/);
    assert.equal(await page.locator('article.turn.ephemeral').count(), 1); // the overview left when help roll ran
    // A command without what it needs shows its full help.
    await send('qr');
    assert.match(await lastText(), /Usage · qr[\s\S]*a QR code for text[\s\S]*Examples/);
    await type('ca');
    await page.keyboard.press('Tab');
    await page.waitForSelector('article.turn.completions');
    await page.keyboard.type('l');
    assert.equal(await page.locator('article.turn.completions').count(), 0);
    await prompt.fill('');
  });

  await check('json tree folds; csv sorts by column and filters; jwt verifies with a pasted key', async () => {
    await send('json tree {"user":{"name":"Ana","tags":["a","b"],"age":30,"admin":false,"pet":null}}');
    const tree = lastTurn().locator('.jt');
    assert.equal(await tree.locator('details[open]').count(), 2);
    assert.equal(await tree.locator('.t-num').first().textContent(), '30');
    assert.equal(await tree.locator('.t-faint', { hasText: 'null' }).count(), 1);
    await tree.locator('details details > summary').first().click(); // fold "user"
    assert.equal(await tree.locator('details[open]').count(), 1);
    const paste = (text) => prompt.evaluate((el, t) => {
      const dt = new DataTransfer();
      dt.setData('text/plain', t);
      return el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
    }, text);
    await type('csv ');
    await paste('name;age;city\nbob;30;Sofia\nalice;25;Varna\ncarol;41;Ruse');
    await page.keyboard.press('Enter');
    await page.waitForSelector('article.turn:last-child .dt');
    const t = lastTurn();
    assert.match(await t.innerText(), /3 rows × 3 columns · semicolon-separated/);
    const col = (i) => t.locator('tbody tr td:nth-child(' + i + ')').allInnerTexts();
    await t.locator('th', { hasText: 'age' }).click();
    assert.deepEqual(await col(2), ['25', '30', '41']);
    await t.locator('th', { hasText: 'age' }).click();
    assert.deepEqual(await col(2), ['41', '30', '25']);
    await t.locator('.dt-filter').fill('car');
    assert.deepEqual(await col(1), ['carol']);
    assert.match(await t.locator('.dt-count').textContent(), /1 of 3 rows/);
    // A token signed with a key pair; the public key pasted after it.
    const { publicKey, privateKey } = require('crypto').generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    const b64 = (x) => Buffer.from(x).toString('base64url');
    const input = b64(JSON.stringify({ alg: 'ES256', typ: 'JWT' })) + '.' + b64(JSON.stringify({ sub: 'e2e' }));
    const token = input + '.' + b64(require('crypto').sign('sha256', Buffer.from(input), { key: privateKey, dsaEncoding: 'ieee-p1363' }));
    await prompt.focus();
    await type('jwt verify ' + token + ' ');
    await paste(publicKey.export({ type: 'spki', format: 'pem' }));
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => /Signature valid/.test([...document.querySelectorAll('.turn')].pop().innerText));
    assert.match(await lastText(), /✓ Signature valid · ES256/);
  });

  await check('crypt: passphrase asked twice, hidden; the envelope decrypts; cert, ua and device read here', async () => {
    const paste = (text) => prompt.evaluate((el, t) => {
      const dt = new DataTransfer();
      dt.setData('text/plain', t);
      return el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
    }, text);
    const answer = async (secret) => {
      await page.waitForFunction(() => document.getElementById('prompt').type === 'password');
      await prompt.pressSequentially(secret);
      await page.keyboard.press('Enter');
    };
    await type('crypt encrypt the plan is secret');
    await page.keyboard.press('Enter');
    await answer('hunter22');
    await answer('hunter22');
    await page.waitForFunction(() => /Encrypted/.test([...document.querySelectorAll('.turn')].pop().innerText), null, { timeout: 10000 });
    const envelope = await lastTurn().locator('.value-text').textContent();
    assert.match(envelope, /^ccx1\.gcm\.210000\./);
    await type('crypt decrypt ' + envelope);
    await page.keyboard.press('Enter');
    await answer('hunter22');
    await page.waitForFunction(() => /Decrypted/.test([...document.querySelectorAll('.turn')].pop().innerText), null, { timeout: 10000 });
    assert.equal(await lastTurn().locator('.value-text').textContent(), 'the plan is secret');
    const kept = await page.evaluate(() => Object.keys(localStorage).map((k) => localStorage.getItem(k)).join('\n'));
    assert.ok(!kept.includes('hunter22') && !kept.includes('the plan is secret') && !kept.includes(envelope.slice(0, 30)));
    // cert: a pasted certificate.
    await prompt.focus();
    await type('cert ');
    await paste(fs.readFileSync(path.join(__dirname, 'fixtures/x509/ec-leaf.pem'), 'utf8'));
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => /SHA-256/.test([...document.querySelectorAll('.turn')].pop().innerText));
    assert.match(await lastText(), /leaf\.example\.test · certificate · valid/);
    assert.match(await lastText(), /EC P-256/);
    await send('ua');
    assert.match(await lastText(), /Chrome \d+[\s\S]*this browser[\s\S]*engine\s+Blink/);
    await send('device');
    await page.waitForFunction(() => /Features/.test([...document.querySelectorAll('.turn')].pop().innerText));
    assert.match(await lastText(), /window\s+1440 × 900/);
    assert.match(await lastText(), /✓ Web Crypto/);
  });

  await check('network: request reads a CORS answer, says when one is hidden; dns over HTTPS; ip', async () => {
    await send('request https://echo.test/zen');
    await page.waitForFunction(() => /CORS/.test([...document.querySelectorAll('.turn')].pop().innerText), null, { timeout: 10000 });
    assert.match(await lastText(), /^200/m);
    assert.match(await lastText(), /"path": "\/zen"/);
    assert.equal(await lastTone(), 'ok');
    await send('request nocors.test');
    await page.waitForFunction(() => /Reachable|Unreachable/.test([...document.querySelectorAll('.turn')].pop().innerText), null, { timeout: 10000 });
    assert.match(await lastText(), /Reachable[\s\S]*doesn’t let pages from other sites read the answer/);
    await send('request example.com port 25');
    assert.match(await lastText(), /port 25 \(SMTP\) is on the browsers’ blocked list/);
    await send('dns example.com a');
    await page.waitForFunction(() => /192\.0\.2\.10/.test([...document.querySelectorAll('.turn')].pop().innerText), null, { timeout: 10000 });
    assert.match(await lastText(), /example\.com · 1 record · Cloudflare/);
    await send('ip');
    await page.waitForFunction(() => /198\.51\.100\.23/.test([...document.querySelectorAll('.turn')].pop().innerText), null, { timeout: 10000 });
    assert.match(await lastText(), /IPv6\s+2001:db8::23/);
    assert.ok(!(await page.evaluate(() => localStorage.getItem('cc:log') || '')).includes('198.51.100.23'));
  });

  await check('font: bigger and smaller on this device, applied before the first paint', async () => {
    const size = () => page.evaluate(() => parseFloat(getComputedStyle(document.body).fontSize));
    const before = await size();
    await send('font 150%');
    assert.equal(await size(), before * 1.5);
    await page.reload();
    await page.waitForSelector('#prompt');
    assert.equal(await page.evaluate(() => document.documentElement.style.getPropertyValue('--scale')), '1.5');
    assert.equal(await size(), before * 1.5);
    await send('font smaller');
    assert.equal(await size(), Math.round(before * 1.35 * 100) / 100);
    await send('font reset');
    assert.equal(await size(), before);
    assert.equal(await page.evaluate(() => localStorage.getItem('cc-device:fontScale')), null);
  });

  await check('address bar: ?q= opens aliases and searches; built-ins are only pre-filled', async () => {
    assert.match(await page.locator('link[rel=search]').getAttribute('href'), /^opensearch\.xml/);
    const xml = fs.readFileSync(path.join(root, 'opensearch.xml'), 'utf8'); // the built copy
    assert.match(xml, /template="https:\/\/[^"]+\?q=\{searchTerms\}"/);
    await page.goto(base + '?q=' + encodeURIComponent('gh org/x y'));
    await page.waitForURL(/github\.com/);
    assert.equal(external.at(-1), 'https://github.com/org/x%20y');
    await page.goto(base + '?q=' + encodeURIComponent('some words'));
    await page.waitForURL(/google\.com/);
    assert.equal(external.at(-1), 'https://www.google.com/search?q=some%20words');
    // A link from anywhere must not be able to change data: built-ins wait for Enter.
    await page.goto(base + '?q=' + encodeURIComponent('t from a link'));
    await page.waitForSelector('#prompt');
    assert.equal(await prompt.inputValue(), 't from a link');
    assert.match(await page.locator('#turns').innerText(), /press Enter to run it/);
    assert.equal(await page.evaluate(() => location.search), ''); // reload won't repeat it
    const count = () => page.evaluate(() => JSON.parse(localStorage.getItem('cc:tasks') || '{"items":[]}').items.filter((t) => t.text === 'from a link').length);
    assert.equal(await count(), 0);
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => /Added task/.test(document.getElementById('turns').innerText));
    assert.equal(await count(), 1);
    await send('t rm ' + (await page.evaluate(() => JSON.parse(localStorage.getItem('cc:tasks')).items.find((t) => t.text === 'from a link').id)));
  });

  await check('hybrid editing: ids link to their entry, values change in place as commands', async () => {
    await send('t water the plants due:tomorrow #home');
    const id = await page.evaluate(() => JSON.parse(localStorage.getItem('cc:tasks')).items.find((t) => t.text === 'water the plants').id);
    await send('tasks');
    await lastTurn().locator('.seg-run', { hasText: id }).click();
    await page.waitForFunction(() => /^tasks t\d+$/.test([...document.querySelectorAll('.you-text')].pop().textContent));
    assert.match(await lastText(), new RegExp('task ' + id));
    // Tap the text, change it, Enter: runs the edit command, which shows in the transcript.
    await lastTurn().locator('.fields .editable').first().click();
    const box = lastTurn().locator('.edit-input');
    assert.equal(await box.inputValue(), 'water the plants');
    await box.fill('water the  garden');
    await box.press('Enter');
    await page.waitForFunction(() => /Updated/.test([...document.querySelectorAll('.turn')].pop().innerText));
    assert.equal(await page.locator('.you-text').last().textContent(), 'tasks ' + id + ' edit text water the  garden');
    const task = () => page.evaluate((i) => JSON.parse(localStorage.getItem('cc:tasks')).items.find((t) => t.id === i), id);
    assert.equal((await task()).text, 'water the  garden');
    // Esc cancels: nothing runs.
    const turns = await page.locator('.turn').count();
    await lastTurn().locator('.fields .editable').nth(1).click();
    await lastTurn().locator('.edit-input').fill('fri');
    await lastTurn().locator('.edit-input').press('Escape');
    assert.equal(await page.locator('.turn').count(), turns);
    assert.equal(await lastTurn().locator('.edit-input').count(), 0);
    // Values that need quotes get them.
    await lastTurn().locator('.fields .editable').first().click();
    await lastTurn().locator('.edit-input').fill('  lead ');
    await lastTurn().locator('.edit-input').press('Enter');
    await page.waitForFunction(() => /Updated/.test([...document.querySelectorAll('.turn')].pop().innerText));
    assert.equal(await page.locator('.you-text').last().textContent(), 'tasks ' + id + ' edit text "  lead "');
    // tasks <id> edit: edit in place, the first field already open.
    await send('tasks ' + id + ' edit');
    await page.waitForSelector('.turn:last-child .edit-input');
    assert.equal(await lastTurn().locator('.edit-input').inputValue(), 'lead'); // text is stored trimmed
    await page.keyboard.press('Escape');
    await send('tasks ' + id + ' rm');
    assert.equal(await focused(), 'prompt');
  });

  await check('undo: a removal offers undo, which brings it back; redo takes it away again', async () => {
    await send('n keep me safe');
    const id = await page.evaluate(() => JSON.parse(localStorage.getItem('cc:notes')).items.find((n) => n.text === 'keep me safe').id);
    await send('n rm ' + id);
    const has = () => page.evaluate((i) => JSON.parse(localStorage.getItem('cc:notes')).items.some((n) => n.id === i), id);
    assert.equal(await has(), false);
    await lastTurn().locator('.seg-run', { hasText: 'undo' }).click();
    await page.waitForFunction(() => /Undid/.test([...document.querySelectorAll('.turn')].pop().innerText));
    assert.equal(await has(), true);
    await send('redo');
    assert.equal(await has(), false);
    await send('undo');
    assert.equal(await has(), true);
    await send('n rm ' + id);
  });

  await check('tapping anywhere on a list row opens that item', async () => {
    await send('n a note to open by its row');
    await send('notes');
    const id = await page.evaluate(() => JSON.parse(localStorage.getItem('cc:notes')).items.find((n) => n.text === 'a note to open by its row').id);
    await lastTurn().locator('tr.tr-run', { hasText: 'a note to open by its row' }).locator('td').last().click(); // the text, not the id
    await page.waitForFunction((i) => [...document.querySelectorAll('.you-text')].pop().textContent === 'notes ' + i, id);
    assert.match(await lastText(), /a note to open by its row/);
    await send('notes ' + id + ' rm');
  });

  await check('visual history: kept across reloads, other devices tagged, session views, clear and undo', async () => {
    await send('calc 6*7');
    // What another device did, as sync would bring it in.
    await page.evaluate(() => {
      const log = JSON.parse(localStorage.getItem('cc:log'));
      const last = log.entries.map((e) => e.at).sort().pop();
      log.entries.push({ id: 'phone-1', at: new Date(Date.parse(last) + 5).toISOString(), device: 'phone', deviceName: 'iPhone · Safari',
        input: 'n from the phone', ops: [['head', [['Added note ', ''], ['n99', 'id']], 'ok']] });
      localStorage.setItem('cc:log', JSON.stringify(log));
    });
    await page.reload();
    await page.waitForSelector('#prompt');
    const texts = () => page.locator('.you-text').allInnerTexts();
    assert.ok((await texts()).includes('calc 6*7')); // drawn again from history
    const phoneTurn = page.locator('article.turn', { hasText: 'n from the phone' });
    assert.equal(await phoneTurn.locator('.you-device').innerText(), 'iPhone · Safari');
    assert.match(await phoneTurn.innerText(), /Added note n99/);
    // Ordered by time: the phone's turn came just after calc 6*7.
    const order = await texts();
    assert.ok(order.indexOf('calc 6*7') < order.indexOf('n from the phone'));
    await send('session show current');
    assert.equal(await page.locator('article.turn', { hasText: 'n from the phone' }).count(), 0);
    await send('session show all');
    assert.equal(await page.locator('article.turn', { hasText: 'n from the phone' }).count(), 1);
    // clear: this device's turns go, the phone's stay; undo brings ours back.
    await send('clear');
    assert.equal(await page.locator('article.turn', { hasText: 'calc 6*7' }).count(), 0);
    assert.equal(await page.locator('article.turn', { hasText: 'n from the phone' }).count(), 1);
    assert.match(await page.locator('#turns').innerText(), /Cleared this device's history · undo brings it back/);
    await send('undo');
    await page.waitForFunction(() => /calc 6\*7/.test(document.getElementById('turns').innerText));
    await send('clear all');
    assert.equal(await page.locator('article.turn[data-id]').count(), 0);
    await page.reload();
    await page.waitForSelector('#prompt');
    assert.equal(await page.locator('article.turn', { hasText: 'n from the phone' }).count(), 0); // stays cleared
    await send('undo');
  });

  await check('find: grouped, ranked, highlighted; results link to their entry', async () => {
    await send('t order oat milk #shop');
    await send('n oat milk is cheaper at the market');
    await send('find oat milk');
    const sections = await lastTurn().locator('.section').allInnerTexts();
    assert.ok(sections.some((t) => /^Tasks/.test(t)) && sections.some((t) => /^Notes/.test(t)), 'sections: ' + sections.join('|'));
    assert.ok(await lastTurn().locator('.t-hl').count() >= 4);
    await lastTurn().locator('.seg-run.t-id').first().click();
    await page.waitForFunction(() => /^(tasks|notes) [tn]\d+$/.test([...document.querySelectorAll('.you-text')].pop().textContent));
    await send('find /^order\\s/');
    assert.match(await lastText(), /regular expression[\s\S]*order oat milk/);
    await send('find qqqzzz');
    assert.match(await lastText(), /Nothing matches/);
  });

  await check('pinned summary: on top, links work, dismissed for the day across reloads, pin brings it back', async () => {
    await send('today pin');
    await send('t pinned summary task due:today');
    assert.equal(await page.locator('#pinned').isVisible(), true);
    assert.match(await page.locator('#pinned').innerText(), /Today[\s\S]*pinned summary task/);
    await page.locator('#pinned .seg-run.t-id').last().click();
    await page.waitForFunction(() => /^tasks t\d+$/.test([...document.querySelectorAll('.you-text')].pop().textContent));
    await page.locator('#pinned .pin-close').click();
    await page.waitForFunction(() => document.getElementById('pinned').hidden);
    assert.equal(await page.locator('.you-text').last().textContent(), 'today dismiss');
    await page.reload();
    await page.waitForSelector('#prompt');
    assert.equal(await page.locator('#pinned').isVisible(), false);
    await send('today pin');
    assert.equal(await page.locator('#pinned').isVisible(), true);
    const id = await page.evaluate(() => JSON.parse(localStorage.getItem('cc:tasks')).items.find((t) => t.text === 'pinned summary task').id);
    await send('t rm ' + id);
    assert.doesNotMatch(await page.locator('#pinned').innerText(), /pinned summary task/); // follows the data
  });

  await check('sync: token asked hidden and kept off the record; two devices converge; a refused token pauses and is renewed', async () => {
    await send('sync');
    assert.match(await lastText(), /Sync is off[\s\S]*fine-grained token/);
    // Setup: the token goes into a masked prompt, never into the transcript or history.
    await send('sync setup me/data');
    assert.equal(await prompt.getAttribute('type'), 'password');
    assert.match(await page.locator('#hint').innerText(), /hidden input/);
    await prompt.pressSequentially('tok-a');
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => /Syncing with me\/data/.test(document.getElementById('turns').innerText), null, { timeout: 5000 });
    assert.equal(await prompt.getAttribute('type'), 'text');
    const leaked = await page.evaluate(() => [document.getElementById('turns').innerText, localStorage.getItem('cc:history')].join('\n').includes('tok-a'));
    assert.equal(leaked, false);
    await page.waitForFunction(() => /sync ✓/.test(document.getElementById('status-sync').textContent));
    assert.ok(gh.file('me/data'));

    // A change here reaches the repo by itself, a few seconds later.
    await send('t synced across devices');
    await page.waitForFunction(() => /sync ✓/.test(document.getElementById('status-sync').textContent));
    await new Promise((r) => setTimeout(r, 5500));
    assert.ok(gh.file('me/data').collections.tasks.items.some((t) => t.text === 'synced across devices'));

    // Device B picks it up when set up, and its dismissal of the summary reaches A.
    const other = await browser.newContext({ viewport: { width: 1200, height: 800 } });
    await routeAll(other);
    const b = await other.newPage();
    await b.goto(base);
    await b.waitForSelector('#prompt');
    const bsend = async (c) => { await b.locator('#prompt').fill(c); await b.keyboard.press('Enter'); await b.waitForTimeout(80); };
    await bsend('sync setup me/data');
    await b.locator('#prompt').pressSequentially('tok-b');
    await b.keyboard.press('Enter');
    await b.waitForFunction(() => /synced across devices/.test(document.querySelector('[data-widget=tasks]').innerText), null, { timeout: 5000 });
    await send('today pin');
    await send('sync now');
    await bsend('sync now');
    await bsend('today dismiss');
    await bsend('sync now');
    await b.waitForFunction(() => /Synced with/.test([...document.querySelectorAll('.turn')].pop().innerText));
    await send('sync now');
    await page.waitForFunction(() => document.getElementById('pinned').hidden, null, { timeout: 5000 });
    // B's commands show up here too, tagged with B's device name; B's sync output doesn't (private).
    await bsend('config edit device Phone B');
    await bsend('t from device b');
    await bsend('sync now');
    await b.waitForFunction(() => /Synced with/.test([...document.querySelectorAll('.turn')].pop().innerText));
    await send('sync now');
    await page.waitForFunction(() => [...document.querySelectorAll('article.turn')].some((t) => /t from device b/.test(t.innerText) && /Phone B/.test(t.innerText)), null, { timeout: 5000 });
    assert.equal(await page.locator('article.turn .you-text', { hasText: 'sync now' }).count() >= 1, true);
    assert.equal(await page.locator('article.turn[data-id] .you-text', { hasText: /^sync/ }).count(), 0);

    // The shared clip: a passphrase on each device (hidden), sealed in the repo, announced on the other device.
    for (const [sendFn, pg] of [[send, page], [bsend, b]]) {
      await sendFn('clip key');
      assert.equal(await pg.locator('#prompt').getAttribute('type'), 'password');
      await pg.locator('#prompt').pressSequentially('a long shared passphrase');
      await pg.keyboard.press('Enter');
      await pg.waitForFunction(() => /Passphrase saved/.test([...document.querySelectorAll('.turn')].pop().innerText), null, { timeout: 5000 });
    }
    await send('clip https://example.com/secret-link');
    await page.waitForFunction(() => /Clipped/.test([...document.querySelectorAll('.turn')].pop().innerText), null, { timeout: 5000 });
    assert.ok(!JSON.stringify(gh.state.repos).includes('secret-link'));
    await bsend('sync now');
    await b.waitForFunction(() => /Clip from/.test(document.getElementById('turns').innerText), null, { timeout: 5000 });
    await b.locator('.turn.notice [data-run="clip"]').last().click();
    await b.waitForFunction(() => /secret-link/.test([...document.querySelectorAll('.turn')].pop().innerText), null, { timeout: 5000 });
    // Never kept: not in the shared history, not in ↑ recall, not in either device's storage as text.
    const kept = async (pg) => pg.evaluate(() => Object.keys(localStorage).map((k) => localStorage.getItem(k)).join('\n'));
    assert.ok(!(await kept(page)).includes('secret-link'));
    assert.ok(!(await kept(b)).includes('secret-link'));
    assert.equal(await page.locator('article.turn[data-id] .you-text', { hasText: /^clip/ }).count(), 0);
    await prompt.fill('');
    await page.keyboard.press('ArrowUp');
    assert.ok(!/^clip/.test(await prompt.inputValue()));
    await prompt.fill('');
    await send('clip clear');
    await other.close();

    // The token is revoked: sync pauses, says so once, and a new token resumes it.
    gh.revoke('tok-a');
    await send('sync now');
    // Wait for this command's own reply (a network round trip; the "Sync paused" notice says the same words).
    await page.waitForFunction(() => {
      const turn = [...document.querySelectorAll('article.turn')].filter((t) => (t.querySelector('.you-text') || {}).textContent === 'sync now').pop();
      return turn && /refused the token/.test(turn.innerText);
    }, null, { timeout: 5000 });
    await page.waitForFunction(() => /Sync paused/.test(document.getElementById('turns').innerText));
    assert.equal(await page.locator('#status-sync').textContent(), 'sync !');
    await send('sync token');
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => /Cancelled/.test([...document.querySelectorAll('.turn')].pop().innerText));
    gh.allow('tok-a2');
    await send('sync token');
    await prompt.pressSequentially('tok-a2');
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => /New token saved/.test([...document.querySelectorAll('.turn')].pop().innerText), null, { timeout: 5000 });
    assert.equal(await page.locator('#status-sync').textContent(), 'sync ✓');
    await send('sync off');
    assert.equal(await page.locator('#status-sync').isVisible(), false);
    assert.equal(await page.evaluate(() => localStorage.getItem('cc-device:sync-token')), null);
  });

  await check('javascript: aliases are rejected', async () => {
    await send('alias evil javascript:alert(1)');
    assert.match(await lastText(), /only http: and https:/);
    assert.equal(await lastTone(), 'err');
  });

  await check('multi-tab: a task added in one tab shows up in the other tab\'s widget', async () => {
    const other = await context.newPage();
    await other.goto(base);
    await other.waitForSelector('[data-widget=tasks]');
    await page.bringToFront();
    await send('t from tab one');
    await other.waitForFunction(() => /from tab one/.test(document.querySelector('[data-widget=tasks]').innerText), null, { timeout: 3000 });
    await other.close();
    await page.bringToFront();
  });

  await check('export, clear storage, import: all data comes back', async () => {
    await send('ev 2026-12-24 18:00 dinner');
    await send('zones add Asia/Tokyo');
    await send('engine default ddg');
    const snap = () => page.evaluate(() => {
      const o = {};
      for (const c of ['notes', 'tasks', 'events', 'aliases', 'settings']) o[c] = JSON.parse(localStorage.getItem('cc:' + c));
      return JSON.stringify({
        notes: o.notes.items.map((n) => n.text), tasks: o.tasks.items.map((t) => [t.text, t.due, t.tags, t.done]),
        events: o.events.items.map((e) => [e.date, e.time, e.title]),
        aliases: o.aliases.entries.map((e) => e.name).sort(), engine: o.aliases.defaultEngine, zones: o.settings.zones,
      });
    });
    const before = await snap();
    const [download] = await Promise.all([page.waitForEvent('download'), send('export')]);
    assert.match(download.suggestedFilename(), /^control-center-\d{4}-\d\d-\d\d\.json$/);
    const file = path.join(require('os').tmpdir(), 'cc-export-' + process.pid + '.json');
    await download.saveAs(file);
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await page.waitForSelector('#prompt');
    await send('notes');
    assert.match(await lastText(), /No notes yet/);
    const [chooser] = await Promise.all([page.waitForEvent('filechooser', { timeout: 3000 }), send('import')]);
    await chooser.setFiles(file);
    await page.waitForFunction(() => /Imported cc-export/.test(document.getElementById('turns').innerText));
    assert.equal(await snap(), before);
    const [chooser2] = await Promise.all([page.waitForEvent('filechooser', { timeout: 3000 }), send('import')]);
    await chooser2.setFiles(file);
    await page.waitForFunction(() => /skipped alias 'gh'.*already exists/.test(document.getElementById('turns').innerText));
    assert.equal(await lastTone(), 'warn');
    fs.unlinkSync(file);
  });

  await check('ics import reads a local file', async () => {
    const f = path.join(require('os').tmpdir(), 'cc-' + process.pid + '.ics');
    fs.writeFileSync(f, 'BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nSUMMARY:Board meeting\r\nDTSTART:20270105T090000\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n');
    const [chooser] = await Promise.all([page.waitForEvent('filechooser', { timeout: 3000 }), send('ics import')]);
    await chooser.setFiles(f);
    await page.waitForFunction(() => /Imported 1 event/.test(document.getElementById('turns').innerText));
    await send('cal 2027-01');
    assert.match(await lastText(), /Tuesday 5 January 2027\s+09:00\s+Board meeting/);
    assert.equal(await lastTurn().locator('.cal td.mark').count(), 1);
    fs.unlinkSync(f);
  });

  await check('week: days link to date; date maths answers are copyable', async () => {
    await send('week');
    await lastTurn().locator('tr.tr-run').nth(2).click();
    await page.waitForFunction(() => /^date \d{4}-\d{2}-\d{2}$/.test([...document.querySelectorAll('.turn .you-text')].pop().textContent));
    assert.match(await lastText(), /week \d+[\s\S]*quarter/);
    await send('days until +10d');
    assert.match(await lastText(), /10 days until/);
  });

  await check('qr: drawn dark on white in any theme, scans back to the text, redrawn from history', async () => {
    const jsQR = require('jsqr');
    const url = 'https://misch0n.github.io/browser-hub/?q=t%20hello';
    await send('theme dark');
    await send('qr ' + url);
    assert.match(await lastText(), /QR code · 50 bytes · version \d+ · error correction [LMQH]/);
    const scan = async () => {
      const png = await page.locator('#turns .turn').last().locator('svg.qr').screenshot();
      const blank = await context.newPage();
      const px = await blank.evaluate(async (b64) => {
        const bmp = await createImageBitmap(new Blob([Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))], { type: 'image/png' }));
        const c = new OffscreenCanvas(bmp.width, bmp.height);
        const g = c.getContext('2d');
        g.drawImage(bmp, 0, 0);
        return { w: bmp.width, h: bmp.height, data: Array.from(g.getImageData(0, 0, bmp.width, bmp.height).data) };
      }, png.toString('base64'));
      await blank.close();
      const r = jsQR(Uint8ClampedArray.from(px.data), px.w, px.h);
      return r && r.data;
    };
    assert.equal(await scan(), url);
    // Kept in the shared history as text only, and drawn again after a reload.
    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('cc:log')).entries.pop());
    assert.deepEqual(stored.ops.find((o) => o[0] === 'qr'), ['qr', url, stored.ops.find((o) => o[0] === 'qr')[2]]);
    await page.reload();
    await page.waitForSelector('#turns svg.qr');
    assert.equal(await scan(), url);
    await send('theme auto');
  });

  await check('qr and barcode: saved as PNG and SVG, the PNGs scan back; a barcode is redrawn from history', async () => {
    const jsQR = require('jsqr');
    const zx = require('@zxing/library');
    // A downloaded PNG's pixels, read in a blank page (the hub's CSP keeps images same-origin).
    const pixels = async (buf) => {
      const blank = await context.newPage();
      const px = await blank.evaluate(async (b64) => {
        const bmp = await createImageBitmap(new Blob([Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))], { type: 'image/png' }));
        const c = new OffscreenCanvas(bmp.width, bmp.height);
        const g = c.getContext('2d');
        g.drawImage(bmp, 0, 0);
        return { w: bmp.width, h: bmp.height, data: Array.from(g.getImageData(0, 0, bmp.width, bmp.height).data) };
      }, buf.toString('base64'));
      await blank.close();
      return px;
    };
    const save = async (label) => {
      const [dl] = await Promise.all([page.waitForEvent('download'), lastTurn().locator('.export-row button', { hasText: label }).click()]);
      return { name: dl.suggestedFilename(), data: fs.readFileSync(await dl.path()) };
    };
    await send('qr https://example.com/x');
    const qrPng = await save('PNG');
    assert.equal(qrPng.name, 'qr-example-com-x.png');
    const q = await pixels(qrPng.data);
    assert.equal(jsQR(Uint8ClampedArray.from(q.data), q.w, q.h).data, 'https://example.com/x');
    const qrSvg = await save('SVG');
    assert.equal(qrSvg.name, 'qr-example-com-x.svg');
    assert.match(qrSvg.data.toString(), /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"[\s\S]*<path fill="#000" d="M/);

    await send('barcode ean13 590123412345');
    assert.match(await lastText(), /EAN-13 · 13 characters · check digit 7 added/);
    assert.equal(await lastTurn().locator('svg.barcode path').count(), 1);
    assert.equal(await lastTurn().locator('svg.barcode text').textContent(), '5901234123457');
    const bPng = await save('PNG');
    assert.equal(bPng.name, 'ean13-5901234123457.png');
    const b = await pixels(bPng.data);
    const lum = new Uint8ClampedArray(b.w * b.h);
    for (let i = 0; i < lum.length; i++) lum[i] = b.data[i * 4];
    const bitmap = new zx.BinaryBitmap(new zx.HybridBinarizer(new zx.RGBLuminanceSource(lum, b.w, b.h)));
    assert.equal(new zx.MultiFormatOneDReader(new Map()).decode(bitmap).getText(), '5901234123457');
    assert.match((await save('SVG')).data.toString(), /<text [^>]*>5901234123457<\/text><\/svg>$/);
    // The shared history keeps the spec; the bars are drawn again from it.
    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('cc:log')).entries.pop());
    assert.deepEqual(stored.ops.find((o) => o[0] === 'barcode'), ['barcode', { type: 'ean13', text: '5901234123457' }]);
    await page.reload();
    await page.waitForSelector('#turns svg.barcode');
    assert.equal(await page.locator('#turns svg.barcode text').last().textContent(), '5901234123457');
  });

  await check('mermaid: the live editor draws as you type, saves as a command, exports PNG and SVG; kept diagrams redraw', async () => {
    await page.evaluate(() => { window.__cspv = []; document.addEventListener('securitypolicyviolation', (e) => window.__cspv.push(e.effectiveDirective + ' ' + e.blockedURI)); });
    await send('mermaid');
    const t = lastTurn();
    await t.locator('.dg-preview img.diagram-img').waitFor({ timeout: 30000 });
    assert.match(await t.locator('.dg-status').textContent(), /✓ drawn · \d+ × \d+/);
    // Typing redraws; a mistake says so and keeps the last drawing, faded.
    const area = t.locator('textarea.dg-code');
    await area.fill('flowchart TD\n  start([Start]) --> check{Ok?}\n  check -->|yes| done[Done]');
    await page.waitForFunction(() => /✓ drawn/.test(document.querySelector('.turn:last-child .dg-status').textContent) &&
      document.querySelector('.turn:last-child .dg-preview img').alt.includes('Mermaid'), null, { timeout: 15000 });
    await area.fill('flowchart TD\n  a --> ');
    await page.waitForFunction(() => document.querySelector('.turn:last-child .dg-status').classList.contains('t-err'), null, { timeout: 15000 });
    assert.equal(await t.locator('.dg-preview.dg-stale').count(), 1);
    await area.fill('flowchart TD\n  start([Start]) --> check{Ok?}\n  check -->|yes| done[Done]');
    await page.waitForFunction(() => /✓ drawn/.test(document.querySelector('.turn:last-child .dg-status').textContent), null, { timeout: 15000 });
    // PNG and SVG of what is drawn.
    const [png] = await Promise.all([page.waitForEvent('download'), t.locator('.export-row button', { hasText: 'PNG' }).click()]);
    const pngData = fs.readFileSync(await png.path());
    assert.equal(png.suggestedFilename(), 'diagram-diagram.png');
    assert.equal(pngData.slice(1, 4).toString(), 'PNG');
    assert.ok(pngData.readUInt32BE(16) > 100, 'a PNG wider than 100 px');
    const [svg] = await Promise.all([page.waitForEvent('download'), t.locator('.export-row button', { hasText: 'SVG' }).click()]);
    const svgText = fs.readFileSync(await svg.path(), 'utf8');
    assert.match(svgText, /^<svg[^>]+xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
    assert.match(svgText, />Start</);
    assert.ok(!/<script|onclick|foreignObject/i.test(svgText));
    // Save as… puts the command in the prompt; Enter keeps the draft as d1.
    await t.locator('.export-row button', { hasText: 'Save as…' }).click();
    assert.equal(await prompt.inputValue(), 'diagrams add ');
    await prompt.pressSequentially('flow');
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => /Added diagram d1 · flow/.test([...document.querySelectorAll('.turn')].pop().innerText));
    await lastTurn().locator('img.diagram-img').waitFor({ timeout: 15000 });
    // diagrams d1 edit, change, Ctrl+S saves through the command.
    await send('diagrams d1 edit');
    const t2 = lastTurn();
    await t2.locator('.dg-preview img').waitFor({ timeout: 15000 });
    await t2.locator('textarea.dg-code').fill('flowchart LR\n  x[Changed] --> y');
    await t2.locator('textarea.dg-code').press('Control+s');
    await page.waitForFunction(() => /Saved diagrams d1 · flow · 2 lines/.test([...document.querySelectorAll('.turn')].pop().innerText));
    // The history keeps the code and draws it again after a reload.
    await send('diagrams d1');
    await lastTurn().locator('img.diagram-img').waitFor({ timeout: 15000 });
    assert.deepEqual(await page.evaluate(() => window.__cspv), []); // nothing the page's CSP had to block
    await page.reload();
    await page.waitForSelector('#turns .diagram-wrap img.diagram-img', { timeout: 30000 });
    assert.equal(await page.locator('iframe.mermaid-frame').count(), 1);
    await send('diagrams d1 rm');
  });

  await check('copy buttons and json colouring', async () => {
    await send('json {"a":[1,true,null]}');
    assert.ok(await lastTurn().locator('.code .t-num').count() > 0);
    await send('uuid');
    assert.equal(await lastTurn().locator('.value .copy').count(), 1);
  });

  await check('copy button by the prompt copies the latest result', async () => {
    await send('calc 6*7');
    const btn = page.locator('#copy-last');
    assert.equal(await btn.isVisible(), true);
    assert.match(await btn.getAttribute('title'), /Copy: 42/);
    await btn.click();
    assert.equal(await page.evaluate(() => navigator.clipboard.readText()), '42');
    assert.equal(await btn.textContent(), 'copied');
    assert.equal(await focused(), 'prompt');
    await send('uuid');
    await btn.click();
    assert.match(await page.evaluate(() => navigator.clipboard.readText()), /^[0-9a-f-]{36}$/);
  });

  await check('Ctrl+R searches history; Enter runs the match, Tab takes it to edit, Esc restores', async () => {
    await send('calc 1+2');
    await send('calc 10*10');
    await type('draft');
    await page.keyboard.press('Control+r');
    await prompt.fill('');
    await prompt.pressSequentially('calc');
    assert.match(await page.locator('#hint').innerText(), /history search “calc”: calc 10\*10/);
    await page.keyboard.press('Control+r');
    assert.match(await page.locator('#hint').innerText(), /: calc 1\+2/);
    await page.keyboard.press('Escape');
    assert.equal(await prompt.inputValue(), 'draft');
    await page.keyboard.press('Control+r');
    await prompt.fill('');
    await prompt.pressSequentially('1+');
    await page.keyboard.press('Tab');
    assert.equal(await prompt.inputValue(), 'calc 1+2');
    await prompt.fill('');
    await page.keyboard.press('Control+r');
    await prompt.pressSequentially('10*');
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => /= 100/.test([...document.querySelectorAll('.turn')].pop().innerText));
    assert.equal(await page.locator('.you-text').last().textContent(), 'calc 10*10');
    await prompt.pressSequentially('zzzq');
    await page.keyboard.press('Control+r');
    assert.match(await page.locator('#hint').innerText(), /no match/);
    await page.keyboard.press('Escape');
    await prompt.fill('');
  });

  await check('did you mean: the hint offers the fix and Tab applies it', async () => {
    await type('tsks');
    assert.match(await page.locator('#hint').innerText(), /did you mean tasks\? tab fixes it/);
    await page.keyboard.press('Tab');
    assert.equal(await prompt.inputValue(), 'tasks ');
    await prompt.fill('');
  });

  await check('graph mode: an overlay beside an unchanged input (path, siblings, letter tree at the cursor); Enter runs as normal mode does', async () => {
    const graph = page.locator('#graph');
    const fwd = page.locator('#graph .g-fwd');
    const steps = () => page.locator('#graph .g-path .g-step:not(.g-here) .g-val').allInnerTexts();
    const words = () => page.locator('#graph .g-fwd .f-root .f-word').evaluateAll((els) => els.map((e) => e.getAttribute('data-take')));
    await send('cook convert 2 cups flour');
    const normal = await lastText();
    await type('graph ');
    assert.equal(await graph.isVisible(), true);
    // The overlay covers the output; the prompt stays usable on top of it.
    const box = await graph.boundingBox();
    const vp = page.viewportSize();
    assert.ok(box.x === 0 && box.y === 0 && box.width === vp.width && box.height === vp.height);
    assert.equal(await page.evaluate(() => document.elementFromPoint(20, 20).closest('#graph') !== null), true);
    const pb = await page.locator('.prompt-box').boundingBox();
    assert.equal(await page.evaluate(([x, y]) => !!document.elementFromPoint(x, y).closest('.prompt-box'), [pb.x + 10, pb.y + pb.height / 2]), true);
    assert.match(await page.locator('#hint').innerText(), /^graph mode/);
    // Far branches fold; tapping one opens its letters without moving on.
    const folded = page.locator('#graph .f-label:has(.f-fold)').first();
    const letters = await folded.getAttribute('data-take');
    await folded.click();
    assert.equal(await prompt.inputValue(), 'graph ' + letters);
    assert.equal(await focused(), 'prompt');
    assert.ok((await words()).every((w) => w.toLowerCase().startsWith(letters.toLowerCase())));
    // Ghost text and Tab are normal mode's; the tree narrows as you type.
    await type('graph coo');
    assert.equal(await page.locator('#ghost-rest').textContent(), 'k');
    assert.ok((await words()).includes('cook'));
    await page.keyboard.press('Tab');
    assert.equal(await prompt.inputValue(), 'graph cook ');
    assert.deepEqual((await words()).slice().sort(), ['calorie', 'convert', 'oven', 'target']);
    assert.match(await fwd.innerText(), /onvert[\s\S]*<amount:number>/); // each word with the slot after it
    // The backward pane: the other commands, a to z, cook marked.
    const back = page.locator('#graph .g-back .g-list').first();
    assert.equal(await back.locator('.g-chosen').innerText(), 'cook');
    const names = await back.locator('li').allInnerTexts();
    const az = names.slice().sort((x, y) => (x.toLowerCase() < y.toLowerCase() ? -1 : x.toLowerCase() > y.toLowerCase() ? 1 : 0));
    assert.deepEqual(names, az);
    // A typo resolves, and shows what it became.
    await prompt.pressSequentially('convrt ');
    assert.deepEqual(await steps(), ['cook', 'convert']);
    assert.match(await page.locator('#graph .g-path').innerText(), /convert \(convrt\)/);
    // An open slot: its shape and what was typed there before; a tap puts it in.
    assert.match(await fwd.innerText(), /<amount:number>/);
    await page.locator('#graph .f-recent').filter({ hasText: /^2$/ }).first().click();
    assert.equal(await prompt.inputValue(), 'graph cook convrt 2 ');
    assert.equal(await focused(), 'prompt');
    await prompt.pressSequentially('cups flour');
    assert.deepEqual(await steps(), ['cook', 'convert', '2', 'cups']);
    assert.match(await page.locator('#hint').innerText(), /↵ runs cook convert 2 cups flour/);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(60);
    assert.equal(await page.locator('.you-text').last().textContent(), 'cook convert 2 cups flour');
    assert.equal(await lastText(), normal);
    assert.equal(await prompt.inputValue(), 'graph '); // still in graph mode
    // ↑↓ walk history and stay in graph mode.
    await page.keyboard.press('ArrowUp');
    assert.equal(await prompt.inputValue(), 'graph cook convert 2 cups flour');
    await page.keyboard.press('ArrowDown');
    assert.equal(await prompt.inputValue(), 'graph ');
    // Backspace and Esc as in normal mode.
    await prompt.pressSequentially('cook ');
    assert.equal((await words())[0], 'convert'); // used most (in graph mode) comes first
    await page.keyboard.press('Backspace');
    assert.equal(await prompt.inputValue(), 'graph cook');
    await page.keyboard.press('Escape');
    assert.equal(await prompt.inputValue(), '');
    assert.equal(await graph.isVisible(), false);
    await type('graph ');
    await page.keyboard.press('Backspace');
    assert.equal(await graph.isVisible(), false);
    assert.match(await page.locator('#hint').innerText(), /^view graph/);
    // The ranking switch, from graph mode itself.
    await type('graph :sort alpha');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(60);
    assert.match(await lastText(), /Graph mode ranks a to z/);
    await type('graph cook ');
    assert.equal((await words())[0], 'calorie');
    await send('graph :sort freq');
    await prompt.fill('');
  });

  await check('graph mode at phone width: siblings above the letter tree, nothing overflows', async () => {
    const phone = await context.newPage();
    await phone.setViewportSize({ width: 390, height: 844 });
    await phone.goto(base);
    await phone.waitForSelector('#prompt');
    await phone.locator('#prompt').fill('graph cook convert ');
    await phone.waitForSelector('#graph .g-back');
    const m = await phone.evaluate(() => {
      const r = (s) => document.querySelector(s).getBoundingClientRect();
      const g = document.getElementById('graph');
      return { back: r('#graph .g-back'), fwd: r('#graph .g-fwd'), hx: document.documentElement.scrollWidth - innerWidth, gx: g.scrollWidth - g.clientWidth, w: innerWidth };
    });
    assert.ok(m.back.bottom <= m.fwd.top + 1, 'the backward pane sits above the forward pane');
    assert.ok(m.fwd.right <= m.w + 1 && m.hx <= 0 && m.gx <= 0);
    assert.match(await phone.locator('#graph .g-fwd').innerText(), /<amount:number>/);
    await phone.screenshot({ path: path.join(require('os').tmpdir(), 'cc-graph-phone.png') });
    await phone.close();
  });

  await check('refresh reloads the page from the server; the address stays clean and the history is kept', async () => {
    await page.evaluate(() => { window.__beforeRefresh = true; });
    const pages = [];
    const seen = (r) => { if (r.isNavigationRequest()) pages.push(r.url()); };
    page.on('request', seen);
    await type('refresh');
    await Promise.all([page.waitForEvent('load'), page.keyboard.press('Enter')]);
    page.off('request', seen);
    await page.waitForSelector('#prompt');
    assert.equal(await page.evaluate(() => window.__beforeRefresh), undefined); // a new page
    assert.ok(pages.some((u) => /\?fresh=\d+/.test(u)), pages.join(' ')); // an address no cache holds
    assert.equal(new URL(page.url()).search, '');
    assert.equal(await focused(), 'prompt');
    const log = await page.evaluate(() => JSON.parse(localStorage.getItem('cc:log')).entries.map((e) => e.input));
    assert.equal(log.at(-1), 'refresh');
    assert.match(await page.locator('#turns').innerText(), /Refreshing/);
  });

  await check('pageshow clears stale input and refocuses', async () => {
    await prompt.fill('stale');
    await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })));
    assert.equal(await prompt.inputValue(), '');
    assert.equal(await focused(), 'prompt');
  });

  await check('layout: output and prompt use the full width beside the panel', async () => {
    const big = await browser.newContext({ viewport: { width: 2560, height: 1200 } });
    const p = await big.newPage();
    await p.goto(base);
    await p.waitForSelector('#prompt');
    const m = await p.evaluate(() => {
      const r = (id) => document.getElementById(id).getBoundingClientRect();
      return { main: r('main'), panel: r('panel'), prompt: document.querySelector('.prompt-box').getBoundingClientRect(), turns: r('turns') };
    });
    assert.ok(Math.abs(m.main.right - m.panel.left) < 2, 'main ends where the panel starts');
    assert.ok(m.main.right - m.prompt.right < 40, 'prompt box reaches the panel: ' + JSON.stringify(m));
    assert.ok(m.main.right - m.turns.right < 40, 'output reaches the panel');
    await p.evaluate(() => { document.documentElement.setAttribute('data-panel', 'hidden'); });
    const full = await p.evaluate(() => document.querySelector('.prompt-box').getBoundingClientRect().right);
    assert.ok(2560 - full < 40, 'with the panel hidden the prompt spans the window');
    await big.close();
  });

  await check('layout: prompt pinned to bottom, output scrolls, no horizontal overflow', async () => {
    for (let i = 0; i < 30; i++) await send('calc ' + i);
    const m = await page.evaluate(() => {
      const o = document.getElementById('transcript'), c = document.getElementById('composer');
      return { bottom: c.getBoundingClientRect().bottom, vh: innerHeight, scrolled: o.scrollTop > 0,
        atEnd: o.scrollHeight - o.scrollTop - o.clientHeight < 2, hx: document.documentElement.scrollWidth - innerWidth };
    });
    assert.ok(Math.abs(m.bottom - m.vh) < 2);
    assert.ok(m.scrolled && m.atEnd);
    assert.ok(m.hx <= 0);
  });

  await check('phone width: widgets become a drawer, nothing overflows', async () => {
    const phone = await context.newPage();
    await phone.setViewportSize({ width: 390, height: 844 });
    await phone.goto(base);
    await phone.waitForSelector('#prompt');
    const panelVisible = () => phone.evaluate(() => {
      const r = document.getElementById('panel').getBoundingClientRect();
      return r.left < innerWidth - 1;
    });
    assert.equal(await panelVisible(), false);
    await phone.locator('#prompt').fill('tasks all');
    await phone.keyboard.press('Enter');
    await phone.locator('#prompt').fill('help');
    await phone.keyboard.press('Enter');
    await phone.waitForTimeout(100);
    assert.ok(await phone.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await phone.locator('#panel-toggle').click();
    await phone.waitForTimeout(300);
    assert.equal(await panelVisible(), true);
    await phone.screenshot({ path: path.join(require('os').tmpdir(), 'cc-phone.png') });
    await phone.keyboard.press('Escape');
    await phone.waitForTimeout(300);
    assert.equal(await panelVisible(), false);
    await phone.close();
  });

  await check('touch devices: text fields are 16px so iOS does not zoom on focus; ghost stays aligned', async () => {
    const touch = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
    const tp = await touch.newPage();
    await tp.goto(base);
    await tp.waitForSelector('#prompt');
    const sizes = await tp.evaluate(() => ['#prompt', '#ghost', '#palette-input'].map((sel) => getComputedStyle(document.querySelector(sel)).fontSize));
    assert.deepEqual(sizes, ['16px', '16px', '16px']);
    await tp.locator('#prompt').tap();
    await tp.locator('#prompt').pressSequentially('hel');
    const align = await tp.evaluate(() => {
      const r = document.createRange();
      r.selectNodeContents(document.getElementById('ghost-typed'));
      const typed = r.getBoundingClientRect().width;
      const probe = document.createElement('span');
      probe.textContent = 'hel';
      probe.style.font = getComputedStyle(document.getElementById('prompt')).font;
      probe.style.position = 'fixed';
      document.body.appendChild(probe);
      const w = probe.getBoundingClientRect().width;
      probe.remove();
      return Math.abs(typed - w);
    });
    assert.ok(align < 0.5);
    // Phones: the same letter twice, quickly, where it can't be typing, is Tab (and both letters go).
    await tp.locator('#prompt').fill('');
    await tp.locator('#prompt').pressSequentially('cou');
    await tp.keyboard.type('xx');
    assert.equal(await tp.locator('#prompt').inputValue(), 'count ');
    for (const text of ['tasks all', 'n coffee meeting', 'g hello']) {
      await tp.locator('#prompt').fill('');
      await tp.keyboard.type(text);
      assert.equal(await tp.locator('#prompt').inputValue(), text);
    }
    await tp.locator('#prompt').fill('');
    await tp.locator('#prompt').pressSequentially('agenda ');
    await tp.keyboard.type('qq');
    await tp.waitForSelector('article.turn.completions');
    assert.equal(await tp.locator('#prompt').inputValue(), 'agenda ');
    await tp.locator('#prompt').fill('');
    // Smaller text never takes the fields under 16px; bigger text grows them.
    const fieldSize = () => tp.evaluate(() => getComputedStyle(document.getElementById('prompt')).fontSize);
    const tsend = async (c) => { await tp.locator('#prompt').fill(c); await tp.keyboard.press('Enter'); await tp.waitForTimeout(80); };
    await tsend('font 80%');
    assert.equal(await fieldSize(), '16px');
    await tsend('font 150%');
    assert.equal(await fieldSize(), '24px');
    await tsend('font reset');
    // The on-screen keyboard shrinks the visible area: the app follows it, so the prompt sits just above.
    await tp.locator('#prompt').tap();
    await tp.setViewportSize({ width: 390, height: 480 });
    await tp.waitForFunction(() => document.documentElement.style.getPropertyValue('--app-h') === '480px');
    const box = await tp.evaluate(() => { const r = document.querySelector('.prompt-box').getBoundingClientRect(); return { bottom: r.bottom, h: window.visualViewport.height }; });
    assert.ok(box.bottom <= box.h && box.bottom > box.h - 120, JSON.stringify(box));
    assert.equal(await tp.evaluate(() => window.scrollY), 0);
    await tp.setViewportSize({ width: 390, height: 844 });
    await tp.waitForFunction(() => document.documentElement.style.getPropertyValue('--app-h') === '844px');
    await touch.close();
    // desktop (fine pointer) keeps the compact size
    assert.equal(await page.evaluate(() => getComputedStyle(document.getElementById('prompt')).fontSize), '14px');
  });

  await check('every stylesheet and module is loaded through a versioned URL', async () => {
    assert.deepEqual(unstamped, []);
  });

  await check('touch: tapping outside the prompt drops focus (keyboard); tapping the box restores it', async () => {
    const touch = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const tp = await touch.newPage();
    await tp.goto(base);
    await tp.waitForSelector('[data-widget=tasks]');
    const active = () => tp.evaluate(() => document.activeElement && document.activeElement.id);
    assert.equal(await active(), 'prompt'); // the page opens ready to type
    await tp.locator('#transcript').tap({ position: { x: 150, y: 400 } });
    assert.notEqual(await active(), 'prompt');
    await tp.waitForTimeout(400);
    assert.notEqual(await active(), 'prompt'); // nothing pulls it back
    await tp.locator('.prompt-glyph').tap(); // anywhere on the box, not just the text
    assert.equal(await active(), 'prompt');
    await tp.locator('#prompt').fill('t touch task');
    await tp.keyboard.press('Enter');
    await tp.locator('#transcript').tap({ position: { x: 150, y: 600 } });
    // widget actions don't raise the keyboard either
    await tp.locator('#panel-toggle').tap();
    await tp.waitForTimeout(300);
    assert.notEqual(await active(), 'prompt');
    await tp.locator('[data-widget=tasks] .w-check').first().tap();
    await tp.waitForFunction(() => /Completed/.test(document.getElementById('turns').innerText));
    await tp.waitForTimeout(200);
    assert.notEqual(await active(), 'prompt');
    await touch.close();
  });

  await check('touch: key bar toggles, its keys act on the prompt without dropping the keyboard', async () => {
    const touch = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const tp = await touch.newPage();
    await tp.goto(base);
    await tp.waitForSelector('#prompt');
    const active = () => tp.evaluate(() => document.activeElement && document.activeElement.id);
    assert.equal(await tp.locator('#keybar').isVisible(), false); // off until asked for
    assert.equal(await tp.locator('#keys-toggle').isVisible(), true);
    await tp.locator('#keys-toggle').tap();
    assert.equal(await tp.locator('#keybar').isVisible(), true);
    await tp.locator('.prompt-glyph').tap();
    await tp.locator('#prompt').fill('calc 2+2');
    await tp.keyboard.press('Enter');
    await tp.waitForFunction(() => /= 4/.test(document.getElementById('turns').innerText));
    await tp.locator('#prompt').fill('gh org/repo');
    await tp.locator('#keybar [data-key="ctrl+w"]').tap();
    assert.equal(await tp.locator('#prompt').inputValue(), 'gh ');
    assert.equal(await active(), 'prompt'); // the keyboard stays up
    await tp.locator('#keybar [data-key="Escape"]').tap();
    assert.equal(await tp.locator('#prompt').inputValue(), '');
    await tp.locator('#keybar [data-key="ArrowUp"]').tap();
    assert.equal(await tp.locator('#prompt').inputValue(), 'calc 2+2');
    await tp.locator('#keybar [data-key="Escape"]').tap();
    await tp.locator('#keybar [data-key="ctrl+r"]').tap();
    assert.match(await tp.locator('#hint').innerText(), /history search/);
    await tp.locator('#keybar [data-key="Escape"]').tap();
    await tp.locator('#prompt').fill('cal');
    await tp.locator('#keybar [data-key="Tab"]').tap();
    assert.match(await tp.locator('#prompt').inputValue(), /^calc? ?/);
    // Remembered on this device.
    await tp.reload();
    await tp.waitForSelector('#prompt');
    assert.equal(await tp.locator('#keybar').isVisible(), true);
    await tp.locator('#keys-toggle').tap();
    assert.equal(await tp.locator('#keybar').isVisible(), false);
    // No overflow at phone width with the bar on.
    await tp.locator('#keys-toggle').tap();
    assert.ok(await tp.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
    await touch.close();
  });

  await check('phone width: tables never squeeze a column into a sliver (help, keys, lists)', async () => {
    const touch = await browser.newContext({ viewport: { width: 375, height: 700 }, isMobile: true, hasTouch: true });
    const tp = await touch.newPage();
    await tp.goto(base);
    await tp.waitForSelector('#prompt');
    const send2 = async (c) => { await tp.locator('#prompt').fill(c); await tp.keyboard.press('Enter'); await tp.waitForTimeout(80); };
    await send2('alias gh https://github.com/ https://github.com/{} --path');
    await send2('t a task with a fairly long description that has to wrap somewhere due:tomorrow #home');
    // Each command's tables are measured right after it runs (help and keys leave with the next command).
    const bad = [];
    for (const c of ['help', 'keys', 'alias ls', 'tasks', 'tz', 'theme', 'widgets', 'help alias', 'agenda', 'cook target', 'cook oven', 'cook oven chicken 500g', 'cook convert', 'cook calorie chocolate', 'cook calorie 05062', 'roll', 'roll stats']) {
      await send2(c);
      await tp.waitForTimeout(c.startsWith('cook calorie') ? 300 : 0);
      bad.push(...(await tp.evaluate(() => {
      const out = [];
      for (const t of [...document.querySelectorAll('article.turn')].pop().querySelectorAll('.tbl')) {
        const wrap = t.parentElement;
        // A row as tall as many lines means a column was squeezed to a character or two.
        for (const r of t.querySelectorAll('tr')) {
          if (r.getBoundingClientRect().height > 90) out.push('tall row: ' + r.innerText.slice(0, 40));
        }
        if (t.classList.contains('tbl-stack') && t.getBoundingClientRect().width > wrap.clientWidth + 1) out.push('stack table overflows');
      }
      return out;
    })).map((x) => c + ': ' + x));
    }
    assert.deepEqual(bad, []);
    assert.ok(await tp.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
    await touch.close();
  });

  await check('desktop: no key bar toggle; palette groups commands, engines and aliases', async () => {
    assert.equal(await page.locator('#keys-toggle').isVisible(), false);
    await prompt.fill('');
    await page.keyboard.press('/');
    const sections = await page.locator('#palette-list .p-section').allInnerTexts();
    assert.ok(sections.some((t) => /BUILT-IN · TOOLS/i.test(t)), sections.join(','));
    assert.ok(sections.some((t) => /YOUR SEARCH ENGINES/i.test(t)));
    assert.ok(sections.some((t) => /THEMES/i.test(t)));
    await page.locator('#palette-input').pressSequentially('ddg');
    assert.equal(await page.locator('#palette-list .p-section').count(), 0); // ranked once you type
    assert.match(await page.locator('#palette-list li.selected .p-kind').innerText(), /your engine/);
    await page.keyboard.press('Escape');
    await type('calc');
    assert.match(await page.locator('#hint').innerText(), /^tools calc/);
    await type('ddg x');
    assert.match(await page.locator('#hint').innerText(), /^your engine ddg/);
    await prompt.fill('');
  });

  await check('no console errors during the whole run', async () => {
    assert.deepEqual(errors.filter((e) => !/Content Security Policy|Refused to (connect|evaluate|execute)|Failed to fetch/i.test(e)), []);
  });

  await page.screenshot({ path: process.env.SHOT || path.join(require('os').tmpdir(), 'cc.png') });
  await browser.close();
  server.close();
  fs.rmSync(root, { recursive: true, force: true });
  console.log(passed + ' browser checks passed' + (process.exitCode ? ' (with failures)' : ''));
})().catch((e) => { console.error(e); process.exit(1); });
