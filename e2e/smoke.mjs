// End-to-end check in a real Chromium: loads the extension, blocks local
// test sites and checks what the user would see. No request leaves the
// machine: the test sites are *.test names mapped to a local server.
//
// The browser's "allow access" prompt can't be clicked from a test, so the
// test copy of the extension gets host access up front.
//
// Run: npm run test:e2e   (needs playwright-core and its Chromium:
//                           npx playwright install chromium)
// Screenshots go to e2e/screenshots/.

import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';

const { chromium } = await import(process.env.PLAYWRIGHT_CORE ?? 'playwright-core');

const root = new URL('..', import.meta.url).pathname;
const shots = join(root, 'e2e', 'screenshots');
mkdirSync(shots, { recursive: true });

// A test copy of the extension, with host access granted at install unless
// `access` is false (the user who denies Chrome's prompt). The browser's
// language can't be changed from a test on every system, so a copy for
// another language keeps only that language's messages.
const copies = [];
function testCopy(lang = 'en', access = true) {
    const dir = mkdtempSync(join(tmpdir(), 'coddy-focus-'));
    copies.push(dir);
    cpSync(join(root, 'src'), dir, { recursive: true });
    const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'));
    if (access) manifest.host_permissions = ['*://*/*'];
    if (lang !== 'en') {
        manifest.default_locale = lang;
        for (const other of readdirSync(join(dir, '_locales'))) {
            if (other !== lang) rmSync(join(dir, '_locales', other), { recursive: true });
        }
    }
    writeFileSync(join(dir, 'manifest.json'), JSON.stringify(manifest));
    return dir;
}

const server = createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end(`<!doctype html><title>${req.headers.host}${req.url}</title><h1>site ${req.headers.host}${req.url}</h1>`);
}).listen(0, '127.0.0.1');
await new Promise((r) => server.on('listening', r));
const port = server.address().port;
const site = (host, path = '/') => `http://${host}:${port}${path}`;

async function launch({ lang = 'en', colorScheme = 'light', access = true } = {}) {
    const ext = testCopy(lang, access);
    const context = await chromium.launchPersistentContext('', {
        channel: 'chromium',
        headless: true,
        colorScheme,
        args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`, `--host-resolver-rules=MAP *.test 127.0.0.1`],
    });
    const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
    const id = new URL(worker.url()).host;
    const errors = [];
    context.on('page', (page) => {
        page.on('pageerror', (e) => errors.push(`${page.url()}: ${e.message}`));
        page.on('console', (m) => m.type() === 'error' && errors.push(`${page.url()}: ${m.text()}`));
    });
    // The install opens the settings page.
    const isOptions = (p) => p.url().includes(`${id}/pages/options.html`);
    for (let i = 0; i < 100 && !context.pages().some(isOptions); i++) await new Promise((r) => setTimeout(r, 100));
    assert.ok(context.pages().some(isOptions), 'installing opens the settings page');
    for (const p of context.pages().filter(isOptions)) await p.close();
    const page = await context.newPage();
    await page.goto(`chrome-extension://${id}/pages/options.html`);
    const send = (type, payload = {}) => page.evaluate(([type, payload]) => chrome.runtime.sendMessage({ type, ...payload }), [type, payload]).then((r) => {
        if (!r.ok) throw new Error(r.error);
        return r.result;
    });
    return { context, worker, id, page, send, errors };
}

const settingsWith = (entries, extra = {}) => ({ entries, allowanceMinutes: 30, ...extra });
const step = (name) => console.log(`- ${name}`);

const { context, worker, id, page, send, errors } = await launch();
const blockedPrefix = `chrome-extension://${id}/pages/blocked.html?`;

step('a used-up allowance sends the site to the blocked page');
await send('save', { settings: settingsWith([{ pattern: 'distract.test', mode: 'limited' }], { allowanceMinutes: 0 }) });
const tab = await context.newPage();
await tab.goto(site('distract.test', '/watch?v=1&t=2'));
await tab.waitForURL(`${blockedPrefix}**`);
assert.equal(tab.url(), `${blockedPrefix}u=${site('distract.test', '/watch?v=1&t=2')}`);
await tab.locator('h1').filter({ hasText: 'distract.test is blocked' }).waitFor();
await tab.locator('#reason').filter({ hasText: "You used today's time. It opens again at midnight." }).waitFor();
assert.match(await tab.locator('#learn').getAttribute('href'), /^https:\/\/coddy\.tech\/\?utm_source=focus_extension&utm_medium=blocked_page$/);
await tab.setViewportSize({ width: 1000, height: 700 });
await tab.screenshot({ path: join(shots, 'blocked-light.png') });

step('a subdomain is covered, an unlisted site is not');
await tab.goto(site('www.distract.test'));
await tab.waitForURL(`${blockedPrefix}**`);
await tab.goto(site('fine.test'));
assert.equal(await tab.locator('h1').textContent(), `site fine.test:${port}/`);

step('a path entry blocks that path only');
await send('save', { settings: settingsWith([{ pattern: 'forum.test/r/all', mode: 'blocked' }]) });
await tab.goto(site('forum.test', '/r/all/top'));
await tab.waitForURL(`${blockedPrefix}**`);
await tab.locator('#reason').filter({ hasText: /always blocked/ }).waitFor();
await tab.goto(site('forum.test', '/r/allthings'));
assert.equal(await tab.locator('h1').textContent(), `site forum.test:${port}/r/allthings`);

step('starting a focus session moves open tabs to the blocked page');
await send('save', { settings: settingsWith([{ pattern: 'video.test', mode: 'limited' }]) });
await tab.goto(site('video.test', '/clip'));
assert.equal(await tab.locator('h1').textContent(), `site video.test:${port}/clip`);
await send('startFocus');
await tab.waitForURL(`${blockedPrefix}**`);
await tab.locator('#reason').filter({ hasText: /focus session/ }).waitFor();
let s = await send('status');
assert.equal(s.focus.phase, 'work');

step('stopping it opens the site again');
await send('stopFocus');
await tab.locator('h1').filter({ hasText: 'video.test is open again' }).waitFor();
await tab.locator('#back').click();
await tab.waitForURL(site('video.test', '/clip'));

step('"Go back" from a moved tab skips the blocked site instead of looping');
await tab.goto(site('fine.test', '/before'));
await tab.goto(site('video.test', '/clip'));
await send('startFocus');
await tab.waitForURL(`${blockedPrefix}moved&u=**`);
await tab.locator('#back').click();
await tab.waitForURL(site('fine.test', '/before'));
await send('stopFocus');

step('strict mode applies tightening now and keeps loosening for midnight');
await send('save', { settings: settingsWith([{ pattern: 'video.test', mode: 'limited' }], { strict: true }) });
s = await send('save', { settings: settingsWith([{ pattern: 'new.test', mode: 'blocked' }], { strict: true, allowanceMinutes: 90 }) });
assert.deepEqual(s.settings.entries.map((e) => e.pattern).sort(), ['new.test', 'video.test']);
assert.equal(s.settings.allowanceMinutes, 30);
assert.ok(s.pending);
assert.equal(new Date(s.pending.applyAt).getHours(), 0);
s = await send('cancelPending');
assert.equal(s.pending, null);

step('a lockdown blocks everything and cannot be shortened');
s = await send('startLockdown', { minutes: 120 });
const until = s.lockdown.until;
s = await send('startLockdown', { minutes: 30 });
assert.equal(s.lockdown.until, until);
await tab.goto(site('video.test'));
await tab.waitForURL(`${blockedPrefix}**`);
await tab.locator('#reason').filter({ hasText: /Lockdown is on until/ }).waitFor();

step('hiding YouTube Shorts registers the YouTube script');
s = await send('save', { settings: { ...s.settings, hide: { ...s.settings.hide, ytShorts: true } } });
const scripts = await worker.evaluate(() => chrome.scripting.getRegisteredContentScripts());
assert.deepEqual(scripts.map((x) => x.id), ['hide-youtube']);

step('the popup shows the lockdown');
const popup = await context.newPage();
await popup.goto(`chrome-extension://${id}/pages/popup.html`);
await popup.locator('#status').filter({ hasText: 'Lockdown is on' }).waitFor();

step('statistics older than 30 days are pruned even with no new time');
await worker.evaluate(() => chrome.storage.local.set({ stats: { days: { '2020-01-01': { allowance: 60, sites: { 'video.test': 60 } } } } }));
await send('status');
assert.deepEqual((await worker.evaluate(() => chrome.storage.local.get('stats'))).stats, { days: {} });

assert.deepEqual(errors, []);
await context.close();

step('extending a lockdown also holds back a removal queued before it');
{
    const b = await launch();
    await b.send('save', {
        settings: settingsWith([
            { pattern: 'video.test', mode: 'limited' },
            { pattern: 'forum.test', mode: 'limited' },
        ]),
    });
    let st = await b.send('startLockdown', { minutes: 30 });
    st = await b.send('save', { settings: settingsWith([{ pattern: 'video.test', mode: 'limited' }]) });
    assert.equal(st.settings.entries.length, 2, 'the removal waits');
    assert.equal(st.pending.applyAt, st.lockdown.until);
    st = await b.send('startLockdown', { minutes: 120 });
    assert.ok(st.lockdown.until > st.now + 100 * 60000);
    assert.equal(st.pending.applyAt, st.lockdown.until, 'the removal now waits for the longer lockdown');
    assert.deepEqual(b.errors, []);
    await b.context.close();
}

step('without site access a site is still blocked, and the page says time is not counted');
{
    const b = await launch({ access: false });
    const st = await b.send('save', { settings: settingsWith([{ pattern: 'distract.test', mode: 'limited' }], { allowanceMinutes: 0 }) });
    assert.equal(Object.values(st.access)[0], false);
    const blockedTab = await b.context.newPage();
    await assert.rejects(blockedTab.goto(site('distract.test')), /ERR_BLOCKED_BY_CLIENT/);
    await b.page.goto(`chrome-extension://${b.id}/pages/options.html#sites`);
    await b.page.locator('#site-list .access').filter({ hasText: "can't count your time there" }).waitFor();
    assert.deepEqual(b.errors, []);
    await b.context.close();
}

step('in an incognito window, a new load and an open tab both end on the browser\'s error page');
{
    // Playwright can't open incognito windows, and the browser only lets an
    // extension in when the user allows it. Loading it over the DevTools
    // socket with incognito allowed stands in for that switch, and the
    // extension opens the windows itself.
    const profile = mkdtempSync(join(tmpdir(), 'coddy-focus-profile-'));
    copies.push(profile);
    const ctx = await chromium.launchPersistentContext(profile, {
        channel: 'chromium',
        headless: true,
        ignoreDefaultArgs: ['--disable-extensions'],
        args: ['--enable-unsafe-extension-debugging', '--remote-debugging-port=0', '--host-resolver-rules=MAP *.test 127.0.0.1'],
    });
    let active;
    for (let i = 0; i < 50 && !active; i++) {
        try {
            active = readFileSync(join(profile, 'DevToolsActivePort'), 'utf8');
        } catch {
            await new Promise((r) => setTimeout(r, 100));
        }
    }
    const [devPort, devPath] = active.trim().split('\n');
    const ws = new WebSocket(`ws://127.0.0.1:${devPort}${devPath}`);
    await new Promise((r) => ws.addEventListener('open', r));
    let callId = 0;
    const cdp = (method, params = {}, sessionId) =>
        new Promise((resolve, reject) => {
            const id = ++callId;
            ws.addEventListener('message', function on(e) {
                const d = JSON.parse(e.data);
                if (d.id !== id) return;
                ws.removeEventListener('message', on);
                d.error ? reject(new Error(d.error.message)) : resolve(d.result);
            });
            ws.send(JSON.stringify({ id, method, params, sessionId }));
        });
    const { id: extId } = await cdp('Extensions.loadUnpacked', { path: testCopy(), enableInIncognito: true });
    const p = await ctx.newPage();
    await p.goto(`chrome-extension://${extId}/pages/options.html`);
    const call = (msg) => p.evaluate((msg) => chrome.runtime.sendMessage(msg), msg);
    assert.equal(await p.evaluate(() => chrome.extension.isAllowedIncognitoAccess()), true);

    // What the incognito tab shows, read through DevTools: the extension
    // itself can't see incognito tabs' addresses without the tabs permission.
    const incognitoPage = async () => {
        for (let i = 0; i < 40; i++) {
            const { targetInfos } = await cdp('Target.getTargets');
            const target = targetInfos.find((t) => t.type === 'page' && t.url.includes('/pages/blocked.html?'));
            if (target) {
                const { sessionId } = await cdp('Target.attachToTarget', { targetId: target.targetId, flatten: true });
                const { result } = await cdp('Runtime.evaluate', { expression: 'document.body?.className', returnByValue: true }, sessionId);
                if (result.value) return { url: target.url, bodyClass: result.value };
            }
            await new Promise((r) => setTimeout(r, 250));
        }
        throw new Error('no blocked incognito tab');
    };

    await call({ type: 'save', settings: settingsWith([{ pattern: 'distract.test', mode: 'limited' }], { allowanceMinutes: 0 }) });
    let win = await p.evaluate((url) => chrome.windows.create({ incognito: true, url }).then((w) => w.id), site('distract.test'));
    let shown = await incognitoPage();
    assert.match(shown.url, /blocked\.html\?u=http:\/\/distract\.test/);
    assert.equal(shown.bodyClass, 'neterror');
    await p.evaluate((id) => chrome.windows.remove(id), win);

    await call({ type: 'save', settings: settingsWith([{ pattern: 'video.test', mode: 'limited' }]) });
    win = await p.evaluate((url) => chrome.windows.create({ incognito: true, url }).then((w) => w.id), site('video.test', '/clip'));
    for (let i = 0; i < 40; i++) {
        const { targetInfos } = await cdp('Target.getTargets');
        if (targetInfos.some((t) => t.title === `video.test:${port}/clip`)) break;
        await new Promise((r) => setTimeout(r, 250));
    }
    await call({ type: 'startFocus' });
    shown = await incognitoPage();
    assert.match(shown.url, /blocked\.html\?moved&u=http:\/\/video\.test/);
    assert.equal(shown.bodyClass, 'neterror');
    await p.evaluate((id) => chrome.windows.remove(id), win);

    ws.close();
    await ctx.close();
}

/**
 * A browser with a believable day for the screenshots: three sites, some
 * time spent, the tabs of the settings page, the popup and a blocked page.
 */
async function tour({ lang, colorScheme, name }) {
    step(`screenshots: ${name}`);
    const b = await launch({ lang, colorScheme });
    const now = new Date();
    const day = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    await b.worker.evaluate((day) => chrome.storage.local.set({ stats: { days: { [day]: { allowance: 720, sites: { 'youtube.com': 480, 'reddit.com': 240, 'distract.test': 90 } } } } }), day);
    await b.send('save', {
        settings: settingsWith([
            { pattern: 'youtube.com', mode: 'limited' },
            { pattern: 'reddit.com', mode: 'limited' },
            { pattern: 'distract.test', mode: 'blocked' },
        ]),
    });
    const page = b.page;
    const shot = async (file, width, height, fullPage = true) => {
        await page.setViewportSize({ width, height });
        await page.waitForTimeout(250);
        await page.screenshot({ path: join(shots, `${name}-${file}.png`), fullPage });
    };
    for (const tab of ['today', 'sites', 'limits', 'focus', 'hide', 'more']) {
        await page.goto(`chrome-extension://${b.id}/pages/options.html#${tab}`);
        await page.locator(`#${tab}:not([hidden])`).waitFor();
        await page.locator('#tab-today').waitFor();
        await shot(tab, 1280, 860);
    }
    await page.goto(`chrome-extension://${b.id}/pages/options.html#today`);
    await page.locator('#today-status .status-big').waitFor();
    await shot('today-phone', 390, 844);

    const popup = await b.context.newPage();
    await popup.setViewportSize({ width: 360, height: 520 });
    await popup.goto(`chrome-extension://${b.id}/pages/popup.html`);
    await popup.locator('#status .status-big').waitFor();
    await popup.screenshot({ path: join(shots, `${name}-popup.png`) });

    const blocked = await b.context.newPage();
    await blocked.setViewportSize({ width: 1000, height: 700 });
    await blocked.goto(site('distract.test'));
    await blocked.waitForURL(`chrome-extension://${b.id}/pages/blocked.html?u=**`);
    await blocked.locator('#reason').filter({ hasText: /./ }).waitFor();
    if (lang === 'ar') assert.equal(await blocked.evaluate(() => document.documentElement.dir), 'rtl');
    await blocked.screenshot({ path: join(shots, `${name}-blocked.png`) });

    assert.deepEqual(b.errors, []);
    await b.context.close();
}

await tour({ lang: 'en', colorScheme: 'light', name: 'en-light' });
await tour({ lang: 'ar', colorScheme: 'dark', name: 'ar-dark' });

server.close();
for (const dir of copies) rmSync(dir, { recursive: true, force: true });
console.log(`ok, screenshots in ${shots}`);
