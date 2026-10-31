import { matchingEntries, parsePattern } from '../lib/sites.js';
import { applyI18n, coddyUrl, el, formatMinutes, ltr, onStateChange, send, sentence, t } from './common.js';
import { canStartSessions, statusView } from './status.js';
import { favicon, icon } from './ui.js';

applyI18n();

for (const node of document.querySelectorAll('[data-icon]')) node.prepend(icon(node.dataset.icon));

const statusBox = document.getElementById('status');
const focusButton = document.getElementById('focus');
const siteBox = document.getElementById('site');

document.getElementById('learn').href = coddyUrl('popup');
document.getElementById('open-settings').addEventListener('click', () => openSettings());
document.getElementById('lockdown').addEventListener('click', () => openSettings('#lockdown'));
document.getElementById('incognito-fix').addEventListener('click', () => {
    chrome.tabs.create({ url: `chrome://extensions/?id=${chrome.runtime.id}` });
});
focusButton.addEventListener('click', async () => render(await send('startFocus')));

function openSettings(hash = '') {
    chrome.tabs.create({ url: chrome.runtime.getURL(`pages/options.html${hash}`) });
    window.close();
}

let tick = () => {};

function renderStatus(s) {
    if (!s.settings.entries.length) {
        tick = () => {};
        statusBox.replaceChildren(
            el('p', { className: 'status-label' }, t('popup_empty_title')),
            el('p', { className: 'muted' }, t('popup_empty_body')),
            el('div', {}, el('button', { className: 'btn primary md', type: 'button', onclick: () => openSettings('#today') }, t('popup_empty_action')))
        );
        document.getElementById('actions').hidden = true;
        return;
    }
    const view = statusView(s, { onChange: render });
    tick = view.tick;
    statusBox.replaceChildren(...view.nodes);
    document.getElementById('actions').hidden = !canStartSessions(s);
    focusButton.textContent = t('popup_focus_start', { duration: formatMinutes(s.settings.focus.workMinutes) });
}

async function renderSite(s) {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const site = tab?.url && /^https?:/.test(tab.url) ? parsePattern(tab.url) : null;
    if (!site) {
        siteBox.hidden = true;
        return;
    }
    const listed = matchingEntries(s.settings.entries, tab.url)[0];
    const name = ltr(listed?.pattern ?? site.domain);
    const line = listed
        ? sentence(listed.mode === 'blocked' ? 'popup_site_listed_blocked' : 'popup_site_listed_limited', { site: name })
        : sentence('popup_site_not_listed', { site: name });
    siteBox.replaceChildren(
        el('p', { className: 'site-name' }, favicon(site.domain), el('span', {}, line)),
        listed
            ? el('button', { className: 'btn link', type: 'button', onclick: () => openSettings('#sites') }, t('popup_site_manage'))
            : el(
                  'button',
                  { className: 'btn secondary md', type: 'button', onclick: () => openSettings(`#add=${encodeURIComponent(site.domain)}`) },
                  t('popup_site_add')
              )
    );
    siteBox.hidden = false;
}

async function render(s) {
    const status = s ?? (await send('status'));
    renderStatus(status);
    document.getElementById('incognito').hidden = status.incognitoAllowed;
    await renderSite(status);
}

render();
onStateChange(() => render());
setInterval(() => tick(), 1000);
// Time left changes while a listed site is open in another window.
setInterval(() => render(), 30 * 1000);
