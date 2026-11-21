
from __future__ import annotations

import json
import math
import sys
from pathlib import Path

import chess
import numpy as np
import onnxruntime as ort


ROOT = Path(__file__).resolve().parent.parent
MODEL_PATH = ROOT / "engines" / "maia3" / "maia3_simplified.onnx"

MOVE_TABLE_CANDIDATES = [
    ROOT / "data" / "all_moves_maia3.json",
    ROOT / "engines" / "maia3" / "data" / "all_moves_maia3.json",
    ROOT / "puzzle" / "data" / "all_moves_maia3.json",
]

PIECE_CHANNELS = {
    (chess.WHITE, chess.PAWN): 0,
    (chess.WHITE, chess.KNIGHT): 1,
    (chess.WHITE, chess.BISHOP): 2,
    (chess.WHITE, chess.ROOK): 3,
    (chess.WHITE, chess.QUEEN): 4,
    (chess.WHITE, chess.KING): 5,
    (chess.BLACK, chess.PAWN): 6,
    (chess.BLACK, chess.KNIGHT): 7,
    (chess.BLACK, chess.BISHOP): 8,
    (chess.BLACK, chess.ROOK): 9,
    (chess.BLACK, chess.QUEEN): 10,
    (chess.BLACK, chess.KING): 11,
}

PROMOTION_TYPES = (
    chess.QUEEN,
    chess.ROOK,
    chess.BISHOP,
    chess.KNIGHT,
)

CAPTURE_TYPES = (
    chess.PAWN,
    chess.KNIGHT,
    chess.BISHOP,
    chess.ROOK,
    chess.QUEEN,
)

# python-chess represents castling rights using rook-square bitboards.
CASTLING_BITS = (
    chess.BB_H1,
    chess.BB_A1,
    chess.BB_H8,
    chess.BB_A8,
)


# ============================================================
# MAIA MOVE TABLE
# ============================================================

def locate_move_table() -> Path:
    for path in MOVE_TABLE_CANDIDATES:
        if path.is_file():
            return path

    searched = "\n".join(str(p) for p in MOVE_TABLE_CANDIDATES)

    raise FileNotFoundError(
        "Could not find all_moves_maia3.json. Checked:\n" + searched
    )


def load_move_table() -> dict[str, int]:
    path = locate_move_table()

    with path.open("r", encoding="utf-8") as f:
        data = json.load(f)

    table = {
        str(k): int(v)
        for k, v in data.items()
    }

    print(f"Loaded {len(table):,} Maia move mappings.")

    return table


# ============================================================
# BOARD ENCODING
# ============================================================

def board_tokens(board: chess.Board) -> np.ndarray:
    """Create Maia's [64, 12] piece tensor."""

    tokens = np.zeros((64, 12), dtype=np.float32)

    for square, piece in board.piece_map().items():
        channel = PIECE_CHANNELS[
            (piece.color, piece.piece_type)
        ]

        tokens[square, channel] = 1.0

    return tokens


def mirror_move(move: chess.Move) -> chess.Move:
    """Mirror ranks and swap colors."""

    return chess.Move(
        chess.square_mirror(move.from_square),
        chess.square_mirror(move.to_square),
        promotion=move.promotion,
        drop=move.drop,
    )


def canonical_position(
    board: chess.Board,
) -> tuple[chess.Board, bool]:
    """Maia expects White to move."""

    if board.turn == chess.WHITE:
        return board, False

    return board.mirror(), True


# ============================================================
# POSITION COMPARISON
# ============================================================

def position_signature(board: chess.Board) -> tuple:
    return (
        board.board_fen(),
        board.turn,
        board.clean_castling_rights(),
        board.ep_square,
        board.halfmove_clock,
        board.fullmove_number,
    )


def target_matches(
    board: chess.Board,
    target: chess.Board,
) -> bool:
    return position_signature(board) == position_signature(target)


# ============================================================
# CASTLING RIGHTS
# ============================================================

def rights_options(target_rights: int) -> list[int]:
    """Generate possible predecessor castling-right combinations."""

    options = []

    for mask in range(16):
        rights = 0

        for i, bit in enumerate(CASTLING_BITS):
            if mask & (1 << i):
                rights |= bit

        if (rights & target_rights) == target_rights:
            options.append(rights)

    return options


# ============================================================
# POSSIBLE PREVIOUS MOVE ORIGINS
# ============================================================

def plausible_origins(
    target: chess.Board,
    to_sq: int,
    piece: chess.Piece,
) -> set[int]:

    origins: set[int] = set()

    color = piece.color
    ptype = piece.piece_type

    file = chess.square_file(to_sq)
    rank = chess.square_rank(to_sq)

    def add(f: int, r: int) -> None:
        if 0 <= f < 8 and 0 <= r < 8:
            sq = chess.square(f, r)

            if target.piece_at(sq) is None:
                origins.add(sq)

    if ptype == chess.PAWN:

        direction = 1 if color == chess.WHITE else -1

        add(file, rank - direction)
        add(file - 1, rank - direction)
        add(file + 1, rank - direction)

        start_rank = 1 if color == chess.WHITE else 6

        if rank == start_rank + 2 * direction:
            add(file, rank - 2 * direction)

    elif ptype == chess.KNIGHT:

        offsets = (
            (1, 2), (2, 1),
            (-1, 2), (-2, 1),
            (1, -2), (2, -1),
            (-1, -2), (-2, -1),
        )

        for df, dr in offsets:
            add(file + df, rank + dr)

    elif ptype == chess.KING:

        for df in (-1, 0, 1):
            for dr in (-1, 0, 1):
                if df or dr:
                    add(file + df, rank + dr)

    else:

        directions = []

        if ptype in (chess.BISHOP, chess.QUEEN):
            directions += [
                (1, 1), (1, -1),
                (-1, 1), (-1, -1),
            ]

        if ptype in (chess.ROOK, chess.QUEEN):
            directions += [
                (1, 0), (-1, 0),
                (0, 1), (0, -1),
            ]

        for df, dr in directions:

            f = file + df
            r = rank + dr

            while 0 <= f < 8 and 0 <= r < 8:

                sq = chess.square(f, r)

                if target.piece_at(sq) is not None:
                    break

                origins.add(sq)

                f += df
                r += dr

    return origins


# ============================================================
# RECONSTRUCT PREVIOUS POSITION
# ============================================================

def build_predecessor(
    target: chess.Board,
    from_sq: int,
    to_sq: int,
    moving_piece: chess.Piece,
    captured_piece: chess.Piece | None,
    captured_square: int | None,
    rights: int,
    promotion: int | None,
) -> chess.Board | None:

    mover = not target.turn

    previous = chess.Board(None)
    previous.clear_board()

    for sq, piece in target.piece_map().items():

        if sq != to_sq:
            previous.set_piece_at(sq, piece)

    previous.set_piece_at(from_sq, moving_piece)

    if captured_piece is not None and captured_square is not None:

        if previous.piece_at(captured_square) is not None:
            return None

        previous.set_piece_at(captured_square, captured_piece)

    previous.turn = mover
    previous.castling_rights = rights
    previous.ep_square = None

    is_pawn_move = moving_piece.piece_type == chess.PAWN
    is_capture = captured_piece is not None

    if is_pawn_move or is_capture:

        if target.halfmove_clock != 0:
            return None

        previous.halfmove_clock = 0

    else:

        if target.halfmove_clock < 1:
            return None

        previous.halfmove_clock = target.halfmove_clock - 1

    previous.fullmove_number = (
        target.fullmove_number - 1
        if mover == chess.BLACK
        else target.fullmove_number
    )

    if previous.fullmove_number < 1:
        return None

    if not previous.is_valid():
        return None

    return previous


# ============================================================
# GENERATE POSSIBLE LAST MOVES
# ============================================================

def reverse_candidates(
    target: chess.Board,
) -> list[tuple[chess.Board, chess.Move]]:

    mover = not target.turn

    candidates = []

    seen: set[tuple[str, str]] = set()

    rights_sets = rights_options(
        target.clean_castling_rights()
    )

    def test_candidate(
        from_sq: int,
        to_sq: int,
        moving_piece: chess.Piece,
        captured_piece: chess.Piece | None,
        captured_square: int | None,
        promotion: int | None,
        rights: int,
    ) -> None:

        previous = build_predecessor(
            target,
            from_sq,
            to_sq,
            moving_piece,
            captured_piece,
            captured_square,
            rights,
            promotion,
        )

        if previous is None:
            return

        move = chess.Move(
            from_sq,
            to_sq,
            promotion=promotion,
        )

        if move not in previous.legal_moves:
            return

        previous.push(move)

        if not target_matches(previous, target):
            return

        previous.pop()

        key = (
            previous.fen(en_passant="fen"),
            move.uci(),
        )

        if key not in seen:
            seen.add(key)
            candidates.append((previous, move))

    # Ordinary moves, captures, and promotions.

    for to_sq, target_piece in target.piece_map().items():

        if target_piece.color != mover:
            continue

        for from_sq in plausible_origins(
            target,
            to_sq,
            target_piece,
        ):

            is_promotion_square = (
                target_piece.piece_type in PROMOTION_TYPES
                and chess.square_rank(to_sq) == (
                    7 if mover else 0
                )
                and chess.square_rank(from_sq) == (
                    6 if mover else 1
                )
            )

            moving_options = [
                (target_piece, None)
            ]

            if is_promotion_square:

                moving_options.append(
                    (
                        chess.Piece(chess.PAWN, mover),
                        target_piece.piece_type,
                    )
                )

            for moving_piece, promotion in moving_options:

                for rights in rights_sets:

                    # Quiet move.

                    test_candidate(
                        from_sq,
                        to_sq,
                        moving_piece,
                        None,
                        None,
                        promotion,
                        rights,
                    )

                    # Ordinary captures.

                    for captured_type in CAPTURE_TYPES:

                        captured = chess.Piece(
                            captured_type,
                            not mover,
                        )

                        test_candidate(
                            from_sq,
                            to_sq,
                            moving_piece,
                            captured,
                            to_sq,
                            promotion,
                            rights,
                        )

                    # En passant.

                    if moving_piece.piece_type == chess.PAWN:

                        direction = (
                            1 if mover == chess.WHITE else -1
                        )

                        ep_capture_sq = (
                            to_sq - 8 * direction
                        )

                        if 0 <= ep_capture_sq < 64:

                            captured = chess.Piece(
                                chess.PAWN,
                                not mover,
                            )

                            test_candidate(
                                from_sq,
                                to_sq,
                                moving_piece,
                                captured,
                                ep_capture_sq,
                                promotion,
                                rights,
                            )

    # Castling.

    back_rank = 0 if mover == chess.WHITE else 7

    king_from = chess.square(4, back_rank)

    # Each specification contains the actual castling-right bitboard.
    castle_specs = (
        (
            chess.square(6, back_rank),
            chess.square(5, back_rank),
            chess.square(7, back_rank),
            chess.BB_H1 if mover == chess.WHITE else chess.BB_H8,
        ),
        (
            chess.square(2, back_rank),
            chess.square(3, back_rank),
            chess.square(0, back_rank),
            chess.BB_A1 if mover == chess.WHITE else chess.BB_A8,
        ),
    )

    for king_to, rook_to, rook_from, right_bit in castle_specs:

        king = target.piece_at(king_to)
        rook = target.piece_at(rook_to)

        if king != chess.Piece(chess.KING, mover):
            continue

        if rook != chess.Piece(chess.ROOK, mover):
            continue

        for rights in rights_sets:

            if not (rights & right_bit):
                continue

            previous = chess.Board(None)
            previous.clear_board()

            for sq, piece in target.piece_map().items():

                if sq not in (king_to, rook_to):
                    previous.set_piece_at(sq, piece)

            previous.set_piece_at(
                king_from,
                chess.Piece(chess.KING, mover),
            )

            previous.set_piece_at(
                rook_from,
                chess.Piece(chess.ROOK, mover),
            )

            previous.turn = mover
            previous.castling_rights = rights
            previous.ep_square = None

            if target.halfmove_clock < 1:
                continue

            previous.halfmove_clock = (
                target.halfmove_clock - 1
            )

            previous.fullmove_number = (
                target.fullmove_number - 1
                if mover == chess.BLACK
                else target.fullmove_number
            )

            if previous.fullmove_number < 1:
                continue

            if not previous.is_valid():
                continue

            move = chess.Move(
                king_from,
                king_to,
            )

            if move not in previous.legal_moves:
                continue

            previous.push(move)

            if not target_matches(previous, target):
                continue

            previous.pop()

            key = (
                previous.fen(en_passant="fen"),
                move.uci(),
            )

            if key not in seen:
                seen.add(key)
                candidates.append((previous, move))

    return candidates


# ============================================================
# ELO RANGE
# ============================================================

def make_elo_range(
    minimum: int,
    maximum: int,
) -> list[int]:

    if minimum < 0 or maximum < 0:
        raise ValueError("Elo values cannot be negative.")

    if minimum > maximum:
        raise ValueError("Minimum Elo cannot exceed maximum Elo.")

    if maximum - minimum > 10000:
        raise ValueError("The Elo range is too large.")

    values = list(range(minimum, maximum + 1, 100))

    if not values or values[-1] != maximum:
        values.append(maximum)

    return values


# ============================================================
# MAIA MODEL
# ============================================================

class MaiaModel:

    def __init__(self, elo_values: list[int]):

        if not MODEL_PATH.is_file():
            raise FileNotFoundError(
                f"Maia model not found: {MODEL_PATH}"
            )

        self.elo_values = [
            float(elo)
            for elo in elo_values
        ]

        print(f"\nLoading Maia 3 model: {MODEL_PATH}")

        session_options = ort.SessionOptions()

        session_options.graph_optimization_level = (
            ort.GraphOptimizationLevel.ORT_DISABLE_ALL
        )

        session_options.execution_mode = ort.ExecutionMode.ORT_SEQUENTIAL
        session_options.intra_op_num_threads = 1
        session_options.inter_op_num_threads = 1

        self.session = ort.InferenceSession(
            str(MODEL_PATH),
            sess_options=session_options,
            providers=["CPUExecutionProvider"],
        )

        self.move_to_index = load_move_table()

        print("Maia 3 is ready.")

        
    def score_batch(
        self,
        candidates: list[tuple[chess.Board, chess.Move]],
        start: int,
        batch_size: int,
    ) -> list[tuple[float, chess.Board, chess.Move]]:

        batch = candidates[start:start + batch_size]

        if not batch:
            return []

        tokens_batch = []
        candidate_indices = []
        legal_indices_per_position = []

        for previous, move in batch:

            canonical, mirrored = canonical_position(previous)

            tokens_batch.append(
                board_tokens(canonical)
            )

            canonical_move = (
                mirror_move(move)
                if mirrored
                else move
            )

            move_index = self.move_to_index.get(
                canonical_move.uci()
            )

            candidate_indices.append(move_index)

            legal_indices = []

            for legal_move in canonical.legal_moves:

                index = self.move_to_index.get(
                    legal_move.uci()
                )

                if index is not None:
                    legal_indices.append(index)

            legal_indices_per_position.append(
                legal_indices
            )

        tokens_array = np.asarray(
            tokens_batch,
            dtype=np.float32,
        )

        # Sum each candidate's probability over all Elo values.
        probability_sums = np.zeros(
            len(batch),
            dtype=np.float64,
        )

        valid_counts = np.zeros(
            len(batch),
            dtype=np.int32,
        )

        # Reuse the same ONNX session and positions for every Elo.
        for elo in self.elo_values:

            elo_array = np.full(
                len(batch),
                elo,
                dtype=np.float32,
            )

            feeds = {
                "tokens": tokens_array,
                "elo_self": elo_array,
                "elo_oppo": elo_array,
            }

            logits = self.session.run(
                ["logits_move"],
                feeds,
            )[0]

            for i in range(len(batch)):

                candidate_index = candidate_indices[i]
                legal_indices = legal_indices_per_position[i]

                if candidate_index is None:
                    continue

                if candidate_index not in legal_indices:
                    continue

                if not legal_indices:
                    continue

                legal_logits = logits[i, legal_indices]

                max_logit = float(
                    np.max(legal_logits)
                )

                exp_values = np.exp(
                    legal_logits - max_logit
                )

                denominator = float(
                    np.sum(exp_values)
                )

                if denominator <= 0 or not math.isfinite(denominator):
                    continue

                candidate_logit = float(
                    logits[i, candidate_index]
                )

                probability = (
                    math.exp(candidate_logit - max_logit)
                    / denominator
                )

                probability_sums[i] += probability
                valid_counts[i] += 1

        results = []

        for i, (previous, move) in enumerate(batch):

            if valid_counts[i] == 0:
                continue

            average_probability = (
                probability_sums[i] / valid_counts[i]
            )

            results.append(
                (
                    float(average_probability),
                    previous,
                    move,
                )
            )

        return results

    def rank(
        self,
        candidates: list[tuple[chess.Board, chess.Move]],
        batch_size: int = 32,
    ) -> list[tuple[float, chess.Board, chess.Move]]:

        ranked = []

        total = len(candidates)

        for start in range(0, total, batch_size):

            end = min(
                start + batch_size,
                total,
            )

            print(
                f"\rEvaluating candidates: {end}/{total}",
                end="",
                flush=True,
            )

            ranked.extend(
                self.score_batch(
                    candidates,
                    start,
                    batch_size,
                )
            )

        if total:
            print()

        ranked.sort(
            key=lambda item: item[0],
            reverse=True,
        )

        return ranked


# ============================================================
# USER INPUT
# ============================================================

def get_fen() -> str:

    while True:

        fen = input("\nPaste the FEN: ").strip()

        if fen:
            return fen

        print("Please enter a FEN.")


def get_elo_range() -> list[int]:

    while True:
        try:
            elo = int(input("\nEnter your Elo: ").strip())

            if elo < 0:
                print("Elo cannot be negative.")
                continue

            minimum = ((elo - 50) // 50) * 50
            maximum = ((elo + 50 + 49) // 50) * 50

            values = list(range(minimum, maximum + 1, 50))

            print(f"\nMinimum Elo: {minimum}")
            print(f"Maximum Elo: {maximum}")
            print("Elo values:", ", ".join(map(str, values)))

            return values

        except ValueError:
            print("Enter a valid whole-number Elo.")


# ============================================================
# MAIN
# ============================================================

def main() -> int:

    try:

        fen = get_fen()

        target = chess.Board(fen)

        if not target.is_valid():

            raise ValueError(
                "The supplied FEN describes an invalid chess position. "
                f"python-chess status: {target.status()}"
            )

        elo_values = get_elo_range()

        print("\n" + "=" * 76)
        print("BACKWARDS FEN SOLVER")
        print("=" * 76)

        print(
            f"\nPosition: {target.fen(en_passant='fen')}"
        )

        print(
            f"Elo range: {elo_values[0]}–{elo_values[-1]}"
        )

        print(
            f"Elo evaluations: {len(elo_values)}"
        )

        print(
            "\nReconstructing possible previous positions..."
        )

        candidates = reverse_candidates(target)

        print(
            f"Found {len(candidates)} legal predecessor move(s)."
        )

        if not candidates:

            print(
                "\nNo legal previous position could be reconstructed."
            )

            print(
                "This can happen with edited positions, unusual FEN "
                "history information, or positions with missing history."
            )

            return 0

        model = MaiaModel(elo_values)

        ranked = model.rank(candidates)

        if not ranked:

            print(
                "Maia could not score any reconstructed candidates."
            )

            return 1

        print("\n" + "=" * 100)
        print("MOST LIKELY LAST MOVES")
        print("=" * 100)

        print(
            f"{'Rank':<6}"
            f"{'Move':<10}"
            f"{'SAN':<10}"
            f"{'Average':>12}"
            f"  Previous position"
        )

        print("-" * 100)

        for rank, (probability, previous, move) in enumerate(
            ranked[:15],
            start=1,
        ):

            san_board = previous.copy()

            try:
                san = san_board.san(move)
            except Exception:
                san = move.uci()

            print(
                f"{rank:<6}"
                f"{move.uci():<10}"
                f"{san:<10}"
                f"{probability * 100:>10.4f}%  "
                f"{previous.fen(en_passant='fen')}"
            )

        print("\n" + "=" * 100)

        print(
            "The average probability is calculated across every Elo "
            "value in your selected range."
        )

        print(
            "Maia estimates human move likelihood; it cannot prove "
            "the actual historical move."
        )

        print(
            "A FEN does not preserve the complete game history."
        )

        return 0

    except KeyboardInterrupt:

        print("\nCancelled.")

        return 130

    except Exception as exc:

        print(
            f"\nERROR: {exc}",
            file=sys.stderr,
        )

        return 1


if __name__ == "__main__":
    raise SystemExit(main())
