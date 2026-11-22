/*
 * Maia 3 Backwards FEN Solver
 *
 * Browser-side JavaScript conversion of the supplied Python solver.
 *
 * Required globals, loaded before this file:
 *   window.Chess
 *   window.engine
 *
 * Expected engine API:
 *   engine.evaluate(game, eloSelf, eloOppo)
 */

(function () {
  "use strict";

  const PIECE_TYPES = ["p", "n", "b", "r", "q"];
  const CASTLING_ORDER = "KQkq";
  const FILES = "abcdefgh";

  // ============================================================
  // DEPENDENCIES
  // ============================================================

  function assertDependencies() {
    if (typeof window.Chess !== "function") {
      throw new Error(
        "chess.js was not found. Load chess.min.js first."
      );
    }

    if (!window.engine ||
        typeof window.engine.evaluate !== "function") {
      throw new Error(
        "Maia engine was not found. Load maia-engine.js first."
      );
    }
  }

  // ============================================================
  // GENERAL HELPERS
  // ============================================================

  function square(file, rank) {
    return rank * 8 + file;
  }

  function fileOf(sq) {
    return sq % 8;
  }

  function rankOf(sq) {
    return Math.floor(sq / 8);
  }

  function squareName(sq) {
    return FILES[fileOf(sq)] +
      String(rankOf(sq) + 1);
  }

  function colorOf(piece) {
    if (!piece) return null;

    return piece === piece.toUpperCase()
      ? "w"
      : "b";
  }

  function pieceType(piece) {
    return piece ? piece.toLowerCase() : null;
  }

  function normalizeCastling(rights) {
    if (!rights || rights === "-") {
      return "-";
    }

    return CASTLING_ORDER
      .split("")
      .filter(ch => rights.includes(ch))
      .join("") || "-";
  }

  function cloneBoard(board) {
    return board.slice();
  }

  function parseFen(fen) {
    const fields = String(fen).trim().split(/\s+/);

    if (fields.length < 4 || fields.length > 6) {
      throw new Error(
        "FEN must contain 4, 5, or 6 fields."
      );
    }

    const ranks = fields[0].split("/");

    if (ranks.length !== 8) {
      throw new Error(
        "FEN must contain exactly 8 board ranks."
      );
    }

    const board = Array(64).fill(null);

    for (let fenRank = 0; fenRank < 8; fenRank++) {
      let file = 0;

      for (const token of ranks[fenRank]) {
        if (/^[1-8]$/.test(token)) {
          file += Number(token);
        } else if (/^[prnbqkPRNBQK]$/.test(token)) {
          if (file >= 8) {
            throw new Error(
              "Invalid FEN rank: too many squares."
            );
          }

          board[square(file, 7 - fenRank)] = token;
          file++;
        } else {
          throw new Error(
            "Invalid FEN piece-placement field."
          );
        }
      }

      if (file !== 8) {
        throw new Error(
          "Invalid FEN rank: each rank must contain 8 squares."
        );
      }
    }

    if (fields[1] !== "w" && fields[1] !== "b") {
      throw new Error(
        "FEN active color must be w or b."
      );
    }

    if (!/^(?:-|K?Q?k?q?)$/.test(fields[2])) {
      throw new Error(
        "Invalid FEN castling-rights field."
      );
    }

    if (!/^(?:-|[a-h][36])$/.test(fields[3])) {
      throw new Error(
        "Invalid FEN en-passant field."
      );
    }

    const halfmove = fields.length >= 5
      ? Number(fields[4])
      : 0;

    const fullmove = fields.length >= 6
      ? Number(fields[5])
      : 1;

    if (!Number.isInteger(halfmove) || halfmove < 0) {
      throw new Error("Invalid FEN halfmove clock.");
    }

    if (!Number.isInteger(fullmove) || fullmove < 1) {
      throw new Error("Invalid FEN fullmove number.");
    }

    return {
      board,
      turn: fields[1],
      castling: normalizeCastling(fields[2]),
      ep: fields[3],
      halfmove,
      fullmove
    };
  }

  function boardToFen(board) {
    const ranks = [];

    for (let rank = 7; rank >= 0; rank--) {
      let row = "";
      let empty = 0;

      for (let file = 0; file < 8; file++) {
        const piece = board[square(file, rank)];

        if (!piece) {
          empty++;
        } else {
          if (empty) row += String(empty);

          empty = 0;
          row += piece;
        }
      }

      if (empty) row += String(empty);

      ranks.push(row);
    }

    return ranks.join("/");
  }

  function makeFen(position) {
    return [
      boardToFen(position.board),
      position.turn,
      normalizeCastling(position.castling),
      position.ep || "-",
      String(position.halfmove),
      String(position.fullmove)
    ].join(" ");
  }

  function positionSignatureFromFen(fen) {
    const p = parseFen(fen);

    return [
      boardToFen(p.board),
      p.turn,
      normalizeCastling(p.castling),
      p.ep || "-",
      p.halfmove,
      p.fullmove
    ].join(" ");
  }

  function uciFromMove(move) {
    return move.from +
      move.to +
      (move.promotion || "");
  }

  function isSameMove(a, b) {
    return (
      a.from === b.from &&
      a.to === b.to &&
      (a.promotion || "") === (b.promotion || "")
    );
  }

  function makeChess(fen) {
    try {
      return new window.Chess(fen);
    } catch (error) {
      return null;
    }
  }

  function getVerboseLegalMoves(game) {
    try {
      return game.moves({ verbose: true });
    } catch (_) {
      return [];
    }
  }

  function playMove(game, move) {
    try {
      return game.move({
        from: move.from,
        to: move.to,
        promotion: move.promotion || undefined
      });
    } catch (_) {
      return null;
    }
  }

  // ============================================================
  // PLAUSIBLE PREVIOUS MOVE ORIGINS
  // ============================================================

  function plausibleOrigins(target, toSq, piece) {
    const origins = new Set();

    const color = colorOf(piece);
    const type = pieceType(piece);

    const file = fileOf(toSq);
    const rank = rankOf(toSq);

    function add(f, r) {
      if (f < 0 || f > 7 || r < 0 || r > 7) {
        return;
      }

      const sq = square(f, r);

      if (target.board[sq] === null) {
        origins.add(sq);
      }
    }

    if (type === "p") {
      const direction = color === "w" ? 1 : -1;

      add(file, rank - direction);
      add(file - 1, rank - direction);
      add(file + 1, rank - direction);

      const startRank = color === "w" ? 1 : 6;

      if (rank === startRank + 2 * direction) {
        add(file, rank - 2 * direction);
      }
    } else if (type === "n") {
      const offsets = [
        [1, 2],
        [2, 1],
        [-1, 2],
        [-2, 1],
        [1, -2],
        [2, -1],
        [-1, -2],
        [-2, -1]
      ];

      for (const [df, dr] of offsets) {
        add(file + df, rank + dr);
      }
    } else if (type === "k") {
      for (let df = -1; df <= 1; df++) {
        for (let dr = -1; dr <= 1; dr++) {
          if (df || dr) {
            add(file + df, rank + dr);
          }
        }
      }
    } else {
      const directions = [];

      if (type === "b" || type === "q") {
        directions.push(
          [1, 1],
          [1, -1],
          [-1, 1],
          [-1, -1]
        );
      }

      if (type === "r" || type === "q") {
        directions.push(
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1]
        );
      }

      for (const [df, dr] of directions) {
        let f = file + df;
        let r = rank + dr;

        while (f >= 0 && f < 8 && r >= 0 && r < 8) {
          const sq = square(f, r);

          if (target.board[sq] !== null) {
            break;
          }

          origins.add(sq);

          f += df;
          r += dr;
        }
      }
    }

    return origins;
  }

  // ============================================================
  // CASTLING RIGHTS
  // ============================================================

  function rightsOptions(targetRights) {
      const options = [];

      // A target position with no castling rights can have
      // originated from any previous combination of rights.
      const required = targetRights === "-"
          ? ""
          : targetRights;

      for (let mask = 0; mask < 16; mask++) {
          let value = "";

          for (let i = 0; i < CASTLING_ORDER.length; i++) {
              if (mask & (1 << i)) {
                  value += CASTLING_ORDER[i];
              }
          }

          if ([...required].every(ch => value.includes(ch))) {
              options.push(normalizeCastling(value));
          }
      }

      return options;
  }

  // ============================================================
  // BUILD PREVIOUS POSITION
  // ============================================================

  function buildPredecessor(
    target,
    fromSq,
    toSq,
    movingPiece,
    capturedPiece,
    capturedSquare,
    rights,
    promotion,
    isEnPassant
  ) {
    const mover = target.turn === "w" ? "b" : "w";

    const board = cloneBoard(target.board);

    board[toSq] = null;
    board[fromSq] = movingPiece;

    if (capturedPiece && capturedSquare !== null) {
      if (board[capturedSquare] !== null) {
        return null;
      }

      board[capturedSquare] = capturedPiece;
    }

    const isPawnMove = pieceType(movingPiece) === "p";
    const isCapture = !!capturedPiece;

    let halfmove;

    if (isPawnMove || isCapture) {
      if (target.halfmove !== 0) {
        return null;
      }

      halfmove = 0;
    } else {
      if (target.halfmove < 1) {
        return null;
      }

      halfmove = target.halfmove - 1;
    }

    const fullmove = mover === "b"
      ? target.fullmove - 1
      : target.fullmove;

    if (fullmove < 1) {
      return null;
    }

    const ep = isEnPassant
      ? squareName(toSq)
      : "-";

    const previous = {
      board,
      turn: mover,
      castling: rights,
      ep,
      halfmove,
      fullmove
    };

    const fen = makeFen(previous);
    const game = makeChess(fen);

    if (!game) return null;

    const otherTurnFen = [
      boardToFen(board),
      mover === "w" ? "b" : "w",
      normalizeCastling(rights),
      ep,
      String(halfmove),
      String(fullmove)
    ].join(" ");

    const otherTurnGame = makeChess(otherTurnFen);

    if (
      otherTurnGame &&
      typeof otherTurnGame.in_check === "function" &&
      otherTurnGame.in_check()
    ) {
      return null;
    }

    const requested = {
      from: squareName(fromSq),
      to: squareName(toSq),
      promotion: promotion || undefined
    };

    const legal = getVerboseLegalMoves(game);

    const legalMove = legal.find(m =>
      isSameMove(m, requested)
    );

    if (!legalMove) return null;

    if (
      isEnPassant &&
      !String(legalMove.flags || "").includes("e")
    ) {
      return null;
    }

    if (
      !isEnPassant &&
      String(legalMove.flags || "").includes("e")
    ) {
      return null;
    }

    const made = playMove(game, requested);

    if (!made) return null;

    let afterFen;

    try {
      afterFen = game.fen();
    } catch (_) {
      return null;
    }

    if (
      positionSignatureFromFen(afterFen) !==
      positionSignatureFromFen(makeFen(target))
    ) {
      return null;
    }

    return {
      fen,
      move: requested,
      uci: uciFromMove(requested),
      san: made.san
    };
  }

  // ============================================================
  // RECONSTRUCT ALL POSSIBLE LAST MOVES
  // ============================================================

  function reverseCandidates(targetFen) {
    const target = parseFen(targetFen);

    const mover = target.turn === "w" ? "b" : "w";

    const candidates = [];
    const seen = new Set();

    const rightsSets = rightsOptions(target.castling);

    function addCandidate(candidate) {
      if (!candidate) return;

      const key = candidate.fen + "|" + candidate.uci;

      if (!seen.has(key)) {
        seen.add(key);
        candidates.push(candidate);
      }
    }

    function testCandidate(
      fromSq,
      toSq,
      movingPiece,
      capturedPiece,
      capturedSquare,
      promotion,
      rights,
      isEnPassant
    ) {
      addCandidate(
        buildPredecessor(
          target,
          fromSq,
          toSq,
          movingPiece,
          capturedPiece,
          capturedSquare,
          rights,
          promotion,
          !!isEnPassant
        )
      );
    }

    // Ordinary moves, captures, promotions, and en passant.

    for (let toSq = 0; toSq < 64; toSq++) {
      const targetPiece = target.board[toSq];

      if (!targetPiece || colorOf(targetPiece) !== mover) {
        continue;
      }

      for (const fromSq of plausibleOrigins(
        target,
        toSq,
        targetPiece
      )) {
        const targetRank = rankOf(toSq);
        const originRank = rankOf(fromSq);

        const promotionRank = mover === "w" ? 7 : 0;
        const originPromotionRank = mover === "w" ? 6 : 1;

        const isPromotionSquare =
          ["q", "r", "b", "n"].includes(pieceType(targetPiece)) &&
          targetRank === promotionRank &&
          originRank === originPromotionRank;

        const movingOptions = [
          {
            piece: targetPiece,
            promotion: null
          }
        ];

        if (isPromotionSquare) {
          movingOptions.push({
            piece: mover === "w" ? "P" : "p",
            promotion: pieceType(targetPiece)
          });
        }

        for (const option of movingOptions) {
          for (const rights of rightsSets) {
            // Quiet move.

            testCandidate(
              fromSq,
              toSq,
              option.piece,
              null,
              null,
              option.promotion,
              rights,
              false
            );

            // Captures on destination square.

            for (const capturedType of PIECE_TYPES) {
              const capturedPiece = mover === "w"
                ? capturedType
                : capturedType.toUpperCase();

              testCandidate(
                fromSq,
                toSq,
                option.piece,
                capturedPiece,
                toSq,
                option.promotion,
                rights,
                false
              );
            }

            // En passant.

            if (pieceType(option.piece) === "p") {
              const direction = mover === "w" ? 1 : -1;

              const capturedSq = toSq - 8 * direction;

              if (capturedSq >= 0 && capturedSq < 64) {
                const capturedPawn = mover === "w"
                  ? "p"
                  : "P";

                testCandidate(
                  fromSq,
                  toSq,
                  option.piece,
                  capturedPawn,
                  capturedSq,
                  option.promotion,
                  rights,
                  true
                );
              }
            }
          }
        }
      }
    }

    // Castling.

    const backRank = mover === "w" ? 0 : 7;
    const kingFrom = square(4, backRank);

    const castleSpecs = [
      {
        kingTo: square(6, backRank),
        rookTo: square(5, backRank),
        rookFrom: square(7, backRank),
        right: mover === "w" ? "K" : "k"
      },
      {
        kingTo: square(2, backRank),
        rookTo: square(3, backRank),
        rookFrom: square(0, backRank),
        right: mover === "w" ? "Q" : "q"
      }
    ];

    for (const spec of castleSpecs) {
      const king = target.board[spec.kingTo];
      const rook = target.board[spec.rookTo];

      if (king !== (mover === "w" ? "K" : "k")) {
        continue;
      }

      if (rook !== (mover === "w" ? "R" : "r")) {
        continue;
      }

      for (const rights of rightsSets) {
        if (!rights.includes(spec.right)) {
          continue;
        }

        const board = cloneBoard(target.board);

        board[spec.kingTo] = null;
        board[spec.rookTo] = null;

        board[kingFrom] = mover === "w" ? "K" : "k";
        board[spec.rookFrom] = mover === "w" ? "R" : "r";

        if (target.halfmove < 1) continue;

        const fullmove = mover === "b"
          ? target.fullmove - 1
          : target.fullmove;

        if (fullmove < 1) continue;

        const previous = {
          board,
          turn: mover,
          castling: rights,
          ep: "-",
          halfmove: target.halfmove - 1,
          fullmove
        };

        const fen = makeFen(previous);
        const game = makeChess(fen);

        if (!game) continue;

        const move = {
          from: squareName(kingFrom),
          to: squareName(spec.kingTo),
          promotion: undefined
        };

        const legalMove = getVerboseLegalMoves(game).find(m =>
          isSameMove(m, move)
        );

        if (
          !legalMove ||
          !String(legalMove.flags || "").match(/[kq]/)
        ) {
          continue;
        }

        const made = playMove(game, move);

        if (!made) continue;

        if (
          positionSignatureFromFen(game.fen()) !==
          positionSignatureFromFen(makeFen(target))
        ) {
          continue;
        }

        const candidate = {
          fen,
          move,
          uci: uciFromMove(move),
          san: made.san
        };

        const key = candidate.fen + "|" + candidate.uci;

        if (!seen.has(key)) {
          seen.add(key);
          candidates.push(candidate);
        }
      }
    }

    return candidates;
  }

  // ============================================================
  // ELO RANGE
  // ============================================================

  function makeEloRangeFromUserElo(elo) {
      if (!Number.isInteger(elo) || elo < 0) {
          throw new Error(
              "Elo must be a non-negative whole number."
          );
      }

      return [elo];
  }

  function makeEloRange(minimum, maximum) {
    if (
      !Number.isInteger(minimum) ||
      !Number.isInteger(maximum) ||
      minimum < 0 ||
      maximum < 0
    ) {
      throw new Error(
        "Elo values must be non-negative whole numbers."
      );
    }

    if (minimum > maximum) {
      throw new Error(
        "Minimum Elo cannot exceed maximum Elo."
      );
    }

    if (maximum - minimum > 10000) {
      throw new Error("The Elo range is too large.");
    }

    const values = [];

    for (let value = minimum; value <= maximum; value += 100) {
      values.push(value);
    }

    if (!values.length || values[values.length - 1] !== maximum) {
      values.push(maximum);
    }

    return values;
  }

  // ============================================================
  // MAIA POLICY ADAPTER
  // ============================================================

  function policyMoveUci(entry) {
    if (typeof entry === "string") {
      return entry;
    }

    if (!entry || typeof entry !== "object") {
      return null;
    }

    const direct =
      entry.uci ||
      entry.uci_move ||
      entry.uciMove ||
      entry.move_uci;

    if (typeof direct === "string") {
      return direct;
    }

    if (typeof entry.move === "string") {
      return entry.move;
    }

    const move = entry.move &&
      typeof entry.move === "object"
      ? entry.move
      : entry;

    if (
      typeof move.from === "string" &&
      typeof move.to === "string"
    ) {
      return move.from +
        move.to +
        (move.promotion || "");
    }

    return null;
  }

  function policyProbability(entry) {
    if (
      typeof entry === "number" &&
      Number.isFinite(entry)
    ) {
      return entry;
    }

    if (!entry || typeof entry !== "object") {
      return null;
    }

    for (const key of [
      "probability",
      "prob",
      "p",
      "policy",
      "moveProbability",
      "move_probability"
    ]) {
      if (
        typeof entry[key] === "number" &&
        Number.isFinite(entry[key])
      ) {
        return entry[key];
      }
    }

    return null;
  }

  function getMoveProbability(result, wantedUci) {
    if (!result || result.policy == null) {
      throw new Error(
        "Maia evaluate() did not return a policy. " +
        "Check maia-engine.js output."
      );
    }

    const policy = result.policy;

    if (Array.isArray(policy)) {
      for (const entry of policy) {
        if (
          Array.isArray(entry) &&
          entry.length >= 2
        ) {
          if (
            String(entry[0]) === wantedUci &&
            typeof entry[1] === "number"
          ) {
            return entry[1];
          }
        }

        if (policyMoveUci(entry) === wantedUci) {
          const probability = policyProbability(entry);

          if (probability !== null) {
            return probability;
          }
        }
      }
    } else if (typeof policy === "object") {
      if (typeof policy[wantedUci] === "number") {
        return policy[wantedUci];
      }

      for (const [key, value] of Object.entries(policy)) {
        if (
          key === wantedUci &&
          typeof value === "number"
        ) {
          return value;
        }

        if (policyMoveUci(value) === wantedUci) {
          const probability = policyProbability(value);

          if (probability !== null) {
            return probability;
          }
        }
      }
    }

    throw new Error(
      "Could not find a probability for move " +
      wantedUci +
      " in Maia's policy. The policy output format " +
      "needs an adapter adjustment."
    );
  }

  // ============================================================
  // SCORE ONE CANDIDATE
  // ============================================================

  async function scoreCandidate(
    candidate,
    eloValues,
    engine,
    onProgress
  ) {
    let probabilitySum = 0;
    let validCount = 0;

    for (let i = 0; i < eloValues.length; i++) {
      const elo = eloValues[i];

      const game = makeChess(candidate.fen);

      if (!game) continue;

      const result = await engine.evaluate(
          game,
          elo,
          elo
      );

      const probability = getMoveProbability(
        result,
        candidate.uci
      );

      if (
        Number.isFinite(probability) &&
        probability >= 0
      ) {
        probabilitySum += probability;
        validCount++;
      }

      if (onProgress) {
        onProgress({
          eloIndex: i + 1,
          eloTotal: eloValues.length,
          elo,
          candidate
        });
      }
    }

    if (!validCount) return null;

    return {
      probability: probabilitySum / validCount,
      probabilityCount: validCount,
      ...candidate
    };
  }

  // ============================================================
  // RANK ALL CANDIDATES
  // ============================================================

  async function rankCandidates(
    candidates,
    eloValues,
    engine,
    onProgress
  ) {
    const ranked = [];

    for (let i = 0; i < candidates.length; i++) {
      if (onProgress) {
        onProgress({
          candidateIndex: i + 1,
          candidateTotal: candidates.length
        });
      }

      const scored = await scoreCandidate(
        candidates[i],
        eloValues,
        engine,
        onProgress
      );

      if (scored) {
        ranked.push(scored);
      }
    }

    ranked.sort((a, b) =>
      b.probability - a.probability
    );

    return ranked;
  }

  // ============================================================
  // HTML INTERFACE
  // ============================================================

  function createInterface(root) {
    root.innerHTML = `
      <section class="reverse-fen-app">

        <style>
          .reverse-fen-app {
            font: 15px/1.5 system-ui, sans-serif;
            color: inherit;
            max-width: 100%;
          }

          .reverse-fen-app * {
            box-sizing: border-box;
          }

          .reverse-fen-app .rf-panel {
            border: 1px solid #8885;
            border-radius: 12px;
            padding: 16px;
            margin: 12px 0;
          }

          .reverse-fen-app label {
            display: block;
            font-weight: 600;
            margin: 10px 0 5px;
          }

          .reverse-fen-app textarea,
          .reverse-fen-app input {
            width: 100%;
            padding: 10px;
            border: 1px solid #8888;
            border-radius: 7px;
            background: transparent;
            color: inherit;
            font: inherit;
          }

          .reverse-fen-app textarea {
            min-height: 82px;
            resize: vertical;
          }

          .reverse-fen-app .rf-grid {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 12px;
          }

          .reverse-fen-app button {
            border: 0;
            border-radius: 8px;
            padding: 10px 16px;
            background: #2563eb;
            color: white;
            font-weight: 650;
            cursor: pointer;
            margin-top: 14px;
          }

          .reverse-fen-app button:disabled {
            opacity: .55;
            cursor: wait;
          }

          .reverse-fen-app .rf-status {
            white-space: pre-wrap;
            margin-top: 12px;
          }

          .reverse-fen-app table {
            width: 100%;
            border-collapse: collapse;
            margin-top: 12px;
            font-size: 13px;
          }

          .reverse-fen-app th,
          .reverse-fen-app td {
            text-align: left;
            padding: 8px;
            border-bottom: 1px solid #8885;
            vertical-align: top;
          }

          .reverse-fen-app code {
            overflow-wrap: anywhere;
          }

          .reverse-fen-app .rf-muted {
            opacity: .7;
            font-size: 13px;
          }

          @media(max-width:560px) {
            .reverse-fen-app .rf-grid {
              grid-template-columns: 1fr;
            }

            .reverse-fen-app table {
              font-size: 12px;
            }
          }
        </style>

        <div class="rf-panel">

          <h2 style="margin:0 0 8px">
            Backwards FEN Solver
          </h2>

          <div class="rf-muted">
            Reconstruct legal positions that could have
            produced the supplied FEN, then rank the last
            moves using Maia 3.
          </div>

          <label for="rf-fen">
            Target FEN
          </label>

          <textarea
            id="rf-fen"
            spellcheck="false"
            placeholder="Paste a FEN position here"
          ></textarea>

          <div class="rf-grid">

            <div>
              <label for="rf-elo">
                Your Elo
              </label>

              <input
                id="rf-elo"
                type="number"
                min="0"
                step="1"
                value="1000"
              >
            </div>

            <div>
              <label for="rf-limit">
                Results to display
              </label>

              <input
                id="rf-limit"
                type="number"
                min="1"
                max="100"
                step="1"
                value="15"
              >
            </div>

          </div>

          <button id="rf-run" type="button">
            Find likely last moves
          </button>

          <div
            id="rf-status"
            class="rf-status"
            role="status"
            aria-live="polite"
          ></div>

        </div>

        <div
          id="rf-results"
          class="rf-panel"
          hidden
        ></div>

      </section>
    `;

    const fenInput = root.querySelector("#rf-fen");
    const eloInput = root.querySelector("#rf-elo");
    const limitInput = root.querySelector("#rf-limit");
    const runButton = root.querySelector("#rf-run");
    const status = root.querySelector("#rf-status");
    const results = root.querySelector("#rf-results");

    runButton.addEventListener("click", async () => {
      runButton.disabled = true;

      results.hidden = true;
      results.innerHTML = "";

      try {
        assertDependencies();

        const fen = fenInput.value.trim();

        if (!fen) {
          throw new Error("Paste a FEN first.");
        }

        const targetGame = makeChess(fen);

        if (!targetGame) {
          throw new Error(
            "chess.js could not load this FEN. Check its syntax."
          );
        }

        const targetPosition = parseFen(fen);

        if (
          targetPosition.board.filter(p => p === "K").length !== 1 ||
          targetPosition.board.filter(p => p === "k").length !== 1
        ) {
          throw new Error(
            "The position must contain exactly one white king " +
            "and one black king."
          );
        }

        const elo = Number(eloInput.value);

        const eloValues = makeEloRangeFromUserElo(elo);

        const limit = Math.max(
          1,
          Math.min(100, Number(limitInput.value) || 15)
        );

        status.textContent =
          "Reconstructing possible previous positions...";

        await new Promise(resolve =>
          setTimeout(resolve, 0)
        );

        const candidates = reverseCandidates(fen);
        console.log("[Reverse FEN] Parsed target:", parseFen(fen));

        status.textContent =
          "Found " + candidates.length +
          " legal predecessor move(s).\n" +
          "Elo evaluations: " + eloValues.join(", ") +
          "\nScoring candidates with Maia 3...";

        if (!candidates.length) {
          status.textContent +=
            "\nNo legal previous position could be reconstructed. " +
            "A FEN does not contain complete game history.";

          return;
        }

        const ranked = await rankCandidates(
          candidates,
          eloValues,
          window.engine,
          progress => {
            if (progress.candidateIndex) {
              status.textContent =
                "Found " + candidates.length +
                " legal predecessor move(s).\n" +
                "Scoring candidate " +
                progress.candidateIndex +
                "/" +
                progress.candidateTotal +
                "...";
            }
          }
        );

        if (!ranked.length) {
          status.textContent =
            "Maia could not score any reconstructed candidates.";

          return;
        }

        const rows = ranked
          .slice(0, limit)
          .map((item, index) => `
            <tr>
              <td>${index + 1}</td>
              <td>
                <strong>${escapeHtml(item.uci)}</strong>
              </td>
              <td>${escapeHtml(item.san || "")}</td>
              <td>
                ${(item.probability * 100).toFixed(4)}%
              </td>
              <td>
                <code>${escapeHtml(item.fen)}</code>
              </td>
            </tr>
          `)
          .join("");

        results.innerHTML = `
          <h3 style="margin:0">
            Most likely last moves
          </h3>

          <div class="rf-muted">
            Maia move probability at Elo ${eloValues[0]} (1 evaluation per candidate).
          </div>

          <div style="overflow-x:auto">
            <table>
              <thead>
                <tr>
                  <th>Rank</th>
                  <th>UCI</th>
                  <th>SAN</th>
                  <th>Average</th>
                  <th>Previous position FEN</th>
                </tr>
              </thead>

              <tbody>
                ${rows}
              </tbody>
            </table>
          </div>

          <p class="rf-muted">
            Maia estimates human move likelihood; it cannot
            prove the actual historical move. A FEN does not
            preserve the complete game history.
          </p>
        `;

        results.hidden = false;

        status.textContent =
          "Finished. Scored " + ranked.length +
          " candidate move(s).";

      } catch (error) {
        console.error(
          "Backwards FEN solver error:",
          error
        );

        status.textContent =
          "ERROR: " +
          (error && error.message
            ? error.message
            : String(error));

      } finally {
        runButton.disabled = false;
      }
    });
  }

  // ============================================================
  // HTML ESCAPING
  // ============================================================

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, ch => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;"
    })[ch]);
  }


  // ============================================================
  // PUBLIC API
  // ============================================================

  async function findLikelyLastMove(fen, elo = 1000) {
      console.log("[Reverse FEN] Started.");
      console.log("[Reverse FEN] Target FEN:", fen);
      console.log("[Reverse FEN] Elo:", elo);

      const candidates = reverseCandidates(fen);

      console.log(
          `[Reverse FEN] Generated ${candidates.length} candidate moves.`
      );

      if (candidates.length === 0) {
          console.warn("[Reverse FEN] No candidate moves found.");
          return {
              best: null,
              ranked: [],
              candidateCount: 0,
              elo
          };
      }

      const ranked = [];

      for (let i = 0; i < candidates.length; i++) {
          const candidate = candidates[i];

          console.log(
              `[Reverse FEN] Evaluating ${i + 1}/${candidates.length}:`,
              candidate.uci
          );

          try {
              const scored = await scoreCandidate(candidate, elo);
              ranked.push(scored);

              console.log(
                  `[Reverse FEN] Completed ${i + 1}/${candidates.length}:`,
                  candidate.uci,
                  `Probability: ${scored.probability}`
              );
          } catch (error) {
              console.error(
                  `[Reverse FEN] Failed ${i + 1}/${candidates.length}:`,
                  candidate.uci,
                  error
              );
          }
      }

      ranked.sort((a, b) => b.probability - a.probability);

      const best = ranked[0] || null;

      console.log("[Reverse FEN] Finished.");
      console.log(
          `[Reverse FEN] Successfully evaluated ${ranked.length}/${candidates.length} candidates.`
      );

      if (best) {
          console.log("[Reverse FEN] Most likely last move:", best.san, best.uci);
          console.log("[Reverse FEN] Probability:", best.probability);
      }

      return {
          best,
          ranked,
          candidateCount: candidates.length,
          elo
      };
  }

  window.ReverseFenSolver = {
    parseFen,
    makeFen,
    plausibleOrigins,
    reverseCandidates,
    makeEloRange,
    makeEloRangeFromUserElo,
    getMoveProbability,
    scoreCandidate,
    rankCandidates,
    findLikelyLastMove
  };

  // ============================================================
  // START
  // ============================================================

  function boot() {
    const root = document.getElementById(
      "reverse-fen-solver"
    );

    if (root && !root.querySelector(".reverse-fen-app")) {
      createInterface(root);
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot, {
      once: true
    });
  } else {
    boot();
  }

})();