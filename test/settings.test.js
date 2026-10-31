import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    DEFAULT_SETTINGS,
    MAX_ENTRIES,
    exportSettings,
    importSettings,
    makeEntry,
    normalizeSettings,
    splitChange,
} from '../src/lib/settings.js';

const base = () =>
    normalizeSettings({
        entries: [
            { id: 'yt', pattern: 'youtube.com', mode: 'limited' },
            { id: 'rd', pattern: 'reddit.com', mode: 'limited' },
        ],
        allowanceMinutes: 30,
        strict: true,
    });

test('fills defaults and drops bad data', () => {
    const s = normalizeSettings({
        entries: [{ pattern: 'WWW.YouTube.com' }, { pattern: 'youtube.com' }, { pattern: 'nope' }, null],
        allowanceMinutes: 'abc',
        schedule: { enabled: true, days: [9, 1, 1, 'x', 3], start: -5, end: 99999 },
        focus: { workMinutes: 0 },
        hide: { ytShorts: 'yes', igReels: true },
        extra: 1,
    });
    assert.equal(s.entries.length, 1);
    assert.equal(s.entries[0].pattern, 'youtube.com');
    assert.equal(s.entries[0].mode, 'limited');
    assert.equal(typeof s.entries[0].id, 'string');
    assert.equal(s.allowanceMinutes, DEFAULT_SETTINGS.allowanceMinutes);
    assert.deepEqual(s.schedule, { enabled: true, days: [1, 3], start: 0, end: 1439 });
    assert.equal(s.focus.workMinutes, 1);
    assert.equal(s.hide.ytShorts, false);
    assert.equal(s.hide.igReels, true);
    assert.equal('extra' in s, false);
});

test('caps the number of sites', () => {
    const entries = Array.from({ length: MAX_ENTRIES + 20 }, (_, i) => ({ pattern: `site${i}.com` }));
    assert.equal(normalizeSettings({ entries }).entries.length, MAX_ENTRIES);
});

test('in strict mode, tightening applies at once', () => {
    const current = base();
    const next = {
        ...current,
        entries: [...current.entries.map((e) => (e.id === 'rd' ? { ...e, mode: 'blocked' } : e)), makeEntry('tiktok.com')],
        allowanceMinutes: 20,
        hide: { ...current.hide, ytShorts: true },
    };
    const { now, later } = splitChange(current, normalizeSettings(next));
    assert.equal(later, null);
    assert.equal(now.allowanceMinutes, 20);
    assert.deepEqual(
        now.entries.map((e) => `${e.pattern}:${e.mode}`),
        ['youtube.com:limited', 'reddit.com:blocked', 'tiktok.com:limited']
    );
    assert.equal(now.hide.ytShorts, true);
});

test('in strict mode, loosening waits and tightening in the same change still applies', () => {
    const current = base();
    const next = normalizeSettings({
        ...current,
        entries: [current.entries[1], makeEntry('tiktok.com')], // youtube removed, tiktok added
        allowanceMinutes: 60,
        strict: false,
    });
    const { now, later } = splitChange(current, next);
    assert.deepEqual(
        now.entries.map((e) => e.pattern),
        ['youtube.com', 'reddit.com', 'tiktok.com']
    );
    assert.equal(now.allowanceMinutes, 30);
    assert.equal(now.strict, true);
    assert.equal(later, next);
});

test('a schedule change applies at once only when it covers more time', () => {
    const current = normalizeSettings({ ...base(), schedule: { enabled: true, days: [1, 2, 3, 4, 5], start: 540, end: 1020 } });
    const longer = normalizeSettings({ ...current, schedule: { ...current.schedule, start: 480 } });
    const shorter = normalizeSettings({ ...current, schedule: { ...current.schedule, start: 600 } });
    assert.equal(splitChange(current, longer).later, null);
    assert.equal(splitChange(current, shorter).now.schedule.start, 540);
    assert.notEqual(splitChange(current, shorter).later, null);
});

test('focus timer lengths are not a loosening', () => {
    const current = base();
    const next = normalizeSettings({ ...current, focus: { workMinutes: 10, breakMinutes: 20 } });
    const { now, later } = splitChange(current, next);
    assert.equal(later, null);
    assert.equal(now.focus.workMinutes, 10);
});

test('a backup round-trips and rejects other files', () => {
    const s = base();
    const restored = importSettings(JSON.stringify(exportSettings(s)));
    assert.deepEqual(
        restored.entries.map((e) => e.pattern),
        s.entries.map((e) => e.pattern)
    );
    assert.equal(restored.strict, true);
    assert.throws(() => importSettings('{"entries": []}'));
    assert.throws(() => importSettings('not json'));
});
