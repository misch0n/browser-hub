// Browser tests for the real page. Needs Playwright + Chromium:
//   NODE_PATH=$(npm root -g) node tests/e2e.cjs
// Starts its own static server; never touches the network (navigations are intercepted).
const http = require('http');
const fs = require('fs');
const path = require('path');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');

// Test the deployable build: the same cache-busting step the Pages workflow runs.
const root = fs.mkdtempSync(path.join(require('os').tmpdir(), 'cc-site-'));
require('child_process').execFileSync(process.execPath, ['tools/build-site.mjs', root, 'e2e'], { cwd: path.join(__dirname, '..'), stdio: 'ignore' });
const types = { '.xml': 'application/opensearchdescription+xml', '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
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
    // 401 (the revoked-token test) are expected answers, handled by the page.
    if (m.type() === 'error' && !(m.location().url || '').startsWith('https://api.github.com/')) errors.push(m.text());
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
    assert.match(csp, /connect-src https:\/\/api\.github\.com;/); // sync only, nothing else
    assert.equal(await page.evaluate(() => fetch('https://example.com/').then(() => false, () => true)), true);
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
    assert.match(await lastText(), /Minerals[\s\S]*selenium[\s\S]*Vitamins[\s\S]*niacin/);
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
    assert.match(await lastText(), /refused the token/);
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
    for (const c of ['help', 'keys', 'alias ls', 'tasks', 'tz', 'theme', 'widgets', 'help alias', 'agenda', 'cook target', 'cook oven', 'cook oven chicken 500g', 'cook convert', 'cook calorie chocolate', 'cook calorie 05062', 'roll', 'roll stats']) await send2(c);
    const bad = await tp.evaluate(() => {
      const out = [];
      for (const t of document.querySelectorAll('.tbl')) {
        const wrap = t.parentElement;
        // A row as tall as many lines means a column was squeezed to a character or two.
        for (const r of t.querySelectorAll('tr')) {
          if (r.getBoundingClientRect().height > 90) out.push('tall row: ' + r.innerText.slice(0, 40));
        }
        if (t.classList.contains('tbl-stack') && t.getBoundingClientRect().width > wrap.clientWidth + 1) out.push('stack table overflows');
      }
      return out;
    });
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
