import { MINUTES_PER_DAY, atMinute, minuteOfDay, startOfDay } from './time.js';

// A schedule says when limits apply: on `days` (0 is Sunday) between `start`
// and `end` (minutes after midnight). `start` after `end` is an overnight
// window that belongs to the day it starts on; `start` equal to `end` means
// the whole day. A disabled schedule means limits apply all the time.

export function isActiveAt(schedule, weekday, minute) {
    if (!schedule.enabled) return true;
    const { days, start, end } = schedule;
    if (start === end) return days.includes(weekday);
    if (start < end) {
        return days.includes(weekday) && minute >= start && minute < end;
    }
    if (minute >= start) return days.includes(weekday);
    if (minute < end) return days.includes((weekday + 6) % 7);
    return false;
}

export function isActive(schedule, ts) {
    return isActiveAt(schedule, new Date(ts).getDay(), minuteOfDay(ts));
}

/**
 * The next moment after `now` when the schedule switches on or off, or null
 * when it never does. The state can only change at a midnight, a start or
 * an end, so it is enough to walk those candidates in order.
 */
export function nextChange(schedule, now) {
    if (!schedule.enabled) return null;
    const candidates = [];
    for (let offset = 0; offset <= 8; offset++) {
        const day = startOfDay(now, offset);
        candidates.push(day, atMinute(day, schedule.start), atMinute(day, schedule.end));
    }
    candidates.sort((a, b) => a - b);
    const current = isActive(schedule, now);
    return candidates.find((c) => c > now && isActive(schedule, c) !== current) ?? null;
}

/** True when `a` applies limits at every minute of the week that `b` does. */
export function covers(a, b) {
    for (let weekday = 0; weekday < 7; weekday++) {
        for (let minute = 0; minute < MINUTES_PER_DAY; minute++) {
            if (isActiveAt(b, weekday, minute) && !isActiveAt(a, weekday, minute)) {
                return false;
            }
        }
    }
    return true;
}
