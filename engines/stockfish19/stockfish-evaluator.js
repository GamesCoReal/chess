class StockfishEvaluator {
  constructor({ workerUrl = "./engines/stockfish19/stockfish-19-lite-single.js?v=2", depth = 24 } = {}) {
    this.workerUrl = workerUrl;
    this.depth = depth;
    this.worker = null;
    this.ready = false;
    this.readyPromise = null;
    this.resolveReady = null;
    this.rejectReady = null;
    this.current = null;
    this.pending = null;
  }

  start() {
    if (this.readyPromise) return this.readyPromise;

    this.readyPromise = new Promise((resolve, reject) => {
      this.resolveReady = resolve;
      this.rejectReady = reject;
    });

    try {
      // Stockfish.js looks for a wasm file derived from its worker URL unless
      // the wasm URL is supplied in the URL fragment. The bundled file here is
      // named stockfish.wasm, so pass its actual location explicitly.
      const workerUrl = new URL(this.workerUrl, document.baseURI);
      const wasmUrl = new URL("./stockfish.wasm", workerUrl);
      workerUrl.hash = `${encodeURIComponent(wasmUrl.href)},worker`;
      this.worker = new Worker(workerUrl.href);
      this.worker.onmessage = (event) => this.handleMessage(String(event.data));
      this.worker.onerror = (event) => {
        const error = new Error(event.message || "Stockfish worker failed to load.");
        this.rejectReady?.(error);
        this.current?.reject(error);
        this.pending?.reject(error);
        this.current = null;
        this.pending = null;
      };
      this.worker.postMessage("uci");
    } catch (error) {
      this.rejectReady?.(error);
    }

    return this.readyPromise;
  }

  handleMessage(line) {
    if (line === "uciok") {
      this.worker.postMessage("setoption name Threads value 1");
      this.worker.postMessage("setoption name Hash value 16");
      this.worker.postMessage("isready");
      return;
    }

    if (line === "readyok") {
      this.ready = true;
      this.resolveReady?.();
      this.startPending();
      return;
    }

    const scoreMatch = line.match(/\bscore\s+(cp|mate)\s+([+-]?\d+)/);
    if (scoreMatch && this.current) {
      const depthMatch = line.match(/\bdepth\s+(\d+)/);
      this.current.score = {
        type: scoreMatch[1],
        value: Number(scoreMatch[2]),
        depth: depthMatch ? Number(depthMatch[1]) : null,
      };
      this.current.onUpdate?.(this.current.score);
      return;
    }

    if (line.startsWith("bestmove") && this.current) {
      this.current.resolve(this.current.score);
      this.current = null;
      this.startPending();
    }
  }

  evaluateFen(fen, onUpdate = () => {}) {
    return new Promise((resolve, reject) => {
      this.start().then(() => {
        if (this.pending) this.pending.resolve(null);
        this.pending = { fen, resolve, reject, onUpdate };
        if (this.current) {
          this.worker.postMessage("stop");
        } else {
          this.startPending();
        }
      }).catch(reject);
    });
  }

  stop() {
    if (this.pending) {
      this.pending.resolve(null);
      this.pending = null;
    }
    if (this.current) this.worker.postMessage("stop");
  }

  startPending() {
    if (!this.ready || this.current || !this.pending) return;

    this.current = this.pending;
    this.pending = null;
    this.worker.postMessage(`position fen ${this.current.fen}`);
    this.worker.postMessage(`go depth ${this.depth}`);
  }
}

window.StockfishEvaluator = StockfishEvaluator;
window.stockfishEvaluator = new StockfishEvaluator();
