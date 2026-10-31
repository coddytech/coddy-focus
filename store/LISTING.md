# Chrome Web Store listing

Everything to paste into the Chrome Web Store developer dashboard, tab by tab. The images are built by `npm run store` into `store/images/`; the zip by `npm run pack` into `dist/`.

## Package

Upload `dist/coddy-focus-<version>.zip`. The name and short description come from the zip (`_locales/*/messages.json`, keys `ext_name` and `ext_description`), in all 14 languages.

## Store listing

**Description** (English; the dashboard can take one per language later):

```
Coddy Focus blocks the sites that eat your day. It is free, open source, and your data stays in your browser.

Daily time limit
Give your distracting sites one shared daily allowance, like 30 minutes. When it runs out, they are blocked until midnight. Time only counts while the site is in the tab you're looking at, and stops when you step away (unless it's playing sound).

Always blocked
Block a site for good. Block a whole site (youtube.com, which covers its subdomains) or one part of it (reddit.com/r/all).

Schedule
Choose the days and hours your limits and blocks apply, so evenings and weekends can stay open. Focus sessions and lockdowns work anytime.

Focus sessions
Start a focus timer from the toolbar. Every site on your list is blocked until it ends, then you get a short break. You choose both lengths.

Lockdown
For when you mean it: block every site on your list for 15 minutes up to 7 days. A lockdown can't be cancelled from the extension, and changes that would loosen your limits wait until it ends.

Strict mode
Tightening your limits applies right away. Loosening them waits until midnight, so a weak moment can't undo your plan.

Hide distractions
Keep a site open but hide the parts that pull you in: YouTube Shorts, comments and recommendations, and Instagram Reels.

A coding break instead
The blocked page offers a short coding lesson on Coddy instead of more scrolling.

Private by design
• No account, no analytics, no ads.
• Your sites, limits and time stay in your browser. The extension has no code that sends data anywhere, and its security policy forbids network requests.
• Site access is asked for one site at a time, only for sites you add.
• Time per site is kept for 30 days, then deleted.
• Open source under the MIT license, so anyone can check this.

Available in English, Spanish, Portuguese, French, German, Italian, Russian, Polish, Turkish, Indonesian, Japanese, Korean, Arabic and Hebrew.
```

**Category:** Productivity → Workflow & Planning

**Language:** English (the zip's other 13 languages are picked up automatically)

**Graphics** (all in `store/images/`):

| Field | File |
| --- | --- |
| Store icon (128x128) | `src/icons/icon-128-padded.png` (the same icon the zip uses) |
| Screenshots (1280x800), in this order | `1-today.png`, `2-blocked.png`, `3-sites.png`, `4-focus.png`, `5-hide.png` |
| Small promo tile (440x280) | `promo-small.png` |
| Marquee promo tile (1400x560) | `marquee.png` |

**Official URL:** coddy.tech (needs the domain verified in Google Search Console under the publisher account; optional)

**Homepage URL:** https://github.com/coddytech/coddy-focus

**Support URL:** https://github.com/coddytech/coddy-focus/issues

## Privacy practices

**Single purpose:**

```
Coddy Focus helps people limit the time they spend on distracting websites: it blocks the sites the user lists, by a daily time limit, a schedule, a focus timer or a lockdown.
```

**Permission justifications:**

| Permission | Justification |
| --- | --- |
| `storage` | Saves the user's site list, limits and the time spent on listed sites, in the browser only. |
| `declarativeNetRequest` | Blocks the sites the user lists, or sends them to the extension's blocked page, using Chrome's built-in blocking rules. |
| `alarms` | Wakes the extension when a limit, schedule, focus session or lockdown starts or ends, and at midnight when daily time resets. |
| `idle` | Stops counting time on a listed site while the user is away from the computer, so the daily limit is fair. |
| `scripting` | Registers the scripts that hide YouTube Shorts, comments and recommendations, and Instagram Reels, only when the user switches those options on. |
| `activeTab` | Lets the toolbar popup show the site in the current tab and offer to add it to the list, when the user opens the popup. |
| `favicon` | Shows each listed site's icon from Chrome's own icon cache, without loading anything from the web. |
| Host permissions (optional, `*://*/*`) | Asked for one site at a time when the user adds that site, so the extension can count time there and move an already open tab to the blocked page. Without it the site is still blocked. |

**Remote code:** No, I am not using remote code.

**Data usage.** Chrome counts data kept only on the device as handled, so tick:

- [x] **Web history**: time spent per day on the sites the user listed, kept in the browser for 30 days.

Leave everything else unticked. Then tick all three certifications (not sold to third parties; not used or transferred for purposes unrelated to the single purpose; not used for creditworthiness or lending).

**Privacy policy URL:** https://github.com/coddytech/coddy-focus/blob/main/PRIVACY.md

## Distribution

- **Payments:** Free of charge.
- **Visibility:** Public.
- **Regions:** All regions.

## Before submitting

1. Push the repository to github.com/coddytech/coddy-focus and make it public, so the privacy policy, homepage and support links work.
2. Publish from Coddy's developer account (a group publisher, so more than one person can manage it). A new account pays a one-time $5 fee and verifies its contact email.
3. The account's trader declaration (EU) and publisher name ("Coddy") are set once in the account settings.
4. Run `npm run check`, `npm test`, `npm run test:e2e`, then `npm run pack` and upload the zip.
5. Review usually takes a few days; an extension asking for host permissions can take longer.
