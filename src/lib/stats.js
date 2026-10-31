import { dayKey, startOfDay } from './time.js';

// Stats live only in the browser: { days: { "2026-10-31": { allowance,
// sites: { pattern: seconds } } } }. `allowance` is the time counted
// against the shared daily allowance, which is less than the sum of
// `sites` when some time fell outside the schedule.

export const KEEP_DAYS = 30;

/**
 * Adds `seconds` on `pattern` to the day of `now`. Returns new stats. A null
 * `pattern` (time in an incognito window) still counts against the
 * allowance but records no site, so incognito leaves no history behind.
 */
export function addTime(stats, now, seconds, pattern, countsAllowance) {
    if (!(seconds > 0)) return stats;
    const key = dayKey(now);
    const day = stats.days?.[key] ?? { allowance: 0, sites: {} };
    const next = {
        allowance: day.allowance + (countsAllowance ? seconds : 0),
        sites: pattern ? { ...day.sites, [pattern]: (day.sites[pattern] ?? 0) + seconds } : day.sites,
    };
    return prune({ days: { ...stats.days, [key]: next } }, now);
}

/**
 * Credits the time since `tracking.since`, capped at `maxGapMs` so a
 * computer that slept with a site open does not count the night. Time
 * before today's midnight is dropped rather than moved into today. Only
 * whole seconds are credited; `carryMs` is the fraction left over.
 */
export function flush(stats, tracking, now, maxGapMs) {
    const from = Math.max(tracking.since, now - maxGapMs, startOfDay(now));
    const elapsed = Math.max(0, now - from);
    const seconds = Math.floor(elapsed / 1000);
    return {
        stats: addTime(stats, now, seconds, tracking.incognito ? null : tracking.pattern, tracking.countsAllowance),
        carryMs: elapsed - seconds * 1000,
    };
}

export function usedToday(stats, now) {
    return stats.days?.[dayKey(now)]?.allowance ?? 0;
}

export function prune(stats, now) {
    const oldest = dayKey(startOfDay(now, -(KEEP_DAYS - 1)));
    const days = {};
    for (const [key, value] of Object.entries(stats.days ?? {})) {
        if (key >= oldest) days[key] = value;
    }
    return { days };
}

/** Seconds per site for today and the last `span` days, most used first. */
export function summary(stats, now, span = 7) {
    const today = dayKey(now);
    const oldest = dayKey(startOfDay(now, -(span - 1)));
    const totals = new Map();
    for (const [key, day] of Object.entries(stats.days ?? {})) {
        if (key < oldest || key > today) continue;
        for (const [pattern, seconds] of Object.entries(day.sites)) {
            const row = totals.get(pattern) ?? { pattern, today: 0, span: 0 };
            row.span += seconds;
            if (key === today) row.today += seconds;
            totals.set(pattern, row);
        }
    }
    return [...totals.values()].sort((a, b) => b.span - a.span);
}
