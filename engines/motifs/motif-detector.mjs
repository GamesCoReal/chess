import init, { analyze as analyzeMoveRust, analyze_pv as analyzePvRust } from "./engine_rs.mjs";

let initPromise = null;

export function ensureReady() {
  if (!initPromise) {
    initPromise = init()
      .then(() => true)
      .catch((error) => {
        initPromise = null;
        throw error;
      });
  }
  return initPromise;
}

function withLabels(result) {
  if (!result || result.error) return result;
  return {
    ...result,
    motifs: (result.motifs || []).map((motif) => ({
      ...motif,
      label: motif.id.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase()),
    })),
  };
}

export async function analyzeMove(fen, uci) {
  await ensureReady();
  return withLabels(analyzeMoveRust(fen, uci));
}

export async function analyzePv(startFen, ucis, plies = ucis.length) {
  await ensureReady();
  const results = analyzePvRust(startFen, ucis, Math.min(plies, ucis.length));
  if (!Array.isArray(results)) throw new Error("Rust motif analyzer returned an invalid PV result.");
  return results.map(withLabels);
}

window.positionalChessMotifs = { ensureReady, analyzeMove, analyzePv };
