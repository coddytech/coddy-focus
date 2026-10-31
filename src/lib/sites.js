// A site pattern is a domain with an optional path: "youtube.com" or
// "reddit.com/r/all". A domain covers its subdomains, and "www." is dropped
// so "www.youtube.com" and "youtube.com" are the same entry. Paths match
// without regard to case, the same way the browser's blocking rules do.

/** Parses user input into { domain, path }, or null when it is not a site. */
export function parsePattern(input) {
    let text = String(input ?? '').trim();
    if (!text) return null;
    if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(text)) text = `http://${text}`;
    let url;
    try {
        url = new URL(text);
    } catch {
        return null;
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    let domain = url.hostname.toLowerCase().replace(/\.$/, '');
    if (domain.startsWith('www.')) domain = domain.slice(4);
    const labels = domain.split('.');
    if (
        labels.length < 2 ||
        !/^[a-z0-9.-]+$/.test(domain) ||
        labels.some((l) => !l || l.startsWith('-') || l.endsWith('-'))
    ) {
        return null;
    }
    const path = url.pathname.replace(/\/+$/, '');
    return { domain, path };
}

/** The canonical text of a pattern, or null when the input is not a site. */
export function normalizePattern(input) {
    const parsed = parsePattern(input);
    return parsed ? parsed.domain + parsed.path : null;
}

/** True when `url` is on the site `pattern` names. */
export function matchesUrl(pattern, url) {
    const site = parsePattern(pattern);
    if (!site) return false;
    let parsed;
    try {
        parsed = new URL(url);
    } catch {
        return false;
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
    const host = parsed.hostname.toLowerCase();
    if (host !== site.domain && !host.endsWith(`.${site.domain}`)) return false;
    if (!site.path) return true;
    const path = parsed.pathname.toLowerCase();
    const want = site.path.toLowerCase();
    return path === want || path.startsWith(`${want}/`);
}

/** Every entry whose pattern covers `url`, the most specific first. */
export function matchingEntries(entries, url) {
    return entries
        .filter((e) => matchesUrl(e.pattern, url))
        .sort((a, b) => b.pattern.length - a.pattern.length);
}

/** The host permission an entry needs so the extension can show its own blocked page. */
export function originsFor(pattern) {
    const site = parsePattern(pattern);
    return site ? [`*://*.${site.domain}/*`] : [];
}
