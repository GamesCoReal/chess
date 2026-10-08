let game = new Chess();
let selectedSquare = null;
let premoves = [];
let playerColor = "w";
let maiaThinking = false;
let engine = window.engine;        // Maia
let stockfishEngine = null;       // Stockfish
let boardFlipped = false;
const NORMAL_BOARD_FLIP_KEY = "chess_normal_board_flipped";
let normalBoardFlip = localStorage.getItem(NORMAL_BOARD_FLIP_KEY);
normalBoardFlip = normalBoardFlip === "true" ? true : normalBoardFlip === "false" ? false : null;
let lastMoveFrom = null;
let lastMoveTo = null;
let gameResigned = false;
let resignedBy = null;
let gameTimedOut = false;
let timedOutColor = null;
let historyRecorded = false;
let puzzleDB = null;
let hintStage = 0;
let hintMovesUsed = 0;
let currentHintMoveIndex = 0;
let currentSolution = [];

// ============================================================
// PAST GAME REPLAY
// ============================================================

let replayGame = null;
let replayMoves = [];
let replayOriginalMoves = [];
let replayOriginalMoveFens = [];
let replayOriginalMoveMotifs = [];
let replayOriginalClockHistory = [];
let replayBranchStart = null;
let replayIndex = 0;
let replayAnalysis = [];
let replayAnalyzing = false;
let replayAnalysisRun = 0;
let replayAnalysisPanelEl = null;
let replayStockfishRun = 0;
let replayPlayerColor = "w";
let replayCandidateLines = [];
let replayRankedLines = [];
let replayStockfishBestLine = null;
let replayMotifModulePromise = null;
let replayMoveFens = [];
let replayMoveMotifs = [];
let replayMotifRun = 0;
let replayPositionScores = new Map();
let replayOriginalPositionScores = new Map();
let replayLineVersion = 0;
let replayOriginalPgn = "";

const NEUTRAL_MOTIF_IDS = new Set(["stalemate", "insufficient_material"]);
const NEGATIVE_MOTIF_IDS = new Set([
  "hangs", "loses_castling", "bishop_pair_lost", "bad_bishop", "knight_on_rim",
  "iqp_self", "hanging_pawns_self", "color_complex_self", "doubled_pawns_self",
  "backward_pawn_self", "isolated_pawn", "trades_when_behind",
]);

const MOVE_ICONS = {
  brilliant: "./images/brilliant.png",
  great: "./images/great.png",
  book: "./images/book.png",
  best: "./images/best.png",
  excellent: "./images/excellent.png",
  good: "./images/good.png",
  inaccuracy: "./images/inaccuracy.png",
  mistake: "./images/mistake.png",
  miss: "./images/miss.png",
  blunder: "./images/blunder.png"
};

let MAIA_ELO = localStorage.getItem("chess_my_rating") || "250" // Maia's own play strength — tied to your outcomes

let myRating = parseInt(localStorage.getItem("chess_my_rating") || "250", 10);

function saveMyRating() {
  localStorage.setItem("chess_my_rating", String(myRating));
}

MAIA_ELO = String(myRating); 


// ---------- Small helpers ----------

function clamp(v, lo, hi) {
  return Math.min(hi, Math.max(lo, v));
}

function applyNormalBoardOrientation() {
  boardFlipped = normalBoardFlip ?? playerColor === "b";
  document.getElementById("board-wrap")?.classList.toggle("flipped", boardFlipped);
}


// ---------- Settings ----------

let username = localStorage.getItem("chess_username") || "You";

let soundEnabled = localStorage.getItem("chess_sound_enabled") !== "false"; // default on

let defaultMode = localStorage.getItem("chess_default_mode");
if (defaultMode !== "ranked" && defaultMode !== "puzzles") {
  defaultMode = "ranked";
  localStorage.setItem("chess_default_mode", defaultMode);
}

let currentMode = defaultMode === "puzzles" ? "puzzles" : "rated";

const hadPriorSession = !!localStorage.getItem("chess_active_mode"); // used once at startup below

function updateModeBadge() {
  const el = document.getElementById("mode-badge");
  if (!el) return;

  if (inPuzzleMode) {
    el.textContent = "Puzzle";
  } else if (inDrillMode) {
    el.textContent = "Opening";
  } else {
    el.textContent = currentMode === "rated" ? "Ranked" : "Puzzle";
  }
}


// --- Username ---
function setUsername() {
  document.querySelectorAll(".menu-item.open").forEach((item) => item.classList.remove("open"));
  const input = prompt("Enter your display name:", username);
  if (input && input.trim()) {
    username = input.trim().slice(0, 16);
    localStorage.setItem("chess_username", username);
    updateUsernameDisplay();
  }
}
window.setUsername = setUsername;

function updateUsernameDisplay() {
  const nameEl = document.getElementById("your-name-label");
  if (nameEl) nameEl.textContent = username;
  const btn = document.getElementById("settings-username-btn");
  if (btn) btn.textContent = "Username: " + username;
}


// --- Sound ---
function toggleSound() {
  document.querySelectorAll(".menu-item.open").forEach((item) => item.classList.remove("open"));
  soundEnabled = !soundEnabled;
  localStorage.setItem("chess_sound_enabled", String(soundEnabled));
  updateSoundButtonLabel();
}
window.toggleSound = toggleSound;

function updateSoundButtonLabel() {
  const btn = document.getElementById("settings-sound-btn");
  if (btn) btn.textContent = "Sound: " + (soundEnabled ? "On" : "Off");
}

// Sound files expected in the project root, next to index.html:
// move.mp3, capture.mp3, check.mp3, checkmate.mp3, draw.mp3, lowtime.mp3
const SOUND_FILES = ["move", "capture", "check", "checkmate", "draw", "lowtime"];
const soundCache = {};
for (const name of SOUND_FILES) {
  const audio = new Audio(`./sounds/${name}.mp3`);
  audio.preload = "auto";
  soundCache[name] = audio;
}

function playGameSound(name) {
  if (!soundEnabled) return;
  const base = soundCache[name];
  if (!base) return;
  try {
    const node = base.cloneNode();
    node.play().catch(() => {});
  } catch (e) {
    // Missing/broken file — fail silently rather than breaking the game
  }
}

// Decides which sound a just-made move should play, in priority order.
// checkmate.mp3 covers checkmate AND stalemate (and timeout, handled separately).
function soundForMove(gameObj, moveResult) {
  if (gameObj.in_checkmate() || gameObj.in_stalemate()) return "checkmate";
  if (gameObj.in_draw()) return "draw";
  if (gameObj.in_check()) return "check";
  if (moveResult && moveResult.captured) return "capture";
  return "move";
}


// --- Default game mode ---
const DEFAULT_MODE_ORDER = ["ranked", "puzzles"];
function cycleDefaultMode() {
  document.querySelectorAll(".menu-item.open").forEach((item) => item.classList.remove("open"));
  const idx = DEFAULT_MODE_ORDER.indexOf(defaultMode);
  defaultMode = DEFAULT_MODE_ORDER[(idx + 1) % DEFAULT_MODE_ORDER.length];
  localStorage.setItem("chess_default_mode", defaultMode);
  updateDefaultModeButtonLabel();
}
window.cycleDefaultMode = cycleDefaultMode;

function updateDefaultModeButtonLabel() {
  const btn = document.getElementById("settings-defaultmode-btn");
  if (btn) btn.textContent = "Default: " + defaultMode.charAt(0).toUpperCase() + defaultMode.slice(1);
}

async function openMotifGlossary(motifId = null) {
  document.querySelectorAll(".menu-item.open").forEach((item) => item.classList.remove("open"));
  document.getElementById("motif-glossary-overlay")?.classList.remove("hidden");
  const content = document.getElementById("motif-glossary-content");
  if (!content) return;
  content.textContent = "Loading motifs.md...";
  try {
    const response = await fetch("./motifs.md");
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    renderMotifGlossaryMarkdown(await response.text(), content);
    if (motifId) {
      const targetId = findMotifGlossaryHeading(motifId, content);
      const heading = Array.from(content.querySelectorAll("h1, h2, h3, h4, h5, h6"))
        .find((item) => item.id === targetId);
      heading?.scrollIntoView({ block: "start" });
    }
  } catch (error) {
    content.textContent = `Could not load motifs.md: ${error.message}`;
  }
}
window.openMotifGlossary = openMotifGlossary;

function renderMotifGlossaryMarkdown(markdown, container) {
  const lines = markdown.replace(/\r/g, "").split("\n");
  const headingIds = new Map();
  const isBlockStart = (line) => /^(#{1,6})\s+/.test(line) || /^[-*]\s+/.test(line) || /^---+\s*$/.test(line);
  const appendInline = (parent, text) => {
    const tokens = /(`[^`]+`|\*\*[^*]+\*\*)/g;
    let cursor = 0;
    for (const match of text.matchAll(tokens)) {
      parent.appendChild(document.createTextNode(text.slice(cursor, match.index)));
      const token = match[0];
      const element = document.createElement(token.startsWith("`") ? "code" : "strong");
      element.textContent = token.startsWith("`") ? token.slice(1, -1) : token.slice(2, -2);
      parent.appendChild(element);
      cursor = match.index + token.length;
    }
    parent.appendChild(document.createTextNode(text.slice(cursor)));
  };

  container.replaceChildren();
  for (let index = 0; index < lines.length;) {
    const line = lines[index].trim();
    if (!line) {
      index++;
      continue;
    }

    const heading = line.match(/^(#{1,6})\s+(.+)$/);
    if (heading) {
      const element = document.createElement(`h${heading[1].length}`);
      appendInline(element, heading[2]);
      const slug = heading[2].toLowerCase()
        .replace(/^\d+\.\s*/, "")
        .replace(/`/g, "")
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "") || "section";
      const occurrence = (headingIds.get(slug) || 0) + 1;
      headingIds.set(slug, occurrence);
      element.id = occurrence === 1 ? slug : `${slug}-${occurrence}`;
      container.appendChild(element);
      index++;
      continue;
    }

    if (/^---+\s*$/.test(line)) {
      container.appendChild(document.createElement("hr"));
      index++;
      continue;
    }

    if (/^[-*]\s+/.test(line)) {
      const list = document.createElement("ul");
      while (index < lines.length && /^[-*]\s+/.test(lines[index].trim())) {
        const item = document.createElement("li");
        appendInline(item, lines[index].trim().replace(/^[-*]\s+/, ""));
        list.appendChild(item);
        index++;
      }
      container.appendChild(list);
      continue;
    }

    const paragraph = [];
    while (index < lines.length && lines[index].trim() && !isBlockStart(lines[index].trim())) {
      paragraph.push(lines[index].trim());
      index++;
    }
    const element = document.createElement("p");
    appendInline(element, paragraph.join(" "));
    container.appendChild(element);
  }
}

const MOTIF_GLOSSARY_ALIASES = {
  castles_kingside: ["kingside castling", "castling"],
  castles_queenside: ["queenside castling", "castling"],
  castles: ["castling"],
  connects_rooks: ["connect the rooks"],
  capture: ["capture or trade"],
  queen_trade: ["capture or trade", "simplification", "exchange"],
  piece_trade: ["capture or trade", "exchange"],
  simplifies: ["simplification"],
  trades_when_behind: ["simplification", "exchange"],
  trades_into_endgame: ["simplification", "exchange"],
  exchange_sacrifice: ["sacrifice or hangs", "sacrifice", "exchange"],
  check: ["check class", "check"],
  discovered_check: ["check class", "check"],
  double_check: ["check class", "check"],
  threatens: ["threats and creates", "attack"],
  creates_threat: ["threats and creates"],
  attacks_king: ["attacks king"],
  eyes_king_zone: ["eyes king zone"],
  removes_defender: ["removal of defender"],
  traps_piece: ["traps piece", "trapped piece"],
  sacrifice: ["sacrifice or hangs", "sacrifice"],
  hangs: ["sacrifice or hangs", "hanging piece"],
  defends: ["defends hanging", "pawn structure changes"],
  smothered_hint: ["smothered mate hint", "smothered mate"],
  anastasia_mate_threat: ["anastasia mate threat"],
  bodens_mate_threat: ["bodens mate threat"],
  arabian_mate_threat: ["arabian mate threat"],
  back_rank_mate_threat: ["back rank mate threat"],
  rook_lift: ["rook lift"],
  rook_seventh: ["rook on the seventh rank"],
  knight_invasion: ["piece invasion"],
  rook_play: ["open file rook", "rook activity"],
  bishop_pair_lost: ["bishop pair"],
  iqp_self: ["isolated queen pawn", "pawn structure changes"],
  iqp_them: ["isolated queen pawn", "pawn structure changes"],
  doubled_pawns_them: ["doubled pawns", "pawn structure changes"],
  hanging_pawns_self: ["hanging pawns", "pawn structure changes"],
  backward_pawn_self: ["backward pawn", "pawn structure changes"],
  opens_file_for: ["opens line for"],
  opens_diagonal_for: ["opens line for"],
  prepares_castling_kingside: ["castling"],
  prepares_castling_queenside: ["castling"],
  loses_castling: ["loss of castling rights", "castling"],
  activates: ["piece activity", "development"],
};

function findMotifGlossaryHeading(motifId, container) {
  const normalize = (value) => value.toLowerCase()
    .replace(/^\d+\.\s*/, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  const headings = Array.from(container.querySelectorAll("h1, h2, h3, h4, h5, h6"));
  const normalizedHeadings = headings.map((heading) => normalize(heading.textContent));
  const candidates = [
    motifId.replace(/_/g, " "),
    ...(MOTIF_GLOSSARY_ALIASES[motifId] || []),
  ].map(normalize);
  for (const candidate of candidates) {
    const matches = headings.filter((heading, index) => normalizedHeadings[index] === candidate);
    if (matches.length) return matches[matches.length - 1].id;
  }
  return headings.find((heading) => /^\d+ tactics$/i.test(normalize(heading.textContent)))?.id
    || headings[0]?.id;
}

function closeMotifGlossary(event) {
  const overlay = document.getElementById("motif-glossary-overlay");
  if (!overlay || (event && event.target !== overlay)) return;
  overlay.classList.add("hidden");
}
window.closeMotifGlossary = closeMotifGlossary;


// --- Clear all saved data ---
async function clearAllSavedData() {
  localStorage.clear();
  sessionStorage.clear();

  engine?.worker?.terminate();
  stockfishEngine?.stop?.();

  if ("caches" in window) {
    const cacheNames = await caches.keys();
    await Promise.all(cacheNames
      .filter((name) => name.startsWith("chess-offline-"))
      .map((name) => caches.delete(name)));
  }

  await Promise.all(["PuzzleDatabases", "MaiaModels"].map((name) => new Promise((resolve) => {
    const request = indexedDB.deleteDatabase(name);
    request.onsuccess = resolve;
    request.onerror = resolve;
    request.onblocked = () => resolve();
  })));

  localStorage.clear();
  sessionStorage.clear();
  alert("Saved data and offline downloads cleared. Reloading to download them again...");
  location.reload();
}

window.clearAllSavedData = clearAllSavedData;

const STARTING_CLOCK_SECONDS = 600;

function freshStats() {
  return { brilliant: 0, great: 0, book: 0, best: 0, excellent: 0, good: 0, inaccuracy: 0, mistake: 0, miss: 0, blunder: 0 };
}
let playerMoveStats = freshStats();
let maiaMoveStatsObj = freshStats();
let pendingMaiaGrading = null;

let whiteTime = STARTING_CLOCK_SECONDS;
let blackTime = STARTING_CLOCK_SECONDS;
let moveClockHistory = [];
let replayClockHistory = [];
let whiteClockStarted = false;
let blackClockStarted = false;

function humanDelay() {
  const ms = 600 + Math.random() * 1600;
  return new Promise((resolve) => setTimeout(resolve, ms));
}

let gameToken = 0;

const boardEl = document.getElementById("board");
const statusEl = document.getElementById("status");
const whiteTurnTag = document.getElementById("white-turn-tag");
const blackTurnTag = document.getElementById("black-turn-tag");
const overlayEl = document.getElementById("game-over-overlay");
const overlayTitleEl = document.getElementById("overlay-title");
const overlaySubEl = document.getElementById("overlay-sub");
const yourStatsEl = document.getElementById("your-stats");
const maiaStatsEl = document.getElementById("maia-stats");
const yourAccuracyEl = document.getElementById("your-accuracy");
const maiaAccuracyEl = document.getElementById("maia-accuracy");
const historyEl = document.getElementById("history");
const yourClockEl = document.getElementById("your-clock");
const maiaClockEl = document.getElementById("maia-clock");
const moveListEl = document.getElementById("move-list");
const gameControlsEl = document.getElementById("game-controls");
const puzzleControlsEl = document.getElementById("puzzle-controls");
const offlineStatusEl = document.getElementById("offline-status");

function updateOfflineStatus(status) {
  if (!offlineStatusEl || !status) return;
  if (status.state === "downloading") {
    const currentFile = status.file ? `: ${status.file.split("/").pop()}` : "";
    offlineStatusEl.textContent = `Downloading app files (${status.completed}/${status.total})${currentFile}`;
  } else if (status.state === "ready") {
    offlineStatusEl.textContent = "App files ready for offline use";
  } else if (status.state === "error") {
    offlineStatusEl.textContent = `Offline download failed: ${status.file || status.message || "check connection and reset data"}`;
    console.error("Offline file download failed:", status);
  } else if (status.state === "missing") {
    offlineStatusEl.textContent = "Preparing offline downloads...";
    navigator.serviceWorker.ready.then((registration) => {
      registration.active?.postMessage({ type: "REDOWNLOAD_ALL" });
    }).catch((error) => console.warn("Could not restart offline downloads:", error));
  }
}

if ("serviceWorker" in navigator) {
  offlineStatusEl.textContent = "Preparing offline downloads...";
  navigator.serviceWorker.addEventListener("message", (event) => {
    if (event.data?.type === "OFFLINE_STATUS") updateOfflineStatus(event.data);
  });
  navigator.serviceWorker.ready.then((registration) => {
    registration.active?.postMessage({ type: "GET_OFFLINE_STATUS" });
  }).catch((error) => console.warn("Could not read offline download status:", error));
} else if (offlineStatusEl) {
  offlineStatusEl.textContent = "Offline downloads require a supported browser and HTTPS";
}

let storageManagerOpen = false;
let storageRenderRun = 0;
const storageActions = new Set();
const automaticStorageDownloads = new Set();

function puzzleRangeLabel(range) {
  return Number.isFinite(range.max) ? `${range.min}-${range.max}` : `${range.min}+`;
}

function formatStorageSize(bytes) {
  if (!bytes) return "size unknown";
  return bytes >= 1024 * 1024
    ? `${(bytes / (1024 * 1024)).toFixed(1)} MB`
    : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function getAutomaticPuzzleFiles(rating) {
  const ranges = PuzzleDB.ranges;
  let index = ranges.findIndex((range) => rating >= range.min && rating <= range.max);
  if (index < 0) index = rating < ranges[0].min ? 0 : ranges.length - 1;
  return new Set([index - 1, index, index + 1]
    .filter((rangeIndex) => ranges[rangeIndex])
    .map((rangeIndex) => ranges[rangeIndex].file));
}

async function refreshStorageManager() {
  if (!storageManagerOpen) return;
  const runId = ++storageRenderRun;
  const list = document.getElementById("puzzle-storage-list");
  const usage = document.getElementById("storage-usage");
  list.textContent = "Loading puzzle databases...";

  try {
    const [inventory, estimate] = await Promise.all([
      PuzzleDB.listPuzzleDatabases(),
      navigator.storage?.estimate?.().catch(() => null),
    ]);
    if (runId !== storageRenderRun || !storageManagerOpen) return;

    const automaticFiles = getAutomaticPuzzleFiles(puzzleRating);
    const used = estimate?.usage;
    const quota = estimate?.quota;
    usage.textContent = `Puzzle rating ${puzzleRating} · automatically kept ranges: ${[...automaticFiles].map((file) => {
      const range = inventory.find((item) => item.file === file);
      return range ? puzzleRangeLabel(range) : "";
    }).join(", ")}${typeof used === "number" ? ` · site storage ${formatStorageSize(used)}${typeof quota === "number" ? ` / ${formatStorageSize(quota)}` : ""}` : ""}`;

    list.replaceChildren(...inventory.map((item) => {
      const auto = automaticFiles.has(item.file);
      const busy = storageActions.has(item.file);
      const row = document.createElement("div");
      row.className = "storage-row";

      const main = document.createElement("div");
      main.className = "storage-row-main";
      const name = document.createElement("div");
      name.className = "storage-row-name";
      name.textContent = puzzleRangeLabel(item);
      const state = document.createElement("div");
      state.className = "storage-row-state";
      state.textContent = busy
        ? "Working..."
        : automaticStorageDownloads.has(item.file)
          ? "Downloading automatically..."
        : item.manual
          ? `Saved by you · ${formatStorageSize(item.size)}`
          : item.downloaded
            ? `${auto ? "Automatic" : "Stored"} · ${formatStorageSize(item.size)}`
            : auto
              ? "Automatic range · downloads when Puzzle mode needs it"
              : "Not downloaded";
      main.append(name, state);

      const button = document.createElement("button");
      button.type = "button";
      button.className = "storage-action";
      button.disabled = busy;
      if (item.manual) {
        button.textContent = "Delete";
        button.classList.add("danger");
        button.addEventListener("click", () => runStorageAction(item.file, "delete"));
      } else if (item.downloaded) {
        button.textContent = "Keep";
        button.classList.add("primary");
        button.title = "Keep this database until you delete it";
        button.addEventListener("click", () => runStorageAction(item.file, "keep"));
      } else {
        button.textContent = "Download";
        button.classList.add("primary");
        button.addEventListener("click", () => runStorageAction(item.file, "download"));
      }

      row.append(main, button);
      return row;
    }));
  } catch (error) {
    if (runId !== storageRenderRun) return;
    list.textContent = `Could not read puzzle storage: ${error.message}`;
  }
}

async function runStorageAction(filename, action) {
  const range = PuzzleDB.ranges.find((item) => item.file === filename);
  const label = range ? puzzleRangeLabel(range) : filename;
  const status = document.getElementById("storage-manager-status");
  storageActions.add(filename);
  status.textContent = action === "delete" ? `Deleting ${label}...` : `Downloading ${label}...`;
  refreshStorageManager();

  try {
    if (action === "delete") {
      await PuzzleDB.deletePuzzleDatabase(filename);
      status.textContent = `${label} deleted.`;
    } else {
      await PuzzleDB.downloadPuzzleDatabase(filename);
      status.textContent = `${label} saved by you. It stays until you delete it.`;
    }
  } catch (error) {
    status.textContent = `Could not ${action === "delete" ? "delete" : "download"} ${label}: ${error.message}`;
  } finally {
    storageActions.delete(filename);
    await refreshStorageManager();
  }
}

function openStorageManager() {
  document.querySelectorAll(".menu-item.open").forEach((item) => item.classList.remove("open"));
  storageManagerOpen = true;
  document.getElementById("storage-manager-overlay").classList.remove("hidden");
  document.getElementById("storage-manager-status").textContent = "";
  refreshStorageManager();
}
window.openStorageManager = openStorageManager;

function closeStorageManager(event) {
  const overlay = document.getElementById("storage-manager-overlay");
  if (event && event.target !== overlay) return;
  storageManagerOpen = false;
  overlay.classList.add("hidden");
}
window.closeStorageManager = closeStorageManager;

window.addEventListener("puzzle-storage-changed", (event) => {
  if (event.detail?.downloading) automaticStorageDownloads.add(event.detail.filename);
  else if (event.detail?.downloading === false) automaticStorageDownloads.delete(event.detail.filename);
  if (storageManagerOpen) refreshStorageManager();
});

const files = ["a", "b", "c", "d", "e", "f", "g", "h"];

function squareId(file, rank) {
  return files[file] + rank;
}

function isGameLocked() {
  return game.game_over() || gameResigned || gameTimedOut;
}


// ---------- Puzzle mode ----------

let recentPuzzleFens = [];
const RECENT_PUZZLE_HISTORY = 25;

let inPuzzleMode = false;
let puzzleGame = null;
let puzzleSolution = [];
let puzzleSolutionIndex = 0;
let puzzlePlayerColor = "w";
let puzzleRating = Math.max(399, parseInt(localStorage.getItem("chess_puzzle_rating") || "399", 10)
);
let puzzleAwaitingReply = false;
let puzzleLocked = false;
let puzzleMissedAlready = false;

// Puzzle performance tracking
let puzzleStartTime = 0;
let puzzleHintStage = 0; // 0 = nothing, 1 = show piece, 2 = show destination
let hintSquares = [];
let puzzleWrongAttempts = 0;
let puzzleHintsUsed = 0;
let puzzleRatingAtStart = puzzleRating;
let currentPuzzleEntry = null;
let puzzleInsightRun = 0;
let puzzleMoveAnalysisRun = 0;
let puzzleTargetMoveMotifs = null;
let studyEvaluationRun = 0;
let drillEditingLine = false;
let drillLineSnapshot = null;
function savePuzzleRating() {
  localStorage.setItem("chess_puzzle_rating", String(puzzleRating));
  PuzzleDB.manageForRating(puzzleRating).catch((error) => {
    console.warn("Could not update puzzle database downloads for your rating:", error);
  });
}

function useHint() {

  if (inPuzzleMode) {
    if (puzzleLocked || puzzleAwaitingReply) return;

    const move = puzzleSolution[puzzleSolutionIndex];
    if (!move) return;

    puzzleHintsUsed++;

    const from = move.slice(0,2);
    const to = move.slice(2,4);

    if (puzzleHintStage === 0) {
      hintSquares = [from];
      puzzleHintStage = 1;
    } 
    else if (puzzleHintStage === 1) {
      hintSquares = [from,to];
      puzzleHintStage = 2;
    }

    renderBoard();
    return;
  }


  if (inDrillMode) {
    const move = drillSolution[drillSolutionIndex];
    if (!move || drillLocked || drillAwaitingReply) return;

    hintSquares = [
      move.slice(0,2),
      move.slice(2,4)
    ];

    renderBoard();
  }
}

window.useHint = useHint;

function undoDrillMove() {
  if (!inDrillMode || !drillGame || drillAwaitingReply) return;

  if (drillOutOfLine) {
    if (!drillGame.undo()) return;
    drillOutOfLine = false;
    selectedSquare = null;
    hintSquares = [];
    puzzleHintStage = 0;
    const history = drillGame.history({ verbose: true });
    const lastMove = history[history.length - 1];
    lastMoveFrom = lastMove ? lastMove.from : null;
    lastMoveTo = lastMove ? lastMove.to : null;
    updateStudyProgress();
    updateStudyEvaluation(drillGame, "opening");
    analyzeNextOpeningDrillMove();
    renderBoard();
    renderMoveList();
    statusEl.textContent = openingDrillInstruction();
    return;
  }

  let undone = false;
  while (
    drillGame.history().length > drillStartPly
    && drillSolutionIndex > drillStartSolutionIndex
  ) {
    const move = drillGame.undo();
    if (!move) break;
    drillSolutionIndex--;
    undone = true;
    if (drillGame.turn() === drillPlayerColor) break;
  }

  if (!undone) return;

  drillLocked = false;
  selectedSquare = null;
  hintSquares = [];
  puzzleHintStage = 0;
  const history = drillGame.history({ verbose: true });
  const lastMove = history[history.length - 1];
  lastMoveFrom = lastMove ? lastMove.from : null;
  lastMoveTo = lastMove ? lastMove.to : null;
  updateStudyProgress();
  updateStudyEvaluation(drillGame, "opening");
  analyzeNextOpeningDrillMove();
  renderBoard();
  renderMoveList();
  statusEl.textContent = openingDrillInstruction();
}

window.undoDrillMove = undoDrillMove;


// ---------- Puzzle rating formula ----------
// Rating change = K * (performance - expected), Elo-style, where "performance" (S)
// is built from how fast you solved it, minus penalties for hints and wrong tries.
const PUZZLE_RATING_K = 60;          // max swing on a dead-even, perfect, instant solve
const PUZZLE_BASE_TIME_PER_MOVE = 8; // seconds considered "on pace" per move you have to find
const PUZZLE_TIME_WINDOW = 3;        // how many "baselines" of extra time before time credit hits 0
const PUZZLE_HINT_PENALTY = 0.18;    // performance lost per hint used
const PUZZLE_WRONG_PENALTY = 0.22;   // performance lost per wrong attempt

// Reads the puzzle's own difficulty rating off the UI (set in loadNextPuzzle),
// computes your performance score S in [-1, 1], compares it to the Elo-expected
// score E for facing a puzzle of that difficulty, and returns the rating delta.
function computePuzzleRatingDelta() {
  // solution[0] is the auto-played opponent setup move, not a move you make —
  // only count moves from index 1 onward, and only every other one of those.
  const movesRequired = Math.max(1, Math.ceil((puzzleSolution.length - 1) / 2));
  const expectedTime = movesRequired * PUZZLE_BASE_TIME_PER_MOVE;
  const timeTaken = (performance.now() - puzzleStartTime) / 1000;

  const timeFactor = clamp(
    1 - Math.max(0, timeTaken - expectedTime) / (expectedTime * PUZZLE_TIME_WINDOW),
    0,
    1
  );

  let S = timeFactor - PUZZLE_HINT_PENALTY * puzzleHintsUsed - PUZZLE_WRONG_PENALTY * puzzleWrongAttempts;
  S = clamp(S, -1, 1);

  const puzzleRatingValue = parseInt(document.getElementById("maia-rating").textContent, 10) || puzzleRating;
  const E = 1 / (1 + Math.pow(10, (puzzleRatingValue - puzzleRating) / 399));

  return Math.round(PUZZLE_RATING_K * (S - E));
}

// Hook this up to a hint button whenever you add one. Each call costs performance
// but doesn't reveal anything itself — wire your actual hint UI in here too.
function usePuzzleHint() {
  if (!inPuzzleMode || puzzleLocked || puzzleAwaitingReply) return;
  puzzleHintsUsed++;
}
window.usePuzzleHint = usePuzzleHint;

async function loadNextPuzzle() {
  const puzzle = await PuzzleDB.getRandomPuzzle(
    puzzleRating,
    recentPuzzleFens
  );

  puzzleInsightRun++;
  puzzleTargetMoveMotifs = null;
  currentPuzzleEntry = {
    id: puzzle.id || puzzle.puzzleId || puzzle.fen,
    fen: puzzle.fen,
    solution: puzzle.solution.slice(),
    rating: puzzle.rating,
    themes: Array.isArray(puzzle.themes) ? puzzle.themes.slice() : [],
  };
  recentPuzzleFens.push(puzzle.fen);
  if (recentPuzzleFens.length > RECENT_PUZZLE_HISTORY) recentPuzzleFens.shift();

  puzzleGame = new Chess(puzzle.fen);
  puzzleSolution = puzzle.solution.slice();
  puzzleSolutionIndex = 0;
  lastMoveFrom = null;
  lastMoveTo = null;

  // Standard puzzle-DB convention: the FEN is the position BEFORE the
  // opponent's setup move, and solution[0] is that opponent move — it is
  // NOT something the player needs to find. Auto-play it silently before
  // handing control over, then start scoring attempts from solution[1].
  // Skipping this step is what let a player's move get matched against the
  // opponent's forced move, then get auto-mated by their own real solution
  // while the game still reported "Solved!".
  if (puzzleSolution.length > 0) {
    const setupUci = puzzleSolution[0];
    const sFrom = setupUci.slice(0, 2), sTo = setupUci.slice(2, 4);
    const sPromo = setupUci.length > 4 ? setupUci.slice(4) : "q";
    const setupMove = puzzleGame.move({ from: sFrom, to: sTo, promotion: sPromo });
    if (setupMove) {
      lastMoveFrom = sFrom;
      lastMoveTo = sTo;
      puzzleSolutionIndex = 1;
    }
  }

  puzzlePlayerColor = puzzleGame.turn();
  puzzleRatingAtStart = puzzleRating;
  puzzleAwaitingReply = false;
  puzzleLocked = false;
  puzzleMissedAlready = false;
  puzzleHintsUsed = 0;
  hintSquares = [];
  puzzleStartTime = performance.now();
  puzzleWrongAttempts = 0;
  puzzleHintStage = 0;
  selectedSquare = null;

  boardFlipped = puzzlePlayerColor === "b";
  document.getElementById("board-wrap").classList.toggle("flipped", boardFlipped);

  document.getElementById("your-rating").textContent = puzzleRating;
  document.getElementById("maia-rating").textContent = puzzle.rating;

  clearTurnTags();
  updatePuzzleInsights();
  updateStudyProgress();
  renderBoard();
  renderMoveList();
  updateStudyEvaluation(puzzleGame, "puzzle");
  updatePuzzleActionButton();
  statusEl.textContent = `Puzzle Rating ${puzzleRating} — find the best move for ${puzzlePlayerColor === "w" ? "White" : "Black"}.`;
  statusEl.classList.remove("status-hidden");
  analyzeNextPuzzleMove();
}

function updatePuzzleActionButton() {
  const btn = document.getElementById("puzzle-action-btn");
  if (!btn) return;

  btn.textContent = "Give Up";
}

function updateStudyProgress() {
  const progress = document.getElementById("study-progress");
  const label = document.getElementById("study-progress-label");
  const fill = document.getElementById("study-progress-fill");
  if (!progress || !label || !fill) return;
  if (inDrillMode) {
    const total = drillSolution.length;
    const current = Math.min(drillSolutionIndex, total);
    progress.hidden = false;
    label.textContent = `Opening line: ${current} / ${total} moves`;
    fill.style.width = `${total ? current / total * 100 : 100}%`;
  } else {
    progress.hidden = true;
    label.textContent = "";
    fill.style.width = "0%";
  }
}

function updatePuzzleInsights() {
  const panel = document.getElementById("review-insights-panel");
  if (!panel) return;
  panel.replaceChildren();
  panel.classList.add("hidden");
  panel.classList.remove("puzzle-insights");
  if (!inPuzzleMode) return;

  const copy = document.createElement("div");
  copy.className = "review-insights-copy";
  const pending = currentPuzzleEntry?.solution?.length > 0 && puzzleTargetMoveMotifs === null;
  renderMotifInsightPanel(
    copy,
    puzzleTargetMoveMotifs?.motifs || null,
    pending ? "Analyzing next move..." : "",
    puzzleTargetMoveMotifs?.error ? "Next-move analysis unavailable." : ""
  );
  const side = document.createElement("span");
  side.className = `puzzle-side-indicator ${puzzlePlayerColor === "w" ? "white" : "black"}`;
  side.title = `You are playing ${puzzlePlayerColor === "w" ? "White" : "Black"}`;
  side.setAttribute("aria-label", side.title);
  panel.classList.add("puzzle-insights");
  panel.append(copy, side);
  panel.classList.remove("hidden");
}

async function analyzeNextPuzzleMove() {
  if (!inPuzzleMode || !puzzleGame || puzzleAwaitingReply || puzzleGame.turn() !== puzzlePlayerColor) return;
  const uci = puzzleSolution[puzzleSolutionIndex];
  if (!uci) return;
  const fen = puzzleGame.fen();
  const runId = puzzleInsightRun;
  const analysisRun = ++puzzleMoveAnalysisRun;
  puzzleTargetMoveMotifs = null;
  updatePuzzleInsights();
  if (typeof window.analyzePositionalChessMove !== "function") {
    if (analysisRun !== puzzleMoveAnalysisRun || runId !== puzzleInsightRun) return;
    puzzleTargetMoveMotifs = { error: true };
    updatePuzzleInsights();
    return;
  }
  try {
    const result = await window.analyzePositionalChessMove(fen, uci);
    if (analysisRun !== puzzleMoveAnalysisRun || runId !== puzzleInsightRun || !inPuzzleMode) return;
    puzzleTargetMoveMotifs = result?.error
      ? { error: true }
      : { motifs: result?.motifs || [] };
  } catch (error) {
    if (analysisRun !== puzzleMoveAnalysisRun || runId !== puzzleInsightRun) return;
    console.error("Could not analyze next puzzle move:", error);
    puzzleTargetMoveMotifs = { error: true };
  }
  updatePuzzleInsights();
}

function updateStudyEvaluation(gameObj, mode) {
  const evaluator = window.stockfishEvaluator;
  const scoreLabel = document.getElementById("replay-eval-score");
  if (!gameObj || !scoreLabel || !evaluator) {
    if (scoreLabel && (mode === "puzzle" || mode === "opening")) scoreLabel.textContent = "SF !";
    return;
  }
  const runId = ++studyEvaluationRun;
  const fen = gameObj.fen();
  const turn = gameObj.turn();
  const isCurrent = () => runId === studyEvaluationRun
    && ((mode === "puzzle" && inPuzzleMode && puzzleGame?.fen() === fen)
      || (mode === "opening" && inDrillMode && drillGame?.fen() === fen));
  scoreLabel.textContent = "…";
  renderReplayEvalBar();
  evaluator.evaluateFenMultiPv(fen, {
    depth: 10,
    count: 1,
    onUpdate: (lines) => {
      if (!isCurrent() || !lines?.length) return;
      updateReplayEvalBar(lines[0], turn);
    },
  }).then((lines) => {
    if (!isCurrent() || !lines?.length) return;
    updateReplayEvalBar(lines[0], turn);
  }).catch((error) => {
    if (!isCurrent()) return;
    console.error(`Could not evaluate ${mode} position with Stockfish:`, error);
    scoreLabel.textContent = "SF !";
    scoreLabel.title = error.message;
  });
}

const PUZZLE_HISTORY_KEY = "chess_puzzle_history";

function loadPuzzleHistory() {
  try {
    const value = JSON.parse(localStorage.getItem(PUZZLE_HISTORY_KEY) || "[]");
    return Array.isArray(value) ? value : [];
  } catch (error) {
    console.error("Could not load past puzzles:", error);
    return [];
  }
}

function recordPuzzleHistory(result, ratingDelta) {
  if (!currentPuzzleEntry || !puzzleGame) return;
  const moves = puzzleGame.history();
  const history = loadPuzzleHistory();
  history.unshift({
    puzzleId: currentPuzzleEntry.id,
    fen: currentPuzzleEntry.fen,
    solution: currentPuzzleEntry.solution,
    pgn: puzzleGame.pgn(),
    result,
    rating: currentPuzzleEntry.rating,
    playerRatingBefore: puzzleRatingAtStart,
    playerRatingAfter: puzzleRating,
    ratingDelta,
    themes: currentPuzzleEntry.themes,
    date: Date.now(),
    moveline: moves.join(" ") || "(no moves)",
    totalMoves: moves.length,
    playerColor: puzzlePlayerColor,
  });
  localStorage.setItem(PUZZLE_HISTORY_KEY, JSON.stringify(history.slice(0, 100)));
}

async function handlePuzzleAction() {
  giveUpPuzzle();
}

window.handlePuzzleAction = handlePuzzleAction;

async function autoNextPuzzle() {
  await humanDelay(0o750); // wait 3/4 second
  await loadNextPuzzle();
}

async function enterPuzzleMode() {
  document.querySelectorAll(".menu-item.open").forEach((item) => item.classList.remove("open"));
  if (maiaThinking) return;
  if (document.querySelector(".container").classList.contains("openings-mode")) {
    leaveOpeningsMode(false);
  }
  premoves = [];
  selectedSquare = null;
  if (inDrillMode) {
    inDrillMode = false;
    document.getElementById("drill-controls").classList.add("hidden");
  }

  inPuzzleMode = true;
  document.querySelector(".container")?.classList.add("puzzle-mode");
  updateModeBadge();
  gameControlsEl.classList.add("hidden");
  puzzleControlsEl.classList.remove("hidden");
  console.log("Entered puzzle mode");
  renderHistory();
  await loadNextPuzzle();
  console.log("Finished loadNextPuzzle");
}
window.enterPuzzleMode = enterPuzzleMode;

function exitPuzzleMode(resumeGame = true) {
  inPuzzleMode = false;
  puzzleInsightRun++;
  puzzleMoveAnalysisRun++;
  studyEvaluationRun++;
  document.querySelector(".container")?.classList.remove("puzzle-mode");
  document.getElementById("review-insights-panel")?.classList.add("hidden");
  updateStudyProgress();
  hintSquares = [];
  puzzleHintStage = 0;
  updateModeBadge();
  puzzleControlsEl.classList.add("hidden");
  gameControlsEl.classList.remove("hidden");
  selectedSquare = null;
  applyNormalBoardOrientation();

  document.getElementById("your-rating").textContent = myRating;
  document.getElementById("maia-rating").textContent = MAIA_ELO;
  restoreLastMoveFromRealGame();

  renderBoard();
  renderMoveList();
  updateClockDisplays();
  renderHistory();
  if (isGameLocked()) {
    // popup will show if they reopen it; just leave board as-is
  } else {
    updateStatusForTurn();
    if (resumeGame && game.turn() !== playerColor) runMaiaTurn();
  }
}

function restoreLastMoveFromRealGame() {
  const verboseHistory = game.history({ verbose: true });
  if (verboseHistory.length > 0) {
    const last = verboseHistory[verboseHistory.length - 1];
    lastMoveFrom = last.from;
    lastMoveTo = last.to;
  } else {
    lastMoveFrom = null;
    lastMoveTo = null;
  }
}

function giveUpPuzzle() {
  if (!inPuzzleMode || puzzleLocked) return;
  puzzleLocked = true;
  hintSquares = [];
  puzzleHintStage = 0;

  // Giving up scores like a worst-case attempt (S = -1) against this puzzle's Elo.
  const puzzleRatingValue = parseInt(document.getElementById("maia-rating").textContent, 10) || puzzleRating;
  const E = 1 / (1 + Math.pow(10, (puzzleRatingValue - puzzleRating) / 399));
  const requestedDelta = Math.round(PUZZLE_RATING_K * (-1 - E));
  puzzleRating = clamp(puzzleRating + requestedDelta, 399, 3000);
  const delta = requestedDelta;
  savePuzzleRating();
  document.getElementById("your-rating").textContent = puzzleRating;

  const sanParts = [];
  for (let i = puzzleSolutionIndex; i < puzzleSolution.length; i++) {
    const uci = puzzleSolution[i];
    const from = uci.slice(0, 2), to = uci.slice(2, 4);
    const promotion = uci.length > 4 ? uci.slice(4) : "q";
    const mv = puzzleGame.move({ from, to, promotion });
    if (mv) {
      sanParts.push(mv.san);
      lastMoveFrom = from;
      lastMoveTo = to;
      playGameSound(soundForMove(puzzleGame, mv));
    }
  }
  recordPuzzleHistory("gave-up", delta);
  updatePuzzleInsights();
  updateStudyProgress();
  renderBoard();
  renderMoveList();
  updateStudyEvaluation(puzzleGame, "puzzle");
  updatePuzzleActionButton();
  renderHistory();
  statusEl.textContent = `Solution: ${sanParts.join(" ")}  (${delta >= 0 ? "+" : ""}${delta} → Puzzle Rating ${puzzleRating})`;
  statusEl.classList.remove("status-hidden");
}
window.giveUpPuzzle = giveUpPuzzle;

async function onPuzzleSquareClick(sq) {
  if (puzzleLocked || puzzleAwaitingReply) return;
  if (puzzleGame.turn() !== puzzlePlayerColor) return;

  if (selectedSquare === null) {
    const piece = puzzleGame.get(sq);
    if (piece && piece.color === puzzlePlayerColor) {
      selectedSquare = sq;
      renderBoard();
    }
    return;
  }
  if (sq === selectedSquare) {
    selectedSquare = null;
    renderBoard();
    return;
  }

  const from = selectedSquare;
  const to = sq;
  selectedSquare = null;

  const preFen = puzzleGame.fen();
  const moveResult = puzzleGame.move({ from, to, promotion: "q" });

  if (!moveResult) {
    const piece = puzzleGame.get(sq);
    if (piece && piece.color === puzzlePlayerColor) selectedSquare = sq;
    renderBoard();
    return;
  }

  const promotion = moveResult.promotion ? moveResult.promotion : "";
  const playedUci = from + to + promotion;
  const expectedUci = puzzleSolution[puzzleSolutionIndex];

  if (playedUci !== expectedUci) {
    // Rating is no longer docked immediately — every wrong try just feeds the
    // performance formula, which gets settled once when the puzzle ends
    // (solved or given up).
    puzzleWrongAttempts++;
    puzzleMissedAlready = true;
    puzzleGame.load(preFen);
    renderBoard();
    statusEl.textContent = `Not quite — try again, or Give Up to see the answer.`;
    return;
  }

  lastMoveFrom = from;
  lastMoveTo = to;
  playGameSound(soundForMove(puzzleGame, moveResult));
  renderBoard();
  renderMoveList();
  puzzleSolutionIndex++;
  updatePuzzleInsights();
  updateStudyEvaluation(puzzleGame, "puzzle");

  if (puzzleSolutionIndex >= puzzleSolution.length) {
    puzzleLocked = true;
    const delta = computePuzzleRatingDelta();
    puzzleRating = clamp(puzzleRating + delta, 399, 3000);
    savePuzzleRating();
    document.getElementById("your-rating").textContent = puzzleRating;
    statusEl.textContent = `Solved! ${delta >= 0 ? "+" : ""}${delta} → Puzzle Rating ${puzzleRating}`;
    recordPuzzleHistory("solved", delta);
    renderHistory();
    
    autoNextPuzzle();
    return;
  }

  puzzleAwaitingReply = true;
  await humanDelay();
  const replyUci = puzzleSolution[puzzleSolutionIndex];
  const rFrom = replyUci.slice(0, 2), rTo = replyUci.slice(2, 4);
  const rPromo = replyUci.length > 4 ? replyUci.slice(4) : "q";
  const replyResult = puzzleGame.move({ from: rFrom, to: rTo, promotion: rPromo });
  lastMoveFrom = rFrom;
  lastMoveTo = rTo;
  playGameSound(soundForMove(puzzleGame, replyResult));
  puzzleSolutionIndex++;
  updatePuzzleInsights();
  renderBoard();
  renderMoveList();
  updateStudyEvaluation(puzzleGame, "puzzle");
  puzzleAwaitingReply = false;

  if (puzzleSolutionIndex >= puzzleSolution.length) {
    puzzleLocked = true;
    const delta = computePuzzleRatingDelta();
    puzzleRating = clamp(puzzleRating + delta, 399, 3000);
    savePuzzleRating();
    document.getElementById("your-rating").textContent = puzzleRating;
    statusEl.textContent = `Solved! ${delta >= 0 ? "+" : ""}${delta} → Puzzle Rating ${puzzleRating}`;
    recordPuzzleHistory("solved", delta);
    renderHistory();
    autoNextPuzzle();
  } else {
    statusEl.textContent = `Puzzle Rating ${puzzleRating} — find the best move.`;
    analyzeNextPuzzleMove();
  }
}

// ---------- Opening line browser and drills ----------

// Load the complete opening catalog from all five alphabetic TSV files.
let OPENINGS_DATA = [];
let openingCatalog = [];
let openingBookPrefixes = new Set();
let openingLinesBySignature = new Map();
const OPENING_TSV_FILES = ["a", "b", "c", "d", "e"].map(
  (letter) => `./data/openings_${letter}.tsv`
);
let openingDataLoadComplete = false;
const openingLoadErrors = [];

async function loadOpeningsData() {
  const fileEntries = await Promise.all(OPENING_TSV_FILES.map(async (file) => {
    try {
      const res = await fetch(file);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return parseOpeningTsv(await res.text());
    } catch (err) {
      openingLoadErrors.push(`${file}: ${err.message}`);
      console.error(`Failed to load ${file}:`, err);
      return [];
    }
  }));
  OPENINGS_DATA = buildOpeningTree(fileEntries.flat());
  rebuildOpeningCatalogIndex();
  openingDataLoadComplete = true;
  if (inDrillMode) {
    updateDrillOpeningIndicators();
  } else if (inReplayMode && replayGame) {
    updateLiveOpeningIndicators(replayGame, replayPlayerColor);
    replayAnalysis.forEach((_, index) => refreshReplayMoveRating(index));
    renderMoveList();
  } else {
    updateLiveOpeningIndicators(game);
  }
  recordCompletedOpeningAchievements(game);
  updateOpeningAchievementButton();
  if (!document.getElementById("opening-achievements-overlay")?.classList.contains("hidden")) {
    renderOpeningAchievements();
  }
  if (!document.getElementById("drill-picker-overlay").classList.contains("hidden")) {
    renderOpeningCatalog();
  }
}

function getOpeningMoveSignature(moves) {
  return moves.join(" ");
}

function openingAchievementId(variation) {
  return JSON.stringify([
    variation.eco || "",
    variation.fullName || variation.name,
    (variation.solution || []).join(" "),
  ]);
}

function rebuildOpeningCatalogIndex() {
  openingCatalog = OPENINGS_DATA.flatMap((root) => root.allVariations || [])
    .slice()
    .sort((a, b) => compareOpeningNames(a.fullName, b.fullName));
  openingBookPrefixes = new Set();
  openingLinesBySignature = new Map();
  for (const variation of openingCatalog) {
    const solution = variation.solution || [];
    for (let length = 1; length <= solution.length; length++) {
      const signature = getOpeningMoveSignature(solution.slice(0, length));
      openingBookPrefixes.add(signature);
    }
    const signature = getOpeningMoveSignature(solution);
    if (!openingLinesBySignature.has(signature)) openingLinesBySignature.set(signature, []);
    openingLinesBySignature.get(signature).push(variation);
  }
}

function getLiveGameUciHistory(gameObj) {
  if (!gameObj || typeof gameObj.history !== "function") return [];
  return gameObj.history({ verbose: true }).map(
    (move) => move.from + move.to + (move.promotion || "")
  );
}

function isOpeningBookMove(gameObj) {
  const moves = getLiveGameUciHistory(gameObj);
  return isOpeningBookSequence(moves);
}

function isOpeningBookSequence(moves) {
  return moves.length > 0 && openingBookPrefixes.has(getOpeningMoveSignature(moves));
}

function updateLiveOpeningIndicators(gameObj, humanColor = playerColor) {
  const playerOpeningEl = document.getElementById("your-opening-name");
  const maiaOpeningEl = document.getElementById("maia-opening-name");
  if (!playerOpeningEl || !maiaOpeningEl) return;

  const moves = getLiveGameUciHistory(gameObj);
  const history = gameObj?.history?.({ verbose: true }) || [];
  const hasContinuation = moves.length > 0 && openingCatalog.some((variation) => {
    const solution = variation.solution || [];
    return solution.length > moves.length
      && moves.every((move, index) => solution[index] === move);
  });
  const lineIsActive = hasContinuation
    && openingBookPrefixes.has(getOpeningMoveSignature(moves));
  const whiteHasMoved = history.some((move) => move.color === "w");
  const blackHasMoved = history.some((move) => move.color === "b");
  const openingNameForColor = (color) => {
    if (!lineIsActive) return "";
    for (let length = moves.length; length > 0; length--) {
      if (history[length - 1]?.color !== color) continue;
      const matches = openingLinesBySignature.get(
        getOpeningMoveSignature(moves.slice(0, length))
      );
      if (matches?.length) return matches[0].fullName;
    }
    const possible = openingCatalog
      .filter((variation) => {
        const solution = variation.solution || [];
        return solution.length >= moves.length
          && moves.every((move, index) => solution[index] === move);
      })
      .sort((a, b) =>
        (a.solution.length - b.solution.length)
        || compareOpeningVariationsByPlayerCount(a, b)
      );
    return possible[0]?.fullName || "";
  };
  const setOpeningLabel = (element, name, hasMoved) => {
    element.textContent = hasMoved ? name : "";
    element.title = hasMoved ? name : "";
    element.hidden = !hasMoved || !name;
  };
  setOpeningLabel(
    playerOpeningEl,
    openingNameForColor(humanColor),
    humanColor === "w" ? whiteHasMoved : blackHasMoved
  );
  setOpeningLabel(
    maiaOpeningEl,
    openingNameForColor(humanColor === "w" ? "b" : "w"),
    humanColor === "w" ? blackHasMoved : whiteHasMoved
  );
}

function updateDrillOpeningIndicators() {
  const playerOpeningEl = document.getElementById("your-opening-name");
  const maiaOpeningEl = document.getElementById("maia-opening-name");
  if (!playerOpeningEl || !maiaOpeningEl) return;
  const name = currentDrill?.fullName || currentDrill?.name || "";
  playerOpeningEl.textContent = name;
  playerOpeningEl.title = name;
  playerOpeningEl.hidden = !name;
  maiaOpeningEl.textContent = "";
  maiaOpeningEl.title = "";
  maiaOpeningEl.hidden = true;
}

const OPENING_ACHIEVEMENTS_KEY = "chess_opening_achievements_v1";
let openingAchievements = loadOpeningAchievements();
let openingAchievementSearch = "";
const openingPositionCache = new Map();
const openingPieceImageCache = new Map();

function loadOpeningAchievements() {
  try {
    const saved = JSON.parse(localStorage.getItem(OPENING_ACHIEVEMENTS_KEY) || "[]");
    return new Set(Array.isArray(saved) ? saved.filter((id) => typeof id === "string") : []);
  } catch (error) {
    console.error("Could not load achievements:", error);
    return new Set();
  }
}

function saveOpeningAchievements() {
  try {
    localStorage.setItem(OPENING_ACHIEVEMENTS_KEY, JSON.stringify([...openingAchievements]));
  } catch (error) {
    console.error("Could not save achievements:", error);
  }
}

function recordCompletedOpeningAchievements(gameObj) {
  const moves = getLiveGameUciHistory(gameObj);
  const completed = openingLinesBySignature.get(getOpeningMoveSignature(moves)) || [];
  const newlyUnlocked = [];
  for (const variation of completed) {
    const id = openingAchievementId(variation);
    if (openingAchievements.has(id)) continue;
    openingAchievements.add(id);
    newlyUnlocked.push(variation);
  }
  if (newlyUnlocked.length) {
    saveOpeningAchievements();
    updateOpeningAchievementButton();
    showOpeningAchievementToast(newlyUnlocked);
    if (!document.getElementById("opening-achievements-overlay")?.classList.contains("hidden")) {
      renderOpeningAchievements();
    }
  }
}

let openingAchievementToastTimer = null;

function showOpeningAchievementToast(variations) {
  const toast = document.getElementById("opening-achievement-toast");
  if (!toast) return;
  const names = variations.map((variation) => variation.fullName);
  toast.textContent = `Achievement unlocked: ${names.join(", ")}`;
  toast.classList.remove("hidden");
  clearTimeout(openingAchievementToastTimer);
  openingAchievementToastTimer = setTimeout(() => {
    toast.classList.add("hidden");
  }, 4500);
}

function updateOpeningAchievementButton() {
  const button = document.getElementById("settings-opening-achievements-btn");
  if (button) {
    button.textContent = `Achievements (${openingAchievements.size}/${openingCatalog.length})`;
  }
}

function openOpeningAchievements() {
  document.querySelectorAll(".menu-item.open").forEach((item) => item.classList.remove("open"));
  const overlay = document.getElementById("opening-achievements-overlay");
  if (!overlay) return;
  overlay.classList.remove("hidden");
  openingAchievementSearch = "";
  const search = document.getElementById("opening-achievements-search");
  if (search) search.value = "";
  renderOpeningAchievements();
}
window.openOpeningAchievements = openOpeningAchievements;

function searchOpeningAchievements(value) {
  openingAchievementSearch = value;
  renderOpeningAchievements();
}
window.searchOpeningAchievements = searchOpeningAchievements;

function closeOpeningAchievements(event) {
  if (event && event.target !== event.currentTarget) return;
  document.getElementById("opening-achievements-overlay")?.classList.add("hidden");
}
window.closeOpeningAchievements = closeOpeningAchievements;

function renderOpeningAchievements() {
  const list = document.getElementById("opening-achievements-list");
  const progress = document.getElementById("opening-achievements-progress");
  if (!list || !progress) return;
  const query = openingAchievementSearch.trim().toLocaleLowerCase();
  const filtered = openingCatalog
    .filter((variation) =>
      !query || `${variation.fullName} ${variation.eco}`.toLocaleLowerCase().includes(query)
    )
    .sort((a, b) =>
      Number(openingAchievements.has(openingAchievementId(b)))
      - Number(openingAchievements.has(openingAchievementId(a)))
      || compareOpeningNames(a.fullName, b.fullName)
    );
  progress.textContent = `${openingAchievements.size} / ${openingCatalog.length} achievements unlocked`;
  list.replaceChildren();

  for (const variation of filtered) {
    const unlocked = openingAchievements.has(openingAchievementId(variation));
    const card = document.createElement("article");
    card.className = `opening-achievement-card${unlocked ? " unlocked" : " locked"}`;
    const icon = unlocked ? document.createElement("canvas") : document.createElement("span");
    icon.className = "opening-achievement-icon";
    if (unlocked) {
      icon.width = 64;
      icon.height = 64;
      icon.setAttribute("aria-label", `Board position for ${variation.fullName}`);
      drawOpeningAchievementPosition(icon, variation);
    } else {
      icon.textContent = "?";
      icon.setAttribute("aria-label", `Locked opening achievement: ${variation.fullName}`);
    }
    const description = document.createElement("div");
    description.className = "opening-achievement-description";
    const name = document.createElement("strong");
    name.textContent = variation.fullName;
    const eco = document.createElement("span");
    eco.textContent = variation.eco;
    description.append(name, eco);
    card.append(icon, description);
    list.appendChild(card);
  }

  if (!openingCatalog.length && !openingDataLoadComplete) {
    const loading = document.createElement("div");
    loading.className = "opening-achievements-empty";
    loading.textContent = "Loading opening achievements…";
    list.appendChild(loading);
  } else if (filtered.length === 0) {
    const empty = document.createElement("div");
    empty.className = "opening-achievements-empty";
    empty.textContent = "No openings match your search.";
    list.appendChild(empty);
  }

}

function drawOpeningAchievementPosition(canvas, variation) {
  const id = openingAchievementId(variation);
  let board = openingPositionCache.get(id);
  if (!board) {
    const position = new Chess();
    try {
      for (const uci of variation.solution || []) {
        const result = position.move({
          from: uci.slice(0, 2),
          to: uci.slice(2, 4),
          promotion: uci[4] || "q",
        });
        if (!result) throw new Error(`Illegal opening move: ${uci}`);
      }
    } catch (error) {
      console.error(`Could not build achievement board for ${variation.fullName}:`, error);
      return;
    }
    board = position.board();
    openingPositionCache.set(id, board);
  }

  const context = canvas.getContext("2d");
  if (!context) return;
  const size = canvas.width;
  const squareSize = size / 8;
  context.clearRect(0, 0, size, size);
  board.forEach((rank, row) => rank.forEach((piece, column) => {
    context.fillStyle = (row + column) % 2 === 0 ? "#f0d9b5" : "#b58863";
    context.fillRect(column * squareSize, row * squareSize, squareSize, squareSize);
    if (!piece) return;
    const key = `${piece.type}${piece.color}`;
    if (!openingPieceImageCache.has(key)) {
      const image = new Image();
      openingPieceImageCache.set(key, image);
      image.onload = () => drawOpeningAchievementPosition(canvas, variation);
      image.onerror = () => console.error(`Could not load opening achievement piece image: ${image.src}`);
      image.src = pieceImage(piece);
    }
    const image = openingPieceImageCache.get(key);
    if (image.complete && image.naturalWidth) {
      context.drawImage(
        image,
        column * squareSize,
        row * squareSize,
        squareSize,
        squareSize
      );
    }
  }));
}

function parseOpeningTsv(text) {
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/).filter((line) => line.length);
  const header = (lines.shift() || "").split("\t").map((column) => column.trim().toLowerCase());
  if (header[0] !== "eco" || header[1] !== "name" || header[2] !== "pgn") {
    throw new Error("Expected TSV columns eco, name, and pgn.");
  }
  const columnIndex = (name) => header.indexOf(name);

  return lines.map((line, index) => {
    const columns = line.split("\t");
    const [eco, name, pgn] = columns;
    if (!eco || !name || !pgn) {
      throw new Error(`Invalid row ${index + 2}: ECO, name, and PGN are required.`);
    }
    const solution = openingSearchToUci(pgn);
    if (!solution?.length) {
      throw new Error(`Could not parse the move line on row ${index + 2} (${name}).`);
    }
    const value = (column) => {
      const index = columnIndex(column);
      return index < 0 ? "" : columns[index] || "";
    };
    return {
      eco,
      fullName: name,
      playercount: value("playercount"),
      win: value("win"),
      draw: value("draw"),
      loss: value("loss"),
      solution,
    };
  });
}

function compareOpeningNames(a, b) {
  return a.localeCompare(b, undefined, { sensitivity: "base", numeric: true });
}

function buildOpeningTree(entries) {
  const rootMap = new Map();
  const entriesByRoot = new Map();
  for (const entry of entries) {
    const colon = entry.fullName.indexOf(":");
    const rootName = colon < 0 ? entry.fullName : entry.fullName.slice(0, colon).trim();
    const suffix = colon < 0 ? "" : entry.fullName.slice(colon + 1).trim();
    const parts = suffix ? suffix.split(",").map((part) => part.trim()).filter(Boolean) : [];
    if (!entriesByRoot.has(rootName)) entriesByRoot.set(rootName, []);
    entriesByRoot.get(rootName).push({ entry, rootName, parts });
  }

  for (const [rootName, rootEntries] of entriesByRoot) {
    const root = {
      name: rootName,
      rootName,
      parent: null,
      children: [],
      variations: [],
    };
    rootMap.set(rootName, root);
    const rootsByLowerName = new Map();
    for (const { parts } of rootEntries) {
      if (parts.length) rootsByLowerName.set(parts[0].toLocaleLowerCase(), parts[0]);
    }

    const nodeMaps = new Map();
    for (const { entry, parts } of rootEntries) {
      let parent = root;
      const expandedParts = [];
      for (const part of parts) {
        // Some labels extend an existing branch without a comma, such as "Budapest Gambit Accepted".
        const ancestors = [...rootsByLowerName.values()]
          .filter((candidate) =>
            candidate.length < part.length
            && part.toLocaleLowerCase().startsWith(`${candidate.toLocaleLowerCase()} `)
          )
          .sort((a, b) => a.length - b.length);
        expandedParts.push(...ancestors, part);
      }

      const path = [];
      for (const part of expandedParts) {
        if (path[path.length - 1] === part) continue;
        path.push(part);
        const pathKey = path.map((segment) => segment.toLocaleLowerCase()).join("\u0000");
        if (!nodeMaps.has(pathKey)) {
          const node = {
            name: part,
            rootName,
            parent,
            children: [],
            variations: [],
          };
          parent.children.push(node);
          nodeMaps.set(pathKey, node);
        }
        parent = nodeMaps.get(pathKey);
      }
      parent.variations.push({
        eco: entry.eco,
        name: entry.fullName === rootName ? rootName : entry.fullName.slice(rootName.length + 2),
        fullName: entry.fullName,
        playercount: entry.playercount,
        win: entry.win,
        draw: entry.draw,
        loss: entry.loss,
        solution: entry.solution,
      });
    }
  }

  const compareOpeningBranchesByPlayerCount = (a, b) =>
    (b.playercount || 0) - (a.playercount || 0)
    || compareOpeningNames(a.name, b.name);
  const finalize = (node) => {
    node.variations.sort(compareOpeningVariationsByPlayerCount);
    node.allVariations = [...node.variations];
    let descendantPlayerCount = 0;
    for (const child of node.children) {
      finalize(child);
      node.allVariations.push(...child.allVariations);
      descendantPlayerCount = Math.max(descendantPlayerCount, child.playercount || 0);
    }
    const directPlayerCount = node.variations.reduce(
      (count, variation) => Math.max(count, Number(variation.playercount) || 0),
      0
    );
    node.playercount = directPlayerCount || descendantPlayerCount;
    node.children.sort(compareOpeningBranchesByPlayerCount);
    return node;
  };
  return [...rootMap.values()]
    .map(finalize)
    .sort(compareOpeningBranchesByPlayerCount);
}

let inDrillMode = false;
let drillGame = null;
let drillSolution = [];
let drillSolutionIndex = 0;
let drillPlayerColor = "w";
let drillLocked = false;
let drillAwaitingReply = false;
let drillOutOfLine = false;
let drillMistakesThisAttempt = false;
let currentDrill = null;
let openingDrillPlayerColor = "w";
let selectedOpeningFamily = null;
let openingRenderGeneration = 0;
let openingDrillStageMarkers = [];
let openingDrillPageActive = false;
let drillStartPly = 0;
let drillStartSolutionIndex = 0;
let openingDrillInsightsMarker = null;
let openingDrillProgressMarker = null;
let openingDrillInsightsWasHidden = true;
let openingDrillAnalysisRun = 0;
let openingDrillDisplayedMoveIndex = null;
let openingDrillMoveMotifs = new Map();
const OPENING_PROGRESS_KEY = "chess_opening_variant_progress";

function loadOpeningProgress() {
  try {
    const stored = localStorage.getItem(OPENING_PROGRESS_KEY);
    if (!stored) return {};
    const progress = JSON.parse(stored);
    if (!progress || typeof progress !== "object" || Array.isArray(progress)) {
      throw new Error("Opening progress data must be an object.");
    }
    return progress;
  } catch (error) {
    console.error("Could not load opening progress:", error);
    return {};
  }
}

let openingProgress = loadOpeningProgress();

function openingVariationProgressKey(family, variation) {
  return JSON.stringify([
    family.rootName || family.name,
    variation.eco || "",
    variation.fullName || variation.name,
    "w",
    (variation.solution || []).join(","),
  ]);
}

function getOpeningProgressStatus(progressKey) {
  const progress = openingProgress[progressKey];
  if (progress?.mastered) return "mastered";
  if (progress?.hasMistake) return "mistake";
  return "incomplete";
}

function saveOpeningProgress() {
  try {
    localStorage.setItem(OPENING_PROGRESS_KEY, JSON.stringify(openingProgress));
  } catch (error) {
    console.error("Could not save opening progress:", error);
  }
}

function recordOpeningProgress(progressKey, result) {
  if (!progressKey) return;
  const previous = openingProgress[progressKey] || {};
  openingProgress[progressKey] = {
    mastered: previous.mastered === true || result === "mastered",
    hasMistake: previous.hasMistake === true || result === "mistake",
  };
  saveOpeningProgress();
}

function getFamilyMastery(family) {
  const variations = family.allVariations || family.variations || [];
  const mastered = variations.filter(
    (variation) => getOpeningProgressStatus(openingVariationProgressKey(family, variation)) === "mastered"
  ).length;
  return { mastered, total: variations.length };
}

function compareOpeningVariationsByPlayerCount(a, b) {
  const countDifference = (Number(b.playercount) || 0) - (Number(a.playercount) || 0);
  return countDifference || a.name.localeCompare(b.name, undefined, { sensitivity: "base", numeric: true });
}

function getOpeningResultRates(variation) {
  if (variation.win === "" || variation.draw === "") return null;
  const win = Number(variation.win);
  const draw = Number(variation.draw);
  if (!Number.isFinite(win) || !Number.isFinite(draw)) return null;
  const loss = variation.loss !== "" && Number.isFinite(Number(variation.loss))
    ? Number(variation.loss)
    : 100 - win - draw;
  return { win, draw, loss };
}

function getFamilyAverageResultRates(family) {
  const rates = (family.allVariations || family.variations || [])
    .map(getOpeningResultRates)
    .filter(Boolean);
  if (!rates.length) return null;
  const totals = rates.reduce((average, result) => ({
    win: average.win + result.win,
    draw: average.draw + result.draw,
    loss: average.loss + result.loss,
  }), { win: 0, draw: 0, loss: 0 });
  return {
    win: totals.win / rates.length,
    draw: totals.draw / rates.length,
    loss: totals.loss / rates.length,
  };
}

function createOpeningRatesElement(rates, prefix = "") {
  const element = document.createElement("div");
  element.className = "opening-result-bar";
  element.setAttribute("role", "img");
  if (!rates) {
    element.setAttribute("aria-label", `${prefix}Win, draw, and loss rates unavailable`);
    return element;
  }

  const results = [
    { name: "Win", value: Math.max(0, rates.win), className: "opening-result-win" },
    { name: "Draw", value: Math.max(0, rates.draw), className: "opening-result-draw" },
    { name: "Loss", value: Math.max(0, rates.loss), className: "opening-result-loss" },
  ];
  const total = results.reduce((sum, result) => sum + result.value, 0);
  element.setAttribute(
    "aria-label",
    `${prefix}${results.map(({ name, value }) => `${name} ${value.toFixed(2)}%`).join(", ")}`
  );
  element.title = element.getAttribute("aria-label");
  for (const result of results) {
    const segment = document.createElement("span");
    segment.className = result.className;
    segment.style.width = `${total ? result.value / total * 100 : 100 / results.length}%`;
    element.appendChild(segment);
  }
  return element;
}

function openDrillPicker() {
  document.querySelectorAll(".menu-item.open").forEach((item) => item.classList.remove("open"));
  if (openingDrillPageActive) exitDrillMode();
  if (inPuzzleMode) exitPuzzleMode(false);
  if (inReplayMode) exitReplay(false);
  document.querySelector(".container").classList.add("openings-mode");
  openingDrillPlayerColor = "w";
  boardFlipped = false;
  document.getElementById("board-wrap").classList.remove("flipped");
  const picker = document.getElementById("drill-picker-overlay");
  picker.classList.remove("hidden");
  picker.classList.remove("drill-active");
  selectedOpeningFamily = null;
  document.getElementById("variation-screen").classList.remove("active");
  document.getElementById("variation-screen").classList.remove("hidden");
  document.getElementById("openings-screen").classList.remove("hidden");
  document.getElementById("openings-screen").style.display = "block";
  document.getElementById("opening-drill-screen").style.display = "none";
  renderOpeningCatalog();
}
window.openDrillPicker = openDrillPicker;

function leaveOpeningsMode(resumeGame = true) {
  if (openingDrillPageActive) exitDrillMode();
  document.getElementById("drill-picker-overlay").classList.add("hidden");
  document.querySelector(".container").classList.remove("openings-mode");
  if (resumeGame && !inPuzzleMode && !isGameLocked() && game.turn() !== playerColor) runMaiaTurn();
}
window.leaveOpeningsMode = leaveOpeningsMode;

function moveGameStageIntoOpeningPage() {
  const stage = document.getElementById("opening-game-stage");
  const elements = [
    statusEl,
    document.getElementById("board-wrap"),
    document.querySelector(".moves"),
    gameControlsEl,
    puzzleControlsEl,
    document.getElementById("drill-controls"),
  ];

  openingDrillStageMarkers = elements.filter(Boolean).map((element) => {
    const marker = document.createComment(`original location for ${element.id || element.className}`);
    element.parentNode.insertBefore(marker, element);
    stage.appendChild(element);
    return { element, marker };
  });
  const insightsPanel = document.getElementById("review-insights-panel");
  openingDrillInsightsMarker = document.createComment("original location for review insights");
  openingDrillInsightsWasHidden = insightsPanel.classList.contains("hidden");
  insightsPanel.parentNode.insertBefore(openingDrillInsightsMarker, insightsPanel);
  const topbar = document.querySelector(".openings-topbar");
  topbar.appendChild(insightsPanel);
  const studyProgress = document.getElementById("study-progress");
  openingDrillProgressMarker = document.createComment("original location for opening progress");
  studyProgress.parentNode.insertBefore(openingDrillProgressMarker, studyProgress);
  topbar.appendChild(studyProgress);
  updateStudyProgress();
  renderOpeningDrillInsightsPrompt();
  openingDrillPageActive = true;
  document.getElementById("drill-picker-overlay").classList.add("drill-active");
  document.getElementById("opening-drill-screen").style.display = "block";
}

function restoreGameStageFromOpeningPage() {
  if (!openingDrillPageActive) return;
  const insightsPanel = document.getElementById("review-insights-panel");
  if (openingDrillInsightsMarker) {
    openingDrillInsightsMarker.parentNode.insertBefore(insightsPanel, openingDrillInsightsMarker);
    openingDrillInsightsMarker.remove();
    openingDrillInsightsMarker = null;
  }
  const studyProgress = document.getElementById("study-progress");
  if (openingDrillProgressMarker) {
    openingDrillProgressMarker.parentNode.insertBefore(studyProgress, openingDrillProgressMarker);
    openingDrillProgressMarker.remove();
    openingDrillProgressMarker = null;
  }
  insightsPanel.classList.toggle("hidden", openingDrillInsightsWasHidden);
  for (const { element, marker } of openingDrillStageMarkers) {
    marker.parentNode.insertBefore(element, marker);
    marker.remove();
  }
  openingDrillStageMarkers = [];
  openingDrillPageActive = false;
  document.getElementById("drill-picker-overlay").classList.remove("drill-active");
  document.getElementById("opening-drill-screen").style.display = "none";
}

const OPENING_PIECES = {
  wp: "./images/pieces/pw.png", wn: "./images/pieces/nw.png",
  wb: "./images/pieces/bw.png", wr: "./images/pieces/rw.png",
  wq: "./images/pieces/qw.png", wk: "./images/pieces/kw.png",
  bp: "./images/pieces/pb.png", bn: "./images/pieces/nb.png",
  bb: "./images/pieces/bb.png", br: "./images/pieces/rb.png",
  bq: "./images/pieces/qb.png", bk: "./images/pieces/kb.png",
};

function openingPreviewBoard(solution = []) {
  const preview = new Chess();
  for (const uci of solution) {
    if (typeof uci !== "string" || uci.length < 4) break;
    const move = preview.move({
      from: uci.slice(0, 2),
      to: uci.slice(2, 4),
      promotion: uci[4] || "q",
    });
    if (!move) break;
  }
  return preview.board();
}

function createOpeningCard({ family, variation = null }) {
  const card = document.createElement("article");
  card.className = "opening-card";
  card.tabIndex = 0;
  card.setAttribute("role", "button");
  card.setAttribute("aria-label", variation
    ? `${family.name}, ${variation.name}. ${getOpeningProgressStatus(openingVariationProgressKey(family, variation))} progress. Start opening drill.`
    : `${family.name}. ${family.children.length ? "Show nested openings." : "Show lines."}`);

  const boardWrap = document.createElement("div");
  boardWrap.className = "opening-board-wrap";
  const board = document.createElement("div");
  board.className = "opening-board";
  const boardData = openingPreviewBoard(variation?.solution);
  for (let row = 0; row < 8; row++) {
    for (let file = 0; file < 8; file++) {
      const square = document.createElement("div");
      square.className = `opening-square ${(row + file) % 2 === 0 ? "light" : "dark"}`;
      const piece = boardData[row][file];
      if (piece) {
        const image = document.createElement("img");
        image.className = "opening-piece";
        image.src = OPENING_PIECES[piece.color + piece.type];
        image.alt = "";
        image.draggable = false;
        square.appendChild(image);
      }
      board.appendChild(square);
    }
  }
  boardWrap.appendChild(board);
  if (variation) {
    const status = getOpeningProgressStatus(openingVariationProgressKey(family, variation));
    const flag = document.createElement("span");
    flag.className = `opening-progress-flag is-${status}`;
    flag.textContent = "⚑";
    flag.setAttribute("aria-label", `Variant ${status}`);
    flag.title = status === "mastered"
      ? "Mastered without mistakes"
      : status === "mistake"
        ? "Mistakes made"
        : "Incomplete";
    boardWrap.appendChild(flag);
  }
  card.appendChild(boardWrap);

  const info = document.createElement("div");
  info.className = "opening-info";
  if (variation) {
    const openingName = document.createElement("div");
    openingName.className = "opening-result-name";
    openingName.textContent = family.rootName || family.name;
    info.appendChild(openingName);
  }
  const title = document.createElement("h2");
  title.className = "opening-title";
  title.textContent = variation
    ? `${variation.eco ? `${variation.eco} — ` : ""}${variation.name}`
    : family.name;
  info.appendChild(title);
  if (variation) {
    info.appendChild(createOpeningRatesElement(getOpeningResultRates(variation)));
  } else {
    const mastery = getFamilyMastery(family);
    const progress = document.createElement("div");
    progress.className = "opening-family-progress";
    progress.textContent = `${mastery.mastered}/${mastery.total} mastered`;
    info.appendChild(progress);
    info.appendChild(createOpeningRatesElement(getFamilyAverageResultRates(family), "Avg. "));
  }
  card.appendChild(info);

  const activate = () => {
    if (variation) {
      if (maiaThinking) return;
      if (inReplayMode) exitReplay(false);
      selectedOpeningFamily = family;
      moveGameStageIntoOpeningPage();
      document.getElementById("openings-screen").style.display = "none";
      document.getElementById("variation-screen").classList.remove("active");
      document.getElementById("openings-screen").classList.add("hidden");
      document.getElementById("variation-screen").classList.add("hidden");
      document.getElementById("drill-picker-overlay").classList.remove("hidden");
      loadDrill({
        name: `${variation.eco ? `${variation.eco} — ` : ""}${variation.fullName || `${family.name} — ${variation.name}`}`,
        playerColor: openingDrillPlayerColor,
        solution: variation.solution,
        progressKey: openingVariationProgressKey(family, variation),
      });
    } else {
      showOpeningVariations(family);
    }
  };
  card.addEventListener("click", activate);
  card.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      activate();
    }
  });
  return card;
}

function appendOpeningCardsInBatches(grid, items, createCard, renderGeneration) {
  let index = 0;
  const renderBatch = () => {
    if (renderGeneration !== openingRenderGeneration) return;
    const fragment = document.createDocumentFragment();
    for (let count = 0; count < 12 && index < items.length; count++, index++) {
      fragment.appendChild(createCard(items[index]));
    }
    grid.appendChild(fragment);
    if (index < items.length) requestAnimationFrame(renderBatch);
  };
  renderBatch();
}

function tokenizeOpeningSearch(value) {
  return value
    .replace(/\d+\.(\.\.)?/g, " ")
    .replace(/\{[^}]*\}/g, " ")
    .replace(/[!?+#]+/g, "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

function openingSearchToUci(value) {
  const tokens = tokenizeOpeningSearch(value);
  if (!tokens.length) return null;
  const searchGame = new Chess();
  const moves = [];
  for (const token of tokens) {
    let move;
    if (/^[a-h][1-8][a-h][1-8][qrbn]?$/i.test(token)) {
      move = searchGame.move({
        from: token.slice(0, 2).toLowerCase(),
        to: token.slice(2, 4).toLowerCase(),
        ...(token[4] ? { promotion: token[4].toLowerCase() } : {}),
      });
    } else {
      move = searchGame.move(token, { sloppy: true });
    }
    if (!move) return null;
    moves.push(move.from + move.to + (move.promotion || ""));
  }
  return moves;
}

function variationContainsLine(variation, line) {
  const solution = (variation.solution || []).map((move) => move.toLowerCase());
  return solution.some((_, start) =>
    line.every((move, offset) => solution[start + offset] === move)
  );
}

function showOpeningVariations(family) {
  selectedOpeningFamily = family;
  document.getElementById("openings-screen").style.display = "none";
  document.getElementById("openings-screen").classList.add("hidden");
  const screen = document.getElementById("variation-screen");
  screen.classList.remove("hidden");
  screen.classList.add("active");
  renderOpeningCatalog();
}

function renderOpeningCatalog() {
  const renderGeneration = ++openingRenderGeneration;
  const query = document.getElementById("opening-search").value.trim();
  const normalizedQuery = query.toLowerCase();
  const moveSequence = openingSearchToUci(query);
  const openingsGrid = document.getElementById("openings-grid");
  const variationsGrid = document.getElementById("variation-grid");
  const inVariations = !!selectedOpeningFamily;
  openingsGrid.replaceChildren();
  variationsGrid.replaceChildren();

  if (inVariations) {
    const family = selectedOpeningFamily;
    const matchesVariation = (variation) => {
      if (!normalizedQuery) return true;
      return `${variation.eco || ""} ${variation.fullName || variation.name || ""}`.toLowerCase().includes(normalizedQuery)
        || (!!moveSequence && variationContainsLine(variation, moveSequence));
    };
    const matchingChildren = family.children.filter((child) =>
      (child.allVariations || []).some(matchesVariation)
    );
    const variations = family.variations.filter(matchesVariation);
    const items = [
      ...matchingChildren.map((child) => ({ family: child, playercount: child.playercount })),
      ...variations.map((variation) => ({ family, variation, playercount: variation.playercount })),
    ].sort((a, b) =>
      (Number(b.playercount) || 0) - (Number(a.playercount) || 0)
      || compareOpeningNames(a.variation?.name || a.family.name, b.variation?.name || b.family.name)
    );
    const back = document.getElementById("opening-back");
    back.textContent = `← ${family.parent ? family.parent.name : "All openings"}`;
    if (!items.length) {
      const empty = document.createElement("div");
      empty.className = "openings-empty";
      empty.textContent = "No matching openings or variations found.";
      variationsGrid.appendChild(empty);
    } else {
      appendOpeningCardsInBatches(
        variationsGrid,
        items,
        ({ family: itemFamily, variation }) => createOpeningCard({ family: itemFamily, variation }),
        renderGeneration
      );
    }
    if (openingLoadErrors.length) {
      const warning = document.createElement("div");
      warning.className = "openings-empty";
      warning.setAttribute("role", "alert");
      warning.textContent = `Some opening files could not be loaded: ${openingLoadErrors.join("; ")}`;
      variationsGrid.prepend(warning);
    }
    return;
  }

  if (!OPENINGS_DATA.length) {
    const empty = document.createElement("div");
    empty.className = "openings-empty";
    empty.textContent = openingDataLoadComplete
      ? `Opening lines are unavailable. ${openingLoadErrors.join("; ") || "Please check your connection and try again."}`
      : "Loading opening lines…";
    openingsGrid.appendChild(empty);
    return;
  }

  const families = OPENINGS_DATA.filter((family) =>
    (family.allVariations || []).some((variation) => {
      if (!normalizedQuery) return true;
      return family.name.toLowerCase().includes(normalizedQuery)
        || `${variation.eco || ""} ${variation.fullName || variation.name || ""}`.toLowerCase().includes(normalizedQuery)
        || (!!moveSequence && variationContainsLine(variation, moveSequence));
    })
  );
  for (const family of families) openingsGrid.appendChild(createOpeningCard({ family }));
  if (openingLoadErrors.length) {
    const warning = document.createElement("div");
    warning.className = "openings-empty";
    warning.setAttribute("role", "alert");
    warning.textContent = `Some opening files could not be loaded: ${openingLoadErrors.join("; ")}`;
    openingsGrid.prepend(warning);
  }
  if (!openingsGrid.childElementCount) {
    const empty = document.createElement("div");
    empty.className = "openings-empty";
    empty.textContent = "No openings or variations found.";
    openingsGrid.appendChild(empty);
  }
}

document.getElementById("opening-search").addEventListener("input", renderOpeningCatalog);
document.getElementById("opening-back").addEventListener("click", () => {
  selectedOpeningFamily = selectedOpeningFamily?.parent || null;
  const atRoot = !selectedOpeningFamily;
  document.getElementById("variation-screen").classList.toggle("active", !atRoot);
  document.getElementById("openings-screen").style.display = atRoot ? "block" : "none";
  renderOpeningCatalog();
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !document.getElementById("drill-picker-overlay").classList.contains("hidden")) {
    leaveOpeningsMode();
  }
});
function loadDrill(drill) {
  if (maiaThinking) return;
  if (inReplayMode) exitReplay(false);
  openingDrillAnalysisRun++;
  openingDrillDisplayedMoveIndex = null;
  openingDrillMoveMotifs.clear();
  renderOpeningDrillInsightsPrompt();
  premoves = [];
  selectedSquare = null;
  if (inPuzzleMode) {
    inPuzzleMode = false;
    puzzleControlsEl.classList.add("hidden");
  }
  currentDrill = drill;
  inDrillMode = true;
  updateModeBadge();
  gameControlsEl.classList.add("hidden");
  puzzleControlsEl.classList.add("hidden");
  document.getElementById("drill-controls").classList.remove("hidden");

  drillGame = drill.fen ? new Chess(drill.fen) : new Chess();

  console.log(drill);

  drillSolution = drill.solution.slice();
  drillSolutionIndex = 0;
  drillPlayerColor = drill.playerColor;
  drillLocked = false;
  drillAwaitingReply = false;
  drillOutOfLine = false;
  drillEditingLine = false;
  drillLineSnapshot = null;
  drillMistakesThisAttempt = false;
  selectedSquare = null;
  hintSquares = [];
  puzzleHintStage = 0;
  lastMoveFrom = null;
  lastMoveTo = null;

  while (drillSolutionIndex < drillSolution.length && drillGame.turn() !== drillPlayerColor) {
    const uci = drillSolution[drillSolutionIndex];
    const from = uci.slice(0, 2), to = uci.slice(2, 4);
    const promotion = uci.length > 4 ? uci.slice(4) : "q";
    const leadMv = drillGame.move({ from, to, promotion });
    lastMoveFrom = from;
    lastMoveTo = to;
    playGameSound(soundForMove(drillGame, leadMv));
    drillSolutionIndex++;
  }

  drillStartPly = drillGame.history().length;
  drillStartSolutionIndex = drillSolutionIndex;
  boardFlipped = drillPlayerColor === "b";
  document.getElementById("board-wrap").classList.toggle("flipped", boardFlipped);

  updateDrillLineControls();
  updateStudyProgress();
  clearTurnTags();
  renderBoard();
  renderMoveList();
  updateStudyEvaluation(drillGame, "opening");
  statusEl.textContent = openingDrillInstruction();
  statusEl.classList.remove("status-hidden");
  analyzeNextOpeningDrillMove();
}

function restartCurrentDrill() {
  if (!inDrillMode || !currentDrill) return;
  hintSquares = [];
  puzzleHintStage = 0;
  loadDrill(currentDrill);
}
window.restartCurrentDrill = restartCurrentDrill;

function openingDrillInstruction() {
  return drillPlayerColor === "b"
    ? `Defend the opening — ${currentDrill.name}`
    : `Use the opening — ${currentDrill.name}`;
}

function exitDrillMode() {
  const returnToOpeningBrowser = openingDrillPageActive;
  openingDrillAnalysisRun++;
  inDrillMode = false;
  studyEvaluationRun++;
  drillOutOfLine = false;
  drillEditingLine = false;
  drillLineSnapshot = null;
  openingDrillDisplayedMoveIndex = null;
  hintSquares = [];
  puzzleHintStage = 0;
  updateModeBadge();
  document.getElementById("drill-controls").classList.add("hidden");
  updateDrillLineControls();
  updateStudyProgress();
  gameControlsEl.classList.remove("hidden");
  selectedSquare = null;
  applyNormalBoardOrientation();
  restoreLastMoveFromRealGame();
  renderBoard();
  renderMoveList();
  updateClockDisplays();
  if (!isGameLocked()) updateStatusForTurn();
  if (!returnToOpeningBrowser && !isGameLocked() && game.turn() !== playerColor) runMaiaTurn();
  if (returnToOpeningBrowser) {
    restoreGameStageFromOpeningPage();
    const browser = document.getElementById("drill-picker-overlay");
    browser.classList.remove("hidden");
    browser.classList.remove("drill-active");
    document.getElementById("opening-drill-screen").style.display = "none";
    document.getElementById("openings-screen").classList.add("hidden");
    document.getElementById("openings-screen").style.display = "none";
    document.getElementById("variation-screen").classList.remove("hidden");
    document.getElementById("variation-screen").classList.add("active");
    renderOpeningCatalog();
  }
}
window.exitDrillMode = exitDrillMode;

async function onDrillSquareClick(sq) {
  if (drillLocked || drillAwaitingReply) return;
  if (!drillEditingLine && drillOutOfLine) return;
  if (!drillEditingLine && drillGame.turn() !== drillPlayerColor) return;

  if (selectedSquare === null) {
    const piece = drillGame.get(sq);
    if (piece && piece.color === (drillEditingLine ? drillGame.turn() : drillPlayerColor)) {
      selectedSquare = sq;
      renderBoard();
    }
    return;
  }
  if (sq === selectedSquare) {
    selectedSquare = null;
    renderBoard();
    return;
  }

  const from = selectedSquare;
  const to = sq;
  selectedSquare = null;

  const preFen = drillGame.fen();
  const moveResult = drillGame.move({ from, to, promotion: "q" });

  if (!moveResult) {
    const piece = drillGame.get(sq);
    if (piece && piece.color === (drillEditingLine ? drillGame.turn() : drillPlayerColor)) selectedSquare = sq;
    renderBoard();
    return;
  }

  if (drillEditingLine) {
    lastMoveFrom = from;
    lastMoveTo = to;
    playGameSound(soundForMove(drillGame, moveResult));
    renderBoard();
    renderMoveList();
    updateStudyEvaluation(drillGame, "opening");
    return;
  }

  const promotion = moveResult.promotion ? moveResult.promotion : "";
  const playedUci = from + to + promotion;
  const expectedUci = drillSolution[drillSolutionIndex];

  if (playedUci !== expectedUci) {
    drillOutOfLine = true;
    drillEditingLine = true;
    drillLineSnapshot = { fen: preFen, solutionIndex: drillSolutionIndex };
    drillMistakesThisAttempt = true;
    recordOpeningProgress(currentDrill.progressKey, "mistake");
    updateDrillLineControls();
    lastMoveFrom = from;
    lastMoveTo = to;
    playGameSound(soundForMove(drillGame, moveResult));
    renderBoard();
    renderMoveList();
    renderOpeningDrillInsightsPrompt();
    updateStudyEvaluation(drillGame, "opening");
    statusEl.textContent = "Outside of this specific opening line.";
    return;
  }

  lastMoveFrom = from;
  lastMoveTo = to;
  playGameSound(soundForMove(drillGame, moveResult));
  renderBoard();
  renderMoveList();
  drillSolutionIndex++;
  updateStudyProgress();
  updateStudyEvaluation(drillGame, "opening");

  if (drillSolutionIndex >= drillSolution.length) {
    completeOpeningDrill();
    return;
  }

  drillAwaitingReply = true;
  await humanDelay();
  const replyUci = drillSolution[drillSolutionIndex];
  const rFrom = replyUci.slice(0, 2), rTo = replyUci.slice(2, 4);
  const rPromo = replyUci.length > 4 ? replyUci.slice(4) : "q";
  const drillReplyResult = drillGame.move({ from: rFrom, to: rTo, promotion: rPromo });
  lastMoveFrom = rFrom;
  lastMoveTo = rTo;
  playGameSound(soundForMove(drillGame, drillReplyResult));
  drillSolutionIndex++;
  updateStudyProgress();
  renderBoard();
  renderMoveList();
  updateStudyEvaluation(drillGame, "opening");
  drillAwaitingReply = false;

  if (drillSolutionIndex >= drillSolution.length) {
    completeOpeningDrill();
  } else {
    statusEl.textContent = openingDrillInstruction();
    analyzeNextOpeningDrillMove();
  }
}

function updateDrillLineControls() {
  const undo = document.getElementById("drill-undo-btn");
  const back = document.getElementById("drill-return-line-btn");
  if (undo) undo.classList.toggle("hidden", drillEditingLine);
  if (back) back.classList.toggle("hidden", !drillEditingLine);
}

function returnToOpeningLine() {
  if (!inDrillMode || !drillEditingLine || !drillLineSnapshot || !drillGame) return;
  drillGame.load(drillLineSnapshot.fen);
  drillSolutionIndex = drillLineSnapshot.solutionIndex;
  drillEditingLine = false;
  drillOutOfLine = false;
  drillLineSnapshot = null;
  drillAwaitingReply = false;
  drillLocked = false;
  selectedSquare = null;
  hintSquares = [];
  const history = drillGame.history({ verbose: true });
  const lastMove = history[history.length - 1];
  lastMoveFrom = lastMove ? lastMove.from : null;
  lastMoveTo = lastMove ? lastMove.to : null;
  updateDrillLineControls();
  updateStudyProgress();
  analyzeNextOpeningDrillMove();
  renderBoard();
  renderMoveList();
  updateStudyEvaluation(drillGame, "opening");
  statusEl.textContent = openingDrillInstruction();
}
window.returnToOpeningLine = returnToOpeningLine;

function completeOpeningDrill() {
  drillLocked = true;
  statusEl.textContent = "Variation complete.";
  if (drillMistakesThisAttempt) {
    recordOpeningProgress(currentDrill.progressKey, "mistake");
  } else {
    recordOpeningProgress(currentDrill.progressKey, "mastered");
  }
  renderOpeningDrillInsightsPrompt();
}

// ---------- Status / turn tags ----------

function updateStatusForTurn() {
  statusEl.classList.add("status-hidden");
}

function clearTurnTags() {
  // Turn tags were removed from the HTML.
}

function toggleFlip() {
  if (inDrillMode && drillAwaitingReply) return;
  boardFlipped = !boardFlipped;

  document
    .getElementById("board-wrap")
    .classList.toggle("flipped", boardFlipped);

  if (inDrillMode && currentDrill) {
    openingDrillPlayerColor = boardFlipped ? "b" : "w";
    currentDrill = { ...currentDrill, playerColor: openingDrillPlayerColor };
    restartCurrentDrill();
    return;
  }

  if (!inPuzzleMode && !inReplayMode) {
    normalBoardFlip = boardFlipped;
    localStorage.setItem(NORMAL_BOARD_FLIP_KEY, String(boardFlipped));
  }
  renderBoard();
}

window.toggleFlip = toggleFlip;

// ---------- Clocks ----------

function formatClock(totalSeconds) {
  const remaining = Math.max(0, totalSeconds);
  const s = Math.floor(remaining);
  const m = Math.floor(s / 60);
  const r = s % 60;
  const base = m + ":" + String(r).padStart(2, "0");
  if (remaining < 10) {
    const tenths = Math.floor((remaining - s) * 10);
    return `${base}.${tenths}`;
  }
  return base;
}

function updateClockDisplays() {
  const displayColor = inReplayMode ? replayPlayerColor : playerColor;
  const replaySnapshot = inReplayMode
    ? replayClockHistory[replayIndex - 1]
    : null;
  const hasReplayClock = !inReplayMode || replayIndex === 0 || Number.isFinite(replaySnapshot?.white);
  const shownWhiteTime = replaySnapshot?.white ?? (inReplayMode ? STARTING_CLOCK_SECONDS : whiteTime);
  const shownBlackTime = replaySnapshot?.black ?? (inReplayMode ? STARTING_CLOCK_SECONDS : blackTime);
  const yourTime = displayColor === "w" ? shownWhiteTime : shownBlackTime;
  const maiaTime = displayColor === "w" ? shownBlackTime : shownWhiteTime;

  yourClockEl.textContent = hasReplayClock ? formatClock(yourTime) : "--:--";
  maiaClockEl.textContent = hasReplayClock ? formatClock(maiaTime) : "--:--";
}

function recordMoveClockSnapshot() {
  const moveIndex = game.history().length - 1;
  if (moveIndex < 0) return;
  moveClockHistory[moveIndex] = {
    white: whiteTime,
    black: blackTime,
    movedAt: Date.now(),
  };
}

function resetClocks() {
  whiteTime = STARTING_CLOCK_SECONDS;
  blackTime = STARTING_CLOCK_SECONDS;
  moveClockHistory = [];

  whiteClockStarted = false;
  blackClockStarted = false;
  clockLastTick = performance.now();

  updateClockDisplays();
}

function updateClockUnlocks() {
  const len = game.history().length;

  whiteClockStarted = len >= 2;
  blackClockStarted = len >= 3;
}

const LOWTIME_THRESHOLDS = [60, 10, 3];
let clockLastTick = performance.now();

function tickClock() {

  // Clocks exist only in normal games.
  if (inReplayMode || inPuzzleMode || inDrillMode || isGameLocked()) {
    clockLastTick = performance.now();
    return;
  }

  const now = performance.now();
  const elapsed = Math.max(0, (now - clockLastTick) / 1000);
  clockLastTick = now;
  const turn = game.turn();
  const previousTime = turn === "w" ? whiteTime : blackTime;

  if (turn === "w") {

    if (!whiteClockStarted) {
      return;
    }

    whiteTime = Math.max(0, whiteTime - elapsed);

    if (whiteTime === 0) {
      handleTimeout("w");
      return;
    }

  } else {

    if (!blackClockStarted) {
      return;
    }

    blackTime = Math.max(0, blackTime - elapsed);

    if (blackTime === 0) {
      handleTimeout("b");
      return;
    }
  }

  // Low-time sound only for YOUR clock.
  if (turn === playerColor) {

    const yourTime =
      playerColor === "w"
        ? whiteTime
        : blackTime;

    if (LOWTIME_THRESHOLDS.some((threshold) => previousTime > threshold && yourTime <= threshold)) {
      playGameSound("lowtime");
    }
  }

  updateClockDisplays();
  if (Math.floor(previousTime) !== Math.floor(turn === "w" ? whiteTime : blackTime)) {
    saveCurrentGame();
  }
}

// Update frequently for millisecond display when either clock is low.
setInterval(tickClock, 25);

function handleTimeout(loserColor) {
  if (isGameLocked()) return;
  gameTimedOut = true;
  timedOutColor = loserColor;
  maiaThinking = false;
  premoves = [];
  playGameSound("checkmate");
  updateClockDisplays();
  saveCurrentGame();
  clearTurnTags();
  statusEl.classList.add("status-hidden");
  showGameOverPopup();
}

// ---------- Color assignment ----------
function assignNextColor() {
  let n = parseInt(localStorage.getItem("chess_games_started") || "0", 10);
  const color = n % 2 === 0 ? "w" : "b";
  localStorage.setItem("chess_games_started", String(n + 1));
  return color;
}

// ============================================================
// PAST GAME REPLAY
// ============================================================

let inReplayMode = false;
let replayReturnGame = null;
let replayReturnBoardFlipped = null;
let replayControlsEl = null;


// ------------------------------------------------------------
// Open a saved game
// ------------------------------------------------------------

function openPastGame(entry) {
  if (!entry || !entry.pgn) {
    console.error("Past game has no PGN.");
    return;
  }
  if (inPuzzleMode) exitPuzzleMode(false);
  if (inReplayMode) exitReplay(false);

  // Save the current real game so we can return to it.
  replayReturnGame = game;

  // Create a completely separate game for replay.
  replayGame = new Chess();

  try {
    if (typeof replayGame.load_pgn === "function") {
      if (!replayGame.load_pgn(entry.pgn)) {
        throw new Error("Chess.js could not load the PGN.");
      }
    } else if (typeof replayGame.loadPgn === "function") {
      if (!replayGame.loadPgn(entry.pgn)) {
        throw new Error("Chess.js could not load the PGN.");
      }
    } else {
      throw new Error("This Chess.js version has no PGN loader.");
    }
  } catch (err) {
    console.error("Could not load saved game:", err);
    replayGame = null;
    replayReturnGame = null;
    return;
  }

  // Save every move.
  replayMoves = replayGame.history({
    verbose: true
  });
  replayMoveFens = captureReplayMoveFens();
  replayMoveMotifs = Array(replayMoves.length).fill(null);
  replayOriginalMoves = replayMoves.map((move) => ({ ...move }));
  replayOriginalMoveFens = replayMoveFens;
  replayOriginalMoveMotifs = replayMoveMotifs;
  const motifRunId = ++replayMotifRun;
  replayAnalysis = Array(replayMoves.length).fill(null);
  replayCandidateLines = [];
  replayRankedLines = [];
  replayPlayerColor = entry.playerColor === "b" ? "b" : entry.playerColor === "w" ? "w" : playerColor;
  replayClockHistory = Array.isArray(entry.clockHistory) ? entry.clockHistory : [];
  replayOriginalClockHistory = replayClockHistory.slice();
  replayOriginalPgn = entry.pgn;
  replayPositionScores.clear();
  replayOriginalPositionScores.clear();
  replayLineVersion++;
  replayBranchStart = null;

  // Start replay at the beginning.
  replayGame.reset();
  replayIndex = 0;

  // Enter replay mode.
  inReplayMode = true;
  document.querySelector(".container")?.classList.add("review-mode");
  document.getElementById("board-wrap").classList.add("replay-mode");
  clearTurnTags();
  statusEl.classList.add("status-hidden");
  replayReturnBoardFlipped = boardFlipped;
  boardFlipped = !boardFlipped;
  document.getElementById("board-wrap").classList.toggle("flipped", boardFlipped);

  selectedSquare = null;
  lastMoveFrom = null;
  lastMoveTo = null;

  // Show replay controls.
  createReplayControls();
  updateReplayControls();
  analyzeReplayPlayedMoves(motifRunId);
  analyzeReplayMoves(entry.pgn);

  // Render the saved game directly on the EXISTING board.
  renderBoard();
  renderMoveList();
  updateClockDisplays();
  analyzeReplayPosition();

  console.log(
    "Loaded past game:",
    replayMoves.length,
    "moves"
  );
}

function captureReplayMoveFens() {
  const fens = Array(replayMoves.length);
  for (let index = replayMoves.length - 1; index >= 0; index--) {
    if (!replayGame.undo()) break;
    fens[index] = replayGame.fen();
  }
  for (const move of replayMoves) replayGame.move(move);
  return fens;
}

async function analyzeReplayPlayedMoves(runId) {
  try {
    const batchSize = 6;
    for (let start = 0; start < replayMoves.length; start += batchSize) {
      const end = Math.min(start + batchSize, replayMoves.length);
      const results = await Promise.all(replayMoves.slice(start, end).map(async (move, offset) => {
        const index = start + offset;
        const uci = move.from + move.to + (move.promotion || "");
        return window.analyzePositionalChessMove(replayMoveFens[index], uci);
      }));
      if (runId !== replayMotifRun || !inReplayMode) return;
      results.forEach((result, offset) => {
        replayMoveMotifs[start + offset] = result?.error ? [] : (result?.motifs || []);
      });
      renderMoveList();
      renderReplayMoveInsights();
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  } catch (error) {
    if (runId !== replayMotifRun) return;
    console.warn("Could not analyze played moves for motifs:", error);
  } finally {
    if (runId === replayMotifRun) {
      renderMoveList();
      renderReplayMoveInsights();
    }
  }
}

// ------------------------------------------------------------
// Replay controls
// ------------------------------------------------------------

function createReplayControls() {
  if (replayControlsEl) {
    replayControlsEl.remove();
  }
  if (replayAnalysisPanelEl) {
    replayAnalysisPanelEl.remove();
  }

  replayControlsEl = document.createElement("div");
  replayControlsEl.className = "controls replay-controls";
  replayControlsEl.id = "replay-controls";
  replayControlsEl.innerHTML = `
    <button type="button" id="replay-exit">
      Exit Replay
    </button>

    <button type="button" id="replay-start" aria-label="Go to start" title="Go to start">
      ⏮
    </button>

    <button type="button" id="replay-previous" aria-label="Previous move" title="Previous move">
      ◀
    </button>

    <span id="replay-position" aria-label="Move position">
      <span class="replay-position-current">0</span>
      <span class="replay-position-total">0</span>
    </span>

    <button type="button" id="replay-next" aria-label="Next move" title="Next move">
      ▶
    </button>

    <button type="button" id="replay-end" aria-label="Go to end" title="Go to end">
      ⏭
    </button>

    <button type="button" id="replay-return-line" class="replay-return-line hidden">
      ↩ Return to Line
    </button>
  `;

  // Keep replay controls outside the horizontal move strip.
  const moveStrip = moveListEl && moveListEl.parentElement;
  if (moveStrip && moveStrip.parentElement) {
    moveStrip.parentElement.insertBefore(replayControlsEl, moveStrip);
  } else if (gameControlsEl) {
    gameControlsEl.parentElement.appendChild(
      replayControlsEl
    );
  } else {
    document.body.appendChild(replayControlsEl);
  }

  replayControlsEl.appendChild(document.getElementById("flip-button"));

document
  .getElementById("replay-exit")
  .addEventListener("click", exitReplay);

document
  .getElementById("replay-start")
  .addEventListener("click", replayStart);

document
  .getElementById("replay-previous")
  .addEventListener("click", replayPrevious);

document
  .getElementById("replay-next")
  .addEventListener("click", replayNext);

document
  .getElementById("replay-end")
  .addEventListener("click", replayEnd);

document
  .getElementById("replay-return-line")
  .addEventListener("click", () => {
    const returnIndex =
      replayBranchStart !== null
        ? replayBranchStart
        : replayIndex;

    restoreOriginalReplayLine(returnIndex);

    lastMoveFrom = null;
    lastMoveTo = null;
    selectedSquare = null;

    renderBoard();
    renderMoveList();
    updateClockDisplays();
    updateReplayControls();
    analyzeReplayPosition();
  });

// Keyboard controls
document.addEventListener("keydown", (event) => {
  if (!inReplayMode) return;

  // Don't hijack keyboard controls while typing.
  if (
    event.target.tagName === "INPUT" ||
    event.target.tagName === "TEXTAREA" ||
    event.target.isContentEditable
  ) {
    return;
  }

  switch (event.key) {
    case "ArrowLeft":
      event.preventDefault();
      replayPrevious();
      break;

    case "ArrowRight":
      event.preventDefault();
      replayNext();
      break;

    case "ArrowUp":
      event.preventDefault();
      replayStart();
      break;

    case "ArrowDown":
      event.preventDefault();
      replayEnd();
      break;

    case "/":
      event.preventDefault();

      if (replayBranchStart !== null) {
        const returnIndex = replayBranchStart;

        restoreOriginalReplayLine(returnIndex);

        lastMoveFrom = null;
        lastMoveTo = null;
        selectedSquare = null;

        renderBoard();
        renderMoveList();
        updateClockDisplays();
        updateReplayControls();
        analyzeReplayPosition();
      }
      break;
  }
});
}

// ------------------------------------------------------------
// Update replay counter
// ------------------------------------------------------------

function updateReplayControls() {
  const position =
    document.getElementById("replay-position");

  const returnLineButton =
    document.getElementById("replay-return-line");

  if (position) {
    position.querySelector(".replay-position-current").textContent =
      replayIndex;
    position.querySelector(".replay-position-total").textContent =
      replayMoves.length;
  }

  if (returnLineButton) {
    const offOriginalLine =
      replayBranchStart !== null;

    returnLineButton.classList.toggle(
      "hidden",
      !offOriginalLine
    );
  }

  renderReplayMoveInsights();
}

function getStockfishSuggestion(maiaLine = null) {
  const first = replayCandidateLines.find((line) => line.multipv === 1) || replayCandidateLines[0];
  const second = replayCandidateLines.find((line) => line.multipv === 2) || replayCandidateLines[1];
  const sameFirstMove = maiaLine?.pv?.[0] && maiaLine.pv[0] === first?.pv?.[0];
  return sameFirstMove ? second || first : first || second;
}

function loadReplayMotifModule() {
  if (!replayMotifModulePromise) {
    replayMotifModulePromise = import("./engines/motifs/motif-detector.mjs?v=1")
      .catch((error) => {
        replayMotifModulePromise = null;
        throw error;
      });
  }
  return replayMotifModulePromise;
}

window.analyzePositionalChessMove = async (fen, uci) =>
  (await loadReplayMotifModule()).analyzeMove(fen, uci);
window.analyzePositionalChessPv = async (fen, ucis, plies = ucis.length) =>
  (await loadReplayMotifModule()).analyzePv(fen, ucis, plies);

// MaiaTensor.processOutputsMaia3 returns value from White's perspective.
// Convert both evaluations to the mover's perspective before grading.
async function analyzeFullGame(pgn, playerSide = playerColor, onProgress = () => {}, shouldCancel = () => false) {
  await waitForMaia();

  const analysisGame = new Chess();
  const loaded = typeof analysisGame.load_pgn === "function"
    ? analysisGame.load_pgn(pgn)
    : analysisGame.loadPgn(pgn);
  if (!loaded) throw new Error("Could not load PGN for analysis.");

  const moves = analysisGame.history({ verbose: true });
  analysisGame.reset();

  // Snapshot the current ratings so a game analyzed over time stays consistent.
  const userRating = myRating;
  const maiaRating = parseInt(MAIA_ELO, 10) || userRating;
  const ratingFor = (color) => color === playerSide ? userRating : maiaRating;
  const evaluateTurn = (gameAtPosition) => {
    const turn = gameAtPosition.turn();
    const opponent = turn === "w" ? "b" : "w";
    return engine.evaluate(
      gameAtPosition,
      ratingFor(turn),
      ratingFor(opponent)
    );
  };

  const results = [];
  let beforeEval = moves.length ? await evaluateTurn(analysisGame) : null;

  for (let i = 0; i < moves.length; i++) {
    if (shouldCancel()) throw new Error("Analysis cancelled.");
    const move = moves[i];
    const moveUci = move.from + move.to + (move.promotion || "");
    const preMoveProb = beforeEval?.policy?.[moveUci] || 0;
    const preTopMove = Object.keys(beforeEval?.policy || {})[0] || null;
    const playedMove = analysisGame.move(move);
    if (!playedMove) throw new Error(`Could not replay move ${i + 1}.`);

    const isMate = analysisGame.in_checkmate();
    const isTerminal = analysisGame.game_over();
    const afterEval = isTerminal ? null : await evaluateTurn(analysisGame);
    if (shouldCancel()) throw new Error("Analysis cancelled.");
    const beforeValue = move.color === "w"
      ? beforeEval.value
      : 1 - beforeEval.value;
    const afterValue = isMate
      ? 1
      : isTerminal
        ? 0.5
        : move.color === "w"
          ? afterEval.value
          : 1 - afterEval.value;
    const afterWhite = isMate
      ? (move.color === "w" ? 1 : 0)
      : isTerminal
        ? 0.5
        : afterEval.value;
    const delta = afterValue - beforeValue;
    const deltaPct = delta * 100;
    results.push({
      move: playedMove,
      san: playedMove.san,
      color: move.color,
      before: beforeValue,
      after: afterValue,
      afterWhite,
      delta,
      deltaPct,
      moveProbability: preMoveProb,
      bestMove: preTopMove,
      beforeEval,
      afterEval,
      classification: null,
      wasMate: isMate,
      moveUci,
    });
    onProgress(results, i + 1, moves.length);

    if (afterEval) beforeEval = afterEval;
  }

  return results;
}

async function analyzeReplayMoves(pgn) {
  const runId = ++replayAnalysisRun;
  if (!replayGame) return;

  replayAnalyzing = true;
  renderReplayAnalysisPanel(0, replayMoves.length);
  try {
    replayAnalysis = await analyzeFullGame(
      pgn,
      replayPlayerColor,
      (results, completed, total) => {
        if (runId !== replayAnalysisRun) return;
        replayAnalysis = results;
        refreshReplayMoveRating(completed - 1);
        renderReplayAnalysisPanel(completed, total);
        renderMoveList();
        if (inReplayMode && replayIndex > 0 && replayIndex - 1 === completed - 1) {
          renderBoard();
        }
      },
      () => runId !== replayAnalysisRun
    );
    if (runId === replayAnalysisRun) {
      replayAnalysis.forEach((_, index) => refreshReplayMoveRating(index));
      renderReplayAnalysisPanel(replayAnalysis.length, replayAnalysis.length);
      renderMoveList();
      if (inReplayMode && replayIndex > 0) renderBoard();
    }
  } catch (err) {
    if (runId === replayAnalysisRun && replayAnalysisPanelEl && err.message !== "Analysis cancelled.") {
      replayAnalysisPanelEl.textContent = `Analysis failed: ${err.message}`;
    }
    if (err.message !== "Analysis cancelled.") {
      console.error("Could not analyze saved game with current rating:", err);
    }
  } finally {
    if (runId === replayAnalysisRun) replayAnalyzing = false;
  }
}

function stockfishScoreToWhiteChance(score, turn) {
  const scoreFromTurn = score.type === "mate"
    ? (score.value > 0 ? 1 : 0)
    : 1 / (1 + Math.exp(-0.00368208 * score.value));
  return turn === "w" ? scoreFromTurn : 1 - scoreFromTurn;
}

function classifyReplayMove({ deltaPct, moveUci, bestMove, moveProbability, isBookMove, wasMate }) {
  if (isBookMove) return "book";
  if (wasMate) return "best";
  if (deltaPct <= -20) return "blunder";
  if (deltaPct <= -10) return "mistake";
  if (moveProbability < 0.05 && deltaPct <= -4) return "miss";
  if (deltaPct <= -3) return "inaccuracy";
  if (moveProbability < 0.05 && deltaPct >= 12) return "brilliant";
  if (moveUci && moveUci === bestMove) return "best";
  if (deltaPct >= 8) return "excellent";
  if (deltaPct >= 3) return "great";
  return "good";
}

function refreshReplayMoveRating(moveIndex) {
  const result = replayAnalysis[moveIndex];
  const before = replayPositionScores.get(moveIndex);
  const after = replayPositionScores.get(moveIndex + 1);
  if (!result || !before || !after || before.lineVersion !== replayLineVersion || after.lineVersion !== replayLineVersion) return;

  const moverChanceBefore = result.color === "w"
    ? stockfishScoreToWhiteChance(before.score, before.turn)
    : 1 - stockfishScoreToWhiteChance(before.score, before.turn);
  const moverChanceAfter = result.color === "w"
    ? stockfishScoreToWhiteChance(after.score, after.turn)
    : 1 - stockfishScoreToWhiteChance(after.score, after.turn);
  result.before = moverChanceBefore;
  result.after = moverChanceAfter;
  result.deltaPct = (moverChanceAfter - moverChanceBefore) * 100;
  const movesThroughPosition = replayMoves
    .slice(0, moveIndex + 1)
    .map((move) => move.from + move.to + (move.promotion || ""));
  result.classification = classifyReplayMove({
    deltaPct: result.deltaPct,
    moveUci: result.moveUci,
    bestMove: result.bestMove,
    moveProbability: result.moveProbability,
    isBookMove: isOpeningBookSequence(movesThroughPosition),
    wasMate: result.wasMate,
  });
}

function recordReplayPositionScore(positionIndex, fen, turn, score, lineVersion) {
  if (!score || lineVersion !== replayLineVersion) return;
  const position = { fen, turn, score, lineVersion };
  replayPositionScores.set(positionIndex, position);
  if (replayBranchStart === null) replayOriginalPositionScores.set(positionIndex, position);
  const moveIndex = positionIndex - 1;
  refreshReplayMoveRating(moveIndex);
  if (moveIndex === replayIndex - 1 && replayAnalysis[moveIndex]?.classification) renderBoard();
}

function renderReplayAnalysisPanel(completed = replayAnalysis.length, total = replayMoves.length) {
  if (!replayAnalysisPanelEl) return;

  const userStats = freshStats();
  const maiaStats = freshStats();
  for (const result of replayAnalysis) {
    if (!result) continue;
    const stats = result.color === replayPlayerColor ? userStats : maiaStats;
    stats[result.classification]++;
  }

  const userAccuracy = computeAccuracy(userStats);
  const maiaAccuracy = computeAccuracy(maiaStats);
  const rows = replayAnalysis.map((result, index) => {
    if (!result) return "";
    const moveNo = Math.floor(index / 2) + 1;
    const notation = index % 2 === 0 ? `${moveNo}. ${result.san}` : `${moveNo}... ${result.san}`;
    const probabilityPct = Math.round(result.moveProbability * 100);
    const deltaDisplay = `${result.deltaPct >= 0 ? "+" : ""}${result.deltaPct.toFixed(1)}%`;
    return `<tr><td>${notation}</td><td>${probabilityPct}%</td><td>${deltaDisplay}</td></tr>`;
  }).join("");

  replayAnalysisPanelEl.innerHTML = `
    <div class="replay-analysis-heading">
      <strong>Full game analysis</strong>
      <span>Using your current rating: ${myRating}</span>
    </div>
    <div class="replay-analysis-summary">
      <span>You: ${userAccuracy === null ? "—" : `${userAccuracy}% accuracy`}</span>
      <span>Maia: ${maiaAccuracy === null ? "—" : `${maiaAccuracy}% accuracy`}</span>
      <span>${completed} / ${total} moves</span>
    </div>
    <div class="replay-analysis-table-wrap">
      <table class="replay-analysis-table">
        <thead><tr><th>Move</th><th>Maia move %</th><th>Change</th></tr></thead>
        <tbody>${rows || `<tr><td colspan="3">${replayAnalyzing ? "Analyzing moves…" : "No moves to analyze."}</td></tr>`}</tbody>
      </table>
    </div>`;
}

// ------------------------------------------------------------
// Go to beginning
// ------------------------------------------------------------

function restoreOriginalReplayLine(index) {
  replayGame.reset();
  replayMoves = replayOriginalMoves.map((move) => ({ ...move }));
  for (let i = 0; i < index; i++) replayGame.move(replayMoves[i]);
  replayIndex = index;
  replayMoveFens = replayOriginalMoveFens;
  replayMoveMotifs = replayOriginalMoveMotifs;
  replayClockHistory = replayOriginalClockHistory.slice();
  replayBranchStart = null;
  replayAnalysisRun++;
  replayAnalysis = Array(replayMoves.length).fill(null);
  replayLineVersion++;
  replayPositionScores = new Map([...replayOriginalPositionScores].map(([ply, position]) => [
    ply,
    { ...position, lineVersion: replayLineVersion },
  ]));
  replayMotifRun++;
  analyzeReplayPlayedMoves(replayMotifRun);
  analyzeReplayMoves(replayOriginalPgn);
}

function replayStart() {
  if (!replayGame) return;

  restoreOriginalReplayLine(0);

  lastMoveFrom = null;
  lastMoveTo = null;
  selectedSquare = null;

  renderBoard();
  renderMoveList();
  updateClockDisplays();
  updateReplayControls();
  analyzeReplayPosition();
}

// ------------------------------------------------------------
// Previous move
// ------------------------------------------------------------

function replayPrevious() {
  if (!replayGame) return;

  if (replayIndex <= 0) {
    return;
  }

  const previousIndex = replayIndex - 1;
  if (replayBranchStart !== null && previousIndex <= replayBranchStart) {
    restoreOriginalReplayLine(previousIndex);
  } else {
    replayGame.reset();
    for (let i = 0; i < previousIndex; i++) replayGame.move(replayMoves[i]);
    replayIndex = previousIndex;
  }

  const last =
    replayIndex > 0
      ? replayMoves[replayIndex - 1]
      : null;

  lastMoveFrom =
    last ? last.from : null;

  lastMoveTo =
    last ? last.to : null;

  selectedSquare = null;

  renderBoard();
  renderMoveList();
  updateClockDisplays();
  updateReplayControls();
  analyzeReplayPosition();
}

// ------------------------------------------------------------
// Next move
// ------------------------------------------------------------

function replayNext() {
  if (!replayGame) return;

  if (
    replayIndex >= replayMoves.length
  ) {
    return;
  }

  const move =
    replayGame.move(
      replayMoves[replayIndex]
    );

  replayIndex++;

  lastMoveFrom =
    move ? move.from : null;

  lastMoveTo =
    move ? move.to : null;

  selectedSquare = null;

  renderBoard();
  renderMoveList();
  updateClockDisplays();
  updateReplayControls();
  analyzeReplayPosition();
}

// ------------------------------------------------------------
// Go to end
// ------------------------------------------------------------

function replayEnd() {
  if (!replayGame) return;

  replayGame.reset();

  for (
    const move of replayMoves
  ) {
    replayGame.move(move);
  }

  replayIndex =
    replayMoves.length;

  const last =
    replayMoves.length > 0
      ? replayMoves[replayMoves.length - 1]
      : null;

  lastMoveFrom =
    last ? last.from : null;

  lastMoveTo =
    last ? last.to : null;

  selectedSquare = null;

  renderBoard();
  renderMoveList();
  updateReplayControls();
  analyzeReplayPosition();
}

// ------------------------------------------------------------
// Exit replay
// ------------------------------------------------------------

function exitReplay(resumeGame = true) {
  replayAnalysisRun++;
  replayStockfishRun++;
  replayMotifRun++;
  window.stockfishEvaluator?.stop();
  clockLastTick = performance.now();
  replayAnalyzing = false;
  inReplayMode = false;
  document.querySelector(".container")?.classList.remove("review-mode");

  // Restore the real game.
  if (replayReturnGame) {
    game = replayReturnGame;
  }
  if (replayReturnBoardFlipped !== null) {
    boardFlipped = replayReturnBoardFlipped;
    replayReturnBoardFlipped = null;
  }

  replayGame = null;
  replayMoves = [];
  replayMoveFens = [];
  replayMoveMotifs = [];
  replayClockHistory = [];
  replayOriginalMoves = [];
  replayOriginalMoveFens = [];
  replayOriginalMoveMotifs = [];
  replayOriginalClockHistory = [];
  replayBranchStart = null;
  replayOriginalPgn = "";
  replayPositionScores.clear();
  replayOriginalPositionScores.clear();
  replayIndex = 0;
  replayAnalysis = [];
  replayCandidateLines = [];
  replayRankedLines = [];
  replayReturnGame = null;

  selectedSquare = null;

  lastMoveFrom = null;
  lastMoveTo = null;

  if (replayControlsEl) {
    replayControlsEl.remove();
    replayControlsEl = null;
  }
  gameControlsEl.appendChild(document.getElementById("flip-button"));
  if (replayAnalysisPanelEl) {
    replayAnalysisPanelEl.remove();
    replayAnalysisPanelEl = null;
  }

  renderReplayMoveInsights();
  renderBoard();
  renderMoveList();
  updateStatusForTurn();
  updateClockDisplays();
  if (resumeGame && !inPuzzleMode && !inDrillMode && !isGameLocked() && game.turn() !== playerColor) {
    runMaiaTurn();
  }

  console.log("Exited replay mode.");
}

// ------------------------------------------------------------
// Make functions available globally
// ------------------------------------------------------------

window.openPastGame = openPastGame;
window.replayStart = replayStart;
window.replayPrevious = replayPrevious;
window.replayNext = replayNext;
window.replayEnd = replayEnd;
window.exitReplay = exitReplay;

// ---------- Save / load ----------
function saveKey(mode) {
  return "chess_game_" + mode;
}

function saveCurrentGame() {
  localStorage.setItem(
    saveKey(currentMode),
    JSON.stringify({
      pgn: game.pgn(),
      clockHistory: moveClockHistory,
      resigned: gameResigned,
      resignedBy,
      timedOut: gameTimedOut,
      timedOutColor,
      historyRecorded,
      playerColor,
      whiteTime,
      blackTime,
      whiteClockStarted,
      blackClockStarted,
    })
  );
  localStorage.setItem("chess_active_mode", currentMode);
}

function loadGame(mode) {
  const raw = localStorage.getItem(saveKey(mode));
  const blank = {
    game: new Chess(), resigned: false, resignedBy: null, timedOut: false, timedOutColor: null,
    historyRecorded: false, playerColor: null,
    clockHistory: [],
    whiteTime: STARTING_CLOCK_SECONDS, blackTime: STARTING_CLOCK_SECONDS,
    whiteClockStarted: false, blackClockStarted: false,
  };
  if (!raw) return blank;
  try {
    const d = JSON.parse(raw);
    const loaded = new Chess();
    if (d.pgn && loaded.load_pgn(d.pgn)) {
      return {
        game: loaded, resigned: !!d.resigned, resignedBy: d.resignedBy || null,
        timedOut: !!d.timedOut, timedOutColor: d.timedOutColor || null,
        historyRecorded: !!d.historyRecorded, playerColor: d.playerColor || "w",
        clockHistory: Array.isArray(d.clockHistory) ? d.clockHistory : [],
        whiteTime: typeof d.whiteTime === "number" ? d.whiteTime : STARTING_CLOCK_SECONDS,
        blackTime: typeof d.blackTime === "number" ? d.blackTime : STARTING_CLOCK_SECONDS,
        whiteClockStarted: !!d.whiteClockStarted, blackClockStarted: !!d.blackClockStarted,
      };
    }
  } catch (e) {
    console.warn("Couldn't restore saved " + mode + " game, starting fresh.", e);
  }
  return blank;
}

function resetForNewGame(mode) {
  currentMode = mode;
  gameToken++;
  maiaThinking = false;
  selectedSquare = null;
  premoves = [];
  gameResigned = false;
  resignedBy = null;
  gameTimedOut = false;
  timedOutColor = null;
  historyRecorded = false;
  moveClockHistory = [];
  playerMoveStats = freshStats();
  maiaMoveStatsObj = freshStats();
  pendingMaiaGrading = null;
}

function applyLoadedState(loaded) {
  game = loaded.game;
  gameResigned = loaded.resigned;
  resignedBy = loaded.resignedBy;
  gameTimedOut = loaded.timedOut;
  timedOutColor = loaded.timedOutColor;
  historyRecorded = loaded.historyRecorded;
  moveClockHistory = loaded.clockHistory;
  whiteTime = loaded.whiteTime;
  blackTime = loaded.blackTime;
  whiteClockStarted = loaded.whiteClockStarted;
  blackClockStarted = loaded.blackClockStarted;
  clockLastTick = performance.now();
  playerColor = loaded.playerColor !== null ? loaded.playerColor : assignNextColor();
  updateClockUnlocks();
  applyNormalBoardOrientation();
  restoreLastMoveFromRealGame();
  updateLiveOpeningIndicators(game);
  recordCompletedOpeningAchievements(game);
  document.getElementById("your-rating").textContent = myRating;
  document.getElementById("maia-rating").textContent = MAIA_ELO;
}

function selectMode(mode) {
  if (mode === "unrated") mode = "rated";
  if (mode !== "rated" && mode !== "puzzles") return;
  document.querySelectorAll(".menu-item.open").forEach((item) => item.classList.remove("open"));
  if (document.querySelector(".container").classList.contains("openings-mode")) {
    leaveOpeningsMode();
  }
  if (inPuzzleMode) exitPuzzleMode();
  if (inDrillMode) exitDrillMode();
  if (mode === currentMode) return;

  saveCurrentGame();
  const loaded = loadGame(mode);
  resetForNewGame(mode);
  applyLoadedState(loaded);
  saveCurrentGame();
  updateModeBadge();

  closeOverlay();
  clearTurnTags();
  renderBoard();
  renderMoveList();
  updateClockDisplays();

  if (isGameLocked()) {
    showGameOverPopup();
  } else {
    updateStatusForTurn();
    if (game.turn() !== playerColor) runMaiaTurn();
  }
}
window.selectMode = selectMode;

function newGameCurrentMode() {
  resetForNewGame(currentMode);
  game = new Chess();
  playerColor = assignNextColor();
  applyNormalBoardOrientation();
  lastMoveFrom = null;
  lastMoveTo = null;
  updateLiveOpeningIndicators(game);
  resetClocks();
  saveCurrentGame();

  closeOverlay();
  clearTurnTags();
  renderBoard();
  renderMoveList();
  updateStatusForTurn();
  updateClockDisplays();

  if (game.turn() !== playerColor) runMaiaTurn();
}
window.newGameCurrentMode = newGameCurrentMode;

function resign() {
  if (inPuzzleMode || isGameLocked()) return;
  gameResigned = true;
  resignedBy = playerColor;
  maiaThinking = false;
  premoves = [];
  saveCurrentGame();
  statusEl.classList.add("status-hidden");
  clearTurnTags();
  showGameOverPopup();
}
window.resign = resign;

// ---------- Board rendering ----------
function pieceImage(piece) {
  return `./images/pieces/${piece.type}${piece.color}.png`;
}

let draggingSquare = null;
const boardAnnotations = [];
let annotationPreview = null;

function annotationPoint(square) {
  const file = square.charCodeAt(0) - 97;
  const rank = Number(square[1]);
  const col = boardFlipped ? 7 - file : file;
  const row = boardFlipped ? rank - 1 : 8 - rank;
  return { x: (col + 0.5) * 12.5, y: (row + 0.5) * 12.5 };
}

function renderBoardAnnotations() {
  const previous = boardEl.querySelector(".board-annotations");
  if (previous) previous.remove();
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("class", "board-annotations");
  svg.setAttribute("viewBox", "0 0 100 100");
  svg.innerHTML = '<defs><marker id="annotation-arrowhead" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto" markerUnits="strokeWidth"><path d="M0,0 L6,3 L0,6 Z" fill="#e53935" stroke="none" /></marker><marker id="line-arrowhead-1" class="line-arrow-1" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto" markerUnits="strokeWidth"><path d="M0,0 L6,3 L0,6 Z" /></marker><marker id="line-arrowhead-stockfish" class="line-arrow-stockfish" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto" markerUnits="strokeWidth"><path d="M0,0 L6,3 L0,6 Z" /></marker></defs>';
  for (const mark of [...boardAnnotations, ...(annotationPreview ? [{ ...annotationPreview, preview: true }] : [])]) {
    const from = annotationPoint(mark.from);
    if (mark.to) {
      const to = annotationPoint(mark.to);
      const fileDelta = Math.abs(mark.from.charCodeAt(0) - mark.to.charCodeAt(0));
      const rankDelta = Math.abs(Number(mark.from[1]) - Number(mark.to[1]));
      const segments = fileDelta * rankDelta === 2
        ? (mark.bend === "vertical"
            ? [[from, { x: from.x, y: to.y }], [{ x: from.x, y: to.y }, to]]
            : [[from, { x: to.x, y: from.y }], [{ x: to.x, y: from.y }, to]])
        : [[from, to]];
      for (const [start, end] of segments) {
        const line = document.createElementNS(svg.namespaceURI, "path");
        line.setAttribute("d", `M ${start.x} ${start.y} L ${end.x} ${end.y}`);
        line.setAttribute("marker-end", "url(#annotation-arrowhead)");
        if (mark.preview) line.setAttribute("class", "annotation-preview");
        svg.appendChild(line);
      }
    } else {
      const circle = document.createElementNS(svg.namespaceURI, "circle");
      circle.setAttribute("cx", from.x);
      circle.setAttribute("cy", from.y);
      circle.setAttribute("r", "5.2");
      if (mark.preview) circle.setAttribute("class", "annotation-preview");
      svg.appendChild(circle);
    }
  }
  if (inReplayMode) {
    const arrows = [
      { move: replayRankedLines[0]?.pv?.[0], className: "engine-arrow engine-arrow-1", marker: "line-arrowhead-1" },
      { move: replayStockfishBestLine?.pv?.[0], className: "engine-arrow engine-arrow-stockfish", marker: "line-arrowhead-stockfish" },
    ];
    for (const item of arrows) {
      const move = item.move;
      if (!move || move.length < 4) continue;
      const from = annotationPoint(move.slice(0, 2));
      const to = annotationPoint(move.slice(2, 4));
      const arrow = document.createElementNS(svg.namespaceURI, "path");
      arrow.setAttribute("d", `M ${from.x} ${from.y} L ${to.x} ${to.y}`);
      arrow.setAttribute("class", item.className);
      arrow.setAttribute("marker-end", `url(#${item.marker})`);
      svg.appendChild(arrow);
    }
  }
  boardEl.appendChild(svg);
}

function renderBoard() {
  const activeGame =
    inReplayMode && replayGame
      ? replayGame
      : (
          inPuzzleMode
            ? puzzleGame
            : (
                inDrillMode
                  ? drillGame
                  : game
              )
        );
  if (inDrillMode) {
    updateDrillOpeningIndicators();
  } else if (inReplayMode) {
    updateLiveOpeningIndicators(activeGame, replayPlayerColor);
  } else if (!inPuzzleMode) {
    updateLiveOpeningIndicators(activeGame, playerColor);
  }
  boardEl.innerHTML = "";
  const boardData = activeGame === game && premoves.length
    ? getProjectedPremoveBoard()
    : activeGame.board();

  const legalTargets = selectedSquare
    ? activeGame.moves({ square: selectedSquare, verbose: true }).map((m) => m.to)
    : [];

  const rankOrder = boardFlipped
    ? [1, 2, 3, 4, 5, 6, 7, 8]
    : [8, 7, 6, 5, 4, 3, 2, 1];

  const fileOrder = boardFlipped
    ? [7, 6, 5, 4, 3, 2, 1, 0]
    : [0, 1, 2, 3, 4, 5, 6, 7];

  console.log(
    "FLIP:",
    boardFlipped,
    "first square:",
    squareId(fileOrder[0], rankOrder[0]),
    "last square:",
    squareId(fileOrder[7], rankOrder[7])
  );
  
  for (const displayRank of rankOrder) {
    for (const fileIdx of fileOrder) {
      const sq = squareId(fileIdx, displayRank);
      const rowIdx = 8 - displayRank;
      const piece = boardData[rowIdx][fileIdx];

      const cell = document.createElement("div");
      cell.className = "square " + (((fileIdx + displayRank) % 2 === 0) ? "light" : "dark");
      cell.dataset.square = sq;

      if (fileIdx === fileOrder[0]) {
        const rankLabel = document.createElement("span");
        rankLabel.className = "square-coordinate rank-label";
        rankLabel.textContent = String(displayRank);
        cell.appendChild(rankLabel);
      }
      if (displayRank === rankOrder[rankOrder.length - 1]) {
        const fileLabel = document.createElement("span");
        fileLabel.className = "square-coordinate file-label";
        fileLabel.textContent = sq[0];
        cell.appendChild(fileLabel);
      }
      
      if (sq === selectedSquare) cell.classList.add("selected");
      if (premoves.some((move) => sq === move.from || sq === move.to)) {
        cell.classList.add("premove-square");
      }
      
      if (hintSquares.includes(sq)) {
        cell.classList.add("hint-highlight");
      }
      
      if (sq === lastMoveFrom || sq === lastMoveTo) cell.classList.add("last-move");
      
      if (legalTargets.includes(sq)) {
        cell.classList.add("legal-target");
        if (piece) cell.classList.add("has-piece");
      }

      if (piece && sq !== draggingSquare) {
        const img = document.createElement("img");
        img.src = pieceImage(piece);
        img.className = "piece";
        img.draggable = false;
        cell.appendChild(img);
      }

      if (inReplayMode && replayIndex > 0 && sq === lastMoveTo) {
        const lastMoveRating = replayAnalysis[replayIndex - 1]?.classification;
        if (lastMoveRating) {
          const badge = document.createElement("img");
          badge.src = `./images/ratings/${lastMoveRating}.png`;
          badge.className = "piece-rating-badge";
          badge.alt = `${lastMoveRating} move`;
          const moveGrade = replayAnalysis[replayIndex - 1];
          const chance = moveGrade?.moveProbability;
          const swing = moveGrade?.deltaPct;
          badge.title = [
            lastMoveRating,
            Number.isFinite(chance) ? `Maia thought you would find it ${Math.round(chance * 100)}% of the time` : "Maia likelihood pending",
            Number.isFinite(swing) ? `Stockfish win-chance change ${swing >= 0 ? "+" : ""}${swing.toFixed(1)} points` : "Stockfish comparison pending",
          ].join(" · ");
          badge.draggable = false;
          cell.appendChild(badge);
        }
      }

      boardEl.appendChild(cell);
    }
  }

  renderBoardAnnotations();
  renderCapturedPieces();

  renderReplayEvalBar();
  if (inReplayMode) updateClockDisplays();
}

function renderReplayEvalBar() {
  const meter = document.getElementById("replay-eval-meter");
  const evalBar = document.getElementById("replay-eval-bar");
  if (!meter || !evalBar) return;
  const visible = (inReplayMode && !!replayGame)
    || (inPuzzleMode && !!puzzleGame)
    || (inDrillMode && !!drillGame);
  meter.classList.toggle("hidden", !visible);
  meter.style.display = visible ? "flex" : "none";
}

function renderCapturedPieces() {
  const topTray = document.getElementById("capture-top");
  const bottomTray = document.getElementById("capture-bottom");
  if (!topTray || !bottomTray) return;

  if (inPuzzleMode || inDrillMode) {
    topTray.replaceChildren();
    bottomTray.replaceChildren();
    return;
  }

  const capturedBy = { w: new Map(), b: new Map() };
  const captureHistory = (inReplayMode ? replayGame : game).history({ verbose: true });
  for (const move of captureHistory) {
    if (move.captured) {
      capturedBy[move.color].set(
        move.captured,
        (capturedBy[move.color].get(move.captured) || 0) + 1
      );
    }
  }

  const pieceValue = { p: 1, n: 2, b: 3, r: 4, q: 5 };
  for (const color of ["w", "b"]) {
    const capturedPieceColor = color === "w" ? "b" : "w";
    const colorName = capturedPieceColor === "w" ? "White" : "Black";
    const entries = [...capturedBy[color].entries()]
      .sort(([typeA], [typeB]) => pieceValue[typeA] - pieceValue[typeB]);
    const items = [];
    for (const [type, count] of entries) {
      const pieceName = { p: "pawn", n: "knight", b: "bishop", r: "rook", q: "queen" }[type];
      const item = document.createElement("div");
      item.className = `captured-piece-count piece-${capturedPieceColor === "w" ? "white" : "black"}`;
      item.title = `${count} ${colorName} ${pieceName}${count === 1 ? "" : "s"} captured`;

      const image = document.createElement("img");
      image.src = pieceImage({ type, color: capturedPieceColor });
      image.alt = `${colorName} ${pieceName} captured`;
      image.draggable = false;
      item.appendChild(image);

      if (count > 1) {
        const countLabel = document.createElement("span");
        countLabel.className = "count-badge";
        countLabel.textContent = String(count);
        countLabel.setAttribute("aria-label", String(count));
        item.appendChild(countLabel);
      }
      items.push(item);
    }

    const target = color === (inReplayMode ? replayPlayerColor : playerColor)
      ? bottomTray
      : topTray;
    target.replaceChildren(...items);
  }
}

function updateReplayEvalBar(score, turn) {
  const evalBar = document.getElementById("replay-eval-bar");
  const scoreLabel = document.getElementById("replay-eval-score");
  if (!evalBar || !scoreLabel) return;

  const scoreFromWhite = score.type === "mate"
    ? (score.value > 0 ? 100 : 0)
    : 100 / (1 + Math.exp(-0.00368208 * score.value));
  const whiteChance = Math.max(0, Math.min(100,
    turn === "w" ? scoreFromWhite : 100 - scoreFromWhite
  ));
  const whitePct = Math.round(whiteChance);
  evalBar.querySelector(".eval-bar-white").style.flexBasis = `${whitePct}%`;
  evalBar.querySelector(".eval-bar-black").style.flexBasis = `${100 - whitePct}%`;
  const scoreText = score.type === "mate"
    ? `M${Math.abs(score.value)}`
    : `${score.value > 0 ? "+" : ""}${(score.value / 100).toFixed(1)}`;
  scoreLabel.textContent = score.depth ? `${scoreText} d${score.depth}` : scoreText;
  evalBar.setAttribute("aria-label", `Position evaluation: White ${whitePct} percent, Black ${100 - whitePct} percent`);
  const depthText = score.depth ? ` Stockfish depth ${score.depth}.` : "";
  evalBar.title = `White ${whitePct}% / Black ${100 - whitePct}%.${depthText}`;
}

function analyzeReplayPosition() {
  const runId = ++replayStockfishRun;
  if (!inReplayMode || !replayGame) return;

  const fen = replayGame.fen();
  const turn = replayGame.turn();
  const positionIndex = replayIndex;
  const lineVersion = replayLineVersion;
  const scoreLabel = document.getElementById("replay-eval-score");
  const evaluator = window.stockfishEvaluator;
  replayCandidateLines = [];
  replayRankedLines = [];
  replayStockfishBestLine = null;
  renderBoardAnnotations();
  if (!evaluator) {
    if (scoreLabel) scoreLabel.textContent = "SF !";
    return;
  }
  if (scoreLabel) scoreLabel.textContent = "…";
  renderReplayEvalBar();

  let receivedScore = false;
  const watchdog = setTimeout(() => {
    if (runId !== replayStockfishRun || receivedScore) return;
    if (scoreLabel) {
      scoreLabel.textContent = "SF?";
      scoreLabel.title = "No score from Stockfish. Check whether its worker and stockfish.wasm loaded successfully.";
    }
  }, 25000);

  evaluator.evaluateFenMultiPv(fen, {
    depth: 10,
    count: 5,
    onUpdate: (lines) => {
      if (runId !== replayStockfishRun || !inReplayMode || !lines?.length) return;
      receivedScore = true;
      clearTimeout(watchdog);
      replayCandidateLines = lines;
      replayStockfishBestLine = lines.find((line) => line.multipv === 1) || lines[0];
      updateReplayEvalBar(lines[0], turn);
      recordReplayPositionScore(positionIndex, fen, turn, lines[0], lineVersion);
      renderBoardAnnotations();
    },
  }).then(async (lines) => {
    clearTimeout(watchdog);
    if (runId !== replayStockfishRun || !inReplayMode) return;
    if (!lines?.length) {
      return;
    }
    replayCandidateLines = lines;
    replayStockfishBestLine = lines.find((line) => line.multipv === 1) || lines[0];
    recordReplayPositionScore(positionIndex, fen, turn, replayStockfishBestLine, lineVersion);
    if (runId !== replayStockfishRun || !inReplayMode) return;
    renderBoardAnnotations();

    const ranked = await rankReplayCandidateLines(lines, fen, runId);
    if (runId !== replayStockfishRun || !inReplayMode || !ranked) return;
    replayRankedLines = ranked;
    replayStockfishBestLine = getStockfishSuggestion(ranked[0]);
    renderBoardAnnotations();
  }).catch((error) => {
    clearTimeout(watchdog);
    if (runId === replayStockfishRun) {
      console.error("Could not evaluate replay position with Stockfish:", error);
      if (scoreLabel) {
        scoreLabel.textContent = "SF !";
        scoreLabel.title = error.message;
      }
    }
  });
}

async function rankReplayCandidateLines(lines, fen, runId) {
  await waitForMaia();
  const ranked = [];
  const rating = myRating;
  const evaluationByFen = new Map();

  for (let index = 0; index < lines.length; index++) {
    if (runId !== replayStockfishRun || !inReplayMode) return null;
    const line = lines[index];
    const lineGame = new Chess(fen);
    let probability = 1;
    let plies = 0;

    for (const uci of line.pv.slice(0, 10)) {
      if (runId !== replayStockfishRun || !inReplayMode) return null;
      const positionFen = lineGame.fen();
      if (!evaluationByFen.has(positionFen)) {
        evaluationByFen.set(positionFen, engine.evaluate(lineGame, rating, rating));
      }
      const evaluation = await evaluationByFen.get(positionFen);
      probability *= evaluation.policy[uci] || 0;
      const move = lineGame.move({
        from: uci.slice(0, 2),
        to: uci.slice(2, 4),
        promotion: uci[4] || "q",
      });
      if (!move) break;
      plies++;
    }

    ranked.push({
      ...line,
      probability,
      plies,
    });
  }

  return ranked.sort((a, b) => b.probability - a.probability || a.multipv - b.multipv);
}

function onBoardClick(sq) {
  if (inReplayMode) return onReplaySquareClick(sq);
  if (inPuzzleMode) return onPuzzleSquareClick(sq);
  if (inDrillMode) return onDrillSquareClick(sq);
  return onSquareClick(sq);
}

function onReplaySquareClick(sq) {
  if (!replayGame) return;

  if (selectedSquare === null) {
    if (replayGame.get(sq)) {
      selectedSquare = sq;
      renderBoard();
    }
    return;
  }

  if (sq === selectedSquare) {
    selectedSquare = null;
    renderBoard();
    return;
  }

  const movingPiece = replayGame.get(selectedSquare);
  const promotes = movingPiece?.type === "p" &&
    ((movingPiece.color === "w" && sq[1] === "8") || (movingPiece.color === "b" && sq[1] === "1"));
  let promotion = "q";
  if (promotes) {
    const choice = window.prompt("Promote to queen, rook, bishop, or knight? Enter q, r, b, or n.", "q");
    if (choice === null) {
      selectedSquare = null;
      renderBoard();
      return;
    }
    const normalizedChoice = choice.trim().toLowerCase();
    promotion = /^[qrbn]$/.test(normalizedChoice) ? normalizedChoice : "q";
  }

  const originalNextMove = replayOriginalMoves[replayIndex];
  const followsOriginalLine = originalNextMove &&
    originalNextMove.from === selectedSquare &&
    originalNextMove.to === sq &&
    (originalNextMove.promotion || "") === (promotion === "q" && !promotes ? "" : promotion);
  const startsBranch = !followsOriginalLine && replayBranchStart === null;

  const move = replayGame.move({ from: selectedSquare, to: sq, promotion });
  if (!move) {
    if (replayGame.get(sq)) selectedSquare = sq;
    else selectedSquare = null;
    renderBoard();
    return;
  }

  if (startsBranch) {
    replayBranchStart = replayIndex;
    replayAnalysisRun++;
    replayLineVersion++;
    replayPositionScores = new Map([...replayOriginalPositionScores]
      .filter(([ply]) => ply <= replayBranchStart)
      .map(([ply, position]) => [ply, { ...position, lineVersion: replayLineVersion }]));
  }

  replayMoves = replayGame.history({ verbose: true });
  replayIndex = replayMoves.length;
  if (replayBranchStart !== null) {
    replayMoveFens = captureReplayMoveFens();
    replayMoveMotifs = Array(replayMoves.length).fill(null);
    replayClockHistory = replayOriginalClockHistory.slice(0, replayBranchStart);
    replayAnalysis = Array(replayMoves.length).fill(null);
    const motifRunId = ++replayMotifRun;
    analyzeReplayPlayedMoves(motifRunId);
    analyzeReplayMoves(replayGame.pgn());
  }
  lastMoveFrom = move.from;
  lastMoveTo = move.to;
  selectedSquare = null;
  replayCandidateLines = [];
  replayRankedLines = [];

  renderBoard();
  renderMoveList();
  updateReplayControls();
  analyzeReplayPosition();
}

// ---------- Drag to move ----------
const DRAG_THRESHOLD_PX = 8;

let pointerTrack = null;
let annotationTrack = null;
let lastAnnotationClick = null;
let ghostEl = null;
let dragHoverSq = null;

function pieceIsDraggableAt(sq) {
  if (inReplayMode) return !!replayGame?.get(sq);
  if (inPuzzleMode) {
    if (puzzleLocked || puzzleAwaitingReply || !puzzleGame) return false;
    const piece = puzzleGame.get(sq);
    return !!piece && piece.color === puzzlePlayerColor && puzzleGame.turn() === puzzlePlayerColor;
  }
  if (inDrillMode) {
    if (drillLocked || drillAwaitingReply || !drillGame) return false;
    const piece = drillGame.get(sq);
    return !!piece && piece.color === drillPlayerColor && drillGame.turn() === drillPlayerColor;
  }
  if (isGameLocked()) return false;
  const piece = game.get(sq);
  return !!piece && piece.color === playerColor &&
    (game.turn() === playerColor || (maiaThinking && game.turn() !== playerColor));
}

function squareFromPoint(x, y) {
  const el = document.elementFromPoint(x, y);
  const cell = el && el.closest ? el.closest(".square") : null;
  return cell ? cell.dataset.square : null;
}

function createGhost(sq, x, y) {
  const activeGame = inReplayMode ? replayGame : (inPuzzleMode ? puzzleGame : (inDrillMode ? drillGame : game));
  const piece = activeGame.get(sq);
  if (!piece) return;

  ghostEl = document.createElement("img");
  ghostEl.src = pieceImage(piece);
  ghostEl.className = "drag-ghost";
  const size = boardEl.getBoundingClientRect().width / 8;
  ghostEl.style.width = size + "px";
  ghostEl.style.height = size + "px";
  document.body.appendChild(ghostEl);
  moveGhost(x, y);
}

function moveGhost(x, y) {
  if (!ghostEl) return;
  const half = ghostEl.getBoundingClientRect().width / 2;
  ghostEl.style.transform = `translate(${x - half}px, ${y - half}px)`;
}

function removeGhost() {
  if (ghostEl) {
    ghostEl.remove();
    ghostEl = null;
  }
}

function setDragHover(sq) {
  if (dragHoverSq === sq) return;
  const prev = boardEl.querySelector('.square.drag-hover');
  if (prev) prev.classList.remove("drag-hover");
  dragHoverSq = sq;
  if (sq) {
    const cell = boardEl.querySelector(`.square[data-square="${sq}"]`);
    if (cell) cell.classList.add("drag-hover");
  }
}

boardEl.addEventListener("pointerdown", (e) => {
  const cell = e.target.closest(".square");
  if (!cell) return;
  const sq = cell.dataset.square;

  if (e.button === 2) {
    e.preventDefault();
    annotationTrack = { pointerId: e.pointerId, from: sq, to: sq, startX: e.clientX, startY: e.clientY, dragging: false, bend: null };
    annotationPreview = { from: sq };
    return;
  }
  if (e.button !== 0) return;

  pointerTrack = {
    pointerId: e.pointerId,
    startSq: sq,
    startX: e.clientX,
    startY: e.clientY,
    isDraggable: pieceIsDraggableAt(sq),
    dragging: false,
  };
});

boardEl.addEventListener("contextmenu", (e) => e.preventDefault());

document.addEventListener("pointermove", (e) => {
  if (annotationTrack && e.pointerId === annotationTrack.pointerId) {
    const target = squareFromPoint(e.clientX, e.clientY);
    const moved = Math.hypot(e.clientX - annotationTrack.startX, e.clientY - annotationTrack.startY) >= DRAG_THRESHOLD_PX;
    if (moved && !annotationTrack.dragging) {
      annotationTrack.dragging = true;
      annotationTrack.bend = Math.abs(e.clientX - annotationTrack.startX) >= Math.abs(e.clientY - annotationTrack.startY)
        ? "horizontal"
        : "vertical";
    }
    if (annotationTrack.dragging && target) {
      annotationTrack.to = target;
      annotationPreview = { from: annotationTrack.from, to: target, bend: annotationTrack.bend, preview: true };
      renderBoardAnnotations();
    }
    e.preventDefault();
    return;
  }
  if (!pointerTrack || e.pointerId !== pointerTrack.pointerId) return;

  const dx = e.clientX - pointerTrack.startX;
  const dy = e.clientY - pointerTrack.startY;

  if (!pointerTrack.dragging) {
    if (!pointerTrack.isDraggable) return;
    if (Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;

    pointerTrack.dragging = true;
    draggingSquare = pointerTrack.startSq;
    selectedSquare = pointerTrack.startSq;
    renderBoard();
    createGhost(pointerTrack.startSq, e.clientX, e.clientY);
  }

  e.preventDefault();
  moveGhost(e.clientX, e.clientY);
  setDragHover(squareFromPoint(e.clientX, e.clientY));
}, { passive: false });

function endPointerTrack(e) {
  if (annotationTrack && e.pointerId === annotationTrack.pointerId) {
    const mark = annotationTrack;
    annotationTrack = null;
    annotationPreview = null;
    const target = squareFromPoint(e.clientX, e.clientY);
    if (mark.dragging && target && target !== mark.from) {
      lastAnnotationClick = null;
      const index = boardAnnotations.findIndex((item) => item.from === mark.from && item.to === target);
      if (index >= 0) boardAnnotations.splice(index, 1);
      else boardAnnotations.push({ from: mark.from, to: target, bend: mark.bend });
    } else {
      const now = Date.now();
      if (target && lastAnnotationClick?.square === target && now - lastAnnotationClick.time <= 500) {
        boardAnnotations.length = 0;
        lastAnnotationClick = null;
        renderBoardAnnotations();
        e.preventDefault();
        return;
      }
      lastAnnotationClick = target ? { square: target, time: now } : null;
      const index = boardAnnotations.findIndex((item) => item.from === mark.from && !item.to);
      if (index >= 0) boardAnnotations.splice(index, 1);
      else boardAnnotations.push({ from: mark.from });
    }
    renderBoardAnnotations();
    e.preventDefault();
    return;
  }
  if (!pointerTrack || e.pointerId !== pointerTrack.pointerId) return;
  const track = pointerTrack;
  pointerTrack = null;

  if (track.dragging) {
    removeGhost();
    setDragHover(null);
    draggingSquare = null;
    const dropSq = squareFromPoint(e.clientX, e.clientY);

    if (!dropSq || dropSq === track.startSq) {
      renderBoard();
    } else {
      onBoardClick(dropSq);
    }
  } else {
    onBoardClick(track.startSq);
  }
}

document.addEventListener("pointerup", endPointerTrack);
document.addEventListener("pointercancel", (e) => {
  if (annotationTrack && e.pointerId === annotationTrack.pointerId) {
    annotationTrack = null;
    annotationPreview = null;
    renderBoardAnnotations();
    return;
  }
  if (!pointerTrack || e.pointerId !== pointerTrack.pointerId) return;
  removeGhost();
  setDragHover(null);
  draggingSquare = null;
  pointerTrack = null;
  renderBoard();
});

// ---------- Real move list ----------
function renderMoveList() {
  const activeGame =
    inReplayMode && replayGame
      ? replayGame
      : (
          inPuzzleMode
            ? puzzleGame
            : (
                inDrillMode
                  ? drillGame
                  : game
              )
        );
  const history = inReplayMode
    ? replayMoves.map((move) => move.san)
    : activeGame ? activeGame.history() : [];
  moveListEl.replaceChildren();
  history.forEach((san, index) => {
    if (index % 2 === 0) {
      const number = document.createElement("span");
      number.className = "movenum";
      number.textContent = `${Math.floor(index / 2) + 1}.`;
      moveListEl.appendChild(number);
      moveListEl.appendChild(document.createTextNode(" "));
    }

    const move = document.createElement("span");
    move.className = "move";
    const selectedReplayMove = replayIndex > 0 ? replayIndex - 1 : 0;
    if (inReplayMode && index === selectedReplayMove) {
      move.classList.add("replay-current-move");
      move.setAttribute("aria-current", "step");
    }
    move.textContent = san;
    moveListEl.append(move, document.createTextNode(" "));
  });
  const scrollParent = moveListEl.closest(".moves");
  if (scrollParent && inReplayMode) {
    const selectedReplayMove = replayIndex > 0 ? replayIndex - 1 : 0;
    if (selectedReplayMove < 3) {
      scrollParent.scrollLeft = 0;
    } else {
      const moves = moveListEl.querySelectorAll(".move");
      const firstVisibleMove = moves[selectedReplayMove - 2];
      if (firstVisibleMove) {
        scrollParent.scrollLeft += firstVisibleMove.getBoundingClientRect().left -
          scrollParent.getBoundingClientRect().left;
      }
    }
  } else if (scrollParent) {
    scrollParent.scrollLeft = scrollParent.scrollWidth;
  }
}

function renderReplayMoveInsights() {
  const panel = document.getElementById("review-insights-panel");
  if (!panel) return;
  panel.replaceChildren();
  panel.classList.add("hidden");
  if (!inReplayMode) return;
  const moveIndex = replayIndex > 0 ? replayIndex - 1 : 0;
  if (!replayMoves[moveIndex]) return;
  const motifs = replayMoveMotifs[moveIndex];
  renderMotifInsightPanel(panel, motifs, motifs == null ? "Analyzing..." : "");
}

function renderMotifInsightPanel(panel, motifs, pendingText = "", errorText = "") {
  const prosLine = document.createElement("div");
  prosLine.className = "review-insight-pro";
  prosLine.textContent = "Pros: None identified";
  const consLine = document.createElement("div");
  consLine.className = "review-insight-con";
  consLine.textContent = "Cons: None identified";

  if (errorText) {
    prosLine.textContent = "Pros: —";
    consLine.textContent = `Cons: ${errorText}`;
  } else if (pendingText) {
    prosLine.textContent = `Pros: ${pendingText}`;
    consLine.textContent = `Cons: ${pendingText}`;
  } else if (Array.isArray(motifs)) {
    const pros = [];
    const cons = [];
    for (const motif of motifs) {
      if (NEUTRAL_MOTIF_IDS.has(motif.id)) continue;
      const label = motif.id === "hangs"
        ? (motif.phrase || motif.label || "Hangs").replace(/^Hangs:\s*/i, "")
        : (motif.label || motif.id).replace(/:.*/, "").trim();
      (NEGATIVE_MOTIF_IDS.has(motif.id) ? cons : pros).push(label);
    }
    prosLine.textContent = `Pros: ${pros.join(", ") || "None identified"}`;
    consLine.textContent = `Cons: ${cons.join(", ") || "None identified"}`;
  }

  panel.replaceChildren(prosLine, consLine);
  panel.classList.remove("hidden");
}

function renderOpeningDrillInsightsPrompt() {
  const panel = document.getElementById("review-insights-panel");
  if (!panel) return;
  if (openingDrillDisplayedMoveIndex === null) {
    renderMotifInsightPanel(panel, null, "Analyzing the next move...");
  } else {
    const result = openingDrillMoveMotifs.get(openingDrillDisplayedMoveIndex);
    if (!result) {
      renderMotifInsightPanel(panel, null, "Analyzing the next move...");
    } else if (result.error) {
      renderMotifInsightPanel(panel, null, "", "Next-move analysis unavailable.");
    } else {
      renderMotifInsightPanel(panel, result.motifs);
    }
  }
  if (drillOutOfLine) {
    const notice = panel.children[1];
    if (notice) {
      notice.textContent = "Outside of this specific opening line";
      notice.classList.add("review-insight-out-of-line");
    }
  }
}

function analyzeNextOpeningDrillMove() {
  if (!inDrillMode || !drillGame || drillAwaitingReply) return;
  const solutionIndex = drillSolutionIndex;
  const uci = drillSolution[solutionIndex];
  if (!uci || drillGame.turn() !== drillPlayerColor) {
    openingDrillDisplayedMoveIndex = null;
    renderMotifInsightPanel(
      document.getElementById("review-insights-panel"),
      null,
      "Variant complete."
    );
    return;
  }

  openingDrillDisplayedMoveIndex = solutionIndex;
  renderOpeningDrillInsightsPrompt();
  if (openingDrillMoveMotifs.has(solutionIndex)) return;
  void analyzeOpeningDrillMove(
    drillGame.fen(),
    uci,
    solutionIndex,
    openingDrillAnalysisRun
  );
}

async function analyzeOpeningDrillMove(fen, uci, solutionIndex, analysisRun) {
  try {
    const result = await window.analyzePositionalChessMove(fen, uci);
    if (analysisRun !== openingDrillAnalysisRun) return;
    if (!result || result.error) {
      throw new Error(result?.error || "The positional move analyzer returned no result.");
    }
    openingDrillMoveMotifs.set(solutionIndex, { motifs: result.motifs || [] });
    if (inDrillMode && openingDrillDisplayedMoveIndex === solutionIndex) {
      renderOpeningDrillInsightsPrompt();
    }
  } catch (error) {
    if (analysisRun !== openingDrillAnalysisRun) return;
    console.error("Could not analyze opening drill move:", error);
    openingDrillMoveMotifs.set(solutionIndex, { error });
    if (inDrillMode && openingDrillDisplayedMoveIndex === solutionIndex) {
      renderOpeningDrillInsightsPrompt();
    }
  }
}

// ---------- Move classification ----------
function classifyMoveGeneric({ preValue, postValue, moveUci, preTopMove, preMoveProb, moverColor, wasMate, skipTopMatch }) {
  const delta = moverColor === "w" ? postValue - preValue : preValue - postValue;
  const deltaPct = delta * 100;

  if (wasMate) return "best";
  if (preMoveProb < 0.05 && deltaPct >= 12) return "brilliant";
  if (!skipTopMatch && moveUci === preTopMove) return "best";
  if (deltaPct <= -20) return "blunder";
  if (deltaPct <= -10) return "mistake";
  if (preMoveProb < 0.05 && deltaPct <= -4) return "miss";
  if (deltaPct <= -3) return "inaccuracy";
  if (deltaPct >= 8) return "excellent";
  if (deltaPct >= 3) return "great";
  return "good";
}

function resolvePendingMaiaGrading(currentPositionValue) {
  if (!pendingMaiaGrading) return;
  const {
    preMoveValue,
    color,
    moveNumber,
    moveUci,
    preMoveProb,
    isBookMove,
    bookSignature,
  } = pendingMaiaGrading;
  const label = isBookMove || openingBookPrefixes.has(bookSignature)
    ? "book"
    : classifyMoveGeneric({
        preValue: preMoveValue,
        postValue: currentPositionValue,
        moveUci,
        preTopMove: null,
        preMoveProb,
        moverColor: color,
        wasMate: false,
        skipTopMatch: true,
      });
  maiaMoveStatsObj[label]++;
  pendingMaiaGrading = null;
}

// ---------- Maia's turn ----------
// ---------- Maia's turn ----------
async function runMaiaTurn() {

  // Maia should only move during a normal game.
  if (
    inPuzzleMode ||
    inDrillMode ||
    maiaThinking ||
    isGameLocked() ||
    game.turn() === playerColor
  ) {
    return;
  }

  const myToken = gameToken;

  maiaThinking = true;
  updateStatusForTurn();

  try {

    // ==================================================
    // WAIT FOR MAIA
    // ==================================================
    if (!maiaReady || !engine) {

      statusEl.textContent = "Maia is loading...";
      statusEl.classList.remove("status-hidden");

      await waitForMaia();
    }

    // ==================================================
    // MAKE SURE THE GAME STILL EXISTS
    // ==================================================
    if (myToken !== gameToken) {
      return;
    }

    if (
      inPuzzleMode ||
      inDrillMode ||
      isGameLocked() ||
      game.turn() === playerColor
    ) {
      return;
    }

    if (!maiaReady || !engine) {
      throw new Error(
        "Maia is not ready."
      );
    }

    // ==================================================
    // SAVE MAIA'S POSITION
    // ==================================================
    const maiaColor = game.turn();

    const moveNumber =
      Math.floor(game.history().length / 2) + 1;

    // ==================================================
    // ASK MAIA FOR A MOVE
    // ==================================================
    statusEl.classList.add("status-hidden");

    const [evalResult] = await Promise.all([
      engine.evaluate(
        game,
        MAIA_ELO,
        myRating
      ),
      humanDelay()
    ]);

    // Game changed while Maia was thinking.
    if (myToken !== gameToken) {
      return;
    }

    if (!evalResult) {
      throw new Error(
        "Maia returned no evaluation."
      );
    }

    if (
      !evalResult.policy ||
      Object.keys(evalResult.policy).length === 0
    ) {
      throw new Error(
        "Maia returned no legal moves."
      );
    }

    // ==================================================
    // GET MAIA MOVE
    // ==================================================
    const preMoveValue = evalResult.value;

    const uci =
      Object.keys(evalResult.policy)[0];

    if (!uci || uci.length < 4) {
      throw new Error(
        "Maia returned invalid move: " + uci
      );
    }

    const preMoveProb =
      evalResult.policy[uci] || 0;

    const from = uci.slice(0, 2);
    const to = uci.slice(2, 4);

    const promotion =
      uci.length > 4
        ? uci.slice(4)
        : "q";

    // ==================================================
    // PLAY MOVE
    // ==================================================
    const maiaMoveResult = game.move({
      from,
      to,
      promotion
    });

    if (!maiaMoveResult) {
      throw new Error(
        "Maia returned an illegal move: " + uci
      );
    }

    lastMoveFrom = from;
    lastMoveTo = to;
    clockLastTick = performance.now();
    recordMoveClockSnapshot();

    playGameSound(
      soundForMove(
        game,
        maiaMoveResult
      )
    );

    updateClockUnlocks();

    renderBoard();
    renderMoveList();
    updateClockDisplays();

    saveCurrentGame();

    // ==================================================
    // GRADE / SAVE MAIA MOVE
    // ==================================================
    if (game.game_over()) {

      if (game.in_checkmate()) {
        maiaMoveStatsObj.best++;
      }

      pendingMaiaGrading = null;

    } else {

      pendingMaiaGrading = {
        preMoveValue,
        color: maiaColor,
        moveNumber,
        moveUci: uci,
        preMoveProb
      };
    }

    // ==================================================
    // GAME OVER
    // ==================================================
    if (game.game_over()) {

      clearTurnTags();
      showGameOverPopup();
    }

  } catch (err) {

    console.error(
      "Maia turn error:",
      err
    );

    if (myToken === gameToken) {

      statusEl.textContent =
        "Maia failed to move — check console.";

      statusEl.classList.remove(
        "status-hidden"
      );
    }

  } finally {

    if (myToken === gameToken) {

      maiaThinking = false;

      if (!isGameLocked()) {
        updateStatusForTurn();
      }
      if (premoves.length && !isGameLocked() && game.turn() === playerColor) {
        setTimeout(() => executeQueuedPremove(myToken), 100);
      } else if (isGameLocked()) {
        premoves = [];
        renderBoard();
      }
    }
  }
}

function handlePremoveClick(sq) {
  const piece = getProjectedPremovePiece(sq);
  if (selectedSquare === null) {
    if (piece && piece.color === playerColor) selectedSquare = sq;
    renderBoard();
    return;
  }

  if (sq === selectedSquare) {
    selectedSquare = null;
  } else {
    premoves.push({ from: selectedSquare, to: sq });
    selectedSquare = null;
  }
  renderBoard();
}

function getProjectedPremovePiece(square) {
  return getProjectedPremovePieces().get(square) || null;
}

function getProjectedPremovePieces() {
  const projected = new Map();
  const board = game.board();
  for (let row = 0; row < 8; row++) {
    for (let file = 0; file < 8; file++) {
      const piece = board[row][file];
      if (piece) projected.set(squareId(file, 8 - row), piece);
    }
  }

  for (const move of premoves) {
    const movingPiece = projected.get(move.from);
    if (!movingPiece) continue;
    projected.delete(move.from);
    projected.set(move.to, movingPiece);
  }
  return projected;
}

function getProjectedPremoveBoard() {
  const projected = getProjectedPremovePieces();
  return Array.from({ length: 8 }, (_, row) =>
    Array.from({ length: 8 }, (_, file) => projected.get(squareId(file, 8 - row)) || null)
  );
}

async function executeQueuedPremove(expectedGameToken) {
  if (!premoves.length) return;
  if (expectedGameToken !== gameToken || isGameLocked() || game.turn() !== playerColor) {
    premoves = [];
    renderBoard();
    return;
  }

  const queued = premoves.shift();
  selectedSquare = null;
  renderBoard();
  const moveCount = game.history().length;
  await onSquareClick(queued.from);
  await onSquareClick(queued.to);
  if (game.history().length === moveCount) {
    premoves = [];
    selectedSquare = null;
    renderBoard();
  }
}

function cancelAllPremoves() {
  if (!premoves.length && selectedSquare === null) return;
  premoves = [];
  selectedSquare = null;
  renderBoard();
}

boardEl.addEventListener("dblclick", (event) => {
  if (inReplayMode || inPuzzleMode || inDrillMode) return;
  const hasPendingSelection = game.turn() !== playerColor && selectedSquare !== null;
  if (!premoves.length && !hasPendingSelection) return;
  cancelAllPremoves();
  event.preventDefault();
});

// ---------- Player's turn ----------
async function onSquareClick(sq) {

  // ==================================================
  // BASIC SAFETY CHECKS
  // ==================================================
  if (isGameLocked()) {
    return;
  }

  if (game.turn() !== playerColor) {
    handlePremoveClick(sq);
    return;
  }

  if (maiaThinking) {
    handlePremoveClick(sq);
    return;
  }

  // ==================================================
  // SELECT PIECE
  // ==================================================
  if (selectedSquare === null) {

    const piece = game.get(sq);

    if (piece && piece.color === playerColor) {
      selectedSquare = sq;
      renderBoard();
    }

    return;
  }

  // ==================================================
  // DESELECT PIECE
  // ==================================================
  if (sq === selectedSquare) {
    selectedSquare = null;
    renderBoard();
    return;
  }

  // ==================================================
  // SAVE POSITION BEFORE PLAYER MOVE
  // ==================================================
  const from = selectedSquare;
  const to = sq;

  const preFen = game.fen();

  const moverColor = playerColor;

  const moveNumber =
    Math.floor(game.history().length / 2) + 1;

  // ==================================================
  // TRY PLAYER MOVE
  // ==================================================
  const moveResult = game.move({
    from,
    to,
    promotion: "q"
  });

  selectedSquare = null;

  // ==================================================
  // ILLEGAL MOVE
  // ==================================================
  if (!moveResult) {

    const piece = game.get(sq);

    if (piece && piece.color === playerColor) {
      selectedSquare = sq;
    }

    renderBoard();
    return;
  }

  const playerMoveIsBook = isOpeningBookMove(game);
  const playerMoveBookSignature = getOpeningMoveSignature(getLiveGameUciHistory(game));
  recordCompletedOpeningAchievements(game);
  updateLiveOpeningIndicators(game);

  // ==================================================
  // PLAYER MOVE SUCCESSFUL
  // ==================================================
  lastMoveFrom = from;
  lastMoveTo = to;
  clockLastTick = performance.now();
  recordMoveClockSnapshot();

  playGameSound(
    soundForMove(
      game,
      moveResult
    )
  );

  updateClockUnlocks();

  renderBoard();
  renderMoveList();
  saveCurrentGame();

  // ==================================================
  // CHECK WHETHER PLAYER ENDED THE GAME
  // ==================================================
  const wasMate = game.in_checkmate();

  const otherGameEnd =
    !wasMate && game.game_over();

  if (otherGameEnd) {

    pendingMaiaGrading = null;

    clearTurnTags();

    showGameOverPopup();

    return;
  }

  // ==================================================
  // CREATE A TOKEN FOR THIS TURN
  // ==================================================
  const myToken = gameToken;

  const promotion =
    moveResult.promotion
      ? moveResult.promotion
      : "";

  const moveUci =
    from + to + promotion;

  // Maia is now processing the response.
  maiaThinking = true;
  let retryMaiaMove = false;

  updateStatusForTurn();

  try {

    // ==================================================
    // WAIT FOR MAIA IF IT IS STILL LOADING
    // ==================================================
    if (!maiaReady || !engine) {

      statusEl.textContent =
        "Maia is loading...";

      statusEl.classList.remove(
        "status-hidden"
      );

      // Make sure initialization has started.
      if (!maiaLoading && !maiaLoadError) {
        initializeMaiaInBackground();
      }

      // Wait until Maia AND the engine are ready.
      while (
        (!maiaReady || !engine) &&
        !maiaLoadError
      ) {

        // User started a new game/mode.
        if (myToken !== gameToken) {
          return;
        }

        // Wait 100ms before checking again.
        await new Promise(
          resolve => setTimeout(resolve, 100)
        );
      }
    }

    // ==================================================
    // MAIA LOAD FAILURE
    // ==================================================
    if (maiaLoadError) {
      throw maiaLoadError;
    }

    if (!maiaReady || !engine) {
      throw new Error(
        "Maia is not ready and no usable engine exists."
      );
    }

    // ==================================================
    // CHECK THAT THIS IS STILL THE SAME GAME
    // ==================================================
    if (myToken !== gameToken) {
      return;
    }

    // ==================================================
    // EVALUATE THE POSITION BEFORE THE PLAYER MOVE
    // AND THE POSITION AFTER THE PLAYER MOVE
    // ==================================================
    const preEvalPromise =
      engine.evaluate(
        new Chess(preFen),
        myRating,
        MAIA_ELO
      );

    const postEvalPromise =
      wasMate
        ? Promise.resolve(null)
        : engine.evaluate(
            game,
            MAIA_ELO,
            myRating
          );

    // Human-like delay is separate so the results are
    // easy to understand and there is no destructuring bug.
    const [preEval, postEval] =
      await Promise.all([
        preEvalPromise,
        postEvalPromise
      ]);

    await humanDelay();

    // ==================================================
    // CHECK GAME TOKEN AGAIN
    // ==================================================
    if (myToken !== gameToken) {
      return;
    }

    // ==================================================
    // GRADE PREVIOUS MAIA MOVE
    // ==================================================
    resolvePendingMaiaGrading(
      preEval.value
    );

    // ==================================================
    // FIND BEST/PREFERRED MOVE
    // ==================================================
    const preTopMove =
      Object.keys(
        preEval.policy
      )[0];

    const preMoveProb =
      preEval.policy[moveUci] || 0;

    // ==================================================
    // PLAYER CHECKMATE
    // ==================================================
    if (wasMate) {

      playerMoveStats.best++;

    } else {

      // ==================================================
      // GRADE PLAYER'S MOVE
      // ==================================================
      const label = playerMoveIsBook || openingBookPrefixes.has(playerMoveBookSignature)
        ? "book"
        : classifyMoveGeneric({
          preValue: preEval.value,
          postValue: postEval.value,
          moveUci: moveUci,
          preTopMove: preTopMove,
          preMoveProb: preMoveProb,
          moverColor: moverColor,
          wasMate: false,
          skipTopMatch: false
        });

      playerMoveStats[label]++;

      // ==================================================
      // MAIA'S TURN
      // ==================================================
      const maiaColor =
        game.turn();

      const maiaMoveNumber =
        Math.floor(
          game.history().length / 2
        ) + 1;

      const maiaPreMoveValue =
        postEval.value;

      const maiaUci =
        Object.keys(
          postEval.policy
        )[0];

      if (!maiaUci || maiaUci.length < 4) {
        throw new Error(
          "Maia returned no valid move after player move."
        );
      }

      const maiaPreMoveProb =
        postEval.policy[maiaUci] || 0;

      const mFrom =
        maiaUci.slice(0, 2);

      const mTo =
        maiaUci.slice(2, 4);

      const mPromo =
        maiaUci.length > 4
          ? maiaUci.slice(4)
          : "q";

      // ==================================================
      // PLAY MAIA'S MOVE
      // ==================================================
      const maiaInlineResult =
        game.move({
          from: mFrom,
          to: mTo,
          promotion: mPromo
        });

      if (!maiaInlineResult) {

        throw new Error(
          "Maia returned an illegal move: " +
          maiaUci
        );
      }

      const maiaMoveIsBook = isOpeningBookMove(game);
      const maiaMoveBookSignature = getOpeningMoveSignature(getLiveGameUciHistory(game));
      recordCompletedOpeningAchievements(game);
      updateLiveOpeningIndicators(game);

      lastMoveFrom = mFrom;
      lastMoveTo = mTo;
      clockLastTick = performance.now();
      recordMoveClockSnapshot();

      playGameSound(
        soundForMove(
          game,
          maiaInlineResult
        )
      );

      updateClockUnlocks();

      renderBoard();
      renderMoveList();

      saveCurrentGame();

      // ==================================================
      // CHECK WHETHER MAIA WON BY CHECKMATE
      // ==================================================
      if (
        game.game_over() &&
        game.in_checkmate()
      ) {

        maiaMoveStatsObj.best++;

        pendingMaiaGrading = null;

      } else if (!game.game_over()) {

        // Save Maia's move so the next player move
        // can grade it.
        pendingMaiaGrading = {
          preMoveValue:
            maiaPreMoveValue,

          color:
            maiaColor,

          moveNumber:
            maiaMoveNumber,

          moveUci:
            maiaUci,

          preMoveProb:
            maiaPreMoveProb,

          isBookMove:
            maiaMoveIsBook,

          bookSignature:
            maiaMoveBookSignature
        };
      }
    }

    // ==================================================
    // CHECK GAME OVER
    // ==================================================
    if (game.game_over()) {

      clearTurnTags();

      showGameOverPopup();
    }

  } catch (err) {

    console.error(
      "Player/Maia turn error:",
      err
    );

    if (myToken === gameToken) {
      retryMaiaMove = !maiaLoadError
        && !isGameLocked()
        && game.turn() !== playerColor;

      statusEl.textContent =
        "Maia had an error — check the console.";

      statusEl.classList.remove(
        "status-hidden"
      );
    }

  } finally {

    // ==================================================
    // ALWAYS RELEASE MAIA THINKING STATE
    // ==================================================
    if (myToken === gameToken) {

      maiaThinking = false;

      if (!game.game_over()) {
        updateStatusForTurn();
      }
      if (premoves.length && !isGameLocked() && game.turn() === playerColor) {
        setTimeout(() => executeQueuedPremove(myToken), 100);
      } else if (isGameLocked() && premoves.length) {
        premoves = [];
        renderBoard();
      }
    }
  }

  if (retryMaiaMove && myToken === gameToken) {
    setTimeout(() => runMaiaTurn(), 0);
  }
}

// ---------- Game-over popup ----------
function getResultText() {
  if (gameTimedOut) {
    const winner = timedOutColor === "w" ? "Black" : "White";
    return { title: winner + " wins", sub: "on time" };
  }
  if (gameResigned) {
    const winner = resignedBy === "w" ? "Black" : "White";
    return { title: winner + " wins", sub: "by resignation" };
  }
  if (game.in_checkmate()) {
    const winner = game.turn() === "w" ? "Black" : "White";
    return { title: winner + " wins", sub: "by checkmate" };
  }
  if (game.in_stalemate()) return { title: "Draw", sub: "by stalemate" };
  if (game.in_threefold_repetition()) return { title: "Draw", sub: "by repetition" };
  if (typeof game.insufficient_material === "function" && game.insufficient_material()) {
    return { title: "Draw", sub: "insufficient material" };
  }
  if (game.in_draw()) return { title: "Draw", sub: "" };
  return { title: "Game Over", sub: "" };
}

const STAT_LABELS = [
  ["brilliant", "Brilliant"], ["great", "Great"], ["book", "Book"], ["best", "Best"],
  ["excellent", "Excellent"], ["good", "Good"], ["inaccuracy", "Inaccuracy"],
  ["mistake", "Mistake"], ["miss", "Miss"], ["blunder", "Blunder"],
];
const POSITIVE_KEYS = ["brilliant", "great", "book", "best", "excellent", "good"];

function computeAccuracy(stats) {
  const total = STAT_LABELS.reduce((sum, [key]) => sum + stats[key], 0);
  if (total === 0) return null;
  const positive = POSITIVE_KEYS.reduce((sum, key) => sum + stats[key], 0);
  return Math.round((positive / total) * 100);
}

function buildStatsList(container, stats) {
  container.innerHTML = "";
  for (const [key, label] of STAT_LABELS) {
    const count = stats[key];
    if (count === 0) continue;
    const row = document.createElement("div");
    row.className = "stat-line";
    row.innerHTML = `<span>${label}</span><span class="num">${count}</span>`;
    container.appendChild(row);
  }
  if (container.children.length === 0) {
    const row = document.createElement("div");
    row.className = "stat-line";
    row.innerHTML = `<span>No moves yet</span>`;
    container.appendChild(row);
  }
}

const HISTORY_KEY = "chess_history";

function loadHistory() {
  try {
    return JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]");
  } catch (e) {
    return [];
  }
}

function removeUnrankedSavedGames() {
  localStorage.removeItem("chess_game_unrated");
  if (localStorage.getItem("chess_active_mode") === "unrated") {
    localStorage.setItem("chess_active_mode", "rated");
  }
  const rankedHistory = loadHistory().filter((entry) =>
    entry.rated === true || entry.mode === "rated"
  );
  localStorage.setItem(HISTORY_KEY, JSON.stringify(rankedHistory));
}

function pushHistoryEntry() {
  const yourAcc = computeAccuracy(playerMoveStats);
  const maiaAcc = computeAccuracy(maiaMoveStatsObj);

  let resultLabel;
  if (gameTimedOut) {
    resultLabel = timedOutColor === playerColor ? "-30" : "+30";
  } else if (gameResigned) {
    resultLabel = resignedBy === playerColor ? "-30" : "+30";
  } else if (game.in_checkmate()) {
    const winner = game.turn() === "w" ? "b" : "w";
    resultLabel = winner === playerColor ? "+30" : "-30";
  } else {
    resultLabel = "0";
  }

  if (currentMode === "rated") {
    if (resultLabel === "+30") myRating += 30;
    else if (resultLabel === "-30") myRating = Math.max(100, myRating - 30);
    saveMyRating();
    document.getElementById("your-rating").textContent = myRating;
    MAIA_ELO = String(myRating);
    document.getElementById("maia-rating").textContent = MAIA_ELO;
  }

  const sanMoves = game.history();
  const moveline = sanMoves.slice(0, 6).join(" ") + (sanMoves.length > 6 ? "..." : "");

  const yourBest = POSITIVE_KEYS.reduce((sum, key) => sum + playerMoveStats[key], 0);
  const maiaBest = POSITIVE_KEYS.reduce((sum, key) => sum + maiaMoveStatsObj[key], 0);

  const entry = {
    pgn: game.pgn(),
    playerColor,
    clockHistory: moveClockHistory.slice(0, game.history().length),
    
    result: resultLabel,
    rated: currentMode === "rated",
    mode: currentMode,
    moveline: moveline || "(no moves)",
    yourName: username,
    yourElo: myRating,
    maiaElo: MAIA_ELO,
    yourAcc: yourAcc === null ? "—" : yourAcc + "%",
    maiaAcc: maiaAcc === null ? "—" : maiaAcc + "%",
    yourBest,
    maiaBest,
    yourMistakes: playerMoveStats.mistake,
    maiaMistakes: maiaMoveStatsObj.mistake,
    yourBlunders: playerMoveStats.blunder,
    maiaBlunders: maiaMoveStatsObj.blunder,
    accuracy: (yourAcc === null ? "—" : yourAcc + "%") + " / " + (maiaAcc === null ? "—" : maiaAcc + "%"),
    you: username + myRating,
    maia: "Maia" + MAIA_ELO,
  };

  const history = loadHistory();
  history.unshift(entry);
  localStorage.setItem(HISTORY_KEY, JSON.stringify(history.slice(0, 100)));
}

function renderHistory() {
  const title = document.getElementById("history-title");
  const history = loadHistory();
  historyEl.innerHTML = "";
  if (inPuzzleMode) {
    const puzzles = loadPuzzleHistory();
    if (title) {
      title.hidden = false;
      title.textContent = "Past Puzzles";
    }
    if (puzzles.length === 0) {
      const empty = document.createElement("div");
      empty.className = "history-empty";
      empty.textContent = "No puzzles completed yet.";
      historyEl.appendChild(empty);
      return;
    }
    for (const entry of puzzles) {
      const card = document.createElement("button");
      card.className = "history-card";
      card.type = "button";
      const result = entry.result === "solved" ? "Solved" : "Gave Up";
      const date = Number.isFinite(entry.date)
        ? new Date(entry.date).toLocaleString(undefined, {
            year: "numeric", month: "numeric", day: "numeric",
            hour: "numeric", minute: "2-digit", second: "2-digit",
          })
        : "Date unavailable";
      const head = document.createElement("div");
      head.className = "hc-head";
      const resultLabel = document.createElement("span");
      resultLabel.className = "hc-result";
      resultLabel.textContent = result;
      const ratingLabel = document.createElement("span");
      ratingLabel.className = "hc-mode";
      ratingLabel.textContent = `Puzzle ${entry.rating ?? "—"}`;
      head.append(resultLabel, ratingLabel);

      const details = document.createElement("div");
      details.className = "hc-puzzle-details";
      const sideDate = document.createElement("div");
      sideDate.className = "hc-stat";
      sideDate.textContent = `${entry.playerColor === "b" ? "Black" : "White"} to play · ${date}`;
      const ratingChange = document.createElement("div");
      ratingChange.className = "hc-stat";
      const delta = Number.isFinite(entry.ratingDelta)
        ? `${entry.ratingDelta >= 0 ? "+" : ""}${entry.ratingDelta}`
        : "—";
      const ratingAfter = Number.isFinite(entry.playerRatingAfter)
        ? entry.playerRatingAfter
        : entry.playerRatingBefore ?? "—";
      const ratingBefore = Number.isFinite(entry.playerRatingBefore)
        ? entry.playerRatingBefore
        : "—";
      ratingChange.textContent = `Your Elo ${ratingBefore} → ${ratingAfter} (${delta})`;
      const moveCount = document.createElement("div");
      moveCount.className = "hc-stat";
      moveCount.textContent = `Total moves ${entry.totalMoves ?? entry.solution?.length ?? 0}`;
      details.append(sideDate, moveCount, ratingChange);
      const moveLine = document.createElement("div");
      moveLine.className = "hc-moves";
      moveLine.textContent = entry.moveline || "(no moves)";
      card.append(head, details, moveLine);
      card.addEventListener("click", () => {
        if (entry.pgn) openPastGame(entry);
      });
      historyEl.appendChild(card);
    }
    return;
  }
  if (title) {
    title.hidden = true;
    title.textContent = "";
  }
  if (history.length === 0) {
    const empty = document.createElement("div");
    empty.className = "history-empty";
    empty.textContent = "No games played yet.";
    historyEl.appendChild(empty);
    return;
  }
  for (const entry of history) {
    const card = document.createElement("button");
    card.className = "history-card";
    card.type = "button";

    const yourName = entry.yourName ?? "Me";
    const yourElo = entry.yourElo ?? "—";
    const maiaElo = entry.maiaElo ?? "—";
    const yourAcc = entry.yourAcc ?? "—";
    const maiaAcc = entry.maiaAcc ?? "—";
    const yourBest = entry.yourBest ?? 0;
    const maiaBest = entry.maiaBest ?? 0;
    const yourMistakes = entry.yourMistakes ?? 0;
    const maiaMistakes = entry.maiaMistakes ?? 0;
    const yourBlunders = entry.yourBlunders ?? 0;
    const maiaBlunders = entry.maiaBlunders ?? 0;

    card.innerHTML = `
      <div class="hc-head">
        <span class="hc-result">${entry.result}</span>
        <span class="hc-mode">Ranked</span>
      </div>
      <div class="hc-top">
        <div class="hc-player">
          <h4>${yourName}</h4>
          <div class="hc-stat">${yourElo}</div>
          <div class="hc-stat">${yourAcc}</div>
          <div class="hc-stat">B ${yourBest}</div>
          <div class="hc-stat">M ${yourMistakes}</div>
          <div class="hc-stat">X ${yourBlunders}</div>
        </div>
        <div class="hc-divider"></div>
        <div class="hc-player">
          <h4>Maia</h4>
          <div class="hc-stat">${maiaElo}</div>
          <div class="hc-stat">${maiaAcc}</div>
          <div class="hc-stat">B ${maiaBest}</div>
          <div class="hc-stat">M ${maiaMistakes}</div>
          <div class="hc-stat">X ${maiaBlunders}</div>
        </div>
      </div>
      <div class="hc-moves">${entry.moveline}</div>
    `;

    card.addEventListener("click", () => {
      openPastGame(entry);
    });

    historyEl.appendChild(card);
  }
}

function showGameOverPopup() {
  if (!historyRecorded) {
    pushHistoryEntry();
    historyRecorded = true;
    saveCurrentGame();
    renderHistory();
  }

  const { title, sub } = getResultText();
  overlayTitleEl.textContent = title;
  overlaySubEl.textContent = sub;

  const yourAcc = computeAccuracy(playerMoveStats);
  const maiaAcc = computeAccuracy(maiaMoveStatsObj);
  yourAccuracyEl.textContent = yourAcc === null ? "" : yourAcc + "%";
  maiaAccuracyEl.textContent = maiaAcc === null ? "" : maiaAcc + "%";
  buildStatsList(yourStatsEl, playerMoveStats);
  buildStatsList(maiaStatsEl, maiaMoveStatsObj);

  overlayEl.classList.remove("hidden");
}

function closeOverlay() {
  overlayEl.classList.add("hidden");
}
window.closeOverlay = closeOverlay;

// ---------- Maia initialization ----------
let maiaReady = false;
let maiaLoading = false;
let maiaLoadError = null;
let maiaInitPromise = null;

// The worker already reports model download progress; surface it in the status line.
if (engine) {
  engine.onStatus = (status) => {
    if (status === "downloading") {
      statusEl.textContent = "Downloading Maia model...";
      statusEl.classList.remove("status-hidden", "has-progress");
      statusEl.classList.add("maia-downloading");
    } else if (status === "ready") {
      statusEl.classList.remove("maia-downloading", "has-progress");
      statusEl.style.removeProperty("--download-progress");
    }
  };
  engine.onProgress = (progress, loaded, total) => {
    statusEl.style.setProperty("--download-progress", `${progress}%`);
    statusEl.classList.add("maia-downloading");
    statusEl.classList.toggle("has-progress", total > 0);
    statusEl.classList.remove("status-hidden");
    statusEl.textContent = total > 0
      ? `Downloading Maia model... ${progress}%`
      : `Downloading Maia model... ${Math.round(loaded / 1024 / 1024)} MB`;
  };
}

function waitForMaia() {
  // Maia is already ready.
  if (maiaReady && engine) {
    return Promise.resolve();
  }

  // Maia previously failed.
  if (maiaLoadError) {
    return Promise.reject(maiaLoadError);
  }

  // Initialization is already running.
  if (maiaInitPromise) {
    return maiaInitPromise;
  }

  // Start exactly ONE initialization promise.
  maiaInitPromise = initializeMaiaInBackground();

  return maiaInitPromise;
}

function initializeMaiaInBackground() {

  // Already ready.
  if (maiaReady && engine) {
    return Promise.resolve();
  }

  // Already loading.
  if (maiaInitPromise) {
    return maiaInitPromise;
  }

  maiaLoading = true;
  maiaLoadError = null;

  maiaInitPromise = (async () => {

    try {

      console.log("Maia: starting initialization...");

      if (
        !maiaThinking &&
        !isGameLocked() &&
        !inPuzzleMode &&
        !inDrillMode
      ) {
        statusEl.textContent = "Loading Maia...";
        statusEl.classList.remove("status-hidden");
      }

      // Load Maia's move tables/model.
      await MaiaTensor.initMoveTables("./data/");

      // The Maia library is expected to create the engine.
      if (!engine) {
        throw new Error(
          "Maia move tables loaded, but engine was not created."
        );
      }

      maiaReady = true;

      console.log("Maia: ready.");

      if (
        !maiaThinking &&
        !isGameLocked() &&
        !inPuzzleMode &&
        !inDrillMode
      ) {
        updateStatusForTurn();
      }

      return true;

    } catch (err) {

      maiaReady = false;
      maiaLoadError = err;

      console.error(
        "Maia failed to initialize:",
        err
      );

      if (
        !maiaThinking &&
        !inPuzzleMode &&
        !inDrillMode
      ) {
        statusEl.textContent =
          "Maia couldn't load. Check the console.";

        statusEl.classList.remove("status-hidden");
      }

      throw err;

    } finally {

      maiaLoading = false;

      // Do NOT clear this until all callers have received
      // the promise result.
      maiaInitPromise = null;
    }

  })();

  return maiaInitPromise;
}

async function init() {

  // -----------------------------------------
  // 1. Load the UI immediately
  // -----------------------------------------
  renderHistory();

  statusEl.textContent = "Loading game...";

  updateModeBadge();
  updateUsernameDisplay();
  updateSoundButtonLabel();
  updateDefaultModeButtonLabel();

  // -----------------------------------------
  // 2. Start background resources immediately
  // -----------------------------------------
  PuzzleDB.manageForRating(puzzleRating).catch((err) => {
    console.warn("Background puzzle database preparation failed:", err);
  });

  // Openings
  loadOpeningsData().catch((err) => {
    console.error(
      "Failed to load openings:",
      err
    );
  });

  // -----------------------------------------
  // 3. Start the current mode immediately
  // -----------------------------------------
  if (currentMode === "puzzles") {

    try {
      await enterPuzzleMode();

    } catch (err) {
      console.error("Failed to start puzzle mode:", err);

      statusEl.textContent = "Failed to load puzzle mode.";
      statusEl.classList.remove("status-hidden");
    }

  } else {

    try {
      const loaded = loadGame(currentMode);

      applyLoadedState(loaded);

      renderBoard();
      renderMoveList();
      updateClockDisplays();
      updateStatusForTurn();

    } catch (err) {

      console.error("Failed during initial board setup:", err);

      statusEl.textContent = "Failed to load the game.";
      statusEl.classList.remove("status-hidden");

      return;
    }
  }

  // -----------------------------------------
  // 4. Start Maia WITHOUT blocking the UI
  // -----------------------------------------
  initializeMaiaInBackground();

  // -----------------------------------------
  // 5. Let Maia handle the turn, including waiting for initialization
  // -----------------------------------------
  if (
    !inPuzzleMode &&
    !inDrillMode &&
    !isGameLocked() &&
    game.turn() !== playerColor
  ) {
    runMaiaTurn();
  }
}

window.openPastGame = openPastGame;
window.replayStart = replayStart;
window.replayPrevious = replayPrevious;
window.replayNext = replayNext;
window.replayEnd = replayEnd;
window.closeReplayUI = exitReplay;

removeUnrankedSavedGames();
init();
