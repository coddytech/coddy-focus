# Coddy Focus

A free, open-source website blocker and focus timer from [Coddy](https://coddy.tech). It sends no browsing data to Coddy or anyone else: your settings and usage statistics stay on your device.

When you hit a blocked site, Coddy Focus offers you a short coding lesson instead.

## What it does

- **Daily time:** sites on your list share a daily allowance (30 minutes by default). When it is used up, they are blocked until midnight.
- **Always blocked:** sites that are blocked whenever your limits apply.
- **Schedule:** limits can apply only on some days and hours, including overnight.
- **Focus timer:** blocks every site on your list for a work session (25 minutes by default), then gives you a break.
- **Lockdown:** blocks every site on your list for a set time. It can be made longer but never shorter.
- **Strict mode:** stricter limits apply right away; looser ones wait until midnight.
- **Hide distractions:** hide YouTube Shorts, comments and recommendations, and Instagram Reels, while keeping the sites usable.
- **Your time:** time per site today and over the last 7 days, kept on your device.
- **Backup:** save settings to a file and load them again.
- Works in 14 languages, including Arabic and Hebrew right to left, in light and dark mode.

## Privacy

The extension makes no network requests, has no analytics and keeps everything in your browser. The manifest's content security policy forbids network connections, and `npm run check` fails if network code is added. See [PRIVACY.md](PRIVACY.md).

The extension needs no access to any site at install. It asks for access to each site when you add it, so it can show its own blocked page and count your time there. If the user denies the prompt, the site is not added. A site whose access is removed later in Chrome's settings is still blocked, with the browser's plain error page, but time on it is not counted.

## Limitations

- **Incognito** is off unless you allow the extension there. When allowed, blocked sites show Chrome's own error page, because Chrome does not let a `spanning` extension open its own pages in incognito tabs; incognito time counts against the allowance without recording which site it was. `split` mode would show the blocked page but runs a second worker over the same storage, so it was not chosen.
- **Uninstalling or disabling** the extension removes every block. It adds friction, not a lock.
- **Hiding on YouTube and Instagram** depends on their page structure, which they change; the selectors are in `src/content/`.
- **Sites can detect** that the extension is installed, because the blocked page must be reachable from web pages for the redirect to work.

## How it works

There is no build step: `src/` is the extension, and the zip in the store is that folder.

| Path | What is there |
| --- | --- |
| `src/manifest.json` | Manifest V3. Permissions: `storage`, `alarms`, `idle`, `declarativeNetRequest`, `scripting`, `activeTab`, `favicon` (site icons from the browser's own cache); site access is optional and asked per site. |
| `src/lib/` | Pure logic with no browser APIs, covered by unit tests: site patterns, schedules, what is blocked and why, strict mode, stats. |
| `src/background/worker.js` | The service worker: the only place that changes state. It keeps the browser's blocking rules in sync, moves open tabs to the blocked page, counts time and wakes itself with alarms. |
| `src/pages/` | The popup, the settings page (tabs: Today, Sites, Limits, Focus, Hide, More) and the blocked page. Styles follow coddy.tech's theme tokens, controls and fonts (`common.css`); `ui.js` holds the shared controls, `status.js` the "time left" card the popup and Today tab share. |
| `src/content/` | The YouTube and Instagram scripts behind "Hide distractions", registered only while a switch is on. |
| `src/_locales/` | Translations, one `messages.json` per language. Text uses `{name}` placeholders, filled in `pages/common.js`. |

Blocking uses `declarativeNetRequest` rules, which the browser applies itself, so it keeps working while the worker sleeps. A rule's redirect sends the page to `pages/blocked.html?u=<original address>`.

## Develop

Load `src/` as an unpacked extension in `chrome://extensions` (turn on Developer mode, then **Load unpacked**).

```bash
npm test             # unit tests (node:test, no dependencies)
npm run check        # no network code, manifest, translations
npm install && npx playwright install chromium
npm run test:e2e     # loads the extension in Chromium and checks blocking end to end
npm run pack         # checks, tests, then dist/coddy-focus-<version>.zip
npm run store        # store images into store/images/ (listing text: store/LISTING.md)
```

The end-to-end test maps `*.test` names to a local server, so it sends nothing to the internet. Most of it runs on a copy granted access to every site (a test cannot click Chrome's permission prompt); one step runs on a copy with no access at all, the path of a user who denies the prompt.

## Translations

Every language has the same keys as `src/_locales/en/messages.json`. `npm run check` fails on a missing key, a changed placeholder or a dash in the copy. To add a language, copy the English file into a folder named with Chrome's locale code.

## Name and logo

The code is under the MIT license. The Coddy name, the Coddy Focus name and the Coddy logo are trademarks of Coddy and are not covered by it: a fork may use the code, but must not publish under those names or with that logo.

The fonts in `src/fonts/` (Coddy Round, Varela Round, Noto Sans Arabic) are under the SIL Open Font License, see `src/fonts/OFL.txt`.
