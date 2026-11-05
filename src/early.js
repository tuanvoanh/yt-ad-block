(() => {
  try {
    const root = document.head || document.documentElement;
    if (!root) return;
    const script = document.createElement("script");
    script.src = chrome.runtime.getURL("src/main.js");
    script.async = false;
    script.onload = () => script.remove();
    script.onerror = () => script.remove();
    root.appendChild(script);
  } catch (e) {}
})();
