import { normalizePattern } from './sites.js';
import { covers } from './schedule.js';

export const MAX_ENTRIES = 500; // each entry is one regex rule; Chrome allows 1000
export const HIDE_KEYS = ['ytShorts', 'ytComments', 'ytRecommendations', 'igReels'];

export const DEFAULT_SETTINGS = Object.freeze({
    version: 1,
    entries: [],
    allowanceMinutes: 30,
    schedule: { enabled: false, days: [1, 2, 3, 4, 5], start: 9 * 60, end: 17 * 60 },
    focus: { workMinutes: 25, breakMinutes: 5 },
    hide: { ytShorts: false, ytComments: false, ytRecommendations: false, igReels: false },
    strict: false,
});

const clampInt = (value, min, max, fallback) => {
    const n = Math.round(Number(value));
    return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
};

const newId = () =>
    globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;

/**
 * A complete, valid settings object from anything: stored data from an
 * older version, an imported file, or a page's edit. Unknown fields drop,
 * bad values fall back to the defaults.
 */
export function normalizeSettings(raw) {
    const src = raw && typeof raw === 'object' ? raw : {};
    const seen = new Set();
    const entries = [];
    for (const e of Array.isArray(src.entries) ? src.entries : []) {
        const pattern = normalizePattern(e?.pattern);
        if (!pattern || seen.has(pattern) || entries.length >= MAX_ENTRIES) continue;
        seen.add(pattern);
        entries.push({
            id: typeof e.id === 'string' && e.id ? e.id : newId(),
            pattern,
            mode: e.mode === 'blocked' ? 'blocked' : 'limited',
        });
    }
    const s = src.schedule ?? {};
    const d = DEFAULT_SETTINGS;
    const days = Array.isArray(s.days)
        ? [...new Set(s.days.map(Number).filter((n) => Number.isInteger(n) && n >= 0 && n <= 6))].sort((a, b) => a - b)
        : [...d.schedule.days];
    const hide = {};
    for (const key of HIDE_KEYS) hide[key] = src.hide?.[key] === true;
    return {
        version: 1,
        entries,
        allowanceMinutes: clampInt(src.allowanceMinutes, 0, 1440, d.allowanceMinutes),
        schedule: {
            enabled: s.enabled === true,
            days,
            start: clampInt(s.start, 0, 1439, d.schedule.start),
            end: clampInt(s.end, 0, 1439, d.schedule.end),
        },
        focus: {
            workMinutes: clampInt(src.focus?.workMinutes, 1, 240, d.focus.workMinutes),
            breakMinutes: clampInt(src.focus?.breakMinutes, 1, 60, d.focus.breakMinutes),
        },
        hide,
        strict: src.strict === true,
    };
}

/** Builds a new entry for `input`, or null when it is not a site. */
export function makeEntry(input, mode = 'limited') {
    const pattern = normalizePattern(input);
    return pattern ? { id: newId(), pattern, mode: mode === 'blocked' ? 'blocked' : 'limited' } : null;
}

/** Compares two settings objects, ignoring entry order and ids. */
export function sameSettings(a, b) {
    const canon = (s) => ({
        ...s,
        entries: s.entries.map((e) => `${e.pattern}|${e.mode}`).sort(),
    });
    return JSON.stringify(canon(a)) === JSON.stringify(canon(b));
}

/**
 * The part of a change from `current` to `next` that only makes limits
 * stricter: new sites, a time limit turned into a full block, a smaller
 * allowance, a schedule that covers at least as much time, more hiding,
 * strict mode on. Focus timer lengths are free to change; the timer is
 * something you start yourself.
 */
export function tightenOnly(current, next) {
    const byPattern = new Map(next.entries.map((e) => [e.pattern, e]));
    const kept = current.entries.map((e) => {
        const wanted = byPattern.get(e.pattern);
        return wanted?.mode === 'blocked' ? { ...e, mode: 'blocked' } : e;
    });
    const known = new Set(current.entries.map((e) => e.pattern));
    const added = next.entries.filter((e) => !known.has(e.pattern)).slice(0, MAX_ENTRIES - kept.length);
    const hide = {};
    for (const key of HIDE_KEYS) hide[key] = current.hide[key] || next.hide[key];
    return {
        ...current,
        entries: [...kept, ...added],
        allowanceMinutes: Math.min(current.allowanceMinutes, next.allowanceMinutes),
        schedule: covers(next.schedule, current.schedule) ? next.schedule : current.schedule,
        focus: next.focus,
        hide,
        strict: current.strict || next.strict,
    };
}

/**
 * Splits a change made while limits are locked (strict mode or a
 * lockdown). `now` takes effect at once; `later` is the full change, kept
 * until it is allowed, or null when the change only tightens.
 */
export function splitChange(current, next) {
    const now = tightenOnly(current, next);
    return { now, later: sameSettings(now, next) ? null : next };
}

/** The settings a user can save to a file and load again. */
export function exportSettings(settings) {
    const { entries, ...rest } = settings;
    return {
        app: 'coddy-focus',
        ...rest,
        entries: entries.map(({ pattern, mode }) => ({ pattern, mode })),
    };
}

/** Reads an exported file's text; throws when it is not a Coddy Focus file. */
export function importSettings(text) {
    const data = JSON.parse(text);
    if (data?.app !== 'coddy-focus') throw new Error('not-a-backup');
    return normalizeSettings(data);
}
