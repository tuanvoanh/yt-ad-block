const YT_ORIGIN = /^https?:\/\/(?:[^/]+\.)?(?:youtube\.com|youtube-nocookie\.com)\//;

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.get("enabled").then((state) => {
    if (state.enabled === undefined) {
      chrome.storage.local.set({ enabled: true });
    }
  }).catch(() => {});
});

function injectMain(tabId, frameId) {
  chrome.scripting.executeScript({
    target: { tabId, frameIds: [frameId] },
    world: "MAIN",
    injectImmediately: true,
    files: ["src/main.js"]
  }).catch(() => {});
}

if (chrome.webNavigation && chrome.webNavigation.onCommitted) {
  chrome.webNavigation.onCommitted.addListener((details) => {
    if (!YT_ORIGIN.test(details.url)) return;
    injectMain(details.tabId, details.frameId);
  });
}
