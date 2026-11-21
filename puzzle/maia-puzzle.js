
// ============================================
// MAIA 3 — CHESS PUZZLE INTEGRATION
// GamesCoReal
// ============================================

(() => {
  const MAIA_DATA_PATH = "../data/";

  let initialization = null;

  // --------------------------------------------
  // INITIALIZE MAIA
  // --------------------------------------------

  async function initialize() {
    if (window.engine && window.MaiaTensor) {
      if (window.MaiaPuzzleReady) return true;
    }

    if (initialization) return initialization;

    initialization = (async () => {
      if (!window.MaiaTensor) {
        throw new Error("MaiaTensor was not loaded.");
      }

      await window.MaiaTensor.initMoveTables(
        MAIA_DATA_PATH
      );

      if (!window.engine) {
        throw new Error(
          "Maia engine was not created."
        );
      }

      window.MaiaPuzzleReady = true;

      console.log("Maia 3 initialized.");

      return true;
    })();

    try {
      return await initialization;
    } catch (error) {
      initialization = null;
      throw error;
    }
  }

  // --------------------------------------------
  // GET MAIA'S PREFERRED MOVE
  // --------------------------------------------

  async function getBestMove(fen, rating = 250) {
    await initialize();

    const game = new Chess(fen);

    const result = await window.engine.evaluate(
      game,
      String(rating),
      Number(rating)
    );

    if (!result || !result.policy) {
      throw new Error(
        "Maia did not return a move policy."
      );
    }

    const legalMoves = game.moves({
      verbose: true
    });

    const legalUci = new Set(
      legalMoves.map(move =>
        move.from +
        move.to +
        (move.promotion || "")
      )
    );

    const rankedMoves = Object.entries(
      result.policy
    );

    const best = rankedMoves.find(
      ([uci]) => legalUci.has(uci)
    );

    if (!best) {
      throw new Error(
        "Maia returned no legal moves."
      );
    }

    const [uci, probability] = best;

    return {
      uci,
      from: uci.slice(0, 2),
      to: uci.slice(2, 4),
      promotion: uci.length > 4
        ? uci[4]
        : null,
      probability,
      value: result.value
    };
  }

  // --------------------------------------------
  // PUBLIC API
  // --------------------------------------------

  window.MaiaPuzzle = {
    initialize,
    getBestMove
  };

})();
