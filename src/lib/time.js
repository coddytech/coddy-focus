// Local calendar helpers. Days, schedules and the daily allowance all follow
// the user's local clock, so everything here goes through Date's local
// fields, which also keeps daylight saving changes correct.

export const MINUTE = 60 * 1000;
export const MINUTES_PER_DAY = 24 * 60;

const pad = (n) => String(n).padStart(2, '0');

/** "2026-10-31" for the local day that contains `ts`. */
export function dayKey(ts) {
    const d = new Date(ts);
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Local midnight at the start of the day `offset` days after `ts`'s day. */
export function startOfDay(ts, offset = 0) {
    const d = new Date(ts);
    return new Date(d.getFullYear(), d.getMonth(), d.getDate() + offset).getTime();
}

export function nextMidnight(ts) {
    return startOfDay(ts, 1);
}

/**
 * The time `minute` minutes into the local day starting at `dayStart`.
 * Built from local fields rather than added milliseconds, so 09:00 stays
 * 09:00 on the day the clocks change.
 */
export function atMinute(dayStart, minute) {
    const d = new Date(dayStart);
    return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, minute).getTime();
}

export function minuteOfDay(ts) {
    const d = new Date(ts);
    return d.getHours() * 60 + d.getMinutes();
}
