import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchesUrl, matchingEntries, normalizePattern, originsFor } from '../src/lib/sites.js';

test('normalizes what people type into one pattern', () => {
    assert.equal(normalizePattern('youtube.com'), 'youtube.com');
    assert.equal(normalizePattern('  https://www.YouTube.com/  '), 'youtube.com');
    assert.equal(normalizePattern('WWW.reddit.com/r/all/'), 'reddit.com/r/all');
    assert.equal(normalizePattern('https://news.ycombinator.com/news?p=2#top'), 'news.ycombinator.com/news');
    assert.equal(normalizePattern('m.facebook.com'), 'm.facebook.com');
    assert.equal(normalizePattern('bücher.de'), 'xn--bcher-kva.de');
});

test('rejects things that are not sites', () => {
    for (const input of ['', '   ', 'localhost', 'youtube', 'ftp://example.com', 'chrome://extensions', 'a..b.com', '-bad.com', 'exa mple.com', null]) {
        assert.equal(normalizePattern(input), null, String(input));
    }
});

test('a domain covers its subdomains but not look-alikes', () => {
    assert.ok(matchesUrl('youtube.com', 'https://www.youtube.com/watch?v=1'));
    assert.ok(matchesUrl('youtube.com', 'https://m.youtube.com/'));
    assert.ok(matchesUrl('youtube.com', 'http://youtube.com'));
    assert.ok(!matchesUrl('youtube.com', 'https://notyoutube.com/'));
    assert.ok(!matchesUrl('youtube.com', 'https://youtube.com.evil.net/'));
    assert.ok(!matchesUrl('youtube.com', 'chrome-extension://abc/pages/blocked.html?u=https://youtube.com/'));
});

test('a path covers itself and below it, ignoring case', () => {
    assert.ok(matchesUrl('reddit.com/r/all', 'https://www.reddit.com/r/all'));
    assert.ok(matchesUrl('reddit.com/r/all', 'https://www.reddit.com/r/all/top?t=day'));
    assert.ok(matchesUrl('reddit.com/r/all', 'https://www.reddit.com/R/All/'));
    assert.ok(!matchesUrl('reddit.com/r/all', 'https://www.reddit.com/r/allthingsgo'));
    assert.ok(!matchesUrl('reddit.com/r/all', 'https://www.reddit.com/r/programming'));
});

test('the most specific entry comes first', () => {
    const entries = [
        { id: 'a', pattern: 'youtube.com', mode: 'limited' },
        { id: 'b', pattern: 'youtube.com/shorts', mode: 'blocked' },
        { id: 'c', pattern: 'reddit.com', mode: 'limited' },
    ];
    assert.deepEqual(
        matchingEntries(entries, 'https://www.youtube.com/shorts/abc').map((e) => e.id),
        ['b', 'a']
    );
    assert.deepEqual(matchingEntries(entries, 'https://example.com/'), []);
});

test('asks for access to the domain and its subdomains', () => {
    assert.deepEqual(originsFor('reddit.com/r/all'), ['*://*.reddit.com/*']);
    assert.deepEqual(originsFor('not a site'), []);
});
