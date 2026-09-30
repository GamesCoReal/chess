let game = new Chess();
let selectedSquare = null;
let premove = null;
let playerColor = "w";
let maiaThinking = false;
let engine = window.engine;        // Maia
let stockfishEngine = null;       // Stockfish
let boardFlipped = false;
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
let replayIndex = 0;
let replayAnalysis = [];
let replayAnalyzing = false;
let replayAnalysisRun = 0;
let replayAnalysisPanelEl = null;
let replayStockfishRun = 0;
let replayPlayerColor = "w";

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


// ---------- Settings ----------

let username = localStorage.getItem("chess_username") || "You";

let soundEnabled = localStorage.getItem("chess_sound_enabled") !== "false"; // default on

let defaultMode = localStorage.getItem("chess_default_mode") || "unranked"; // "unranked" | "ranked" | "s"

let currentMode;

if (defaultMode === "ranked") {
    currentMode = "rated";
} else if (defaultMode === "puzzles") {
    currentMode = "puzzles";
} else {
    currentMode = "unrated";
}

const hadPriorSession = !!localStorage.getItem("chess_active_mode"); // used once at startup below

function updateModeBadge() {
  const el = document.getElementById("mode-badge");
  if (!el) return;

  if (inPuzzleMode) {
    el.textContent = "Puzzle";
  } else if (inDrillMode) {
    el.textContent = currentDrillCategory === "endgame" ? "Endgame" : "Opening";
  } else {
    el.textContent = currentMode === "rated" ? "Rated" : "Unrated";
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
const DEFAULT_MODE_ORDER = ["unranked", "ranked", "puzzles"];
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


// --- Clear all saved data ---
async function clearAllSavedData() {
  // Local storage
  localStorage.clear();
  sessionStorage.clear();

  // Cache Storage
  if ("caches" in window) {
    const cacheNames = await caches.keys();
    await Promise.all(cacheNames.map(name => caches.delete(name)));
  }

  // Delete puzzle databases
  indexedDB.deleteDatabase("PuzzleDatabases");

  alert("Saved data cleared. Reloading...");
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
function savePuzzleRating() {
  localStorage.setItem("chess_puzzle_rating", String(puzzleRating));
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
  renderBoard();
  renderMoveList();
  updatePuzzleActionButton();
  statusEl.textContent = `Puzzle Rating ${puzzleRating} — find the best move for ${puzzlePlayerColor === "w" ? "White" : "Black"}.`;
  statusEl.classList.remove("status-hidden");
}

function updatePuzzleActionButton() {
  const btn = document.getElementById("puzzle-action-btn");
  if (!btn) return;

  btn.textContent = "Give Up";
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
  if (inDrillMode) {
    inDrillMode = false;
    document.getElementById("drill-controls").classList.add("hidden");
  }

  inPuzzleMode = true;
  updateModeBadge();
  gameControlsEl.classList.add("hidden");
  puzzleControlsEl.classList.remove("hidden");
  console.log("Entered puzzle mode");
  await loadNextPuzzle();
  console.log("Finished loadNextPuzzle");
}
window.enterPuzzleMode = enterPuzzleMode;

function exitPuzzleMode() {
  inPuzzleMode = false;
  hintSquares = [];
  puzzleHintStage = 0;
  updateModeBadge();
  puzzleControlsEl.classList.add("hidden");
  gameControlsEl.classList.remove("hidden");
  selectedSquare = null;
  boardFlipped = playerColor === "b";
  document.getElementById("board-wrap").classList.toggle("flipped", boardFlipped);

  document.getElementById("your-rating").textContent = myRating;
  document.getElementById("maia-rating").textContent = MAIA_ELO;
  restoreLastMoveFromRealGame();

  renderBoard();
  renderMoveList();
  updateClockDisplays();
  if (isGameLocked()) {
    // popup will show if they reopen it; just leave board as-is
  } else {
    updateStatusForTurn();
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
  const delta = Math.round(PUZZLE_RATING_K * (-1 - E));
  puzzleRating = clamp(puzzleRating + delta, 399, 3000);  savePuzzleRating();
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
  renderBoard();
  renderMoveList();
  updatePuzzleActionButton();
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

  if (puzzleSolutionIndex >= puzzleSolution.length) {
    puzzleLocked = true;
    const delta = computePuzzleRatingDelta();
    puzzleRating = clamp(puzzleRating + delta, 399, 3000);
    savePuzzleRating();
    document.getElementById("your-rating").textContent = puzzleRating;
    statusEl.textContent = `Solved! ${delta >= 0 ? "+" : ""}${delta} → Puzzle Rating ${puzzleRating}`;
    
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
  renderBoard();
  renderMoveList();
  puzzleAwaitingReply = false;

  if (puzzleSolutionIndex >= puzzleSolution.length) {
    puzzleLocked = true;
    const delta = computePuzzleRatingDelta();
    puzzleRating = clamp(puzzleRating + delta, 399, 3000);
    savePuzzleRating();
    document.getElementById("your-rating").textContent = puzzleRating;
    statusEl.textContent = `Solved! ${delta >= 0 ? "+" : ""}${delta} → Puzzle Rating ${puzzleRating}`;
    autoNextPuzzle();
  } else {
    statusEl.textContent = `Puzzle Rating ${puzzleRating} — find the best move.`;
  }
}

// ---------- Openings & Endgame drills ----------

// Real ECO opening database (105 families, 3575 verified variations), loaded from data/openings.json
let OPENINGS_DATA = [];

async function loadOpeningsData() {
  try {
    const res = await fetch("./data/openings.json");
    if (!res.ok) throw new Error("HTTP " + res.status);
    const data = await res.json();
    if (!Array.isArray(data) || data.length === 0) throw new Error("Empty or invalid openings data");
    OPENINGS_DATA = data;
  } catch (err) {
    console.error("Failed to load openings.json — opening drills will be unavailable:", err);
    OPENINGS_DATA = [];
  }
}

const DRILLS = {
  endgame: [
    { name: "Rook Ladder Mate", fen: "7k/1R6/8/8/8/8/8/R3K3 w - - 0 1", playerColor: "w", solution: ["a1a8"] },
    { name: "King & Queen Mate", fen: "7k/Q4K2/8/8/8/8/8/8 w - - 0 1", playerColor: "w", solution: ["a7g7"] },
    { name: "Back-Rank Mate", fen: "6k1/5ppp/8/8/8/8/5PPP/4R1K1 w - - 0 1", playerColor: "w", solution: ["e1e8"] },
  ],
};

let inDrillMode = false;
let drillGame = null;
let drillSolution = [];
let drillSolutionIndex = 0;
let drillPlayerColor = "w";
let drillLocked = false;
let drillAwaitingReply = false;
let currentDrill = null;
let currentDrillCategory = "opening";

function openDrillPicker() {
  document.querySelectorAll(".menu-item.open").forEach((item) => item.classList.remove("open"));
  onDrillCategoryChange();
  document.getElementById("drill-picker-overlay").classList.remove("hidden");
}
window.openDrillPicker = openDrillPicker;

function closeDrillPicker() {
  document.getElementById("drill-picker-overlay").classList.add("hidden");
}
window.closeDrillPicker = closeDrillPicker;

// Switches the picker form between "Opening" (family + variation + color) and
// "Endgame" (a single flat drill list, fixed color per drill).
function onDrillCategoryChange() {
  const category = document.getElementById("drill-category").value;
  const familyLabel = document.getElementById("drill-family-label");
  const familySelect = document.getElementById("drill-family");
  const variationLabel = document.getElementById("drill-variation-label");
  const colorLabel = document.getElementById("drill-color-label");
  const colorSelect = document.getElementById("drill-color");

  const isOpening = category === "opening";
  familyLabel.classList.toggle("hidden", !isOpening);
  familySelect.classList.toggle("hidden", !isOpening);
  colorLabel.classList.toggle("hidden", !isOpening);
  colorSelect.classList.toggle("hidden", !isOpening);
  variationLabel.textContent = isOpening ? "Variation" : "Drill";

  if (isOpening) {
    populateFamilyOptions();
  } else {
    populateEndgameOptions();
  }
}
window.onDrillCategoryChange = onDrillCategoryChange;

function populateFamilyOptions() {
  const familySelect = document.getElementById("drill-family");
  familySelect.innerHTML = "";
  OPENINGS_DATA.forEach((family, i) => {
    const opt = document.createElement("option");
    opt.value = i;
    opt.textContent = family.name;
    familySelect.appendChild(opt);
  });
  populateVariationOptions();
}

function populateVariationOptions() {
  const familyIdx = parseInt(document.getElementById("drill-family").value, 10);
  const family = OPENINGS_DATA[familyIdx];
  const select = document.getElementById("drill-select");
  select.innerHTML = "";
  if (!family) return;
  family.variations.forEach((variation, i) => {
    const opt = document.createElement("option");
    opt.value = i;
    opt.textContent = (variation.eco ? variation.eco + " — " : "") + variation.name;
    select.appendChild(opt);
  });
}
window.populateVariationOptions = populateVariationOptions;

function populateEndgameOptions() {
  const select = document.getElementById("drill-select");
  select.innerHTML = "";
  DRILLS.endgame.forEach((drill, i) => {
    const opt = document.createElement("option");
    opt.value = i;
    opt.textContent = drill.name;
    select.appendChild(opt);
  });
}

function startSelectedDrill() {
  const category = document.getElementById("drill-category").value;

  if (category === "endgame") {
    const idx = parseInt(document.getElementById("drill-select").value, 10);
    const drill = DRILLS.endgame[idx];
    currentDrillCategory = "endgame";
    closeDrillPicker();
    loadDrill(drill);
    return;
  }

  const familyIdx = parseInt(document.getElementById("drill-family").value, 10);
  const variationIdx = parseInt(document.getElementById("drill-select").value, 10);
  const color = document.getElementById("drill-color").value;
  const family = OPENINGS_DATA[familyIdx];
  if (!family) return;
  const variation = family.variations[variationIdx];
  if (!variation) return;

  const drill = {
    name: family.name + " — " + variation.name,
    playerColor: color,
    solution: variation.solution,
  };
  currentDrillCategory = "opening";
  closeDrillPicker();
  loadDrill(drill);
}
window.startSelectedDrill = startSelectedDrill;

function loadDrill(drill) {
  if (maiaThinking) return;
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

  boardFlipped = drillPlayerColor === "b";
  document.getElementById("board-wrap").classList.toggle("flipped", boardFlipped);

  clearTurnTags();
  renderBoard();
  renderMoveList();
  statusEl.textContent = `${drill.name} — find the next move for ${drillPlayerColor === "w" ? "White" : "Black"}.`;
  statusEl.classList.remove("status-hidden");
}

function restartCurrentDrill() {
  if (!inDrillMode || !currentDrill) return;
  hintSquares = [];
  puzzleHintStage = 0;
  loadDrill(currentDrill);
}
window.restartCurrentDrill = restartCurrentDrill;

function exitDrillMode() {
  inDrillMode = false;
  hintSquares = [];
  puzzleHintStage = 0;
  updateModeBadge();
  document.getElementById("drill-controls").classList.add("hidden");
  gameControlsEl.classList.remove("hidden");
  selectedSquare = null;
  boardFlipped = playerColor === "b";
  document.getElementById("board-wrap").classList.toggle("flipped", boardFlipped);
  restoreLastMoveFromRealGame();
  renderBoard();
  renderMoveList();
  updateClockDisplays();
  if (!isGameLocked()) updateStatusForTurn();
}
window.exitDrillMode = exitDrillMode;

async function onDrillSquareClick(sq) {
  if (drillLocked || drillAwaitingReply) return;
  if (drillGame.turn() !== drillPlayerColor) return;

  if (selectedSquare === null) {
    const piece = drillGame.get(sq);
    if (piece && piece.color === drillPlayerColor) {
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
    if (piece && piece.color === drillPlayerColor) selectedSquare = sq;
    renderBoard();
    return;
  }

  const promotion = moveResult.promotion ? moveResult.promotion : "";
  const playedUci = from + to + promotion;
  const expectedUci = drillSolution[drillSolutionIndex];

  if (playedUci !== expectedUci) {
    drillGame.load(preFen);
    renderBoard();
    statusEl.textContent = "Not the drill line — try again.";
    return;
  }

  lastMoveFrom = from;
  lastMoveTo = to;
  playGameSound(soundForMove(drillGame, moveResult));
  renderBoard();
  renderMoveList();
  drillSolutionIndex++;

  if (drillSolutionIndex >= drillSolution.length) {
    drillLocked = true;
    statusEl.textContent = `Drill complete! Hit Restart to try it again.`;
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
  renderBoard();
  renderMoveList();
  drillAwaitingReply = false;

  if (drillSolutionIndex >= drillSolution.length) {
    drillLocked = true;
    statusEl.textContent = `Drill complete! Hit Restart to try it again.`;
  } else {
    statusEl.textContent = `${currentDrill.name} — find the next move.`;
  }
}

// ---------- Status / turn tags ----------
function updateStatusForTurn() {
  if (inPuzzleMode || isGameLocked()) return;
  whiteTurnTag.textContent = "Your move";
  blackTurnTag.textContent = "Maia's move";
  if (game.turn() === playerColor) {
    statusEl.textContent = "Your move.";
    statusEl.classList.remove("status-hidden");
  } else {
    statusEl.classList.add("status-hidden");
  }
  whiteTurnTag.classList.toggle("active", game.turn() === playerColor);
  blackTurnTag.classList.toggle("active", game.turn() !== playerColor);
}

function clearTurnTags() {
  whiteTurnTag.classList.remove("active");
  blackTurnTag.classList.remove("active");
}

function toggleFlip() {
  boardFlipped = !boardFlipped;
  document.getElementById("board-wrap").classList.toggle("flipped", boardFlipped);
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
    const millis = Math.floor((remaining - s) * 1000);
    return `${base}.${String(millis).padStart(3, "0")}`;
  }
  return base;
}

function updateClockDisplays() {
  const yourTime =
    playerColor === "w" ? whiteTime : blackTime;

  const maiaTime =
    playerColor === "w" ? blackTime : whiteTime;

  yourClockEl.textContent = formatClock(yourTime);
  maiaClockEl.textContent = formatClock(maiaTime);
}

function resetClocks() {
  whiteTime = STARTING_CLOCK_SECONDS;
  blackTime = STARTING_CLOCK_SECONDS;

  // White starts the game, so White's clock starts immediately.
  whiteClockStarted = true;
  blackClockStarted = false;
  clockLastTick = performance.now();

  updateClockDisplays();
}

function updateClockUnlocks() {
  const len = game.history().length;

  // White's clock starts immediately.
  whiteClockStarted = true;

  // Black's clock starts as soon as White has made the opening move.
  if (len >= 1) {
    blackClockStarted = true;
  }
}

const LOWTIME_THRESHOLDS = [60, 10, 3];
let clockLastTick = performance.now();

function tickClock() {

  // Clocks exist only in normal games.
  if (inPuzzleMode || inDrillMode || isGameLocked()) {
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
  premove = null;
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
let replayControlsEl = null;


// ------------------------------------------------------------
// Open a saved game
// ------------------------------------------------------------

function openPastGame(entry) {
  if (!entry || !entry.pgn) {
    console.error("Past game has no PGN.");
    return;
  }

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
  replayAnalysis = Array(replayMoves.length).fill(null);
  replayPlayerColor = entry.playerColor === "b" ? "b" : entry.playerColor === "w" ? "w" : playerColor;

  // Start replay at the beginning.
  replayGame.reset();
  replayIndex = 0;

  // Enter replay mode.
  inReplayMode = true;

  selectedSquare = null;
  lastMoveFrom = null;
  lastMoveTo = null;

  // Show replay controls.
  createReplayControls();

  // Render the saved game directly on the EXISTING board.
  renderBoard();
  renderMoveList();
  analyzeReplayPosition();

  console.log(
    "Loaded past game:",
    replayMoves.length,
    "moves"
  );
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

  replayControlsEl.id = "replay-controls";

  replayControlsEl.style.display = "flex";
  replayControlsEl.style.justifyContent = "center";
  replayControlsEl.style.alignItems = "center";
  replayControlsEl.style.gap = "8px";
  replayControlsEl.style.marginTop = "10px";
  replayControlsEl.style.marginBottom = "10px";
  replayControlsEl.style.flexWrap = "wrap";

  replayControlsEl.innerHTML = `
    <button type="button" id="replay-exit">
      Exit Replay
    </button>

    <button type="button" id="replay-start">
      ⏮
    </button>

    <button type="button" id="replay-previous">
      ◀
    </button>

    <span id="replay-position">
      0 / 0
    </span>

    <button type="button" id="replay-next">
      ▶
    </button>

    <button type="button" id="replay-end">
      ⏭
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

  updateReplayControls();
}


// ------------------------------------------------------------
// Update replay counter
// ------------------------------------------------------------

function updateReplayControls() {
  const position =
    document.getElementById("replay-position");

  if (!position) return;

  position.textContent =
    replayIndex + " / " + replayMoves.length;
}

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
    const classification = classifyMoveGeneric({
      preValue: beforeValue,
      postValue: afterValue,
      moveUci,
      preTopMove,
      preMoveProb,
      moverColor: "w",
      wasMate: isMate,
      moveNumber: Math.floor(i / 2) + 1,
      skipTopMatch: false,
    });

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
      classification,
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
        renderReplayAnalysisPanel(completed, total);
        renderMoveList();
        if (inReplayMode && replayIndex > 0 && replayIndex - 1 === completed - 1) {
          renderBoard();
        }
      },
      () => runId !== replayAnalysisRun
    );
    if (runId === replayAnalysisRun) {
      renderReplayAnalysisPanel(replayAnalysis.length, replayAnalysis.length);
      renderMoveList();
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

function replayStart() {
  if (!replayGame) return;

  replayGame.reset();

  replayIndex = 0;

  lastMoveFrom = null;
  lastMoveTo = null;
  selectedSquare = null;

  renderBoard();
  renderMoveList();
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

  replayGame.reset();

  for (
    let i = 0;
    i < replayIndex - 1;
    i++
  ) {
    replayGame.move(replayMoves[i]);
  }

  replayIndex--;

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

function exitReplay() {
  replayAnalysisRun++;
  replayStockfishRun++;
  window.stockfishEvaluator?.stop();
  replayAnalyzing = false;
  inReplayMode = false;

  // Restore the real game.
  if (replayReturnGame) {
    game = replayReturnGame;
  }

  replayGame = null;
  replayMoves = [];
  replayIndex = 0;
  replayAnalysis = [];
  replayReturnGame = null;

  selectedSquare = null;

  lastMoveFrom = null;
  lastMoveTo = null;

  if (replayControlsEl) {
    replayControlsEl.remove();
    replayControlsEl = null;
  }
  if (replayAnalysisPanelEl) {
    replayAnalysisPanelEl.remove();
    replayAnalysisPanelEl = null;
  }

  renderBoard();
  renderMoveList();

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
  premove = null;
  gameResigned = false;
  resignedBy = null;
  gameTimedOut = false;
  timedOutColor = null;
  historyRecorded = false;
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
  whiteTime = loaded.whiteTime;
  blackTime = loaded.blackTime;
  whiteClockStarted = loaded.whiteClockStarted;
  blackClockStarted = loaded.blackClockStarted;
  clockLastTick = performance.now();
  playerColor = loaded.playerColor !== null ? loaded.playerColor : assignNextColor();
  updateClockUnlocks();
  boardFlipped = playerColor === "b";
  document.getElementById("board-wrap").classList.toggle("flipped", boardFlipped);
  restoreLastMoveFromRealGame();
  document.getElementById("your-rating").textContent = myRating;
  document.getElementById("maia-rating").textContent = MAIA_ELO;
}

function selectMode(mode) {
  document.querySelectorAll(".menu-item.open").forEach((item) => item.classList.remove("open"));
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
  boardFlipped = playerColor === "b";
  document.getElementById("board-wrap").classList.toggle("flipped", boardFlipped);
  lastMoveFrom = null;
  lastMoveTo = null;
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
  premove = null;
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
  boardEl.innerHTML = "";
  const boardData = activeGame.board();

  const legalTargets = selectedSquare
    ? activeGame.moves({ square: selectedSquare, verbose: true }).map((m) => m.to)
    : [];

  const rankOrder = boardFlipped ? [1, 2, 3, 4, 5, 6, 7, 8] : [8, 7, 6, 5, 4, 3, 2, 1];
  const fileOrder = boardFlipped ? [7, 6, 5, 4, 3, 2, 1, 0] : [0, 1, 2, 3, 4, 5, 6, 7];

  for (const displayRank of rankOrder) {
    for (const fileIdx of fileOrder) {
      const sq = squareId(fileIdx, displayRank);
      const rowIdx = 8 - displayRank;
      const piece = boardData[rowIdx][fileIdx];

      const cell = document.createElement("div");
      cell.className = "square " + (((fileIdx + displayRank) % 2 === 0) ? "dark" : "light");
      cell.dataset.square = sq;
      
      if (sq === selectedSquare) cell.classList.add("selected");
      if (premove && (sq === premove.from || sq === premove.to)) {
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
          badge.title = lastMoveRating;
          badge.draggable = false;
          cell.appendChild(badge);
        }
      }

      boardEl.appendChild(cell);
    }
  }

  renderReplayEvalBar();
}

function renderReplayEvalBar() {
  const meter = document.getElementById("replay-eval-meter");
  const evalBar = document.getElementById("replay-eval-bar");
  if (!meter || !evalBar) return;
  meter.classList.toggle("hidden", !inReplayMode || !replayGame);
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
  scoreLabel.textContent = score.type === "mate"
    ? `M${Math.abs(score.value)}`
    : `${score.value > 0 ? "+" : ""}${(score.value / 100).toFixed(1)}`;
  evalBar.setAttribute("aria-label", `Position evaluation: White ${whitePct} percent, Black ${100 - whitePct} percent`);
  evalBar.title = `White ${whitePct}% / Black ${100 - whitePct}%`;
}

function analyzeReplayPosition() {
  const runId = ++replayStockfishRun;
  if (!inReplayMode || !replayGame) return;

  const fen = replayGame.fen();
  const turn = replayGame.turn();
  const scoreLabel = document.getElementById("replay-eval-score");
  if (scoreLabel) scoreLabel.textContent = "…";
  renderReplayEvalBar();

  window.stockfishEvaluator.evaluateFen(fen, (score) => {
    if (runId === replayStockfishRun && inReplayMode && score) {
      updateReplayEvalBar(score, turn);
    }
  }).catch((error) => {
    if (runId === replayStockfishRun) {
      console.error("Could not evaluate replay position with Stockfish:", error);
      if (scoreLabel) scoreLabel.textContent = "!";
    }
  });
}

function onBoardClick(sq) {
  if (inPuzzleMode) return onPuzzleSquareClick(sq);
  if (inDrillMode) return onDrillSquareClick(sq);
  return onSquareClick(sq);
}

// ---------- Drag to move ----------
const DRAG_THRESHOLD_PX = 8;

let pointerTrack = null;
let ghostEl = null;
let dragHoverSq = null;

function pieceIsDraggableAt(sq) {
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
  const activeGame = inPuzzleMode ? puzzleGame : (inDrillMode ? drillGame : game);
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

  pointerTrack = {
    pointerId: e.pointerId,
    startSq: sq,
    startX: e.clientX,
    startY: e.clientY,
    isDraggable: pieceIsDraggableAt(sq),
    dragging: false,
  };
});

document.addEventListener("pointermove", (e) => {
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
  const hist = activeGame ? activeGame.history() : [];
  let html = "";
  for (let i = 0; i < hist.length; i += 2) {
    const moveNum = i / 2 + 1;
    html += `<span class="movenum">${moveNum}.</span> <span class="move">${hist[i]}</span> `;
    if (hist[i + 1]) {
      html += `<span class="move">${hist[i + 1]}</span> `;
    }
  }
  moveListEl.innerHTML = html;
  const scrollParent = moveListEl.closest(".moves");
  if (scrollParent) scrollParent.scrollLeft = scrollParent.scrollWidth;
}

// ---------- Move classification ----------
function classifyMoveGeneric({ preValue, postValue, moveUci, preTopMove, preMoveProb, moverColor, wasMate, moveNumber, skipTopMatch }) {
  const delta = moverColor === "w" ? postValue - preValue : preValue - postValue;
  const deltaPct = delta * 100;

  if (wasMate) return "best";
  if (moveNumber <= 6 && preMoveProb >= 0.35) return "book";
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
  const { preMoveValue, color, moveNumber, moveUci, preMoveProb } = pendingMaiaGrading;
  const label = classifyMoveGeneric({
    preValue: preMoveValue,
    postValue: currentPositionValue,
    moveUci,
    preTopMove: null,
    preMoveProb,
    moverColor: color,
    wasMate: false,
    moveNumber,
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
      if (premove && !isGameLocked() && game.turn() === playerColor) {
        setTimeout(() => executeQueuedPremove(myToken), 100);
      } else if (isGameLocked()) {
        premove = null;
        renderBoard();
      }
    }
  }
}

function handlePremoveClick(sq) {
  const piece = game.get(sq);
  if (selectedSquare === null) {
    premove = null;
    if (piece && piece.color === playerColor) selectedSquare = sq;
    renderBoard();
    return;
  }

  if (sq === selectedSquare) {
    selectedSquare = null;
    premove = null;
  } else if (piece && piece.color === playerColor) {
    selectedSquare = sq;
    premove = null;
  } else {
    premove = { from: selectedSquare, to: sq };
    selectedSquare = null;
  }
  renderBoard();
}

async function executeQueuedPremove(expectedGameToken) {
  if (!premove) return;
  if (expectedGameToken !== gameToken || isGameLocked() || game.turn() !== playerColor) {
    premove = null;
    renderBoard();
    return;
  }

  const queued = premove;
  premove = null;
  selectedSquare = null;
  renderBoard();
  const moveCount = game.history().length;
  await onSquareClick(queued.from);
  await onSquareClick(queued.to);
  if (game.history().length === moveCount) {
    selectedSquare = null;
    renderBoard();
  }
}

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

  // ==================================================
  // PLAYER MOVE SUCCESSFUL
  // ==================================================
  lastMoveFrom = from;
  lastMoveTo = to;
  clockLastTick = performance.now();

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
      const label =
        classifyMoveGeneric({
          preValue: preEval.value,
          postValue: postEval.value,
          moveUci: moveUci,
          preTopMove: preTopMove,
          preMoveProb: preMoveProb,
          moverColor: moverColor,
          wasMate: false,
          moveNumber: moveNumber,
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

      lastMoveFrom = mFrom;
      lastMoveTo = mTo;

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
            maiaPreMoveProb
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
      if (premove && !isGameLocked() && game.turn() === playerColor) {
        setTimeout(() => executeQueuedPremove(myToken), 100);
      } else if (isGameLocked() && premove) {
        premove = null;
        renderBoard();
      }
    }
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
  const history = loadHistory();
  historyEl.innerHTML = "";
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
        <span class="hc-mode">${entry.rated ? "Rated" : "Unrated"}</span>
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
  // Puzzle databases
  PuzzleDB.startBackgroundDownloads().catch((err) => {
    console.warn(
      "Background puzzle database download failed:",
      err
    );
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
  // 5. If Maia needs to move, wait for Maia
  // -----------------------------------------
  if (
    !inPuzzleMode &&
    !inDrillMode &&
    !isGameLocked() &&
    game.turn() !== playerColor
  ) {

    // Maia isn't ready yet.
    // initializeMaiaInBackground() is already running.
    if (!maiaReady) {
      statusEl.textContent = "Loading Maia...";
      statusEl.classList.remove("status-hidden");

      // Wait until Maia becomes ready.
      while (!maiaReady && !maiaLoadError) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }

    if (maiaReady && !isGameLocked()) {
      runMaiaTurn();
    }
  }
}

window.openPastGame = openPastGame;
window.replayStart = replayStart;
window.replayPrevious = replayPrevious;
window.replayNext = replayNext;
window.replayEnd = replayEnd;
window.closeReplayUI = exitReplay;

init();
