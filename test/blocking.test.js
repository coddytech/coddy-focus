import { test } from 'node:test';
import assert from 'node:assert/strict';
import { blockedTarget, buildRules, evaluate } from '../src/lib/blocking.js';
import { normalizeSettings } from '../src/lib/settings.js';
import { advanceFocus, holdPending, startFocus, startLockdown } from '../src/lib/sessions.js';
import { addTime, flush, prune, summary, usedToday } from '../src/lib/stats.js';

const at = (y, m, d, h, min = 0) => new Date(y, m - 1, d, h, min).getTime();
const MON_10 = at(2026, 11, 2, 10);

const settings = normalizeSettings({
    entries: [
        { id: 'yt', pattern: 'youtube.com', mode: 'limited' },
        { id: 'tt', pattern: 'tiktok.com', mode: 'blocked' },
    ],
    allowanceMinutes: 30,
});
const reasons = (ev) => Object.fromEntries(ev.blocked.map((b) => [b.entry.id, b.reason]));

test('always-blocked sites are blocked, limited ones wait for the allowance', () => {
    const ev = evaluate({ settings, usedSeconds: 600, lockdown: null, focus: null, now: MON_10 });
    assert.deepEqual(reasons(ev), { tt: 'blocked' });
    assert.equal(ev.remainingSeconds, 1200);
    assert.equal(ev.blocked[0].until, null);
});

test('a used-up allowance blocks limited sites until midnight', () => {
    const ev = evaluate({ settings, usedSeconds: 1800, lockdown: null, focus: null, now: MON_10 });
    assert.deepEqual(reasons(ev), { yt: 'limit', tt: 'blocked' });
    assert.equal(ev.blocked.find((b) => b.entry.id === 'yt').until, at(2026, 11, 3, 0));
    assert.equal(ev.nextChangeAt, at(2026, 11, 3, 0));
});

test('outside the schedule nothing is blocked', () => {
    const scheduled = normalizeSettings({
        ...settings,
        schedule: { enabled: true, days: [1, 2, 3, 4, 5], start: 9 * 60, end: 17 * 60 },
    });
    const evening = evaluate({ settings: scheduled, usedSeconds: 9999, lockdown: null, focus: null, now: at(2026, 11, 2, 18) });
    assert.deepEqual(reasons(evening), {});
    assert.equal(evening.limitsApply, false);
    const day = evaluate({ settings: scheduled, usedSeconds: 9999, lockdown: null, focus: null, now: MON_10 });
    assert.equal(day.blocked.find((b) => b.entry.id === 'yt').until, at(2026, 11, 2, 17));
    assert.equal(day.nextChangeAt, at(2026, 11, 2, 17));
});

test('focus and lockdown block every site and outrank other reasons', () => {
    const focus = startFocus(settings, MON_10);
    const ev = evaluate({ settings, usedSeconds: 0, lockdown: null, focus, now: MON_10 + 1000 });
    assert.deepEqual(reasons(ev), { yt: 'focus', tt: 'focus' });
    assert.equal(ev.nextChangeAt, MON_10 + 25 * 60000);

    const lockdown = startLockdown(null, 120, MON_10);
    const locked = evaluate({ settings, usedSeconds: 0, lockdown, focus, now: MON_10 + 1000 });
    assert.deepEqual(reasons(locked), { yt: 'lockdown', tt: 'lockdown' });
    assert.equal(locked.lockdownActive, true);
});

test('a focus break blocks nothing extra and the session then ends', () => {
    const focus = startFocus(settings, MON_10);
    const onBreak = advanceFocus(focus, settings, MON_10 + 26 * 60000);
    assert.equal(onBreak.phase, 'break');
    assert.equal(onBreak.endsAt, MON_10 + 30 * 60000);
    assert.deepEqual(reasons(evaluate({ settings, usedSeconds: 0, lockdown: null, focus: onBreak, now: MON_10 + 26 * 60000 })), { tt: 'blocked' });
    assert.equal(advanceFocus(focus, settings, MON_10 + 31 * 60000), null);
});

test('a lockdown can be extended but never shortened', () => {
    const long = startLockdown(null, 240, MON_10);
    assert.equal(startLockdown(long, 60, MON_10).until, long.until);
    assert.ok(startLockdown(long, 480, MON_10).until > long.until);
    assert.equal(startLockdown(null, 1, MON_10).until, MON_10 + 15 * 60000);
});

test('extending a lockdown also holds back changes queued before it', () => {
    // The reviewer's case: a 30-minute lockdown, a removal queued for its end,
    // then the lockdown extended to two hours.
    const short = startLockdown(null, 30, MON_10);
    const pending = holdPending({ settings: {}, applyAt: 0 }, short);
    assert.equal(pending.applyAt, short.until);
    const long = startLockdown(short, 120, MON_10 + 60000);
    assert.equal(holdPending(pending, long).applyAt, long.until);
    // A change due later than the lockdown (strict mode's midnight) keeps its time.
    const midnight = { settings: {}, applyAt: at(2026, 11, 3, 0) };
    assert.equal(holdPending(midnight, long), midnight);
    assert.equal(holdPending(pending, null), pending);
});

test('rules redirect to the blocked page, or plain-block without access', () => {
    const ev = evaluate({ settings, usedSeconds: 1800, lockdown: null, focus: null, now: MON_10 });
    const rules = buildRules(ev.blocked, {
        blockedPageUrl: 'chrome-extension://id/pages/blocked.html',
        hasAccess: (e) => e.id === 'yt',
    });
    assert.equal(rules.length, 2);
    assert.deepEqual(rules[0], {
        id: 1,
        priority: 1,
        condition: { requestDomains: ['youtube.com'], resourceTypes: ['main_frame'], regexFilter: '^https?://.*$' },
        action: { type: 'redirect', redirect: { regexSubstitution: 'chrome-extension://id/pages/blocked.html?u=\\0' } },
    });
    assert.deepEqual(rules[1].action, { type: 'block' });
});

test('path rules match the path and below it only', () => {
    const [rule] = buildRules([{ entry: { id: 'r', pattern: 'reddit.com/r/all.top' } }], {
        blockedPageUrl: 'x',
        hasAccess: () => true,
    });
    const re = new RegExp(rule.condition.regexFilter, 'i');
    assert.ok(re.test('https://www.reddit.com/r/all.top'));
    assert.ok(re.test('https://www.reddit.com/r/all.top/?t=day'));
    assert.ok(!re.test('https://www.reddit.com/r/allxtop'));
    assert.ok(!re.test('https://www.reddit.com/r/all.topics'));
});

test('the blocked page reads the original address back whole', () => {
    assert.equal(blockedTarget('?u=https://www.youtube.com/watch?v=1&t=2'), 'https://www.youtube.com/watch?v=1&t=2');
    assert.equal(blockedTarget(''), '');
    assert.equal(blockedTarget('?moved&u=https://x.com/home'), 'https://x.com/home');
});

test('time is counted per site and against the allowance only when it should be', () => {
    let stats = { days: {} };
    stats = addTime(stats, MON_10, 120, 'youtube.com', true);
    stats = addTime(stats, MON_10, 60, 'youtube.com', false);
    assert.equal(usedToday(stats, MON_10), 120);
    assert.deepEqual(summary(stats, MON_10), [{ pattern: 'youtube.com', today: 180, span: 180 }]);
});

test('a long gap is capped and time before midnight is dropped', () => {
    const tracking = { pattern: 'youtube.com', countsAllowance: true };
    const capped = flush({ days: {} }, { ...tracking, since: MON_10 - 3600000 }, MON_10, 120000);
    assert.equal(usedToday(capped.stats, MON_10), 120);
    const justAfterMidnight = at(2026, 11, 3, 0, 1);
    const split = flush({ days: {} }, { ...tracking, since: at(2026, 11, 2, 23, 59) }, justAfterMidnight, 600000);
    assert.equal(usedToday(split.stats, justAfterMidnight), 60);
});

test('incognito time counts against the allowance but records no site', () => {
    const tracking = { pattern: 'youtube.com', countsAllowance: true, incognito: true, since: MON_10 };
    const { stats } = flush({ days: {} }, tracking, MON_10 + 60000, 120000);
    assert.equal(usedToday(stats, MON_10), 60);
    assert.deepEqual(summary(stats, MON_10), []);
});

test('days older than KEEP_DAYS are pruned, with or without new time', () => {
    const old = { days: { '2026-09-01': { allowance: 60, sites: { 'x.com': 60 } } } };
    assert.deepEqual(prune(old, MON_10), { days: {} });
    const kept = { days: { '2026-10-20': { allowance: 60, sites: { 'x.com': 60 } } } };
    assert.deepEqual(prune(kept, MON_10), kept);
});

test('fractions of a second carry over instead of being lost', () => {
    const tracking = { pattern: 'youtube.com', countsAllowance: true, since: MON_10 };
    const result = flush({ days: {} }, tracking, MON_10 + 2700, 120000);
    assert.equal(usedToday(result.stats, MON_10), 2);
    assert.equal(result.carryMs, 700);
});

test('old days are pruned', () => {
    let stats = addTime({ days: {} }, at(2026, 9, 1, 10), 60, 'a.com', true);
    stats = addTime(stats, MON_10, 60, 'a.com', true);
    assert.deepEqual(Object.keys(stats.days), ['2026-11-02']);
});
