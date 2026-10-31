// Builds the Chrome Web Store images from the real extension pages: five
// 1280x800 screenshots with a caption, the 440x280 small promo tile and the
// 1400x560 marquee, plus the padded 128px icon the manifest uses. Everything is drawn offline in a headless Chromium.
//
// Run: npm run store   (needs playwright-core and its Chromium, like test:e2e)
// Output: store/images/

import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const { chromium } = await import(process.env.PLAYWRIGHT_CORE ?? 'playwright-core');

const root = new URL('..', import.meta.url).pathname;
const out = join(root, 'store', 'images');
mkdirSync(out, { recursive: true });

// A copy with host access granted, loaded with incognito allowed, so the
// pages show the state of a set-up extension and no setup notices.
const ext = mkdtempSync(join(tmpdir(), 'coddy-focus-store-'));
const profile = mkdtempSync(join(tmpdir(), 'coddy-focus-store-profile-'));
cpSync(join(root, 'src'), ext, { recursive: true });
const manifest = JSON.parse(readFileSync(join(ext, 'manifest.json'), 'utf8'));
manifest.host_permissions = ['*://*/*'];
writeFileSync(join(ext, 'manifest.json'), JSON.stringify(manifest));

const context = await chromium.launchPersistentContext(profile, {
    channel: 'chromium',
    headless: true,
    colorScheme: 'light',
    deviceScaleFactor: 2,
    ignoreDefaultArgs: ['--disable-extensions'],
    args: ['--enable-unsafe-extension-debugging', '--remote-debugging-port=0'],
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
const loaded = await new Promise((resolve) => {
    ws.addEventListener('message', (e) => resolve(JSON.parse(e.data)), { once: true });
    ws.send(JSON.stringify({ id: 1, method: 'Extensions.loadUnpacked', params: { path: ext, enableInIncognito: true } }));
});
const id = loaded.result.id;
ws.close();

const page = await context.newPage();
const pageUrl = (path) => `chrome-extension://${id}/pages/${path}`;
await page.goto(pageUrl('options.html'));
const send = (type, payload = {}) => page.evaluate(([type, payload]) => chrome.runtime.sendMessage({ type, ...payload }), [type, payload]);

// A believable day: two limited sites with time spent, two blocked ones.
const now = new Date();
const day = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
await page.evaluate((day) => chrome.storage.local.set({ stats: { days: { [day]: { allowance: 1140, sites: { 'youtube.com': 780, 'reddit.com': 360 } } } } }), day);
await send('save', {
    settings: {
        entries: [
            { pattern: 'youtube.com', mode: 'limited' },
            { pattern: 'reddit.com', mode: 'limited' },
            { pattern: 'x.com', mode: 'blocked' },
            { pattern: 'instagram.com', mode: 'blocked' },
        ],
        allowanceMinutes: 30,
        hide: { ytShorts: true, ytComments: false, ytRecommendations: true, igReels: true },
    },
});

const raw = {};
const capture = async (name, p, width, height) => {
    await p.setViewportSize({ width, height });
    await p.waitForTimeout(300);
    raw[name] = (await p.screenshot()).toString('base64');
};
for (const tab of ['today', 'sites', 'hide']) {
    await page.goto(pageUrl(`options.html#${tab}`));
    await page.locator(`#${tab}:not([hidden])`).waitFor();
    await capture(tab, page, 1180, tab === 'hide' ? 560 : 760);
}

const blocked = await context.newPage();
await blocked.goto(pageUrl('blocked.html?u=https://x.com/home'));
await blocked.locator('#reason').filter({ hasText: /./ }).waitFor();
await capture('blocked', blocked, 1180, 600);

// A focus session nine minutes in, so the timer and its bar show progress.
await send('startFocus');
await page.evaluate(async () => {
    const { focus } = await chrome.storage.local.get('focus');
    const shift = 9 * 60000 + 12000;
    await chrome.storage.local.set({ focus: { ...focus, startedAt: focus.startedAt - shift, endsAt: focus.endsAt - shift } });
});
const popup = await context.newPage();
await popup.setViewportSize({ width: 360, height: 100 });
await popup.goto(pageUrl('popup.html'));
await popup.locator('#status .status-big').waitFor();
await popup.waitForTimeout(300);
raw.popup = (await popup.screenshot({ fullPage: true })).toString('base64');
await context.close();

// The frames, drawn with the extension's own fonts and colours.
const fontData = (file) => `url(data:font/woff2;base64,${readFileSync(join(root, 'src', 'fonts', file)).toString('base64')}) format('woff2')`;
const icon = `data:image/png;base64,${readFileSync(join(root, 'src', 'icons', 'icon-128.png')).toString('base64')}`;
const css = `
    @font-face { font-family: 'Coddy Round'; font-weight: 700; src: ${fontData('coddy-round-700-latin.woff2')}; }
    @font-face { font-family: 'Varela Round'; src: ${fontData('varela-round-latin.woff2')}; }
    * { margin: 0; box-sizing: border-box; }
    body { background: #f1f5f9; color: #000000de; font-family: 'Varela Round', sans-serif; overflow: hidden; }
    h1, .name { font-family: 'Coddy Round', sans-serif; font-weight: 700; }
        .icon { border-radius: 22%; display: block; }
    .shot { border-radius: 16px; border: 2px solid #e6e6e6; box-shadow: 0 12px 40px #0000001a; background: #fff; display: block; }
`;

const browser = await chromium.launch({ channel: 'chromium', headless: true });
const draw = async (file, width, height, body, omitBackground = false) => {
    const p = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
    await p.setContent(`<!doctype html><style>${css}</style>${body}`);
    await p.evaluate(() => document.fonts.ready);
    await p.waitForTimeout(100);
    await p.screenshot({ path: join(out, file), omitBackground });
    await p.close();
};

// A screenshot: the caption on top, the page below it, running off the bottom edge.
const screenshot = (file, caption, name, imgWidth) =>
    draw(
        file,
        1280,
        800,
        `<div style="display:flex;flex-direction:column;align-items:center;gap:36px;padding-top:52px">
            <h1 style="font-size:40px;text-align:center">${caption}</h1>
            <img class="shot" src="data:image/png;base64,${raw[name]}" style="width:${imgWidth}px">
        </div>`
    );

await screenshot('1-today.png', 'See how much time you have left today', 'today', 1080);
await screenshot('2-blocked.png', 'A blocked site becomes a coding break', 'blocked', 1080);
await screenshot('3-sites.png', 'Give a site a daily limit or block it for good', 'sites', 1080);
await screenshot('4-focus.png', 'Start a focus session in one click', 'popup', 480);
await screenshot('5-hide.png', 'Hide Shorts, Reels and recommendations', 'hide', 1080);

await draw(
    'promo-small.png',
    440,
    280,
    `<div style="height:280px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;text-align:center">
        <img class="icon" src="${icon}" width="88" height="88">
        <p class="name" style="font-size:34px">Coddy Focus</p>
        <p style="font-size:17px;color:#0000008a">Less scrolling, more learning.</p>
    </div>`
);

await draw(
    'marquee.png',
    1400,
    560,
    `<div style="height:560px;display:flex;align-items:center;gap:56px;padding-inline:88px 0">
        <div style="flex:0 0 440px;display:flex;flex-direction:column;gap:18px">
            <img class="icon" src="${icon}" width="104" height="104">
            <p class="name" style="font-size:52px;line-height:1.1">Coddy Focus</p>
            <p style="font-size:22px;color:#0000008a">Less scrolling, more learning. Free, open source, and your data stays in your browser.</p>
        </div>
        <img class="shot" src="data:image/png;base64,${raw.today}" style="width:860px;margin-top:120px">
    </div>`
);
// The 128px icon in the manifest, which is also the store icon: 96px
// artwork with 16px of clear space on each side, as the store asks. The
// smaller toolbar icons and the one on the settings page stay full bleed.
await draw(
    'store-icon-128.png',
    128,
    128,
    `<style>body { background: transparent; }</style><img class="icon" src="${icon}" width="96" height="96" style="margin:16px">`,
    true
);
cpSync(join(out, 'store-icon-128.png'), join(root, 'src', 'icons', 'icon-128-padded.png'));
rmSync(join(out, 'store-icon-128.png'));
await browser.close();

rmSync(ext, { recursive: true, force: true });
rmSync(profile, { recursive: true, force: true });
console.log(`store images in ${out}`);
