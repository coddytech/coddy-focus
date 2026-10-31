// The "where am I today" card, shared by the popup and the settings page's
// Today tab: a lockdown, a focus session or break, limits switched off by
// the schedule, or the time left with its bar.

import { el, formatClock, formatMinutes, formatWhen, isTonight, ltr, send, sentence, t } from './common.js';

/**
 * Builds the status nodes. Returns { nodes, tick } where `tick()` updates
 * the countdown and should run every second.
 */
export function statusView(s, { onChange }) {
    const now = Date.now();
    const { settings, focus, lockdown } = s;
    let clock = null;
    const nodes = [];
    const act = (type) => send(type).then(onChange);

    if (lockdown) {
        nodes.push(
            el('p', { className: 'status-label' }, t('popup_lockdown_title')),
            el('p', {}, sentence('popup_lockdown_until', { time: ltr(formatWhen(lockdown.until, now)) }))
        );
    } else if (focus) {
        const working = focus.phase === 'work';
        const breakMs = settings.focus.breakMinutes * 60000;
        // The work part runs from the session's start; the break from the end of the work part.
        const phaseMs = working ? focus.endsAt - focus.startedAt : breakMs;
        const bar = el('span');
        clock = { node: el('p', { className: 'status-big clock ltr' }), bar, endsAt: focus.endsAt, phaseMs };
        nodes.push(
            el('p', { className: 'status-label' }, t(working ? 'popup_focus_title' : 'popup_break_title')),
            clock.node,
            el('div', { className: 'progress', role: 'presentation' }, bar),
            el('p', { className: 'muted' }, t(working ? 'popup_focus_body' : 'popup_break_body')),
            working ? el('p', { className: 'muted' }, t('focus_then_break', { duration: formatMinutes(settings.focus.breakMinutes) })) : null,
            el(
                'div',
                { className: 'status-actions' },
                el('button', { className: 'btn secondary md', type: 'button', onclick: () => act('stopFocus') }, t(working ? 'popup_focus_stop' : 'popup_break_end'))
            )
        );
    } else if (!s.limitsApply) {
        nodes.push(
            el('p', { className: 'status-label' }, t('popup_off_title')),
            s.scheduleChange ? el('p', { className: 'muted' }, sentence('popup_off_body', { time: ltr(formatWhen(s.scheduleChange, now)) })) : null
        );
    } else if (!settings.entries.some((e) => e.mode === 'limited')) {
        nodes.push(el('p', { className: 'status-label' }, t('popup_blocked_title')), el('p', { className: 'muted' }, t('popup_blocked_body')));
    } else {
        const total = s.allowanceSeconds;
        const used = total - s.remainingSeconds;
        const bar = el('span');
        bar.style.inlineSize = `${total ? Math.min(100, (used / total) * 100) : 100}%`;
        if (s.remainingSeconds <= 0) {
            const until = s.blocked.find((b) => b.reason === 'limit')?.until;
            nodes.push(
                el('p', { className: 'status-label' }, t('popup_used_up_title')),
                el('div', { className: 'progress', role: 'presentation' }, bar),
                until
                    ? el('p', { className: 'muted' }, isTonight(until, now) ? t('popup_used_up_midnight') : sentence('popup_used_up_body', { time: ltr(formatWhen(until, now)) }))
                    : null
            );
        } else {
            nodes.push(
                el('p', { className: 'status-label' }, t('popup_left_title')),
                el('p', { className: 'status-big' }, formatMinutes(Math.ceil(s.remainingSeconds / 60))),
                el('div', { className: 'progress', role: 'presentation' }, bar),
                el('p', { className: 'muted' }, t('popup_used_of', { used: formatMinutes(Math.floor(used / 60)), total: formatMinutes(total / 60) }))
            );
        }
    }

    const tick = () => {
        if (!clock) return;
        const left = clock.endsAt - Date.now();
        clock.node.textContent = formatClock(left);
        clock.bar.style.inlineSize = `${Math.min(100, Math.max(0, (1 - left / clock.phaseMs) * 100))}%`;
    };
    tick();
    return { nodes: nodes.filter(Boolean), tick };
}

/** Whether the focus and lockdown buttons make sense right now. */
export function canStartSessions(s) {
    return s.settings.entries.length > 0 && !s.focus && !s.lockdown;
}
