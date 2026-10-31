import { MOVED_PREFIX } from '../lib/blocking.js';
import { parsePattern } from '../lib/sites.js';
import { applyI18n, coddyUrl, formatClock, formatWhen, isTonight, ltr, onStateChange, send, sentence, t } from './common.js';

applyI18n();

const title = document.getElementById('title');
const reason = document.getElementById('reason');
const learn = document.getElementById('learn');
const back = document.getElementById('back');

learn.href = coddyUrl('blocked_page');

let target = '';
let unblocked = false;
let timer = null;
let recheck = null;

// A tab moved here from a site that was already open still has that site
// one step back, which is blocked too, so going back skips it.
const moved = location.search.startsWith(MOVED_PREFIX);

back.addEventListener('click', async () => {
    const steps = moved ? 2 : 1;
    if (unblocked && target) {
        location.replace(target);
    } else if (history.length > steps) {
        history.go(-steps);
    } else {
        // Nothing to go back to: close the tab.
        const tab = await chrome.tabs.getCurrent();
        if (tab) chrome.tabs.remove(tab.id);
    }
});

/** Each reason has its own sentence; {time} is when it ends. */
const REASON_KEYS = {
    lockdown: 'blocked_reason_lockdown',
    focus: 'blocked_reason_focus',
    blocked: 'blocked_reason_blocked',
    limit: 'blocked_reason_limit',
};

async function render() {
    const info = await send('blockedInfo', { search: location.search });
    target = info.url;
    const site = parsePattern(info.url)?.domain ?? '';
    const strongest = info.blocked[0];
    clearInterval(timer);
    clearTimeout(recheck);
    timer = null;

    if (!strongest) {
        // The block ended while this page was open.
        unblocked = true;
        title.replaceChildren(sentence('blocked_open_title', { site: ltr(site) }));
        reason.textContent = t('blocked_open_body');
        back.textContent = t('blocked_open_site');
        document.title = t('blocked_tab_title');
        return;
    }

    unblocked = false;
    title.replaceChildren(sentence('blocked_title', { site: ltr(site) }));
    back.textContent = t('blocked_back');
    document.title = `${t('blocked_tab_title')}: ${site}`;

    const key = !strongest.until
        ? 'blocked_reason_always'
        : strongest.reason === 'limit' && isTonight(strongest.until)
          ? 'blocked_reason_limit_midnight'
          : REASON_KEYS[strongest.reason];
    const show = () => {
        const time = strongest.reason === 'focus' ? formatClock(strongest.until - Date.now()) : formatWhen(strongest.until);
        reason.replaceChildren(sentence(key, { time: ltr(time) }));
    };
    show();
    if (strongest.reason === 'focus') timer = setInterval(show, 1000);
    if (strongest.until) {
        // Check again when this reason ends; another one may take over.
        recheck = setTimeout(render, Math.max(1000, strongest.until - Date.now() + 500));
    }
}

render();
onStateChange(render);
