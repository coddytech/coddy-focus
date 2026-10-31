// Runs on YouTube while one of its hide switches is on. It only marks the
// page with the switches that are on (the CSS next to it does the hiding)
// and turns Shorts addresses into normal video pages. It reads nothing
// from the page and sends nothing anywhere.
(() => {
    const root = document.documentElement;
    let hide = {};

    function redirect() {
        if (!hide.ytShorts) return;
        const short = location.pathname.match(/^\/shorts\/([\w-]+)/);
        if (short) {
            location.replace(`/watch?v=${short[1]}`);
            return;
        }
        const channelTab = location.pathname.match(/^(\/(?:@[^/]+|channel\/[^/]+|c\/[^/]+|user\/[^/]+))\/shorts\/?$/);
        if (channelTab) location.replace(`${channelTab[1]}/videos`);
    }

    function apply(settings) {
        hide = settings?.hide ?? {};
        const on = ['ytShorts', 'ytComments', 'ytRecommendations'].filter((key) => hide[key]);
        if (on.length) root.dataset.coddyFocus = on.join(' ');
        else delete root.dataset.coddyFocus;
        redirect();
    }

    chrome.storage.local.get('settings').then(({ settings }) => apply(settings));
    chrome.storage.onChanged.addListener((changes, area) => {
        if (area === 'local' && changes.settings) apply(changes.settings.newValue);
    });

    // YouTube changes pages without reloading them.
    document.addEventListener('yt-navigate-start', redirect);
    let last = location.href;
    setInterval(() => {
        if (location.href !== last) {
            last = location.href;
            redirect();
        }
    }, 500);
})();
