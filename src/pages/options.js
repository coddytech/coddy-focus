import { exportSettings, importSettings, makeEntry } from '../lib/settings.js';
import { originsFor } from '../lib/sites.js';
import { summary } from '../lib/stats.js';
import {
    applyI18n,
    coddyUrl,
    el,
    firstWeekday,
    formatMinutes,
    formatWhen,
    ltr,
    onStateChange,
    send,
    sentence,
    t,
    weekdayNames,
} from './common.js';
import { canStartSessions, statusView } from './status.js';
import { favicon, icon, savedToast, segmented, switchRow, toast } from './ui.js';

applyI18n();

const $ = (id) => document.getElementById(id);
const TABS = ['today', 'sites', 'limits', 'focus', 'hide', 'more'];
const SUGGESTED = ['youtube.com', 'tiktok.com', 'instagram.com', 'reddit.com', 'x.com', 'facebook.com', 'netflix.com', 'twitch.tv'];
const ALLOWANCE_PRESETS = [15, 30, 45, 60, 90, 120];
const LOCKDOWN_LENGTHS = [30, 60, 120, 240, 480, 1440, 3 * 1440, 7 * 1440];
const HIDE_OPTIONS = [
    { key: 'ytShorts', label: 'hide_yt_shorts', domain: 'youtube.com', origins: ['*://*.youtube.com/*'] },
    { key: 'ytComments', label: 'hide_yt_comments', domain: 'youtube.com', origins: ['*://*.youtube.com/*'] },
    { key: 'ytRecommendations', label: 'hide_yt_recommendations', domain: 'youtube.com', origins: ['*://*.youtube.com/*'] },
    { key: 'igReels', label: 'hide_ig_reels', domain: 'instagram.com', origins: ['*://*.instagram.com/*'] },
];

/** The latest status from the worker. */
let status = null;

/**
 * The settings the page edits: the pending ones when some changes are
 * waiting, so the page always shows what the user last chose.
 */
const draft = () => structuredClone(status.pending?.settings ?? status.settings);

async function save(settings, { quiet = false } = {}) {
    const next = await send('save', { settings });
    render(next);
    if (!quiet) savedToast(next);
}

/** Asks for site access. Must run before any other await in a click handler. */
const requestAccess = (origins) => chrome.permissions.request({ origins }).catch(() => false);

for (const node of document.querySelectorAll('[data-icon]')) node.prepend(icon(node.dataset.icon));

// Tabs

function showTab(name, { focus = false } = {}) {
    const tab = TABS.includes(name) ? name : 'today';
    for (const id of TABS) {
        const selected = id === tab;
        $(`tab-${id}`).ariaSelected = String(selected);
        $(`tab-${id}`).tabIndex = selected ? 0 : -1;
        $(id).hidden = !selected;
    }
    if (focus) $(`tab-${tab}`).focus();
    if (location.hash.slice(1) !== tab) history.replaceState(null, '', `#${tab}`);
    window.scrollTo({ top: 0 });
}

for (const id of TABS) $(`tab-${id}`).addEventListener('click', () => showTab(id));
document.querySelector('.nav').addEventListener('keydown', (event) => {
    const vertical = window.matchMedia('(min-width: 761px)').matches;
    const rtl = document.documentElement.dir === 'rtl';
    const keys = vertical ? { ArrowDown: 1, ArrowUp: -1 } : { ArrowRight: rtl ? -1 : 1, ArrowLeft: rtl ? 1 : -1 };
    const step = keys[event.key];
    if (!step) return;
    event.preventDefault();
    const current = TABS.findIndex((id) => $(`tab-${id}`).ariaSelected === 'true');
    showTab(TABS[(current + step + TABS.length) % TABS.length], { focus: true });
});
for (const button of document.querySelectorAll('[data-goto]')) {
    button.addEventListener('click', () => {
        showTab(button.dataset.goto);
        if (button.dataset.scroll) $(button.dataset.scroll).scrollIntoView({ block: 'start' });
    });
}

// Today

/**
 * Adds a site once Chrome gives access to it. Without access the extension
 * could not count time there or show its own page, so a denied prompt adds
 * nothing. Returns false when access was denied.
 */
async function addEntry(entry) {
    if (!(await requestAccess(originsFor(entry.pattern)))) return false;
    const settings = draft();
    settings.entries.push(entry);
    await save(settings);
    return true;
}

async function addSite(pattern, mode = 'limited') {
    const entry = makeEntry(pattern, mode);
    if (!entry || draft().entries.some((e) => e.pattern === entry.pattern)) return;
    if (!(await addEntry(entry))) toast(t('sites_access_denied', { site: entry.pattern }), { error: true });
}

function suggestionChips(container) {
    const listed = new Set(draft().entries.map((e) => e.pattern));
    const free = SUGGESTED.filter((domain) => !listed.has(domain));
    container.replaceChildren(
        ...free.map((domain) =>
            el('button', { className: 'chip', type: 'button', onclick: () => addSite(domain) }, favicon(domain, 16), ltr(domain))
        )
    );
    return free.length;
}

let tickToday = () => {};

function renderToday() {
    const s = status;
    const empty = !s.settings.entries.length;
    $('today-empty').hidden = !empty;
    $('today-main').hidden = empty;
    if (empty) {
        suggestionChips($('today-suggestions'));
        return;
    }
    const view = statusView(s, { onChange: render });
    tickToday = view.tick;
    $('today-status').replaceChildren(...view.nodes);
    $('today-actions').hidden = !canStartSessions(s);
    $('today-focus').textContent = t('popup_focus_start', { duration: formatMinutes(s.settings.focus.workMinutes) });

    $('today-blocked').textContent = new Intl.NumberFormat(document.documentElement.lang).format(new Set(s.blocked.map((b) => b.id)).size);
    const rows = summary(s.stats, s.now);
    $('today-week').textContent = formatMinutes(Math.ceil(rows.reduce((sum, row) => sum + row.span, 0) / 60));

    const today = rows.filter((row) => row.today > 0).sort((a, b) => b.today - a.today);
    const most = Math.max(1, ...today.map((row) => row.today));
    $('today-sites').replaceChildren(
        ...today.map((row) => {
            const bar = el('span');
            bar.style.inlineSize = `${(row.today / most) * 100}%`;
            return el(
                'li',
                {},
                el('span', { className: 'site' }, favicon(row.pattern.split('/')[0]), ltr(row.pattern)),
                el('span', { className: 'amount' }, formatMinutes(Math.ceil(row.today / 60))),
                el('div', { className: 'progress site-bar', role: 'presentation' }, bar)
            );
        })
    );
    $('today-none').hidden = today.length > 0;
}

const startFocus = async () => {
    render(await send('startFocus'));
};
$('today-focus').addEventListener('click', startFocus);
$('focus-start').addEventListener('click', async () => {
    await startFocus();
    showTab('today');
});

// Sites

const addInput = $('add-input');
const addError = $('add-error');
const addMode = segmented({
    label: t('sites_mode_label'),
    options: [
        { value: 'limited', label: t('mode_limited') },
        { value: 'blocked', label: t('mode_blocked') },
    ],
    value: 'limited',
    onChange: (mode) => showModeHint(mode),
});
$('add-mode').replaceWith(addMode);

/** What the chosen kind of limit does, under the add form. */
const showModeHint = (mode) => {
    $('add-mode-hint').textContent = t(mode === 'blocked' ? 'mode_blocked_hint' : 'mode_limited_hint');
};
showModeHint('limited');

function showAddError(key) {
    addError.textContent = key ? t(key) : '';
    addError.hidden = !key;
    $('add-control').classList.toggle('invalid', Boolean(key));
}
addInput.addEventListener('input', () => showAddError(null));

$('add-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const entry = makeEntry(addInput.value, addMode.getValue());
    if (!entry) return showAddError('sites_invalid');
    if (draft().entries.some((e) => e.pattern === entry.pattern)) return showAddError('sites_duplicate');
    showAddError(null);
    if (await addEntry(entry)) {
        addInput.value = '';
    } else {
        addError.textContent = t('sites_access_denied', { site: entry.pattern });
        addError.hidden = false;
    }
});

$('access-all-button').addEventListener('click', async () => {
    const missing = status.settings.entries.filter((e) => !status.access[e.id]);
    await requestAccess(missing.flatMap((e) => originsFor(e.pattern)));
    render(await send('status'));
});

function renderSites() {
    const settings = draft();
    $('site-list').replaceChildren(
        ...settings.entries.map((entry) => {
            const hasAccess = status.access[entry.id] !== false;
            const mode = segmented({
                label: t('sites_mode_label'),
                small: true,
                options: [
                    { value: 'limited', label: t('mode_limited') },
                    { value: 'blocked', label: t('mode_blocked') },
                ],
                value: entry.mode,
                onChange: (value) => {
                    const next = draft();
                    next.entries.find((e) => e.id === entry.id).mode = value;
                    save(next);
                },
            });
            return el(
                'li',
                {},
                el('span', { className: 'site' }, favicon(entry.pattern.split('/')[0]), ltr(entry.pattern)),
                mode,
                el(
                    'button',
                    {
                        className: 'btn ghost icon md',
                        type: 'button',
                        ariaLabel: t('sites_remove_label', { site: entry.pattern }),
                        title: t('sites_remove_label', { site: entry.pattern }),
                        onclick: () => {
                            const next = draft();
                            next.entries = next.entries.filter((e) => e.id !== entry.id);
                            save(next);
                        },
                    },
                    icon('trash')
                ),
                !hasAccess &&
                    el(
                        'p',
                        { className: 'access' },
                        t('access_basic'),
                        ' ',
                        el(
                            'button',
                            {
                                className: 'btn link',
                                type: 'button',
                                onclick: async () => {
                                    await requestAccess(originsFor(entry.pattern));
                                    render(await send('status'));
                                },
                            },
                            t('access_give')
                        )
                    )
            );
        })
    );
    $('site-empty').hidden = settings.entries.length > 0;
    $('access-all').hidden = status.settings.entries.filter((e) => !status.access[e.id]).length < 2;
    const left = suggestionChips($('site-suggestions'));
    $('site-suggestions').parentElement.hidden = left === 0;
}

// Limits

const minutesToTime = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
const timeToMinutes = (value) => {
    const [h, m] = value.split(':').map(Number);
    return Number.isFinite(h) && Number.isFinite(m) ? h * 60 + m : null;
};

function bindNumber(id, apply) {
    $(id).addEventListener('change', (event) => {
        const value = Number(event.target.value);
        if (event.target.value === '' || !Number.isFinite(value)) return;
        const next = draft();
        apply(next, value);
        save(next);
    });
}
bindNumber('allowance-input', (s, v) => (s.allowanceMinutes = v));
bindNumber('focus-work', (s, v) => (s.focus.workMinutes = v));
bindNumber('focus-break', (s, v) => (s.focus.breakMinutes = v));

$('allowance-presets').replaceChildren(
    ...ALLOWANCE_PRESETS.map((minutes) =>
        el(
            'button',
            {
                className: 'chip',
                type: 'button',
                dataset: { minutes },
                onclick: () => {
                    const next = draft();
                    next.allowanceMinutes = minutes;
                    save(next);
                },
            },
            formatMinutes(minutes)
        )
    )
);

const scheduleSwitch = switchRow({
    label: t('schedule_enable'),
    checked: false,
    id: 'schedule-enabled',
    onChange: (checked) => {
        const next = draft();
        next.schedule.enabled = checked;
        save(next);
    },
});
$('schedule-switch').replaceWith(scheduleSwitch);

for (const [id, key] of [
    ['schedule-start', 'start'],
    ['schedule-end', 'end'],
]) {
    $(id).addEventListener('change', (event) => {
        const minutes = timeToMinutes(event.target.value);
        if (minutes === null) return;
        const next = draft();
        next.schedule[key] = minutes;
        save(next);
    });
}

const dayNames = weekdayNames();
const dayOrder = Array.from({ length: 7 }, (_, i) => (firstWeekday() + i) % 7);
$('schedule-days').replaceChildren(
    ...dayOrder.map((day) =>
        el(
            'button',
            {
                className: 'chip',
                type: 'button',
                dataset: { day },
                onclick: () => {
                    const next = draft();
                    const days = new Set(next.schedule.days);
                    if (days.has(day)) days.delete(day);
                    else days.add(day);
                    next.schedule.days = [...days];
                    save(next);
                },
            },
            dayNames[day]
        )
    )
);

function renderLimits() {
    const s = draft();
    $('allowance-input').value = s.allowanceMinutes;
    for (const chip of $('allowance-presets').children) chip.ariaPressed = String(Number(chip.dataset.minutes) === s.allowanceMinutes);
    $('schedule-enabled').checked = s.schedule.enabled;
    $('schedule-fields').hidden = !s.schedule.enabled;
    for (const chip of $('schedule-days').children) chip.ariaPressed = String(s.schedule.days.includes(Number(chip.dataset.day)));
    $('schedule-start').value = minutesToTime(s.schedule.start);
    $('schedule-end').value = minutesToTime(s.schedule.end);
}

// Focus and lockdown

let lockdownMinutes = 240;
let confirming = false;

$('lockdown-lengths').replaceChildren(
    ...LOCKDOWN_LENGTHS.map((minutes) =>
        el(
            'button',
            {
                className: 'chip',
                type: 'button',
                role: 'radio',
                dataset: { minutes },
                onclick: () => {
                    lockdownMinutes = minutes;
                    confirming = false;
                    renderLockdown();
                },
            },
            formatMinutes(minutes)
        )
    )
);
$('lockdown-start').addEventListener('click', async () => {
    if (!confirming) {
        confirming = true;
        renderLockdown();
        return;
    }
    confirming = false;
    render(await send('startLockdown', { minutes: lockdownMinutes }));
    toast(sentence('lockdown_active', { time: formatWhen(status.lockdown.until) }).textContent);
});
$('lockdown-cancel').addEventListener('click', () => {
    confirming = false;
    renderLockdown();
});

function renderFocus() {
    const s = draft();
    $('focus-work').value = s.focus.workMinutes;
    $('focus-break').value = s.focus.breakMinutes;
    $('focus-start').textContent = t('popup_focus_start', { duration: formatMinutes(s.focus.workMinutes) });
    $('focus-start').disabled = !canStartSessions(status);
    renderLockdown();
}

function renderLockdown() {
    const active = status.lockdown;
    $('lockdown-active').hidden = !active;
    if (active) $('lockdown-active').replaceChildren(sentence('lockdown_active', { time: ltr(formatWhen(active.until)) }));
    for (const chip of $('lockdown-lengths').children) chip.ariaChecked = String(Number(chip.dataset.minutes) === lockdownMinutes);
    const start = $('lockdown-start');
    start.textContent = confirming
        ? t('lockdown_confirm', { duration: formatMinutes(lockdownMinutes) })
        : t(active ? 'lockdown_extend' : 'lockdown_start');
    start.disabled = !status.settings.entries.length;
    $('lockdown-cancel').hidden = !confirming;
}

// Hide

function renderHide() {
    const s = draft();
    $('hide-list').replaceChildren(
        ...HIDE_OPTIONS.map((option) =>
            switchRow({
                label: t(option.label),
                checked: s.hide[option.key],
                lead: favicon(option.domain),
                onChange: async (checked, input) => {
                    if (checked && !(await requestAccess(option.origins))) {
                        input.checked = false;
                        return;
                    }
                    const next = draft();
                    next.hide[option.key] = checked;
                    save(next);
                },
            })
        )
    );
}

// More

const strictSwitch = switchRow({
    label: t('strict_enable'),
    checked: false,
    id: 'strict-enabled',
    onChange: (checked) => {
        const next = draft();
        next.strict = checked;
        save(next);
    },
});
$('strict-switch').replaceWith(strictSwitch);

const backupMessage = $('backup-message');
$('export').addEventListener('click', () => {
    const blob = new Blob([JSON.stringify(exportSettings(draft()), null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    el('a', { href: url, download: `coddy-focus-settings-${new Date().toISOString().slice(0, 10)}.json` }).click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
});
$('import').addEventListener('change', async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    try {
        await save(importSettings(await file.text()), { quiet: true });
        backupMessage.hidden = true;
        toast(t('backup_imported'));
    } catch {
        backupMessage.textContent = t('backup_invalid');
        backupMessage.className = 'error';
        backupMessage.hidden = false;
    }
});

$('learn').href = coddyUrl('settings');
$('incognito-fix').addEventListener('click', () => {
    chrome.tabs.create({ url: `chrome://extensions/?id=${chrome.runtime.id}` });
});

// Notices

function renderNotices() {
    const box = $('pending');
    const { pending, lockdown } = status;
    box.hidden = !pending;
    if (pending) {
        // Strict mode alone always waits for midnight; a lockdown waits for its end.
        const byLockdown = lockdown && pending.applyAt === lockdown.until;
        box.replaceChildren(
            el('p', {}, byLockdown ? sentence('pending_lockdown', { time: ltr(formatWhen(pending.applyAt)) }) : t('pending_strict')),
            el('button', { className: 'btn secondary md', type: 'button', onclick: async () => render(await send('cancelPending')) }, t('pending_cancel'))
        );
    }
    $('incognito').hidden = status.incognitoAllowed;
}

// Page

function render(next) {
    status = next;
    renderNotices();
    renderToday();
    renderSites();
    renderLimits();
    renderFocus();
    renderHide();
    $('strict-enabled').checked = draft().strict;
}

/** #sites opens that tab; #add=site opens Sites ready to add that site. */
function followHash() {
    const hash = decodeURIComponent(location.hash.slice(1));
    if (hash.startsWith('add=')) {
        showTab('sites');
        addInput.value = hash.slice(4);
        addInput.focus();
    } else if (hash === 'lockdown') {
        showTab('focus');
        $('lockdown-card').scrollIntoView({ block: 'start' });
    } else {
        showTab(hash);
    }
}

send('status').then((s) => {
    render(s);
    followHash();
});
onStateChange(async () => render(await send('status')));
// Incognito access is switched on in the browser's own page, which changes
// no storage: check again when the user comes back to this tab.
document.addEventListener('visibilitychange', async () => {
    if (document.visibilityState === 'visible') render(await send('status'));
});
window.addEventListener('hashchange', followHash);
setInterval(() => tickToday(), 1000);
