// Runs on Instagram while "Hide Reels" is on. It marks the page for the CSS
// next to it and sends the Reels feed (/reels/ and /reels/<id>/) back to the
// home feed and a profile's Reels tab back to the profile. A single reel
// someone shared (/reel/<id>/) still opens. It reads nothing from the page
// and sends nothing anywhere.
(() => {
    const root = document.documentElement;
    let on = false;

    function redirect() {
        if (!on) return;
        const path = location.pathname;
        if (/^\/reels(\/|$)/.test(path)) {
            location.replace('/');
            return;
        }
        const profileTab = path.match(/^\/([\w.]+)\/reels\/?$/);
        if (profileTab) location.replace(`/${profileTab[1]}/`);
    }

    function apply(settings) {
        on = settings?.hide?.igReels === true;
        if (on) root.dataset.coddyFocus = 'igReels';
        else delete root.dataset.coddyFocus;
        redirect();
    }

    chrome.storage.local.get('settings').then(({ settings }) => apply(settings));
    chrome.storage.onChanged.addListener((changes, area) => {
        if (area === 'local' && changes.settings) apply(changes.settings.newValue);
    });

    // Instagram changes pages without reloading them.
    let last = location.href;
    setInterval(() => {
        if (location.href !== last) {
            last = location.href;
            redirect();
        }
    }, 500);
})();
