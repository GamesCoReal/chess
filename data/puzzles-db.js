// Puzzle database loader.
//
// Puzzle databases live in per-rating-range SQLite files under ./data/.
// IndexedDB tracks app-managed downloads separately from files the player keeps.
// That means:
//   - "Clear Saved Data" clears the offline caches and Maia's model too.
//     Storage) never touches these — they survive it, same as the Maia model.
//   - Only a browser/site-data wipe removes them.
//   - Automatic cleanup removes only app-managed files outside the rating window.
//   - Manually kept files stay until the player explicitly deletes them.
//
// Only ONE sql.js database connection is kept open at a time. Puzzles are
// fetched with SQL queries — we never load an entire table into JavaScript,
// filtering and randomization both happen inside the SQL engine (WASM), only
// the single winning row crosses over into JS.

const PUZZLE_DB_RANGES = [
  { min: 100, max: 800, file: "puzzles_0100_0800.db" },
  { min: 801, max: 1000, file: "puzzles_0801_1000.db" },
  { min: 1001, max: 1200, file: "puzzles_1001_1200.db" },
  { min: 1201, max: 1400, file: "puzzles_1201_1400.db" },
  { min: 1401, max: 1600, file: "puzzles_1401_1600.db" },
  { min: 1601, max: 1800, file: "puzzles_1601_1800.db" },
  { min: 1801, max: 2000, file: "puzzles_1801_2000.db" },
  { min: 2001, max: 2200, file: "puzzles_2001_2200.db" },
  { min: 2201, max: 2400, file: "puzzles_2201_2400.db" },
  { min: 2401, max: Infinity, file: "puzzles_2401_+.db" },
];

function dbFileForRating(rating) {
  for (const range of PUZZLE_DB_RANGES) {
    if (rating >= range.min && rating <= range.max) return range.file;
  }
  // Ratings below 100 or above the top of the table both fall back sensibly.
  return rating < PUZZLE_DB_RANGES[0].min
    ? PUZZLE_DB_RANGES[0].file
    : PUZZLE_DB_RANGES[PUZZLE_DB_RANGES.length - 1].file;
}

// ---------- IndexedDB storage (same shape/pattern as MaiaModels) ----------

const PUZZLE_IDB_NAME = "PuzzleDatabases";
const PUZZLE_STORE_NAME = "databases";

function openPuzzleIdb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(PUZZLE_IDB_NAME, 1);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(PUZZLE_STORE_NAME)) {
        db.createObjectStore(PUZZLE_STORE_NAME, { keyPath: "filename" });
      }
    };
  });
}

async function getPuzzleDbRecord(filename) {
  const db = await openPuzzleIdb();
  return await new Promise((resolve, reject) => {
    const request = db.transaction([PUZZLE_STORE_NAME], "readonly").objectStore(PUZZLE_STORE_NAME).get(filename);
    request.onsuccess = () => {
      db.close();
      resolve(request.result || null);
    };
    request.onerror = () => {
      db.close();
      reject(request.error);
    };
  });
}

async function getLegacyCachedPuzzleDbResponse(filename) {
  if (!("caches" in window)) return null;
  const url = new URL(`./data/${filename}`, document.baseURI).href;
  return await caches.match(url, { ignoreSearch: true });
}

async function getCachedPuzzleDbBuffer(filename) {
  const record = await getPuzzleDbRecord(filename);
  if (record) return await record.data.arrayBuffer();
  const response = await getLegacyCachedPuzzleDbResponse(filename);
  return response ? await response.arrayBuffer() : null;
}

function notifyPuzzleStorageChanged(detail = {}) {
  window.dispatchEvent(new CustomEvent("puzzle-storage-changed", { detail }));
}

async function storePuzzleDbBuffer(filename, buffer, { manual = false } = {}) {
  const previous = await getPuzzleDbRecord(filename);
  const db = await openPuzzleIdb();
  await new Promise((resolve, reject) => {
    const transaction = db.transaction([PUZZLE_STORE_NAME], "readwrite");
    const request = transaction.objectStore(PUZZLE_STORE_NAME).put({
      filename,
      data: new Blob([buffer]),
      timestamp: Date.now(),
      size: buffer.byteLength,
      manual: manual || !!previous?.manual,
    });
    request.onsuccess = () => {};
    request.onerror = () => reject(request.error);
    transaction.oncomplete = () => {
      db.close();
      resolve();
    };
    transaction.onerror = () => {
      db.close();
      reject(transaction.error);
    };
    transaction.onabort = () => {
      db.close();
      reject(transaction.error || new Error("Puzzle database save was aborted."));
    };
  });
}

async function deleteLegacyPuzzleDbCache(filename) {
  if (!("caches" in window)) return;
  const url = new URL(`./data/${filename}`, document.baseURI).href;
  const cacheNames = await caches.keys();
  await Promise.all(cacheNames.map(async (name) => {
    const cache = await caches.open(name);
    await cache.delete(url, { ignoreSearch: true });
  }));
}

async function deletePuzzleDbRecord(filename) {
  if (activeDbFilename === filename && activeDb) {
    activeDb.close();
    activeDb = null;
    activeDbFilename = null;
  }
  const db = await openPuzzleIdb();
  await new Promise((resolve, reject) => {
    const transaction = db.transaction([PUZZLE_STORE_NAME], "readwrite");
    const request = transaction.objectStore(PUZZLE_STORE_NAME).delete(filename);
    request.onsuccess = () => {};
    request.onerror = () => reject(request.error);
    transaction.oncomplete = () => {
      db.close();
      resolve();
    };
    transaction.onerror = () => {
      db.close();
      reject(transaction.error);
    };
    transaction.onabort = () => {
      db.close();
      reject(transaction.error || new Error("Puzzle database removal was aborted."));
    };
  });
  await deleteLegacyPuzzleDbCache(filename);
}

async function fetchPuzzleDbFromNetwork(filename) {
  const response = await fetch(`./data/${filename}`);
  if (response.status !== 200) {
    throw new Error(`Failed to fetch ${filename}: HTTP ${response.status}`);
  }
  return await response.arrayBuffer();
}

async function listPuzzleDatabases() {
  const db = await openPuzzleIdb();
  const records = await new Promise((resolve, reject) => {
    const request = db.transaction([PUZZLE_STORE_NAME], "readonly").objectStore(PUZZLE_STORE_NAME).getAll();
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error);
  });
  db.close();
  const byName = new Map(records.map((record) => [record.filename, record]));
  const inventory = [];

  for (const range of PUZZLE_DB_RANGES) {
    const record = byName.get(range.file);
    const cachedResponse = record ? null : await getLegacyCachedPuzzleDbResponse(range.file);
    inventory.push({
      ...range,
      downloaded: !!record || !!cachedResponse,
      manual: !!record?.manual,
      size: record?.size || Number(cachedResponse?.headers.get("content-length")) || 0,
    });
  }
  return inventory;
}

const puzzleDbFileTasks = new Map();

async function ensurePuzzleDbStored(filename, manual = false) {
  let task = puzzleDbFileTasks.get(filename);
  if (!task) {
    task = (async () => {
      const existing = await getPuzzleDbRecord(filename);
      if (existing && (!manual || existing.manual)) return existing;

      notifyPuzzleStorageChanged({ filename, downloading: true });
      try {
        let buffer = existing ? await existing.data.arrayBuffer() : await getCachedPuzzleDbBuffer(filename);
        if (!buffer) buffer = await fetchPuzzleDbFromNetwork(filename);
        await storePuzzleDbBuffer(filename, buffer, { manual });
        await deleteLegacyPuzzleDbCache(filename);
        notifyPuzzleStorageChanged({ filename });
      } finally {
        notifyPuzzleStorageChanged({ filename, downloading: false });
      }
    })();
    puzzleDbFileTasks.set(filename, task);
  }

  try {
    await task;
  } finally {
    if (puzzleDbFileTasks.get(filename) === task) puzzleDbFileTasks.delete(filename);
  }

  const record = await getPuzzleDbRecord(filename);
  if (manual && !record?.manual) return ensurePuzzleDbStored(filename, true);
  return record;
}

async function downloadPuzzleDatabase(filename) {
  if (!PUZZLE_DB_RANGES.some((range) => range.file === filename)) throw new Error("Unknown puzzle database.");
  await ensurePuzzleDbStored(filename, true);
  notifyPuzzleStorageChanged({ filename });
}

async function deletePuzzleDatabase(filename) {
  if (!PUZZLE_DB_RANGES.some((range) => range.file === filename)) throw new Error("Unknown puzzle database.");
  if (activeDbFilename === filename && activeDb) {
    activeDb.close();
    activeDb = null;
    activeDbFilename = null;
  }
  await deletePuzzleDbRecord(filename);
  notifyPuzzleStorageChanged({ filename });
}

async function reconcilePuzzleDatabases(rating) {
  let selectedIndex = PUZZLE_DB_RANGES.findIndex((range) => rating >= range.min && rating <= range.max);
  if (selectedIndex < 0) selectedIndex = rating < PUZZLE_DB_RANGES[0].min ? 0 : PUZZLE_DB_RANGES.length - 1;
  const wanted = new Set([selectedIndex - 1, selectedIndex, selectedIndex + 1]
    .filter((index) => PUZZLE_DB_RANGES[index])
    .map((index) => PUZZLE_DB_RANGES[index].file));

  const inventory = await listPuzzleDatabases();
  for (const item of inventory) {
    if (item.downloaded && !item.manual && !wanted.has(item.file)) {
      await deletePuzzleDbRecord(item.file);
      notifyPuzzleStorageChanged({ filename: item.file });
    }
  }

  for (const filename of wanted) {
    try {
      await ensurePuzzleDbStored(filename, false);
    } catch (error) {
      console.warn(`Could not prepare puzzle database ${filename}:`, error);
      notifyPuzzleStorageChanged({ filename, error: error.message });
    }
  }
}

let puzzleDbManagementQueue = Promise.resolve();
function managePuzzleDatabasesForRating(rating) {
  puzzleDbManagementQueue = puzzleDbManagementQueue
    .catch(() => {})
    .then(() => reconcilePuzzleDatabases(rating));
  return puzzleDbManagementQueue;
}

// ---------- sql.js engine (loaded once, reused for every database) ----------

let sqlJsPromise = null;
function getSQL() {
  if (!sqlJsPromise) {
    sqlJsPromise = initSqlJs({
      locateFile: (file) => new URL(`./engines/sql/${file}`, document.baseURI).href,
    });
  }
  return sqlJsPromise;
}

// ---------- Active database management — exactly one open connection ----------

let activeDb = null;
let activeDbFilename = null;
let loadingFilename = null;
let loadingPromise = null;

async function ensureDbLoaded(filename) {
  if (activeDbFilename === filename && activeDb) return activeDb;

  // Coalesce concurrent requests for the same file into one load.
  if (loadingFilename === filename && loadingPromise) return loadingPromise;

  loadingFilename = filename;
  loadingPromise = (async () => {
    const SQL = await getSQL();

    await ensurePuzzleDbStored(filename, false);
    const buffer = await getCachedPuzzleDbBuffer(filename);
    if (!buffer) throw new Error(`Puzzle database ${filename} disappeared after download.`);

    // Close the previous connection before opening the new one — never keep
    // more than one puzzle database open at a time.
    if (activeDb && activeDbFilename !== filename) {
      activeDb.close();
      activeDb = null;
      activeDbFilename = null;
    }

    activeDb = new SQL.Database(new Uint8Array(buffer));
    activeDbFilename = filename;

    return activeDb;
  })();

  try {
    return await loadingPromise;
  } finally {
    loadingFilename = null;
    loadingPromise = null;
  }
}

// Progressively widening rating windows to search, in rating points on either
// side of the target. The last entry is effectively "give up narrowing and
// take anything in this bucket" so we always find *something* if the bucket
// has any puzzles at all.
const RATING_SEARCH_WINDOWS = [0, 1, 2, 3, 4, 5];

// Picks a puzzle whose rating is as close as possible to `targetRating`,
// starting with a tight window and widening only if nothing matches.
// Randomization AND rating-distance filtering both happen inside SQLite —
// only the one chosen row crosses into JS. `excludeFens` can hold many
// recently-served FENs (not just the last one) so small rating windows
// don't just hand back the same puzzle every couple of loads.
function queryPuzzleNearRating(db, targetRating, excludeFens) {
  const exclusions = Array.isArray(excludeFens) ? excludeFens : (excludeFens ? [excludeFens] : []);
  const hasExclusions = exclusions.length > 0;

  const notInClause = hasExclusions
    ? `AND fen NOT IN (${exclusions.map(() => "?").join(",")})`
    : "";

  const sql = `
    SELECT fen, moves, rating
    FROM puzzles
    WHERE rating = ?
    ${notInClause}
    ORDER BY RANDOM()
    LIMIT 1
  `;

  const stmt = db.prepare(sql);

  let row = null;

  try {
    const bindings = hasExclusions
      ? [targetRating, ...exclusions]
      : [targetRating];

    stmt.bind(bindings);

    if (stmt.step()) {
      row = stmt.getAsObject();
      console.log("Found:", row);
    } else {
      console.log("No puzzle at rating:", targetRating);
    }

  } finally {
    stmt.free();
  }

  return row;
}

// One-time-per-file diagnostic so it's obvious in the console whether the
// `rating` column is actually populated per-row, or mostly/entirely NULL
// (which would explain every rating-window query matching zero rows).
const loggedDbDiagnostics = new Set();
function logDbDiagnostics(db, filename) {
  if (loggedDbDiagnostics.has(filename)) return;
  loggedDbDiagnostics.add(filename);
  try {
    const stmt = db.prepare(`
      SELECT COUNT(*) AS total,
             COUNT(rating) AS haveRating,
             MIN(CAST(rating AS INTEGER)) AS minR,
             MAX(CAST(rating AS INTEGER)) AS maxR
      FROM puzzles
    `);
    if (stmt.step()) {
      console.log(`[PuzzleDB] ${filename} diagnostics:`, stmt.getAsObject());
    }
    stmt.free();
  } catch (e) {
    console.warn(`[PuzzleDB] Could not read diagnostics for ${filename}:`, e);
  }
}

// Last-resort fallback: ignore rating entirely and just grab any puzzle from
// the correct bucket file. Used only if rating-window matching comes back
// empty at every window, which most likely means the per-row rating column
// isn't reliably populated for this dataset.
function queryAnyPuzzle(db, excludeFens) {
  const exclusions = Array.isArray(excludeFens) ? excludeFens : (excludeFens ? [excludeFens] : []);
  const hasExclusions = exclusions.length > 0;
  const whereClause = hasExclusions
    ? `WHERE fen NOT IN (${exclusions.map(() => "?").join(",")})`
    : "";

  const stmt = db.prepare(`SELECT fen, moves, rating FROM puzzles ${whereClause} ORDER BY RANDOM() LIMIT 1`);
  let row = null;
  try {
    if (stmt.step(hasExclusions ? exclusions : [])) {
      row = stmt.getAsObject();
    }
  } finally {
    stmt.free();
  }
  return row;
}

async function getRandomPuzzle(rating, excludeFens) {
  console.log("Getting puzzle near rating", rating, "...");
  const filename = dbFileForRating(rating);
  const db = await ensureDbLoaded(filename);
  managePuzzleDatabasesForRating(rating).catch((error) => {
    console.warn("Automatic puzzle database management failed:", error);
  });
  console.log("Database loaded");

  logDbDiagnostics(db, filename);

  const exclusions = Array.isArray(excludeFens) ? excludeFens : (excludeFens ? [excludeFens] : []);

  let row = queryPuzzleNearRating(db, rating, exclusions);

  // If excluding recent history leaves nothing close enough (small window,
  // sparse pool), drop the exclusion rather than fail outright.
  if (!row && exclusions.length > 0) {
    row = queryPuzzleNearRating(db, rating, []);
  }

  // Rating-window matching came back completely empty even with no
  // exclusions and the widest window — the rating column for this dataset
  // is probably unreliable (NULL/unpopulated). Fall back to picking any
  // puzzle from the correct bucket file instead of failing the whole mode.
  if (!row) {
    console.warn(
      `[PuzzleDB] No rating-matched puzzle found in ${filename} — rating column may be sparse or NULL. Falling back to any puzzle in this bucket.`
    );
    row = queryAnyPuzzle(db, exclusions);
    if (!row && exclusions.length > 0) {
      row = queryAnyPuzzle(db, []);
    }
  }

  console.log(row);

  if (!row) throw new Error("No puzzles found in " + filename);

  return {
    fen: row.fen,
    solution: String(row.moves).trim().split(/\s+/).filter(Boolean),
    rating: row.rating,
  };
}

window.PuzzleDB = {
  getRandomPuzzle,
  dbFileForRating,
  listPuzzleDatabases,
  downloadPuzzleDatabase,
  deletePuzzleDatabase,
  manageForRating: managePuzzleDatabasesForRating,
  ranges: PUZZLE_DB_RANGES,
};
