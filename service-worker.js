const CACHE_NAME = "chess-offline-v3";
// Refresh replay branching and pros/cons styling in the app shell.
const STATUS_URL = new URL("__offline_status__", self.registration.scope).href;

const OFFLINE_FILES = [
  "./",
  "./index.html",
  "./service-worker.js",
  "./app.js",
  "./chess.min.js",
  "./data/puzzles-db.js",
  "./motifs.md",
  "./data/openings.json",
  "./data/all_moves_maia3.json",
  "./data/all_moves_maia3_reversed.json",
  "./engines/maia3/maia-engine.js",
  "./engines/maia3/maia-tensor.js",
  "./engines/maia3/maia-worker.js",
  "./engines/maia3/ort/ort.wasm.min.js",
  "./engines/maia3/ort/ort-wasm-simd-threaded.wasm",
  "./engines/maia3/ort/ort-wasm-simd-threaded.mjs",
  "./engines/sql/sql-wasm.js",
  "./engines/sql/sql-wasm.wasm",
  "./engines/stockfish19/stockfish-evaluator.js",
  "./engines/stockfish19/stockfish.js",
  "./engines/stockfish19/stockfish-19-lite-single.js",
  "./engines/stockfish19/stockfish.wasm",
  "./engines/motifs/motif-detector.mjs",
  "./engines/motifs/engine_rs.mjs",
  "./engines/motifs/engine_rs_bg.wasm",
  "./sounds/move.mp3",
  "./sounds/capture.mp3",
  "./sounds/check.mp3",
  "./sounds/checkmate.mp3",
  "./sounds/draw.mp3",
  "./sounds/lowtime.mp3",
  "./sounds/sound.mp3",
  "./images/icons/favicon.png",
  "./images/pieces/pw.png",
  "./images/pieces/pb.png",
  "./images/pieces/nw.png",
  "./images/pieces/nb.png",
  "./images/pieces/bw.png",
  "./images/pieces/bb.png",
  "./images/pieces/rw.png",
  "./images/pieces/rb.png",
  "./images/pieces/qw.png",
  "./images/pieces/qb.png",
  "./images/pieces/kw.png",
  "./images/pieces/kb.png",
  "./images/ratings/brilliant.png",
  "./images/ratings/great.png",
  "./images/ratings/book.png",
  "./images/ratings/best.png",
  "./images/ratings/excellent.png",
  "./images/ratings/good.png",
  "./images/ratings/inaccuracy.png",
  "./images/ratings/mistake.png",
  "./images/ratings/miss.png",
  "./images/ratings/blunder.png",
];
const REFRESH_ON_UPDATE = new Set([
  "./",
  "./index.html",
  "./service-worker.js",
  "./app.js",
  "./data/puzzles-db.js",
  "./motifs.md",
  "./engines/stockfish19/stockfish-evaluator.js",
  "./engines/stockfish19/stockfish.js",
  "./engines/stockfish19/stockfish-19-lite-single.js",
  "./engines/motifs/motif-detector.mjs",
  "./engines/motifs/engine_rs.mjs",
  "./engines/motifs/engine_rs_bg.wasm",
]);

async function writeStatus(status) {
  try {
    const cache = await caches.open(CACHE_NAME);
    await cache.put(STATUS_URL, new Response(JSON.stringify(status), {
      headers: { "Content-Type": "application/json" },
    }));
  } catch (error) {
    console.warn("Offline status could not be saved:", error);
  }
  const clients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
  for (const client of clients) client.postMessage({ type: "OFFLINE_STATUS", ...status });
}

let offlineDownloadPromise = null;

async function removeLegacyPuzzleDbCacheEntries() {
  const cacheNames = await caches.keys();
  await Promise.all(cacheNames.map(async (name) => {
    const cache = await caches.open(name);
    const requests = await cache.keys();
    await Promise.all(requests.filter((request) => {
      const pathname = new URL(request.url).pathname;
      return /\/data\/puzzles_[^/]+\.db$/.test(pathname);
    }).map((request) => cache.delete(request)));
  }));
}

function downloadOfflineFiles() {
  if (offlineDownloadPromise) return offlineDownloadPromise;
  offlineDownloadPromise = (async () => {
    await writeStatus({ state: "downloading", completed: 0, total: OFFLINE_FILES.length });
    let completed = 0;
    for (const file of OFFLINE_FILES) {
      const url = new URL(file, self.registration.scope).href;
      const cache = await caches.open(CACHE_NAME);
      if (!REFRESH_ON_UPDATE.has(file) && await cache.match(url)) {
        completed++;
        await writeStatus({ state: "downloading", completed, total: OFFLINE_FILES.length, file });
        continue;
      }
      let lastError;
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const response = await fetch(url, { cache: "reload" });
          if (response.status !== 200) throw new Error(`HTTP ${response.status} for ${file}`);
          await cache.put(url, response);
          lastError = null;
          break;
        } catch (error) {
          lastError = error;
          await new Promise((resolve) => setTimeout(resolve, 500 * (attempt + 1)));
        }
      }
      if (lastError) {
        await writeStatus({ state: "error", completed, total: OFFLINE_FILES.length, file, message: lastError.message });
        throw lastError;
      }
      completed++;
      await writeStatus({ state: "downloading", completed, total: OFFLINE_FILES.length, file });
    }
    await writeStatus({ state: "ready", completed, total: OFFLINE_FILES.length });
  })().finally(() => {
    offlineDownloadPromise = null;
  });
  return offlineDownloadPromise;
}

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    // Older releases cached every puzzle shard. They are now stored in
    // IndexedDB on demand, so release those duplicate CacheStorage copies.
    await removeLegacyPuzzleDbCacheEntries();
    await downloadOfflineFiles();
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names
      .filter((name) => name.startsWith("chess-offline-") && name !== CACHE_NAME)
      .map((name) => caches.delete(name)));
    await self.clients.claim();
  })());
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "GET_OFFLINE_STATUS") {
    event.waitUntil((async () => {
      const cache = await caches.open(CACHE_NAME);
      const response = await cache.match(STATUS_URL);
      const status = response ? await response.json() : { state: "missing" };
      event.source?.postMessage({ type: "OFFLINE_STATUS", ...status });
    })());
  } else if (event.data?.type === "REDOWNLOAD_ALL") {
    event.waitUntil(downloadOfflineFiles());
  }
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET" || new URL(request.url).origin !== self.location.origin) return;
  const requestUrl = new URL(request.url);
  if (!requestUrl.href.startsWith(self.registration.scope)) return;

  if (/\/data\/puzzles_[^/]+\.db$/.test(requestUrl.pathname)) {
    event.respondWith(fetch(request));
    return;
  }

  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    const cached = request.headers.has("range")
      ? await cache.match(request.url, { ignoreSearch: true })
      : await cache.match(request, { ignoreSearch: true });

    if (request.headers.has("range")) {
      try {
        return await fetch(request);
      } catch (error) {
        if (cached) return cached;
        throw error;
      }
    }

    if (cached) return cached;

    try {
      const response = await fetch(request);
      if (response.status === 200) {
        try {
          await cache.put(request, response.clone());
        } catch (error) {
          console.warn("Offline cache write failed:", request.url, error);
        }
      }
      return response;
    } catch (error) {
      if (request.mode === "navigate") {
        const appShell = await cache.match(new URL("./index.html", self.registration.scope).href);
        if (appShell) return appShell;
      }
      throw error;
    }
  })());
});
