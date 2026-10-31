import { MINUTE } from './time.js';

// Focus sessions and lockdowns are stored as plain end times, so they keep
// running while the worker sleeps and survive a browser restart.

export const LOCKDOWN_MIN_MINUTES = 15;
export const LOCKDOWN_MAX_MINUTES = 7 * 24 * 60;

/** A new focus session: a work part, then a break, then it ends. */
export function startFocus(settings, now) {
    return { phase: 'work', startedAt: now, endsAt: now + settings.focus.workMinutes * MINUTE };
}

/**
 * Moves a focus session on to where it is at `now`: work becomes a break,
 * a finished break ends the session (null). The break is measured from the
 * end of the work part, not from when the worker happened to wake up.
 */
export function advanceFocus(focus, settings, now) {
    let current = focus;
    while (current && current.endsAt <= now) {
        current =
            current.phase === 'work'
                ? {
                      phase: 'break',
                      startedAt: current.startedAt,
                      endsAt: current.endsAt + settings.focus.breakMinutes * MINUTE,
                  }
                : null;
    }
    return current;
}

/**
 * Starts a lockdown, or extends the running one. A lockdown can never be
 * shortened, so the later end time wins.
 */
export function startLockdown(lockdown, minutes, now) {
    const length = Math.min(LOCKDOWN_MAX_MINUTES, Math.max(LOCKDOWN_MIN_MINUTES, Math.round(minutes)));
    const until = now + length * MINUTE;
    return { until: Math.max(until, lockdown?.until ?? 0) };
}

export function activeLockdown(lockdown, now) {
    return lockdown && lockdown.until > now ? lockdown : null;
}

/**
 * Loosening changes never apply during a lockdown: one that was due
 * sooner waits for the lockdown's end. Run it whenever a lockdown starts
 * or is extended, and before applying a due change, so an extended
 * lockdown also holds back the changes queued before it was extended.
 * `lockdown` is the running lockdown, or null.
 */
export function holdPending(pending, lockdown) {
    if (!pending || !lockdown || pending.applyAt >= lockdown.until) return pending;
    return { ...pending, applyAt: lockdown.until };
}
