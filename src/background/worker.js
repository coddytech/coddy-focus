// The extension's single source of truth. Pages send it messages; it reads
// and writes chrome.storage, keeps the browser's blocking rules in sync,
// counts time on listed sites and wakes itself with alarms. It never makes
// a network request (the manifest's CSP forbids it, and `npm run check`
// fails the build if one appears).

import { MOVED_PREFIX, blockedTarget, buildRules, evaluate } from '../lib/blocking.js';
import { advanceFocus, activeLockdown, holdPending, startFocus, startLockdown } from '../lib/sessions.js';
import { normalizeSettings, splitChange } from '../lib/settings.js';
import { matchingEntries, matchesUrl, originsFor } from '../lib/sites.js';
import { flush, prune, usedToday } from '../lib/stats.js';
import { MINUTE, nextMidnight } from '../lib/time.js';

const BLOCKED_PAGE = chrome.runtime.getURL('pages/blocked.html');
const WAKE_ALARM = 'wake';
const TICK_ALARM = 'tick';
// Time is flushed at least once a minute while a listed site is open; a
// longer gap means the computer slept or the browser stalled, so it is not
// counted.
const MAX_GAP_MS = 2 * MINUTE;
const IDLE_SECONDS = 60;

// Content scripts that hide parts of sites, registered only while one of
// their switches is on and the user has given access to the site.
const HIDE_SCRIPTS = [
    {
        id: 'hide-youtube',
        keys: ['ytShorts', 'ytComments', 'ytRecommendations'],
        matches: ['*://*.youtube.com/*'],
        js: ['content/youtube.js'],
        css: ['content/youtube.css'],
    },
    {
        id: 'hide-instagram',
        keys: ['igReels'],
        matches: ['*://*.instagram.com/*'],
        js: ['content/instagram.js'],
        css: ['content/instagram.css'],
    },
];

// Every change runs through one queue, so two events never read and write
// the same state at once.
let queue = Promise.resolve();
function enqueue(task) {
    const run = queue.then(task);
    queue = run.catch((error) => console.error('[coddy-focus]', error));
    return run;
}

const STATE_KEYS = ['settings', 'stats', 'lockdown', 'focus', 'pending'];

async function readState() {
    const stored = await chrome.storage.local.get(STATE_KEYS);
    const state = {
        settings: normalizeSettings(stored.settings),
        stats: stored.stats ?? { days: {} },
        lockdown: stored.lockdown ?? null,
        focus: stored.focus ?? null,
        pending: stored.pending ?? null,
    };
    // What was read, to write back only what changed: pages re-render on
    // every storage change, and a write on every refresh would loop.
    Object.defineProperty(state, 'readKeys', {
        value: Object.fromEntries(STATE_KEYS.map((k) => [k, JSON.stringify(stored[k] ?? null)])),
        enumerable: false,
    });
    return state;
}

async function writeState(state) {
    const changed = {};
    for (const key of STATE_KEYS) {
        if (JSON.stringify(state[key] ?? null) !== state.readKeys?.[key]) changed[key] = state[key];
    }
    if (Object.keys(changed).length) await chrome.storage.local.set(changed);
}

async function accessMap(entries) {
    const pairs = await Promise.all(
        entries.map(async (e) => [e.id, await chrome.permissions.contains({ origins: originsFor(e.pattern) })])
    );
    return new Map(pairs);
}

async function syncRules(blocked, access) {
    const rules = buildRules(blocked, { blockedPageUrl: BLOCKED_PAGE, hasAccess: (e) => access.get(e.id) });
    const existing = await chrome.declarativeNetRequest.getDynamicRules();
    const same =
        existing.length === rules.length &&
        rules.every((r, i) => JSON.stringify(r.condition) === JSON.stringify(existing[i].condition) && JSON.stringify(r.action) === JSON.stringify(existing[i].action));
    if (same) return;
    await chrome.declarativeNetRequest.updateDynamicRules({
        removeRuleIds: existing.map((r) => r.id),
        addRules: rules,
    });
}

/**
 * Rules only stop new page loads, so tabs already open on a site that just
 * became blocked (and single-page sites that change address without a page
 * load) are sent to the blocked page here.
 */
async function enforceTabs(blocked, access) {
    for (const { entry } of blocked) {
        if (!access.get(entry.id)) continue;
        const tabs = await chrome.tabs.query({ url: originsFor(entry.pattern) });
        for (const tab of tabs) {
            if (tab.url && matchesUrl(entry.pattern, tab.url)) {
                await chrome.tabs.update(tab.id, { url: `${BLOCKED_PAGE}${MOVED_PREFIX}${tab.url}` }).catch(() => {});
            }
        }
    }
}

/**
 * What to count from now on: the listed site in the active tab of the
 * focused window, unless the screen is locked, or the user is away and
 * nothing is playing. The extension only sees addresses of sites it has
 * access to, so a listed site without access is never counted, and it
 * cannot see anything else. Incognito time counts against the allowance
 * but is not recorded per site (stats.flush).
 */
async function nextTracking(settings, ev, now) {
    const { idleState = 'active' } = await chrome.storage.session.get('idleState');
    if (idleState === 'locked') return null;
    const win = await chrome.windows.getLastFocused().catch(() => null);
    if (!win?.focused) return null;
    const [tab] = await chrome.tabs.query({ active: true, windowId: win.id });
    if (!tab?.url) return null;
    if (idleState === 'idle' && !tab.audible) return null;
    const matches = matchingEntries(settings.entries, tab.url);
    if (!matches.length) return null;
    const blockedIds = new Set(ev.blocked.map((b) => b.entry.id));
    if (matches.some((e) => blockedIds.has(e.id))) return null;
    return {
        pattern: matches[0].pattern,
        countsAllowance: ev.limitsApply && matches.some((e) => e.mode === 'limited'),
        incognito: tab.incognito,
        since: now,
    };
}

async function updateBadge(focus, now) {
    const working = focus?.phase === 'work' && focus.endsAt > now;
    await chrome.action.setBadgeBackgroundColor({ color: '#0077ff' });
    await chrome.action.setBadgeText({ text: working ? String(Math.ceil((focus.endsAt - now) / MINUTE)) : '' });
}

/**
 * Brings everything up to date at this moment: applies due changes, ends
 * finished sessions, credits the time spent, re-decides what is blocked,
 * updates rules and tabs, and sets the next wake-up.
 */
async function refresh() {
    const now = Date.now();
    const state = await readState();

    state.lockdown = activeLockdown(state.lockdown, now);
    state.pending = holdPending(state.pending, state.lockdown);
    if (state.pending && state.pending.applyAt <= now) {
        state.settings = normalizeSettings(state.pending.settings);
        state.pending = null;
        await syncContentScripts(state.settings);
    }
    state.focus = advanceFocus(state.focus, state.settings, now);

    const { tracking } = await chrome.storage.session.get('tracking');
    let carryMs = 0;
    if (tracking) ({ stats: state.stats, carryMs } = flush(state.stats, tracking, now, MAX_GAP_MS));
    // Also prune here, not only when time is added, so days past KEEP_DAYS go
    // even when no listed site is visited again.
    state.stats = prune(state.stats, now);

    const ev = evaluate({
        settings: state.settings,
        usedSeconds: usedToday(state.stats, now),
        lockdown: state.lockdown,
        focus: state.focus,
        now,
    });
    const access = await accessMap(state.settings.entries);
    await syncRules(ev.blocked, access);
    await enforceTabs(ev.blocked, access);

    const next = await nextTracking(state.settings, ev, now);
    // Whole seconds are credited; the leftover fraction carries over while
    // the same site stays open, so frequent events don't lose time.
    if (next && tracking?.pattern === next.pattern) next.since -= carryMs;
    await chrome.storage.session.set({ tracking: next });

    let wakeAt = ev.nextChangeAt;
    if (state.pending) wakeAt = Math.min(wakeAt, state.pending.applyAt);
    if (next?.countsAllowance) wakeAt = Math.min(wakeAt, now + ev.remainingSeconds * 1000 + 500);
    await chrome.alarms.create(WAKE_ALARM, { when: Math.max(wakeAt, now + 1000) });
    if (next || state.focus) {
        if (!(await chrome.alarms.get(TICK_ALARM))) {
            await chrome.alarms.create(TICK_ALARM, { periodInMinutes: 1 });
        }
    } else {
        await chrome.alarms.clear(TICK_ALARM);
    }

    await updateBadge(state.focus, now);
    await writeState(state);
    return { state, ev, access, now };
}

async function syncContentScripts(settings) {
    const registered = new Set((await chrome.scripting.getRegisteredContentScripts()).map((s) => s.id));
    for (const script of HIDE_SCRIPTS) {
        const wanted =
            script.keys.some((k) => settings.hide[k]) &&
            (await chrome.permissions.contains({ origins: script.matches }));
        if (wanted && !registered.has(script.id)) {
            await chrome.scripting.registerContentScripts([
                {
                    id: script.id,
                    matches: script.matches,
                    js: script.js,
                    css: script.css,
                    runAt: 'document_start',
                    allFrames: false,
                },
            ]);
        } else if (!wanted && registered.has(script.id)) {
            await chrome.scripting.unregisterContentScripts({ ids: [script.id] });
        }
    }
}

/** What the popup and the settings page show. */
async function status() {
    const { state, ev, access, now } = await refresh();
    return {
        now,
        settings: state.settings,
        pending: state.pending,
        lockdown: state.lockdown,
        focus: state.focus,
        stats: state.stats,
        limitsApply: ev.limitsApply,
        scheduleChange: ev.scheduleChange,
        allowanceSeconds: ev.allowanceSeconds,
        remainingSeconds: ev.remainingSeconds,
        blocked: ev.blocked.map((b) => ({ id: b.entry.id, pattern: b.entry.pattern, reason: b.reason, until: b.until })),
        access: Object.fromEntries(access),
        incognitoAllowed: await chrome.extension.isAllowedIncognitoAccess(),
    };
}

/**
 * Saves new settings. While strict mode is on, or during a lockdown, only
 * the stricter part applies now; the rest waits until midnight (strict
 * mode) or until the lockdown ends, whichever is later.
 */
async function save(raw) {
    const now = Date.now();
    const state = await readState();
    const next = normalizeSettings(raw);
    const lockdown = activeLockdown(state.lockdown, now);
    const strict = state.settings.strict;
    if (strict || lockdown) {
        const { now: applied, later } = splitChange(state.settings, next);
        state.settings = applied;
        state.pending = later
            ? { settings: later, applyAt: Math.max(strict ? nextMidnight(now) : 0, lockdown?.until ?? 0) }
            : null;
    } else {
        state.settings = next;
        state.pending = null;
    }
    await writeState(state);
    await syncContentScripts(state.settings);
}

async function update(change) {
    const state = await readState();
    await writeState(Object.assign(state, change(state, Date.now())));
}

const handlers = {
    status: () => status(),
    save: async ({ settings }) => {
        await save(settings);
        return status();
    },
    cancelPending: async () => {
        await update(() => ({ pending: null }));
        return status();
    },
    startFocus: async () => {
        await update((s, now) => ({ focus: startFocus(s.settings, now) }));
        return status();
    },
    stopFocus: async () => {
        await update(() => ({ focus: null }));
        return status();
    },
    startLockdown: async ({ minutes }) => {
        await update((s, now) => {
            if (!s.settings.entries.length) return {};
            const lockdown = startLockdown(activeLockdown(s.lockdown, now), minutes, now);
            return { lockdown, pending: holdPending(s.pending, lockdown) };
        });
        return status();
    },
    blockedInfo: async ({ search }) => {
        const url = blockedTarget(search);
        const { ev } = await refresh();
        const reasons = ev.blocked.filter((b) => matchesUrl(b.entry.pattern, url));
        return {
            url,
            blocked: reasons.map((b) => ({ pattern: b.entry.pattern, reason: b.reason, until: b.until })),
        };
    },
};

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    // Only the extension's own pages may change anything.
    if (sender.id !== chrome.runtime.id || !sender.url?.startsWith(chrome.runtime.getURL(''))) return false;
    const handler = handlers[message?.type];
    if (!handler) return false;
    enqueue(() => handler(message)).then(
        (result) => sendResponse({ ok: true, result }),
        (error) => sendResponse({ ok: false, error: String(error?.message ?? error) })
    );
    return true;
});

const kick = () => enqueue(refresh);

chrome.idle.setDetectionInterval(IDLE_SECONDS);
chrome.idle.onStateChanged.addListener((idleState) => {
    enqueue(async () => {
        await chrome.storage.session.set({ idleState });
        await refresh();
    });
});

chrome.alarms.onAlarm.addListener(kick);
chrome.tabs.onActivated.addListener(kick);
chrome.windows.onFocusChanged.addListener(kick);
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
    // `url` only arrives for sites the extension has access to.
    if (changeInfo.url !== undefined || changeInfo.audible !== undefined) kick();
});

const resync = () =>
    enqueue(async () => {
        const { settings } = await readState();
        await syncContentScripts(settings);
        await refresh();
    });
chrome.permissions.onAdded.addListener(resync);
chrome.permissions.onRemoved.addListener(resync);
chrome.runtime.onStartup.addListener(resync);
chrome.runtime.onInstalled.addListener(({ reason }) => {
    resync();
    if (reason === 'install') chrome.runtime.openOptionsPage();
});
