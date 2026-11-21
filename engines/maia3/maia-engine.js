
// Simplified Maia 3 engine — plain JavaScript

// Resolve resources relative to this file, not the HTML page.
const MAIA_ENGINE_DIRECTORY = new URL(
    "./",
    document.currentScript.src
);

class MaiaEngine {
    constructor({
        modelUrl = new URL(
            "maia3_simplified.onnx",
            MAIA_ENGINE_DIRECTORY
        ).href,

        modelVersion = "3",
        onStatus = () => {},
        onProgress = () => {}
    } = {}) {

        this.worker = new Worker(
            new URL(
                "maia-worker.js",
                MAIA_ENGINE_DIRECTORY
            )
        );

        this.onStatus = onStatus;
        this.onProgress = onProgress;

        this.pending = new Map();
        this.nextId = 0;
        this.status = "loading";

        this.readyPromise = new Promise((resolve, reject) => {
            this._resolveReady = resolve;
            this._rejectReady = reject;
        });

        this.worker.onmessage = (e) => {
            const msg = e.data;

            switch (msg.type) {
                case "status":
                    this.status = msg.status;
                    this.onStatus(msg.status);

                    if (msg.status === "ready") {
                        this._resolveReady();
                    }

                    if (
                        msg.status === "no-cache" &&
                        !this._downloadTriggered
                    ) {
                        this._downloadTriggered = true;
                        this.worker.postMessage({
                            type: "download"
                        });
                    }
                    break;

                case "progress":
                    this.onProgress(
                        msg.progress,
                        msg.loaded,
                        msg.total
                    );
                    break;

                case "error":
                    if (
                        msg.id !== undefined &&
                        this.pending.has(msg.id)
                    ) {
                        this.pending.get(msg.id).reject(
                            new Error(msg.message)
                        );

                        this.pending.delete(msg.id);
                    } else {
                        console.error(
                            "Maia error:",
                            msg.message
                        );

                        this._rejectReady(
                            new Error(msg.message)
                        );
                    }
                    break;

                case "inference-result": {
                    const p = this.pending.get(msg.id);

                    if (p) {
                        p.resolve({
                            logitsMove: new Float32Array(
                                msg.logitsMove
                            ),
                            logitsValue: new Float32Array(
                                msg.logitsValue
                            )
                        });

                        this.pending.delete(msg.id);
                    }

                    break;
                }
            }
        };

        this.worker.onerror = (err) => {
            console.error("Maia worker crashed:", err);

            this._rejectReady(
                new Error(err.message || "Worker crashed")
            );
        };

        this.worker.postMessage({
            type: "init",
            modelUrl,
            modelVersion
        });
    }

    async load() {
        return this.readyPromise;
    }

    _runInference(tokens, eloSelfs, eloOppos, batchSize) {
        const id = this.nextId++;

        return new Promise((resolve, reject) => {
            this.pending.set(id, { resolve, reject });

            this.worker.postMessage(
                {
                    type: "inference",
                    id,
                    tokens: tokens.buffer,
                    eloSelfs: eloSelfs.buffer,
                    eloOppos: eloOppos.buffer,
                    batchSize
                },
                [
                    tokens.buffer,
                    eloSelfs.buffer,
                    eloOppos.buffer
                ]
            );
        });
    }

    async evaluate(
        chessObj,
        eloSelf = 1500,
        eloOppo = 1500
    ) {
        await this.load();

        const fen = chessObj.fen();

        const {
            boardTokens,
            legalMoves
        } = MaiaTensor.preprocessMaia3(chessObj);

        const {
            logitsMove,
            logitsValue
        } = await this._runInference(
            boardTokens,
            Float32Array.from([eloSelf]),
            Float32Array.from([eloOppo]),
            1
        );

        return MaiaTensor.processOutputsMaia3(
            fen,
            logitsMove,
            logitsValue,
            legalMoves
        );
    }

    async getMove(
        chessObj,
        eloSelf = 1500,
        eloOppo = 1500
    ) {
        const { policy } = await this.evaluate(
            chessObj,
            eloSelf,
            eloOppo
        );

        return Object.keys(policy)[0];
    }
}

window.MaiaEngine = MaiaEngine;

// Create the global engine instance.
window.engine = new MaiaEngine();
