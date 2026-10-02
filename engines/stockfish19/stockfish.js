// Keep the worker entry beside stockfish.wasm so Stockfish's default WASM
// resolver loads the matching file without depending on URL-fragment parsing.
importScripts("./stockfish-19-lite-single.js");
