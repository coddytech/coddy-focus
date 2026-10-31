# Privacy

Coddy Focus sends no browsing data to Coddy or to anyone else. Your settings and usage statistics stay on your device.

## What the extension does not do

- **No network requests.** Its code never sends anything anywhere. The content security policy in `src/manifest.json` (`connect-src 'none'`) makes the browser refuse network connections from its pages and worker, and `npm run check` fails the build if network code is added.
- **No analytics, no ads, no third-party code.**
- **No reading of pages.** It never reads what a page says. The only exception is YouTube and Instagram while a "Hide" switch is on, and then only to mark the page so the parts you chose are hidden.

## What stays on your device

All of this is kept in the browser's extension storage on your device. It is not synced to other devices, and uninstalling the extension deletes it. Use **Backup** in the settings to keep a copy.

| Kept | Details |
| --- | --- |
| Your settings | The sites on your list, your limits, schedule, focus timer lengths, hide switches and strict mode |
| Time per site, per day | Only for sites on your list that you gave access to, for the last 30 days |
| Time counted against today's allowance | One number per day |
| A running lockdown or focus session | When it ends |
| Changes waiting for midnight or the end of a lockdown | The settings they will apply |

## Site access

At install the extension can't read any site. When you add a site, Chrome asks you to give it access to that site. With access, the extension shows its own blocked page and counts your time there. If you deny it, the site is not added. If you remove the access later in Chrome's settings, the site is still blocked, but with Chrome's plain error page, and **time on it is not counted**, so it does not use up your daily time.

**Site icons** come from the icons your browser already keeps for sites you visited (the `favicon` permission). Nothing is downloaded for them.

## Incognito windows

Blocking is off in incognito windows unless you allow the extension there in Chrome's extension settings. When you do:

- Blocked sites are blocked in incognito too, but show Chrome's own error page: Chrome does not let an extension like this one open its own pages in incognito tabs.
- Time on a listed site in incognito counts against your daily allowance, but **which site it was is not recorded**, so incognito leaves no history in the extension.

## Links to Coddy

The "Do a lesson instead" and "Learn on Coddy" buttons open coddy.tech. The link carries `utm_source=focus_extension` and `utm_medium` set to where you clicked (`blocked_page`, `popup` or `settings`), so Coddy can count visits that came from the extension. Nothing else is added to the link, and the extension never tells Coddy which site was blocked.

Once you are on coddy.tech, Coddy's own [privacy policy](https://coddy.tech/privacy) applies.

Questions: support@coddy.tech
