const YT_ORIGIN = /^https?:\/\/(?:[^/]+\.)?(?:youtube\.com|youtube-nocookie\.com)\//;

chrome.runtime.onInstalled.addListener(() => {
  try {
    const result = chrome.storage.local.get("enabled");
    if (result && typeof result.then === "function") {
      result.then((state) => {
        if (state && state.enabled === undefined) chrome.storage.local.set({ enabled: true });
      }).catch(() => {});
      return;
    }
    chrome.storage.local.get("enabled", (state) => {
      if (state && state.enabled === undefined) chrome.storage.local.set({ enabled: true });
    });
  } catch (e) {}
});

function injectMain(tabId, frameId) {
  try {
    if (!chrome.scripting || typeof chrome.scripting.executeScript !== "function") return;
    const pending = chrome.scripting.executeScript({
      target: { tabId, frameIds: [frameId] },
      world: "MAIN",
      injectImmediately: true,
      files: ["src/main.js"]
    });
    if (pending && typeof pending.catch === "function") pending.catch(() => {});
  } catch (e) {}
}

if (chrome.webNavigation && chrome.webNavigation.onCommitted) {
  chrome.webNavigation.onCommitted.addListener((details) => {
    if (!YT_ORIGIN.test(details.url)) return;
    injectMain(details.tabId, details.frameId);
  });
}
