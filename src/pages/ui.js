// Small UI pieces built the way coddy.tech draws them (see common.css):
// the outline glyphs of the site's profile rail, site icons, the segmented
// control, the switch and the toast.

import { el, t } from './common.js';

// Glyphs follow the site's NavGlyph rules: a 24-unit box, drawing inside
// 3..21, outline only, 1.8 stroke, round caps and joins, currentColor.
const GLYPHS = {
    today: ['M3.5 10.5 12 3.5l8.5 7v10h-5.5v-6h-6v6H3.5z'],
    sites: [
        { circle: [12, 12, 9] },
        'M3 12h18',
        'M12 3c2.4 2.5 3.6 5.5 3.6 9s-1.2 6.5-3.6 9c-2.4-2.5-3.6-5.5-3.6-9S9.6 5.5 12 3z',
    ],
    limits: [
        'M7 3.5h10M7 20.5h10',
        'M8 3.5v2.2c0 1.6.8 3.1 2.2 4L12 11l1.8-1.3c1.4-.9 2.2-2.4 2.2-4V3.5',
        'M8 20.5v-2.2c0-1.6.8-3.1 2.2-4L12 13l1.8 1.3c1.4.9 2.2 2.4 2.2 4v2.2',
    ],
    focus: [{ circle: [12, 12, 8.5] }, { circle: [12, 12, 4.5] }, { circle: [12, 12, 1] }],
    hide: ['M3.5 12s3-6 8.5-6 8.5 6 8.5 6-3 6-8.5 6-8.5-6-8.5-6z', { circle: [12, 12, 2.5] }, 'M4.5 4.5l15 15'],
    more: [
        'M3.5 7h8M17.5 7h3',
        { circle: [14.5, 7, 2] },
        'M3.5 12h2M11.5 12h9',
        { circle: [8.5, 12, 2] },
        'M3.5 17h8M17.5 17h3',
        { circle: [14.5, 17, 2] },
    ],
    lock: ['M6.5 10.5h11a1.5 1.5 0 0 1 1.5 1.5v7a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 5 19v-7a1.5 1.5 0 0 1 1.5-1.5z', 'M8 10.5V8a4 4 0 0 1 8 0v2.5'],
    trash: ['M4.5 7h15', 'M9.5 7V4.5h5V7', 'M6.5 7l1 13.5h9l1-13.5', 'M10 11v6M14 11v6'],
    check: [{ circle: [12, 12, 9] }, 'M8 12.5l2.7 2.7L16 9.8'],
    external: ['M14 4h6v6', 'M20 4l-9 9', 'M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5'],
};

const SVG = 'http://www.w3.org/2000/svg';

/** An outline glyph from GLYPHS, `size` pixels square. */
export function icon(name, size = 20) {
    const svg = document.createElementNS(SVG, 'svg');
    for (const [key, value] of Object.entries({
        width: size,
        height: size,
        viewBox: '0 0 24 24',
        fill: 'none',
        stroke: 'currentColor',
        'stroke-width': '1.8',
        'stroke-linecap': 'round',
        'stroke-linejoin': 'round',
        'aria-hidden': 'true',
        focusable: 'false',
    })) {
        svg.setAttribute(key, value);
    }
    for (const part of GLYPHS[name]) {
        const node = document.createElementNS(SVG, typeof part === 'string' ? 'path' : 'circle');
        if (typeof part === 'string') {
            node.setAttribute('d', part);
        } else {
            const [cx, cy, r] = part.circle;
            node.setAttribute('cx', cx);
            node.setAttribute('cy', cy);
            node.setAttribute('r', r);
        }
        svg.append(node);
    }
    return svg;
}

const faviconUrl = (pageUrl, size) => {
    const url = new URL(chrome.runtime.getURL('/_favicon/'));
    url.searchParams.set('pageUrl', pageUrl);
    url.searchParams.set('size', String(size));
    return url.href;
};

/** The pixels of an icon, to tell a real one from the browser's blank globe. */
async function pixels(src) {
    const img = new Image();
    img.src = src;
    await img.decode();
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 16;
    const context = canvas.getContext('2d');
    context.drawImage(img, 0, 0, 16, 16);
    return context.getImageData(0, 0, 16, 16).data.join();
}

let blankIcon = null;
const chosen = new Map();

/**
 * Which address Chrome keeps a real icon for: sites are usually visited at
 * www.domain, which the bare domain redirects to, so www is tried first.
 * Null when neither has one.
 */
function pickIcon(domain, size) {
    if (!chosen.has(domain)) {
        // .invalid can never be a real site, so its icon is always the blank globe.
        blankIcon ??= pixels(faviconUrl('https://unvisited.invalid/', 32));
        const pick = async () => {
            const blank = await blankIcon;
            for (const pageUrl of [`https://www.${domain}/`, `https://${domain}/`]) {
                const src = faviconUrl(pageUrl, size);
                if ((await pixels(src)) !== blank) return src;
            }
            return null;
        };
        chosen.set(domain, pick().catch(() => null));
    }
    return chosen.get(domain);
}

/**
 * A site's icon from the browser's own favicon cache (the `favicon`
 * permission). Nothing is downloaded: a site never visited shows the
 * browser's plain globe.
 */
export function favicon(domain, size = 20) {
    const img = el('img', { className: 'favicon', src: faviconUrl(`https://${domain}/`, size * 2), alt: '', width: size, height: size });
    pickIcon(domain, size * 2).then((src) => {
        if (src) img.src = src;
    });
    return img;
}

/**
 * A segmented control (one choice of a few) as a radio group: one Tab stop,
 * arrow keys move the choice in the page's direction.
 */
export function segmented({ label, options, value, onChange, small = false }) {
    const group = el('div', { className: `segmented${small ? ' sm' : ''}`, role: 'radiogroup', ariaLabel: label });
    const buttons = options.map((option) =>
        el(
            'button',
            {
                type: 'button',
                className: 'segment',
                role: 'radio',
                ariaChecked: String(option.value === value),
                tabIndex: option.value === value ? 0 : -1,
                onclick: () => select(option.value, false),
            },
            option.label
        )
    );
    function select(next, focus) {
        buttons.forEach((button, i) => {
            const on = options[i].value === next;
            button.ariaChecked = String(on);
            button.tabIndex = on ? 0 : -1;
            if (on && focus) button.focus();
        });
        if (next !== value) {
            value = next;
            onChange(next);
        }
    }
    group.addEventListener('keydown', (event) => {
        const rtl = document.documentElement.dir === 'rtl';
        const step = { ArrowRight: rtl ? -1 : 1, ArrowLeft: rtl ? 1 : -1, ArrowDown: 1, ArrowUp: -1 }[event.key];
        if (!step) return;
        event.preventDefault();
        const index = options.findIndex((o) => o.value === value);
        select(options[(index + step + options.length) % options.length].value, true);
    });
    group.append(...buttons);
    group.getValue = () => value;
    return group;
}

/** A labelled on/off switch row. `lead` is shown before the label (an icon). */
export function switchRow({ label, checked, onChange, lead = null, id }) {
    const input = el('input', { type: 'checkbox', role: 'switch', checked, id, onchange: () => onChange(input.checked, input) });
    return el(
        'label',
        { className: 'switch-row' },
        el('span', { className: 'switch-label' }, lead, el('span', {}, label)),
        el('span', { className: 'switch' }, input, el('span', { className: 'track' }, el('span', { className: 'knob' })))
    );
}

let toastBox = null;

/** A short message in the corner, like the site's toasts: a confirmation, or an error. */
export function toast(text, { error = false } = {}) {
    if (!toastBox) {
        toastBox = el('div', { className: 'toasts', role: 'status', ariaLive: 'polite' });
        document.body.append(toastBox);
    }
    const item = el('div', { className: `toast${error ? ' toast-error' : ''}` }, error ? null : icon('check'), el('span', {}, text));
    toastBox.replaceChildren(item);
    setTimeout(() => item.remove(), error ? 5000 : 2500);
}

/** "Saved", or the strict-mode notice when part of a change has to wait. */
export function savedToast(status) {
    toast(status?.pending ? t('toast_saved_later') : t('toast_saved'));
}
