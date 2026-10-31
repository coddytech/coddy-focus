// Daylight saving cases need a zone that has it.
process.env.TZ = 'Europe/Berlin';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { covers, isActive, nextChange } from '../src/lib/schedule.js';

const at = (y, m, d, h, min = 0) => new Date(y, m - 1, d, h, min).getTime();
// 2026-11-02 is a Monday.
const workdays = { enabled: true, days: [1, 2, 3, 4, 5], start: 9 * 60, end: 17 * 60 };

test('a disabled schedule always applies and never changes', () => {
    const off = { ...workdays, enabled: false };
    assert.ok(isActive(off, at(2026, 11, 1, 3)));
    assert.equal(nextChange(off, at(2026, 11, 1, 3)), null);
});

test('a day window applies only inside its hours on its days', () => {
    assert.ok(isActive(workdays, at(2026, 11, 2, 9)));
    assert.ok(isActive(workdays, at(2026, 11, 2, 16, 59)));
    assert.ok(!isActive(workdays, at(2026, 11, 2, 17)));
    assert.ok(!isActive(workdays, at(2026, 11, 2, 8, 59)));
    assert.ok(!isActive(workdays, at(2026, 11, 1, 12))); // Sunday
});

test('an overnight window belongs to the day it starts on', () => {
    const nights = { enabled: true, days: [5], start: 22 * 60, end: 2 * 60 }; // Friday night
    assert.ok(isActive(nights, at(2026, 11, 6, 23)));
    assert.ok(isActive(nights, at(2026, 11, 7, 1))); // Saturday 01:00
    assert.ok(!isActive(nights, at(2026, 11, 7, 23)));
    assert.ok(!isActive(nights, at(2026, 11, 6, 1))); // Friday 01:00 belongs to Thursday
});

test('start equal to end means the whole day', () => {
    const weekends = { enabled: true, days: [0, 6], start: 0, end: 0 };
    assert.ok(isActive(weekends, at(2026, 11, 1, 0)));
    assert.ok(isActive(weekends, at(2026, 11, 1, 23, 59)));
    assert.ok(!isActive(weekends, at(2026, 11, 2, 0)));
    assert.equal(nextChange(weekends, at(2026, 11, 1, 12)), at(2026, 11, 2, 0));
});

test('finds the next switch, across the weekend', () => {
    assert.equal(nextChange(workdays, at(2026, 11, 2, 8)), at(2026, 11, 2, 9));
    assert.equal(nextChange(workdays, at(2026, 11, 2, 10)), at(2026, 11, 2, 17));
    assert.equal(nextChange(workdays, at(2026, 11, 6, 18)), at(2026, 11, 9, 9)); // Friday evening to Monday
});

test('keeps local hours across a daylight saving change', () => {
    // Clocks went back on Sunday 2026-10-25 in Berlin.
    const daily = { enabled: true, days: [0, 1, 2, 3, 4, 5, 6], start: 9 * 60, end: 17 * 60 };
    const next = nextChange(daily, at(2026, 10, 24, 18));
    assert.equal(new Date(next).getHours(), 9);
    assert.equal(new Date(next).getDate(), 25);
});

test('covers compares the time limits apply', () => {
    const longer = { ...workdays, start: 8 * 60, end: 18 * 60 };
    const everyDay = { ...workdays, days: [0, 1, 2, 3, 4, 5, 6] };
    const always = { ...workdays, enabled: false };
    assert.ok(covers(longer, workdays));
    assert.ok(!covers(workdays, longer));
    assert.ok(covers(everyDay, workdays));
    assert.ok(covers(always, workdays));
    assert.ok(!covers(workdays, always));
});
