
"use strict";

/* =========================================================
   CHESS.COM REVIEW
   ========================================================= */

const searchButton = document.getElementById("review-search-button");
const topNameInput = document.getElementById("review-top-name");
const bottomNameInput = document.getElementById("review-bottom-name");
const searchStatus = document.getElementById("review-search-status");
const historyElement = document.getElementById("history");
const historyTitle = document.getElementById("history-title");

let searchInProgress = false;

/* =========================================================
   STATUS
   ========================================================= */

function setSearchStatus(message) {
  if (searchStatus) {
    searchStatus.textContent = message;
  }
}

/* =========================================================
   CHESS.COM API
   ========================================================= */

async function fetchJson(url) {
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Chess.com returned HTTP ${response.status}`);
  }

  return response.json();
}

async function fetchPlayerGames(username) {
  const archiveUrl =
    `https://api.chess.com/pub/player/${encodeURIComponent(username)}/games/archives`;

  const archiveData = await fetchJson(archiveUrl);
  const archives = archiveData.archives || [];

  if (!archives.length) {
    return [];
  }

  const games = [];
  const failedArchives = [];

  let nextArchive = 0;

  async function worker() {
    while (nextArchive < archives.length) {
      const index = nextArchive++;
      const archiveUrl = archives[index];

      try {
        const data = await fetchJson(archiveUrl);
        games.push(...(data.games || []));
      } catch (error) {
        console.warn(
          "Could not load Chess.com archive:",
          archiveUrl,
          error
        );

        failedArchives.push(archiveUrl);
      }
    }
  }

  const workerCount = Math.min(5, archives.length);

  await Promise.all(
    Array.from(
      { length: workerCount },
      () => worker()
    )
  );

  if (!games.length && failedArchives.length) {
    throw new Error(
      "Could not retrieve the player's game archives. " +
      "The browser may be blocking Chess.com's API request."
    );
  }

  return games;
}

/* =========================================================
   GAME INFORMATION
   ========================================================= */

function getGameResult(game) {
  const whiteResult = game.white?.result;
  const blackResult = game.black?.result;

  if (whiteResult === "win") {
    return "1 - 0";
  }

  if (blackResult === "win") {
    return "0 - 1";
  }

  const drawResults = [
    "agreed",
    "repetition",
    "stalemate",
    "insufficient",
    "50move",
    "timevsinsufficient",
    "draw"
  ];

  if (
    drawResults.includes(whiteResult) ||
    drawResults.includes(blackResult)
  ) {
    return "½ - ½";
  }

  return "Game";
}

function formatGameDate(timestamp) {
  if (!timestamp) {
    return "Date unavailable";
  }

  return new Date(timestamp * 1000).toLocaleDateString(
    undefined,
    {
      year: "numeric",
      month: "short",
      day: "numeric"
    }
  );
}

function getGameTimeControl(game) {
  if (game.time_class) {
    return game.time_class;
  }

  if (game.time_control) {
    return game.time_control;
  }

  return "Chess";
}

function getPlayerRating(player) {
  if (player?.rating) {
    return `Rating ${player.rating}`;
  }

  return "Rating —";
}

function parseClockTime(value) {
  if (!value) return null;

  const parts = value.split(":").map(Number);
  if (!parts.length || parts.some((part) => !Number.isFinite(part))) {
    return null;
  }

  let seconds = 0;
  for (const part of parts) {
    seconds = seconds * 60 + part;
  }
  return seconds;
}

function getInitialClockSeconds(game) {
  const base = String(game.time_control || "").split("+")[0];
  const seconds = Number(base);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds : 600;
}

function extractClockHistory(game) {
  const pgn = game.pgn || "";
  const clockMatches = [...pgn.matchAll(/\[%clk\s+([0-9:.]+)\]/gi)];

  if (!clockMatches.length) {
    return [];
  }

  let white = getInitialClockSeconds(game);
  let black = getInitialClockSeconds(game);
  const history = [];

  clockMatches.forEach((match, index) => {
    const seconds = parseClockTime(match[1]);
    if (seconds === null) return;

    if (index % 2 === 0) {
      white = seconds;
    } else {
      black = seconds;
    }

    history[index] = { white, black };
  });

  return history;
}

/* =========================================================
   GAME CARD
   ========================================================= */

function createGameCard(game) {
  const card = document.createElement("button");

  card.type = "button";
  card.className = "history-card";

  const white = game.white?.username || "White";
  const black = game.black?.username || "Black";

  /* Header */

  const head = document.createElement("div");
  head.className = "hc-head";

  const result = document.createElement("span");
  result.className = "hc-result";
  result.textContent = getGameResult(game);

  const mode = document.createElement("span");
  mode.className = "hc-mode";
  mode.textContent = getGameTimeControl(game);

  head.append(result, mode);

  /* Players */

  const players = document.createElement("div");
  players.className = "hc-top";

  const whitePlayer = document.createElement("div");
  whitePlayer.className = "hc-player";

  const whiteHeading = document.createElement("h4");
  whiteHeading.className = "review-game-names";
  whiteHeading.textContent = white;

  const whiteRating = document.createElement("div");
  whiteRating.className = "hc-stat";
  whiteRating.textContent = getPlayerRating(game.white);

  whitePlayer.append(whiteHeading, whiteRating);

  const divider = document.createElement("div");
  divider.className = "hc-divider";

  const blackPlayer = document.createElement("div");
  blackPlayer.className = "hc-player";

  const blackHeading = document.createElement("h4");
  blackHeading.className = "review-game-names";
  blackHeading.textContent = black;

  const blackRating = document.createElement("div");
  blackRating.className = "hc-stat";
  blackRating.textContent = getPlayerRating(game.black);

  blackPlayer.append(blackHeading, blackRating);

  players.append(
    whitePlayer,
    divider,
    blackPlayer
  );

  /* Date */

  const date = document.createElement("div");
  date.className = "hc-stat review-game-date";
  date.textContent = formatGameDate(game.end_time);

  /* Game URL */

  const link = document.createElement("div");
  link.className = "hc-moves";
  link.textContent = game.url || "Chess.com game";

  card.append(
    head,
    players,
    date,
    link
  );

  /* Open replay */

  card.addEventListener("click", () => {
    openReviewGame(game);
  });

  return card;
}

/* =========================================================
   OPEN GAME IN EXISTING REPLAY SYSTEM
   ========================================================= */

function openReviewGame(game) {
  if (!game.pgn) {
    setSearchStatus("This game does not contain a PGN.");
    return;
  }

  if (typeof window.openPastGame !== "function") {
    setSearchStatus(
      "Could not find the existing openPastGame() function."
    );

    console.error(
      "window.openPastGame is unavailable. " +
      "Make sure review.js loads after app.js."
    );

    return;
  }

  const white = game.white?.username || "White";
  const black = game.black?.username || "Black";

  const topUsername = topNameInput.value.trim().toLowerCase();
  const bottomUsername = bottomNameInput.value.trim().toLowerCase();

  /*
    With two usernames, the bottom field is the player
    placed at the bottom of the replay board.
    With one username, that player is placed at the bottom
    regardless of which input field contains the username.
  */
  const reviewedUsername = bottomUsername || topUsername;
  const playerColor = black.toLowerCase() === reviewedUsername ? "b" : "w";

  const entry = {
    pgn: game.pgn,
    playerColor,
    clockHistory: extractClockHistory(game),
    whiteName: white,
    blackName: black,
    whiteRating: game.white?.rating,
    blackRating: game.black?.rating
  };

  try {
    window.openPastGame(entry);

    setSearchStatus(
      `${white} vs ${black} · ${formatGameDate(game.end_time)}`
    );
  } catch (error) {
    console.error("Could not open replay:", error);

    setSearchStatus(
      "There was an error opening this game. Check the console."
    );
  }
}

/* =========================================================
   FILTER MATCHING GAMES
   ========================================================= */

function findMatchingGames(games, firstUsername, secondUsername = "") {
  const first = firstUsername.toLowerCase();
  const second = secondUsername.toLowerCase();

  return games.filter((game) => {
    const white = game.white?.username?.toLowerCase();
    const black = game.black?.username?.toLowerCase();

    // One username: every game involving that player.
    if (!second) {
      return white === first || black === first;
    }

    // Two usernames: only games played head-to-head.
    return (
      (white === first && black === second) ||
      (white === second && black === first)
    );
  });
}

/* =========================================================
   DISPLAY RESULTS
   ========================================================= */

function displayGames(games, emptyMessage = "No games found.") {
  historyElement.replaceChildren();

  if (historyTitle) {
    historyTitle.hidden = false;
    historyTitle.textContent = "Chess.com Games";
  }

  if (!games.length) {
    const empty = document.createElement("div");

    empty.className = "history-empty";
    empty.textContent = emptyMessage;

    historyElement.appendChild(empty);

    return;
  }

  games.sort(
    (a, b) => (b.end_time || 0) - (a.end_time || 0)
  );

  // Keep the review page compact: show only the three newest games.
  const fragment = document.createDocumentFragment();

  for (const game of games) {
    fragment.appendChild(
      createGameCard(game)
    );
  }

  historyElement.appendChild(fragment);
}

/* =========================================================
   SEARCH
   ========================================================= */

async function searchGames() {
  if (searchInProgress) {
    return;
  }

  const firstUsername = topNameInput.value.trim();
  const secondUsername = bottomNameInput.value.trim();

  if (!firstUsername && !secondUsername) {
    historyElement.replaceChildren();
    if (historyTitle) historyTitle.hidden = true;
    setSearchStatus("Enter at least one Chess.com username.");
    return;
  }

  if (
    firstUsername &&
    secondUsername &&
    firstUsername.toLowerCase() === secondUsername.toLowerCase()
  ) {
    setSearchStatus("Enter two different usernames, or leave one field blank.");
    return;
  }

  // If only the bottom field is filled, search that player.
  const searchedUsername = firstUsername || secondUsername;
  const opponentUsername = firstUsername && secondUsername ? secondUsername : "";

  searchInProgress = true;
  searchButton.disabled = true;
  historyElement.replaceChildren();

  if (historyTitle) {
    historyTitle.hidden = false;
    historyTitle.textContent = "Chess.com Games";
  }

  setSearchStatus(`Retrieving games for ${searchedUsername}...`);

  try {
    // Chess.com exposes a player's public games through their archives.
    // One archive download is enough; head-to-head mode filters those games.
    const games = await fetchPlayerGames(searchedUsername);
    setSearchStatus(
      opponentUsername
        ? `Finding games between ${searchedUsername} and ${opponentUsername}...`
        : `Organizing games for ${searchedUsername}...`
    );

    const matchingGames = findMatchingGames(
      games,
      searchedUsername,
      opponentUsername
    );

    const emptyMessage = opponentUsername
      ? `No games found between ${searchedUsername} and ${opponentUsername}.`
      : `No public games found for ${searchedUsername}.`;

    displayGames(matchingGames, emptyMessage);

    if (!matchingGames.length) {
      setSearchStatus(emptyMessage);
    } else if (opponentUsername) {
      setSearchStatus(
        `Found ${matchingGames.length} games between ${searchedUsername} and ${opponentUsername}. Showing the 3 newest.`
      );
    } else {
      setSearchStatus(
        `Found ${matchingGames.length} public games for ${searchedUsername}. Showing the 3 newest.`
      );
    }
  } catch (error) {
    console.error("Chess.com search failed:", error);
    historyElement.replaceChildren();

    const empty = document.createElement("div");
    empty.className = "history-empty";
    empty.textContent =
      "Could not retrieve Chess.com games. Check the username and browser console.";
    historyElement.appendChild(empty);

    setSearchStatus(error.message || "Chess.com search failed.");
  } finally {
    searchInProgress = false;
    searchButton.disabled = false;
  }
}

/* =========================================================
   EVENT LISTENERS
   ========================================================= */

if (searchButton) {
  searchButton.addEventListener("click", searchGames);
}

for (const input of [topNameInput, bottomNameInput]) {
  if (!input) continue;

  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      searchGames();
    }
  });
}
