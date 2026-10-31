import { isActive, nextChange } from './schedule.js';
import { nextMidnight } from './time.js';
import { parsePattern } from './sites.js';

// Why a site is blocked, strongest first. A site can have several reasons at
// once; the blocked page shows the strongest and, when that one ends,
// the next takes over.
export const REASONS = ['lockdown', 'focus', 'blocked', 'limit'];

/**
 * Decides which entries are blocked at `now`.
 *
 * - lockdown: every entry, until the lockdown ends.
 * - focus: every entry, during the work part of a focus session.
 * - blocked: "always blocked" entries, while the schedule applies.
 * - limit: time limited entries once today's shared allowance is used up,
 *   while the schedule applies.
 *
 * `until` is when that reason ends, or null when it never ends on its own.
 * `nextChangeAt` is the next moment the answer can change without anything
 * else happening; the worker wakes up then.
 */
export function evaluate({ settings, usedSeconds, lockdown, focus, now }) {
    const limitsApply = isActive(settings.schedule, now);
    const scheduleChange = nextChange(settings.schedule, now);
    const midnight = nextMidnight(now);
    const allowanceSeconds = settings.allowanceMinutes * 60;
    const remainingSeconds = Math.max(0, allowanceSeconds - usedSeconds);
    const lockdownActive = Boolean(lockdown && lockdown.until > now);
    const focusWork = Boolean(focus && focus.phase === 'work' && focus.endsAt > now);

    const blocked = [];
    for (const entry of settings.entries) {
        let reason = null;
        let until = null;
        if (lockdownActive) {
            reason = 'lockdown';
            until = lockdown.until;
        } else if (focusWork) {
            reason = 'focus';
            until = focus.endsAt;
        } else if (limitsApply && entry.mode === 'blocked') {
            reason = 'blocked';
            until = scheduleChange;
        } else if (limitsApply && entry.mode === 'limited' && remainingSeconds <= 0) {
            reason = 'limit';
            until = Math.min(midnight, scheduleChange ?? Infinity);
        }
        if (reason) blocked.push({ entry, reason, until });
    }

    const changes = [midnight, scheduleChange, lockdownActive && lockdown.until, focus?.endsAt].filter(
        (t) => typeof t === 'number' && t > now
    );
    return {
        limitsApply,
        scheduleChange,
        allowanceSeconds,
        remainingSeconds,
        lockdownActive,
        blocked,
        nextChangeAt: Math.min(...changes),
    };
}

const escapeRegex = (text) => text.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&');

/**
 * Turns blocked entries into declarativeNetRequest rules. The browser
 * enforces these itself, so blocking keeps working while the extension's
 * worker sleeps. An entry the extension has site access for redirects to
 * the extension's blocked page (`?u=` followed by the original address);
 * one without access can only use Chrome's plain "blocked" error page.
 */
export function buildRules(blocked, { blockedPageUrl, hasAccess }) {
    const seen = new Set();
    const rules = [];
    for (const { entry } of blocked) {
        if (seen.has(entry.id)) continue;
        seen.add(entry.id);
        const site = parsePattern(entry.pattern);
        if (!site) continue;
        rules.push({
            id: rules.length + 1,
            priority: 1,
            condition: {
                requestDomains: [site.domain],
                resourceTypes: ['main_frame'],
                regexFilter: site.path
                    ? `^https?://[^/]+${escapeRegex(site.path)}(?:[/?#].*)?$`
                    : '^https?://.*$',
            },
            action: hasAccess(entry)
                ? { type: 'redirect', redirect: { regexSubstitution: `${blockedPageUrl}?u=\\0` } }
                : { type: 'block' },
        });
    }
    return rules;
}

/**
 * The blocked page's own address: `?u=<original address>`, or
 * `?moved&u=…` for a tab the worker moved off a site that was already open
 * (its history still holds the site, so going back must skip it).
 */
export const MOVED_PREFIX = '?moved&u=';

/** The original address from a blocked page's own URL. */
export function blockedTarget(search) {
    if (search.startsWith(MOVED_PREFIX)) return search.slice(MOVED_PREFIX.length);
    return search.startsWith('?u=') ? search.slice(3) : '';
}
