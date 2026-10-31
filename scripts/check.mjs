// Checks the promises the extension makes, so a change that breaks one
// fails the build:
//
// 1. No network code. The extension's own code never calls fetch,
//    XMLHttpRequest, WebSockets, beacons or any other way to send data,
//    and links only to coddy.tech and github.com.
// 2. The manifest asks for no more than it needs and its content security
//    policy forbids network connections (connect-src 'none').
// 3. Every language has every message, with the same placeholders, and
//    every message the code uses exists.
//
// Run: npm run check

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const src = join(root, 'src');
const problems = [];
const fail = (file, message) => problems.push(`${relative(root, file)}: ${message}`);

const walk = (dir) =>
    readdirSync(dir).flatMap((name) => {
        const path = join(dir, name);
        return statSync(path).isDirectory() ? walk(path) : [path];
    });
const files = walk(src);
const code = files.filter((f) => /\.(js|html|css)$/.test(f));

// 1. No network code.
const FORBIDDEN = [
    [/\bfetch\s*\(/, 'fetch()'],
    [/\bXMLHttpRequest\b/, 'XMLHttpRequest'],
    [/\bWebSocket\b/, 'WebSocket'],
    [/\bEventSource\b/, 'EventSource'],
    [/\bsendBeacon\b/, 'navigator.sendBeacon'],
    [/\bimportScripts\b/, 'importScripts'],
    [/\bRTCPeerConnection\b/, 'WebRTC'],
    [/\bconnectNative\b|\bsendNativeMessage\b/, 'native messaging'],
    [/\beval\s*\(|new Function\s*\(/, 'eval'],
];
const ALLOWED_HOSTS = new Set(['coddy.tech', 'github.com']);
for (const file of code) {
    const text = readFileSync(file, 'utf8');
    for (const [pattern, name] of FORBIDDEN) {
        if (pattern.test(text)) fail(file, `uses ${name}`);
    }
    // The SVG namespace is a name, not an address: nothing is fetched from it.
    for (const match of text.replaceAll('http://www.w3.org/2000/svg', '').matchAll(/https?:\/\/([a-z0-9.-]+)(\$\{)?/gi)) {
        // A host built from a variable (`https://www.${domain}/`) names the user's own site,
        // only ever looked up in the browser's icon cache; ui.js is the one place that does it.
        if (match[2] && file.endsWith('ui.js')) continue;
        // A .invalid name can never resolve (RFC 2606); ui.js uses one to read the blank icon.
        const host = match[1].toLowerCase();
        if (!ALLOWED_HOSTS.has(host) && !host.endsWith('.invalid')) fail(file, `links to ${match[1]}`);
    }
}

// 2. The manifest.
const manifestPath = join(src, 'manifest.json');
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const PERMISSIONS = ['storage', 'alarms', 'idle', 'declarativeNetRequest', 'scripting', 'activeTab', 'favicon'];
for (const permission of manifest.permissions ?? []) {
    if (!PERMISSIONS.includes(permission)) fail(manifestPath, `asks for "${permission}"`);
}
if (manifest.host_permissions?.length) fail(manifestPath, 'asks for host access at install; ask per site instead');
const csp = manifest.content_security_policy?.extension_pages ?? '';
if (!/connect-src 'none'/.test(csp)) fail(manifestPath, "CSP must keep connect-src 'none'");
if (!/default-src 'self'/.test(csp)) fail(manifestPath, "CSP must keep default-src 'self'");
if (manifest.version !== pkg.version) fail(manifestPath, `version ${manifest.version} differs from package.json ${pkg.version}`);

// 3. Messages.
const localesDir = join(src, '_locales');
const read = (lang) => JSON.parse(readFileSync(join(localesDir, lang, 'messages.json'), 'utf8'));
const english = read('en');
const placeholders = (text) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');
const LIMITS = { ext_name: 75, ext_short_name: 12, ext_description: 132 };
for (const lang of readdirSync(localesDir)) {
    const file = join(localesDir, lang, 'messages.json');
    let messages;
    try {
        messages = read(lang);
    } catch (error) {
        fail(file, `is not valid JSON (${error.message})`);
        continue;
    }
    for (const key of Object.keys(english)) {
        const message = messages[key]?.message;
        if (typeof message !== 'string' || !message) {
            fail(file, `misses "${key}"`);
            continue;
        }
        if (placeholders(message) !== placeholders(english[key].message)) fail(file, `"${key}" has different placeholders`);
        if (message.includes('$')) fail(file, `"${key}" contains "$", which Chrome reads as a substitution`);
        if (/[–—]/.test(message)) fail(file, `"${key}" contains a dash; rewrite the sentence`);
        if (LIMITS[key] && [...message].length > LIMITS[key]) fail(file, `"${key}" is over ${LIMITS[key]} characters`);
        // Single words like "Site" or "Backup" are the same in many languages; a sentence never is.
        const words = message.replace(/\{\w+\}|Coddy Focus|[a-z0-9-]+\.[a-z/.]+/gi, '').match(/[a-z]{2,}/gi) ?? [];
        if (lang !== 'en' && message === english[key].message && words.length > 1) {
            fail(file, `"${key}" is still English`);
        }
    }
    for (const key of Object.keys(messages)) {
        if (!(key in english)) fail(file, `has "${key}", which English does not`);
    }
    if (messages.locale?.message !== lang.replace('_', '-')) fail(file, `"locale" must be "${lang.replace('_', '-')}"`);
    const rtl = ['ar', 'he', 'fa', 'ur'].includes(lang.split('_')[0]);
    if (messages.dir?.message !== (rtl ? 'rtl' : 'ltr')) fail(file, `"dir" must be "${rtl ? 'rtl' : 'ltr'}"`);
}

const used = new Set();
for (const file of [...code, manifestPath]) {
    const text = readFileSync(file, 'utf8');
    for (const m of text.matchAll(/data-i18n(?:-placeholder|-label)?="(\w+)"/g)) used.add(m[1]);
    for (const m of text.matchAll(/\b(?:t|sentence)\(\s*'(\w+)'/g)) used.add(m[1]);
    for (const m of text.matchAll(/__MSG_(\w+)__/g)) used.add(m[1]);
    // Keys passed around as values, like REASON_KEYS or showError('sites_invalid').
    for (const m of text.matchAll(/'(\w+)'/g)) if (m[1] in english) used.add(m[1]);
}
for (const key of used) {
    if (!(key in english)) problems.push(`code uses the message "${key}", which en/messages.json lacks`);
}
for (const key of Object.keys(english)) {
    if (!used.has(key)) problems.push(`en/messages.json has "${key}", which no code uses`);
}

if (problems.length) {
    console.error(`${problems.length} problem(s):\n${problems.map((p) => `  ${p}`).join('\n')}`);
    process.exit(1);
}
console.log(`ok: ${code.length} files without network code, manifest, ${readdirSync(localesDir).length} languages`);
