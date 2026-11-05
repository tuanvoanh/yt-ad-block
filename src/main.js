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

  const MARKER = /"adPlacements"|"adSlots"|playerAds|adBreakHeartbeatParams|adSlotRenderer|promotedSparkles|displayAdRenderer|adClientParams/;
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
    const parse = JSON.parse;
    JSON.parse = function (text, reviver) {
      const out = parse.call(this, text, reviver);
      if (typeof text === "string" && MARKER.test(text) && out && typeof out === "object") {
        try { prune(out); } catch (e) {}
      }
      return out;
    };
  } catch (e) {}

  try {
    const json = Response.prototype.json;
    Response.prototype.json = function () {
      return json.call(this).then((value) => {
        try { prune(value); } catch (e) {}
        return value;
      });
    };
  } catch (e) {}

  const realFetch = window.fetch;

  function readStream(reader, limit) {
    const chunks = [];
    let total = 0;
    return reader.read().then(function pump(result) {
      if (result.done) {
        const merged = new Uint8Array(total);
        let offset = 0;
        for (const chunk of chunks) {
          merged.set(chunk, offset);
          offset += chunk.length;
        }
        return merged;
      }
      chunks.push(result.value);
      total += result.value.length;
      if (limit && total >= limit) {
        try { reader.cancel(); } catch (e) {}
        return null;
      }
      return reader.read().then(pump);
    });
  }

  function patchBackoff(bytes) {
    let patched = false;
    for (let i = 0; i < bytes.length - 2; i++) {
      if (bytes[i] !== 0x20) continue;
      let value = 0;
      let shift = 0;
      let end = i + 1;
      while (end < bytes.length && shift < 35) {
        value |= (bytes[end] & 0x7f) << shift;
        if (!(bytes[end] & 0x80)) {
          end++;
          break;
        }
        shift += 7;
        end++;
      }
      if (value > 500 && value < 100000) {
        const target = 50 + Math.floor(Math.random() * 100);
        let position = i + 1;
        let remaining = target;
        while (position < end - 1) {
          bytes[position++] = (remaining & 0x7f) | 0x80;
          remaining >>>= 7;
        }
        bytes[position] = remaining & 0x7f;
        patched = true;
      }
    }
    return patched;
  }

  function sabrFetch() {
    return realFetch.apply(this, arguments).then((response) => {
      if (!response || !response.ok || !response.body) return response;
      let pass;
      let scan;
      let meta;
      try {
        [pass, scan] = response.body.tee();
        meta = {
          status: response.status,
          statusText: response.statusText,
          headers: response.headers
        };
      } catch (e) {
        return response;
      }
      return readStream(scan.getReader(), 1000).then((bytes) => {
        if (bytes === null) return new Response(pass, meta);
        patchBackoff(bytes);
        const output = new Response(bytes, meta);
        try {
          Object.defineProperty(output, "url", { value: response.url, configurable: true });
          Object.defineProperty(output, "type", { value: response.type, configurable: true });
        } catch (e) {}
        return output;
      }).catch(() => new Response(pass, meta));
    });
  }

  if (typeof realFetch === "function") {
    window.fetch = function (input, init) {
      const url = typeof input === "string" ? input : (input && input.url) || "";
      if (url.includes("googlevideo.com") && url.includes("sabr=1")) {
        return sabrFetch.apply(this, arguments);
      }
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
  hookGlobal("ytInitialData");

  const sweep = () => {
    for (const name of ["ytInitialPlayerResponse", "ytInitialData"]) {
      try {
        const value = window[name];
        if (value && typeof value === "object") prune(value);
      } catch (e) {}
    }
  };

  let sweeps = 0;
  const sweepTimer = setInterval(() => {
    sweep();
    if (++sweeps >= 40) clearInterval(sweepTimer);
  }, 250);

  try {
    const now = performance.now.bind(performance);
    let previous = 0;
    performance.now = function () {
      let current = now();
      if (current <= previous) current = previous + Number.EPSILON * 100000;
      previous = current;
      return current;
    };
  } catch (e) {}

  const SKIP_SELECTOR = ".ytp-ad-skip-button-modern, .ytp-ad-skip-button, .ytp-skip-ad-button, .ytp-ad-overlay-close-button, .ytp-ad-overlay-close-container button";
  let mutedByUs = false;

  const clearFeed = () => {
    const nodes = document.querySelectorAll("ytd-rich-item-renderer, ytd-compact-video-renderer, ytd-video-renderer, ytd-rich-section-renderer");
    for (const node of nodes) {
      if (node.__ytabAd) continue;
      if (node.querySelector("ytd-ad-slot-renderer, ytd-in-feed-ad-layout-renderer, ytd-display-ad-renderer, ytd-promoted-sparkles-web-renderer, ytd-statement-banner-renderer")) {
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
        if (!video.muted) {
          try { video.muted = true; mutedByUs = true; } catch (e) {}
        }
        if (Number.isFinite(video.duration) && video.duration > 1) {
          try { video.currentTime = video.duration; } catch (e) {}
        }
      } else if (video) {
        if (mutedByUs) {
          try { video.muted = false; } catch (e) {}
          mutedByUs = false;
        }
        if (video.playbackRate > 2) {
          try { video.playbackRate = 1; } catch (e) {}
        }
      }
    }
    clearFeed();
  };

  setInterval(tick, 200);

  const UA_MARKERS = ["channel", "lactmilli", "yahi", "inline"];
  let markerQueue = UA_MARKERS.slice();
  let pendingReload = false;
  let reloadBudget = 12;
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

  const isStalled = (info) => !!(info.buffering && info.stats && info.stats.buffer_health_seconds === "0.00 s" && info.stats.resolution === "0x0");

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
    const start = (response.playerConfig && response.playerConfig.playbackStartConfig && response.playerConfig.playbackStartConfig.startSeconds) || (info.progress && info.progress.current) || 0;
    reloadBudget--;
    try { player.loadVideoById(id, start); } catch (e) {}
  };

  const requestReload = () => {
    const info = playerInfo();
    if (!info.player || !isStalled(info)) return;
    const url = info.response && info.response.playbackTracking && info.response.playbackTracking.videostatsPlaybackUrl && info.response.playbackTracking.videostatsPlaybackUrl.baseUrl;
    if (url && url.includes("reloadxhr")) markerQueue = markerQueue.slice(1);
    pendingReload = true;
  };

  const handlePlayer = () => {
    const info = playerInfo();
    if (!info.player) return;
    if (!location.href.includes("/watch?") && !location.href.includes("/embed/")) {
      pendingReload = false;
      return;
    }

    if (info.stats && typeof info.stats.debug_info === "string" && info.stats.debug_info.startsWith("SSAP, AD")) {
      if (info.progress && info.progress.duration > 0) {
        try { info.player.seekTo(info.progress.duration); } catch (e) {}
      }
      return;
    }

    const status = info.response && info.response.playabilityStatus;
    if (status && status.status === "UNPLAYABLE") {
      const error = status.errorScreen;
      const captcha = error && error.playerErrorMessageRenderer && error.playerErrorMessageRenderer.playerCaptchaViewModel;
      if (!captcha) {
        const reason = JSON.stringify(
          (error && error.playerErrorMessageRenderer && error.playerErrorMessageRenderer.subreason && error.playerErrorMessageRenderer.subreason.runs) ||
          (error && error.playerInterstitialRenderer && error.playerInterstitialRenderer.content && error.playerInterstitialRenderer.content.interstitialViewModel && error.playerInterstitialRenderer.content.interstitialViewModel.description && error.playerInterstitialRenderer.content.interstitialViewModel.description.commandRuns) ||
          ""
        );
        if (reason.includes("WEB_PAGE_TYPE_UNKNOWN") && reason.includes("3037019")) {
          rotateMarker();
          pendingReload = false;
          reloadPlayer(info);
          return;
        }
      }
    }

    if (!pendingReload || !isStalled(info)) return;
    rotateMarker();
    pendingReload = false;
    reloadPlayer(info);
  };

  const dismissInterruption = () => {
    const nodes = document.querySelectorAll("ytd-enforcement-message-view-model, yt-confirm-dialog-renderer, tp-yt-paper-dialog");
    for (const node of nodes) {
      const text = node.textContent || "";
      if (!text.includes("Experiencing interruptions") && !text.includes("Ad blockers violate") && !text.includes("ad blocker")) continue;
      node.remove();
      const info = playerInfo();
      rotateMarker();
      pendingReload = false;
      reloadPlayer(info);
      if (info.player && typeof info.player.playVideo === "function") {
        try { info.player.playVideo(); } catch (e) {}
      }
    }
  };

  try {
    const has = Map.prototype.has;
    Map.prototype.has = new Proxy(has, {
      apply(target, self, args) {
        if (args[0] === "onSnackbarMessage" && !pendingReload) requestReload();
        return Reflect.apply(target, self, args);
      }
    });
  } catch (e) {}

  try {
    const push = Array.prototype.push;
    Array.prototype.push = new Proxy(push, {
      apply(target, self, args) {
        const value = args[0];
        if (!pendingReload && value && typeof value === "object" && value.constructor && value.constructor.name === "Uint8Array" && value.buffer && value.buffer.byteLength === value.length && (value.length === 104 || value.length === 105)) {
          requestReload();
        }
        return Reflect.apply(target, self, args);
      }
    });
  } catch (e) {}

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

  document.addEventListener("DOMContentLoaded", () => {
    handlePlayer();
    new MutationObserver(() => {
      handlePlayer();
      dismissInterruption();
    }).observe(document, { childList: true, subtree: true });
  });

  setInterval(handlePlayer, 1000);
  setInterval(dismissInterruption, 1000);

  document.addEventListener("yt-navigate-finish", () => {
    pendingReload = false;
    dismissInterruption();
    sweep();
  });

  document.addEventListener("DOMContentLoaded", sweep);
  window.addEventListener("load", sweep);
})();
