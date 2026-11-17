(() => {
  if (window.__ytabInstalled) return;
  window.__ytabInstalled = true;

  const AD_KEYS = new Set([
    "adPlacements",
    "playerAds",
    "adSlots",
    "adBreakHeartbeatParams",
    "adSlotRenderer",
    "promotedSparklesWebRenderer",
    "promotedSparklesTextSearchRenderer",
    "displayAdRenderer",
    "adClientParams"
  ]);

  const MARKER = /"(?:adPlacements|adSlots|playerAds|adBreakHeartbeatParams|adSlotRenderer|promotedSparklesWebRenderer|promotedSparklesTextSearchRenderer|displayAdRenderer|adClientParams)"/;
  const PLAYER_URL = /\/youtubei\/v1\/(?:player|get_watch)|\/reel_watch_sequence|\/playlist|\/resolve_url|\/player\?|watch\?/;

  const prune = (root) => {
    if (!root || typeof root !== "object") return;
    const seen = new WeakSet();
    const stack = [[root, 0]];
    while (stack.length) {
      const entry = stack.pop();
      const obj = entry[0];
      const depth = entry[1];
      if (!obj || typeof obj !== "object" || depth > 32 || seen.has(obj)) continue;
      seen.add(obj);
      if (Array.isArray(obj)) {
        for (let i = obj.length - 1; i >= 0; i--) {
          const value = obj[i];
          if (value && typeof value === "object") {
            if (value.adSlotRenderer || value.promotedSparklesWebRenderer || value.displayAdRenderer || value.promotedVideoRenderer || (value.adClientParams && value.adClientParams.isAd)) {
              obj.splice(i, 1);
              continue;
            }
            stack.push([value, depth + 1]);
          }
        }
        continue;
      }
      for (const key of Object.keys(obj)) {
        if (AD_KEYS.has(key)) {
          try {
            delete obj[key];
          } catch (e) {
            try { obj[key] = undefined; } catch (_) {}
          }
          continue;
        }
        const value = obj[key];
        if (value && typeof value === "object") stack.push([value, depth + 1]);
      }
    }
  };

  const rewrite = (text) => {
    if (typeof text !== "string" || !MARKER.test(text)) return text;
    try {
      const data = JSON.parse(text);
      prune(data);
      return JSON.stringify(data);
    } catch (e) {
      return text;
    }
  };

  try {
    const json = Response.prototype.json;
    Response.prototype.json = function () {
      return json.call(this).then((value) => {
        if (PLAYER_URL.test(this.url || "")) {
          try { prune(value); } catch (e) {}
        }
        return value;
      });
    };
  } catch (e) {}

  const realFetch = window.fetch;

  if (typeof realFetch === "function") {
    window.fetch = function (input, init) {
      const url = typeof input === "string" ? input : (input && input.url) || "";
      if (!PLAYER_URL.test(url)) return realFetch.apply(this, arguments);
      return realFetch.apply(this, arguments).then((response) => {
        if (!response || !response.ok) return response;
        const type = (response.headers.get("content-type") || "").toLowerCase();
        if (!type.includes("json")) return response;
        return response.clone().text().then((text) => {
          if (!MARKER.test(text)) return response;
          const body = rewrite(text);
          const headers = new Headers(response.headers);
          headers.delete("content-length");
          headers.delete("content-encoding");
          headers.delete("transfer-encoding");
          const output = new Response(body, {
            status: response.status,
            statusText: response.statusText,
            headers
          });
          try {
            Object.defineProperty(output, "url", { value: response.url, configurable: true });
            Object.defineProperty(output, "redirected", { value: response.redirected, configurable: true });
            Object.defineProperty(output, "type", { value: response.type, configurable: true });
          } catch (e) {}
          return output;
        }).catch(() => response);
      });
    };
  }

  try {
    const proto = XMLHttpRequest.prototype;
    const open = proto.open;
    proto.open = function (method, url) {
      try { this.__ytabURL = String(url); } catch (e) {}
      return open.apply(this, arguments);
    };
    const textDescriptor = Object.getOwnPropertyDescriptor(proto, "responseText");
    const responseDescriptor = Object.getOwnPropertyDescriptor(proto, "response");
    if (textDescriptor && textDescriptor.get) {
      Object.defineProperty(proto, "responseText", {
        configurable: true,
        enumerable: textDescriptor.enumerable,
        get() {
          const value = textDescriptor.get.call(this);
          if (this.readyState === 4 && PLAYER_URL.test(this.__ytabURL || "")) return rewrite(value);
          return value;
        }
      });
    }
    if (responseDescriptor && responseDescriptor.get) {
      Object.defineProperty(proto, "response", {
        configurable: true,
        enumerable: responseDescriptor.enumerable,
        get() {
          const value = responseDescriptor.get.call(this);
          if (this.readyState !== 4 || !PLAYER_URL.test(this.__ytabURL || "")) return value;
          if (typeof value === "string") return rewrite(value);
          if (value && typeof value === "object") {
            try { prune(value); } catch (e) {}
          }
          return value;
        }
      });
    }
  } catch (e) {}

  const hookGlobal = (name) => {
    let current;
    try {
      Object.defineProperty(window, name, {
        configurable: true,
        get() { return current; },
        set(value) {
          current = value;
          if (current && typeof current === "object") {
            try { prune(current); } catch (e) {}
          }
        }
      });
    } catch (e) {}
  };

  hookGlobal("ytInitialPlayerResponse");

  const sweep = () => {
    try {
      const value = window.ytInitialPlayerResponse;
      if (value && typeof value === "object") prune(value);
    } catch (e) {}
  };

  let sweeps = 0;
  const sweepTimer = setInterval(() => {
    sweep();
    if (++sweeps >= 40) clearInterval(sweepTimer);
  }, 250);

  const SKIP_SELECTOR = ".ytp-ad-skip-button-modern, .ytp-ad-skip-button, .ytp-skip-ad-button, .ytp-ad-overlay-close-button, .ytp-ad-overlay-close-container button";
  const AD_UI_SELECTOR = ".ytp-ad-player-overlay, .ytp-ad-preview-container, .ytp-ad-text, .ytp-ad-image-overlay, .ytp-ad-simple-ad-badge";

  const clearFeed = () => {
    const nodes = document.querySelectorAll("ytd-rich-item-renderer");
    for (const node of nodes) {
      if (node.__ytabAd) continue;
      if (node.querySelector("ytd-ad-slot-renderer, ytd-in-feed-ad-layout-renderer, ytd-display-ad-renderer, ytd-promoted-sparkles-web-renderer")) {
        node.__ytabAd = true;
        node.remove();
      }
    }
  };

  const tick = () => {
    const player = document.getElementById("movie_player");
    if (player) {
      const video = player.querySelector("video");
      if (video && player.classList.contains("ad-showing")) {
        const button = player.querySelector(SKIP_SELECTOR);
        if (button) {
          try { button.click(); } catch (e) {}
        }
        const adVisible = !!player.querySelector(AD_UI_SELECTOR);
        if (adVisible && Number.isFinite(video.duration) && video.duration > 1 && video.currentTime < video.duration - 1) {
          try { video.currentTime = video.duration; } catch (e) {}
        }
      }
    }
    clearFeed();
  };

  setInterval(tick, 200);

  const UA_MARKERS = ["channel", "lactmilli", "yahi", "inline"];
  let markerQueue = UA_MARKERS.slice();
  let reloadBudget = 4;
  let baseUA = null;

  const innertubeClient = () => {
    const data = window.ytcfg && window.ytcfg.data_;
    return data && data.INNERTUBE_CONTEXT && data.INNERTUBE_CONTEXT.client;
  };

  const applyMarker = (marker) => {
    const client = innertubeClient();
    if (!client || typeof client.userAgent !== "string") return false;
    if (!baseUA) baseUA = client.userAgent;
    const head = baseUA.match(/Mozilla\/5\.0 \([^)]+/);
    if (!head) return false;
    client.userAgent = marker ? baseUA.replace(head[0], head[0] + "; " + marker) : baseUA;
    return true;
  };

  const playerInfo = () => {
    const player = document.getElementById("movie_player");
    return {
      player,
      response: player && typeof player.getPlayerResponse === "function" ? player.getPlayerResponse() : null,
      stats: player && typeof player.getStatsForNerds === "function" ? player.getStatsForNerds() : null,
      progress: player && typeof player.getProgressState === "function" ? player.getProgressState() : null,
      buffering: player && typeof player.getPlayerStateObject === "function" ? !!((player.getPlayerStateObject() || {}).isBuffering) : false
    };
  };

  const rotateMarker = () => {
    if (reloadBudget <= 0) return false;
    markerQueue = markerQueue.length > 1 ? markerQueue.slice(1) : UA_MARKERS.slice();
    return applyMarker(markerQueue[0]);
  };

  const reloadPlayer = (info) => {
    if (reloadBudget <= 0) return;
    const player = info.player;
    const response = info.response;
    if (!player || !response || !response.videoDetails) return;
    const id = response.videoDetails.videoId;
    const start = (info.progress && info.progress.current) ||
      (response.playerConfig && response.playerConfig.playbackStartConfig && response.playerConfig.playbackStartConfig.startSeconds) || 0;
    reloadBudget--;
    try { player.loadVideoById(id, start); } catch (e) {}
  };

  let lastRecovery = 0;
  const RECOVERY_COOLDOWN = 30000;

  const recover = () => {
    const info = playerInfo();
    const now = Date.now();

    let dialog = null;
    for (const node of document.querySelectorAll("ytd-enforcement-message-view-model, yt-confirm-dialog-renderer, tp-yt-paper-dialog")) {
      const text = node.textContent || "";
      if (text.includes("Experiencing interruptions") || text.includes("Ad blockers violate")) {
        dialog = node;
        break;
      }
    }
    if (dialog) dialog.remove();

    const status = info.response && info.response.playabilityStatus;
    const unplayable = !!(status && status.status === "UNPLAYABLE" && JSON.stringify(status.errorScreen || {}).includes("3037019"));
    if (!dialog && !unplayable) return;

    if (info.player && typeof info.player.playVideo === "function") {
      try { info.player.playVideo(); } catch (e) {}
    }
    if (!info.player || !info.response || !info.response.videoDetails) return;
    if (now - lastRecovery < RECOVERY_COOLDOWN) return;

    lastRecovery = now;
    rotateMarker();
    reloadPlayer(info);
  };

  try {
    const then = Promise.prototype.then;
    Promise.prototype.then = new Proxy(then, {
      apply(target, self, args) {
        if (typeof args[0] === "function" && Function.prototype.toString.call(args[0]).includes("onAbnormalityDetected")) {
          args[0] = function () {};
        }
        return Reflect.apply(target, self, args);
      }
    });
  } catch (e) {}

  let recoveryScheduled = false;
  const scheduleRecover = () => {
    if (recoveryScheduled) return;
    recoveryScheduled = true;
    setTimeout(() => {
      recoveryScheduled = false;
      recover();
    }, 300);
  };

  document.addEventListener("DOMContentLoaded", () => {
    recover();
    new MutationObserver(scheduleRecover).observe(document, { childList: true, subtree: true });
  });

  setInterval(recover, 2000);

  document.addEventListener("yt-navigate-finish", () => {
    sweep();
  });

  document.addEventListener("DOMContentLoaded", sweep);
  window.addEventListener("load", sweep);
})();
