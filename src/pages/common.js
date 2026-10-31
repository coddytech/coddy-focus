// Helpers shared by the extension's pages: translated text, formatting in
// the browser's language, and talking to the worker.

// The language of the messages actually shown, which is English when the
// browser's language has no translation. The browser's own language is
// kept when it is a regional form of that one (en-GB, pt-BR), for its
// clock and date habits.
const UI_LANGUAGE = chrome.i18n.getUILanguage();
const MESSAGES_LANGUAGE = chrome.i18n.getMessage('locale') || 'en';
export const LOCALE =
    UI_LANGUAGE.split('-')[0] === MESSAGES_LANGUAGE.split('-')[0] ? UI_LANGUAGE : MESSAGES_LANGUAGE;

/** A translated message, with {name} placeholders filled from `vars`. */
export function t(key, vars = {}) {
    const message = chrome.i18n.getMessage(key) || key;
    return message.replace(/\{(\w+)\}/g, (match, name) => (name in vars ? String(vars[name]) : match));
}

/** Translates every element marked with data-i18n (and its variants) and sets the page direction. */
export function applyI18n(root = document) {
    document.documentElement.lang = LOCALE;
    // From the messages, not the browser: English text shown to a Persian
    // browser must still run left to right.
    document.documentElement.dir = chrome.i18n.getMessage('dir') === 'rtl' ? 'rtl' : 'ltr';
    for (const el of root.querySelectorAll('[data-i18n]')) el.textContent = t(el.dataset.i18n);
    for (const el of root.querySelectorAll('[data-i18n-placeholder]')) el.placeholder = t(el.dataset.i18nPlaceholder);
    for (const el of root.querySelectorAll('[data-i18n-label]')) el.setAttribute('aria-label', t(el.dataset.i18nLabel));
}

/** Sends a message to the worker and returns its result, or throws its error. */
export async function send(type, payload = {}) {
    const response = await chrome.runtime.sendMessage({ type, ...payload });
    if (!response?.ok) throw new Error(response?.error ?? 'no-response');
    return response.result;
}

const unit = (value, name) =>
    new Intl.NumberFormat(LOCALE, { style: 'unit', unit: name, unitDisplay: 'long' }).format(value);

/** "45 minutes", "2 hours", "1 hour, 5 minutes", "3 days" in the browser's language. */
export function formatMinutes(totalMinutes) {
    const minutes = Math.max(0, Math.round(totalMinutes));
    if (minutes >= 1440 && minutes % 1440 === 0) return unit(minutes / 1440, 'day');
    const hours = Math.floor(minutes / 60);
    const rest = minutes % 60;
    if (!hours) return unit(rest, 'minute');
    if (!rest) return unit(hours, 'hour');
    return new Intl.ListFormat(LOCALE, { type: 'unit', style: 'long' }).format([unit(hours, 'hour'), unit(rest, 'minute')]);
}

/** "24:07" for a countdown. */
export function formatClock(ms) {
    const total = Math.max(0, Math.ceil(ms / 1000));
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    const pad = (n) => String(n).padStart(2, '0');
    return h ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

/**
 * True when `ts` is the coming midnight. "Sun 12:00 AM" for tonight reads
 * like next Sunday, so those cases get their own "at midnight" sentence.
 */
export function isTonight(ts, now = Date.now()) {
    const d = new Date(now);
    return ts === new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime();
}

/** A moment in time: "17:00" today, "Mon 09:00" this week, a date later. */
export function formatWhen(ts, now = Date.now()) {
    const date = new Date(ts);
    const today = new Date(now);
    const sameDay = date.toDateString() === today.toDateString();
    const withinWeek = ts - now < 6 * 24 * 3600 * 1000;
    const options = sameDay
        ? { hour: 'numeric', minute: '2-digit' }
        : withinWeek
          ? { weekday: 'short', hour: 'numeric', minute: '2-digit' }
          : { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' };
    return new Intl.DateTimeFormat(LOCALE, options).format(date);
}

/** Short weekday names, Sunday first, in the browser's language. */
export function weekdayNames() {
    const format = new Intl.DateTimeFormat(LOCALE, { weekday: 'short' });
    // 2026-11-01 is a Sunday.
    return Array.from({ length: 7 }, (_, i) => format.format(new Date(2026, 10, 1 + i)));
}

/** The first day of the week in the browser's region, 0 for Sunday. */
export function firstWeekday() {
    try {
        const info = new Intl.Locale(LOCALE).getWeekInfo?.() ?? new Intl.Locale(LOCALE).weekInfo;
        return info ? info.firstDay % 7 : 1;
    } catch {
        return 1;
    }
}

/** A link to Coddy that tells our analytics it came from the extension. */
export function coddyUrl(medium) {
    return `https://coddy.tech/?utm_source=focus_extension&utm_medium=${medium}`;
}

/** Builds an element: el('p', { className: 'muted' }, 'text', child). */
export function el(tag, props = {}, ...children) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(props)) {
        if (key === 'dataset') Object.assign(node.dataset, value);
        else if (key.startsWith('on')) node.addEventListener(key.slice(2).toLowerCase(), value);
        else node[key] = value;
    }
    for (const child of children.flat()) {
        if (child != null && child !== false) node.append(child);
    }
    return node;
}

/** An address or clock that keeps its left-to-right order inside right-to-left text. */
export function ltr(text) {
    return el('bdi', { className: 'ltr' }, text);
}

/**
 * Fills a translated sentence whose {placeholders} become DOM nodes, so
 * parts like a site name can be styled or kept left to right.
 */
export function sentence(key, parts) {
    const fragment = document.createDocumentFragment();
    const message = t(key);
    let last = 0;
    for (const match of message.matchAll(/\{(\w+)\}/g)) {
        fragment.append(message.slice(last, match.index));
        const part = parts[match[1]];
        fragment.append(part instanceof Node ? part : String(part ?? match[0]));
        last = match.index + match[0].length;
    }
    fragment.append(message.slice(last));
    return fragment;
}

/** Reloads `render` whenever the stored state other than stats changes. */
export function onStateChange(render) {
    chrome.storage.onChanged.addListener((changes, area) => {
        if (area !== 'local') return;
        if (Object.keys(changes).some((key) => key !== 'stats')) render();
    });
}
