class StockfishEvaluator {
  constructor({ workerUrl = "./engines/stockfish19/stockfish-19-lite-single.js?v=3" } = {}) {
    this.workerUrl = workerUrl;
    this.worker = null;
    this.ready = false;
    this.readyPromise = null;
    this.resolveReady = null;
    this.rejectReady = null;
    this.current = null;
    this.pending = null;
    this.startupTimer = null;
  }

  start() {
    if (this.readyPromise) return this.readyPromise;

    this.readyPromise = new Promise((resolve, reject) => {
      this.resolveReady = resolve;
      this.rejectReady = reject;
    });
    const startupPromise = this.readyPromise;

    try {
      // Stockfish.js looks for a wasm file derived from its worker URL unless
      // the wasm URL is supplied in the URL fragment. The bundled file here is
      // named stockfish.wasm, so pass its actual location explicitly.
      const workerUrl = new URL(this.workerUrl, document.baseURI);
      const wasmUrl = new URL("./stockfish.wasm", workerUrl);
      workerUrl.hash = encodeURIComponent(wasmUrl.href);
      this.worker = new Worker(workerUrl.href);
      this.startupTimer = setTimeout(() => {
        this.failWorker(new Error("Stockfish did not finish loading its WASM engine and UCI handshake within 120 seconds."));
      }, 120000);
      this.worker.onmessage = (event) => this.handleMessage(String(event.data));
      this.worker.onerror = (event) => {
        const error = new Error(event.message || "Stockfish worker failed to load.");
        this.failWorker(error);
      };
      this.worker.postMessage("uci");
    } catch (error) {
      this.failWorker(error);
    }

    return startupPromise;
  }

  failWorker(error) {
    clearTimeout(this.startupTimer);
    this.worker?.terminate();
    this.worker = null;
    const wasReady = this.ready;
    const rejectReady = this.rejectReady;
    this.ready = false;
    this.readyPromise = null;
    this.resolveReady = null;
    this.rejectReady = null;
    if (!wasReady) rejectReady?.(error);
    this.current?.reject(error);
    this.pending?.reject(error);
    this.current = null;
    this.pending = null;
  }

  handleMessage(message) {
    const lines = String(message).split(/\r?\n/);
    if (lines.length > 1) {
      lines.forEach((line) => this.handleMessage(line));
      return;
    }
    const line = lines[0].trim();
    if (!line) return;

    if (line === "uciok") {
      this.worker.postMessage("setoption name Threads value 1");
      this.worker.postMessage("setoption name Hash value 16");
      this.worker.postMessage("isready");
      return;
    }

    if (line === "readyok") {
      clearTimeout(this.startupTimer);
      this.ready = true;
      this.resolveReady?.();
      this.startPending();
      return;
    }

    const scoreMatch = line.match(/\bscore\s+(cp|mate)\s+([+-]?\d+)/);
    if (scoreMatch && this.current) {
      const depthMatch = line.match(/\bdepth\s+(\d+)/);
      if (this.current.multiPv) {
        const pvIndex = Number(line.match(/\bmultipv\s+(\d+)/)?.[1] || 1);
        const pvMatch = line.match(/\bpv\s+(.+)$/);
        if (!pvMatch) return;
        const candidate = {
          multipv: pvIndex,
          type: scoreMatch[1],
          value: Number(scoreMatch[2]),
          depth: depthMatch ? Number(depthMatch[1]) : null,
          pv: pvMatch[1].trim().split(/\s+/),
        };
        this.current.lines.set(pvIndex, candidate);
        this.current.onUpdate?.([...this.current.lines.values()].sort((a, b) => a.multipv - b.multipv));
        return;
      }
      this.current.score = {
        type: scoreMatch[1],
        value: Number(scoreMatch[2]),
        depth: depthMatch ? Number(depthMatch[1]) : null,
      };
      this.current.onUpdate?.(this.current.score);
      return;
    }

    if (line.startsWith("bestmove") && this.current) {
      const result = this.current.multiPv
        ? [...this.current.lines.values()].sort((a, b) => a.multipv - b.multipv)
        : this.current.score;
      this.current.resolve(result);
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

  evaluateFenMultiPv(fen, { depth = 10, count = 5, onUpdate = () => {} } = {}) {
    return new Promise((resolve, reject) => {
      this.start().then(() => {
        if (this.pending) this.pending.resolve(null);
        this.pending = {
          fen,
          depth,
          count,
          multiPv: true,
          lines: new Map(),
          resolve,
          reject,
          onUpdate,
        };
        if (this.current) this.worker.postMessage("stop");
        else this.startPending();
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
    this.worker.postMessage(`setoption name MultiPV value ${this.current.multiPv ? this.current.count : 1}`);
    this.worker.postMessage(`position fen ${this.current.fen}`);
    this.worker.postMessage(this.current.multiPv ? `go depth ${this.current.depth}` : "go infinite");
  }
}

window.StockfishEvaluator = StockfishEvaluator;
window.stockfishEvaluator = new StockfishEvaluator();
