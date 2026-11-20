
import io
import random
import sqlite3
from pathlib import Path
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs

from PIL import Image, ImageDraw, ImageFont


# ============================================================
# CONFIGURATION
# ============================================================

ROOT = Path(__file__).resolve().parent
DATA_DIR = ROOT / "data"
PIECES_DIR = ROOT / "images" / "pieces"

HOST = "0.0.0.0"
PORT = 8000

IMAGE_WIDTH = 512
HEADER_HEIGHT = 48
BOARD_SIZE = 512
SQUARE_SIZE = BOARD_SIZE // 8
FEN_HEIGHT = 22
IMAGE_HEIGHT = HEADER_HEIGHT + BOARD_SIZE + FEN_HEIGHT

DATABASES = {
    1: 10,
    2: 20,
    3: 40,
    4: 20,
    5: 10,
}

PIECE_FILES = {
    "P": "pw.png",
    "N": "nw.png",
    "B": "bw.png",
    "R": "rw.png",
    "Q": "qw.png",
    "K": "kw.png",
    "p": "pb.png",
    "n": "nb.png",
    "b": "bb.png",
    "r": "rb.png",
    "q": "qb.png",
    "k": "kb.png",
}

DEFAULT_LIGHT = (240, 217, 181)
DEFAULT_DARK = (181, 136, 99)
BACKGROUND = (185, 174, 153)


# ============================================================
# FONTS
# ============================================================

def load_font(size, bold=False):
    paths = (
        [
            "C:/Windows/Fonts/arialbd.ttf",
            "C:/Windows/Fonts/segoeuib.ttf",
        ]
        if bold else
        [
            "C:/Windows/Fonts/arial.ttf",
            "C:/Windows/Fonts/segoeui.ttf",
        ]
    )

    for path in paths:
        if Path(path).exists():
            return ImageFont.truetype(path, size)

    return ImageFont.load_default()


# ============================================================
# URL PARAMETER VALIDATION
# ============================================================

def parse_rgb(value, default):
    if value is None:
        return default

    try:
        parts = [int(part.strip()) for part in value.split(",")]

        if len(parts) != 3:
            raise ValueError

        if any(number < 0 or number > 255 for number in parts):
            raise ValueError

        return tuple(parts)

    except (ValueError, AttributeError):
        raise ValueError(
            "RGB colors must use the format R,G,B with values from 0 to 255."
        )


def parse_settings(params):

    requested_mate = None
    requested_move = None

    if "matein" in params:
        try:
            requested_mate = int(params["matein"][0])
        except ValueError:
            raise ValueError("matein must be a number from 1 to 5.")

        if requested_mate not in DATABASES:
            raise ValueError("matein must be between 1 and 5.")

    if "move" in params:
        requested_move = params["move"][0].lower().strip()

        if requested_move not in ("white", "black"):
            raise ValueError("move must be either white or black.")

    light_square = parse_rgb(
        params.get("light", [None])[0],
        DEFAULT_LIGHT
    )

    dark_square = parse_rgb(
        params.get("dark", [None])[0],
        DEFAULT_DARK
    )

    return requested_mate, requested_move, light_square, dark_square


# ============================================================
# DATABASE
# ============================================================

def get_database_connection(mate):
    path = DATA_DIR / f"MateIn{mate}.db"

    if not path.exists():
        raise FileNotFoundError(f"Database not found: {path}")

    return sqlite3.connect(
        f"file:{path.as_posix()}?mode=ro",
        uri=True
    )


def select_puzzle(requested_mate=None, requested_move=None):

    if requested_move == "white":
        active_color = "w"
    elif requested_move == "black":
        active_color = "b"
    else:
        active_color = None

    if requested_mate is not None:
        candidate_mates = [requested_mate]
    else:
        candidate_mates = list(DATABASES)

    available = []

    for mate in candidate_mates:
        path = DATA_DIR / f"MateIn{mate}.db"

        if not path.exists():
            continue

        conn = get_database_connection(mate)

        try:
            if active_color is None:
                count = conn.execute(
                    "SELECT COUNT(*) FROM puzzles"
                ).fetchone()[0]
            else:
                count = conn.execute(
                    """
                    SELECT COUNT(*)
                    FROM puzzles
                    WHERE substr(fen, instr(fen, ' ') + 1, 1) = ?
                    """,
                    (active_color,)
                ).fetchone()[0]

        finally:
            conn.close()

        if count > 0:
            available.append(mate)

    if not available:
        raise LookupError("No puzzles match the requested settings.")

    if requested_mate is None:
        mate = random.choices(
            available,
            weights=[DATABASES[m] for m in available],
            k=1
        )[0]
    else:
        mate = requested_mate

    conn = get_database_connection(mate)

    try:
        if active_color is None:
            count = conn.execute(
                "SELECT COUNT(*) FROM puzzles"
            ).fetchone()[0]

            offset = random.randrange(count)

            row = conn.execute(
                "SELECT fen FROM puzzles LIMIT 1 OFFSET ?",
                (offset,)
            ).fetchone()

        else:
            count = conn.execute(
                """
                SELECT COUNT(*)
                FROM puzzles
                WHERE substr(fen, instr(fen, ' ') + 1, 1) = ?
                """,
                (active_color,)
            ).fetchone()[0]

            offset = random.randrange(count)

            row = conn.execute(
                """
                SELECT fen
                FROM puzzles
                WHERE substr(fen, instr(fen, ' ') + 1, 1) = ?
                LIMIT 1 OFFSET ?
                """,
                (active_color, offset)
            ).fetchone()

        if row is None:
            raise LookupError("Could not retrieve a matching puzzle.")

        return mate, row[0]

    finally:
        conn.close()


# ============================================================
# CHESSBOARD IMAGE
# ============================================================

def generate_board_image(
    fen,
    mate,
    light_square=DEFAULT_LIGHT,
    dark_square=DEFAULT_DARK
):

    parts = fen.split()

    if len(parts) < 4:
        raise ValueError("Invalid FEN.")

    position, active_color = parts[:2]

    if active_color not in ("w", "b"):
        raise ValueError("Invalid active color in FEN.")

    ranks = position.split("/")

    if len(ranks) != 8:
        raise ValueError("Invalid FEN: expected 8 ranks.")

    white = (255, 255, 255)
    black = (0, 0, 0)

    turn_color = white if active_color == "w" else black
    turn_name = "White" if active_color == "w" else "Black"

    image = Image.new(
        "RGB",
        (IMAGE_WIDTH, IMAGE_HEIGHT),
        BACKGROUND
    )

    draw = ImageDraw.Draw(image)

    # HEADER

    title_font = load_font(19, bold=True)
    subtitle_font = load_font(14, bold=True)

    title = f"{turn_name}'s Move:"
    subtitle = f"Mate In {mate}"

    def centered_text(text, y, font, color):
        bounds = draw.textbbox((0, 0), text, font=font)
        width = bounds[2] - bounds[0]
        x = (IMAGE_WIDTH - width) // 2 - bounds[0]

        draw.text(
            (x, y),
            text,
            font=font,
            fill=color,
            stroke_width=1 if color == white else 0,
            stroke_fill=(65, 55, 45)
        )

    centered_text(title, 3, title_font, turn_color)
    centered_text(subtitle, 26, subtitle_font, turn_color)

    # CHESSBOARD

    board_left = 0
    board_top = HEADER_HEIGHT

    for row in range(8):
        for column in range(8):

            color = (
                light_square
                if (row + column) % 2 == 0
                else dark_square
            )

            x = board_left + column * SQUARE_SIZE
            y = board_top + row * SQUARE_SIZE

            draw.rectangle(
                (
                    x,
                    y,
                    x + SQUARE_SIZE - 1,
                    y + SQUARE_SIZE - 1
                ),
                fill=color
            )

    # CHESS PIECES

    piece_size = 60

    for row, rank in enumerate(ranks):

        column = 0

        for character in rank:

            if character.isdigit():
                column += int(character)
                continue

            if character not in PIECE_FILES:
                raise ValueError(f"Invalid FEN piece: {character}")

            if column >= 8:
                raise ValueError("Invalid FEN rank.")

            piece_path = PIECES_DIR / PIECE_FILES[character]

            if not piece_path.exists():
                raise FileNotFoundError(
                    f"Missing piece image: {piece_path}"
                )

            with Image.open(piece_path) as source:
                piece = source.convert("RGBA")

            piece = piece.resize(
                (piece_size, piece_size),
                Image.Resampling.LANCZOS
            )

            x = board_left + column * SQUARE_SIZE
            y = board_top + row * SQUARE_SIZE

            piece_x = x + (SQUARE_SIZE - piece_size) // 2
            piece_y = y + (SQUARE_SIZE - piece_size) // 2

            image.paste(
                piece,
                (piece_x, piece_y),
                piece
            )

            column += 1

        if column != 8:
            raise ValueError("Invalid FEN rank: expected 8 squares.")

    # FULL FEN AT THE BOTTOM

    fen_left = SQUARE_SIZE
    fen_right = 7 * SQUARE_SIZE
    fen_area_width = fen_right - fen_left

    fen_font_size = 9
    fen_font = load_font(fen_font_size)

    while True:
        fen_bounds = draw.textbbox(
            (0, 0),
            fen,
            font=fen_font
        )

        fen_width = fen_bounds[2] - fen_bounds[0]

        if fen_width <= fen_area_width - 8 or fen_font_size <= 1:
            break

        fen_font_size -= 1
        fen_font = load_font(fen_font_size)

    fen_x = (
        fen_left
        + (fen_area_width - fen_width) // 2
        - fen_bounds[0]
    )

    draw.text(
        (fen_x, HEADER_HEIGHT + BOARD_SIZE + 5),
        fen,
        font=fen_font,
        fill=(65, 55, 45)
    )

    # EXPORT PNG

    output = io.BytesIO()

    image.save(
        output,
        format="PNG",
        optimize=True
    )

    output.seek(0)

    return output.getvalue()


# ============================================================
# HTTP API
# ============================================================

class PuzzleHandler(BaseHTTPRequestHandler):

    def send_cors_headers(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_cors_headers()
        self.end_headers()

    def do_GET(self):

        parsed = urlparse(self.path)

        if parsed.path == "/health":
            self.send_response(200)
            self.send_cors_headers()
            self.send_header("Content-Type", "text/plain")
            self.end_headers()
            self.wfile.write(b"API online")
            return

        if parsed.path != "/puzzle/image":
            self.send_error(404, "Endpoint not found.")
            return

        try:
            params = parse_qs(parsed.query)

            (
                requested_mate,
                requested_move,
                light_square,
                dark_square
            ) = parse_settings(params)

            mate, fen = select_puzzle(
                requested_mate,
                requested_move
            )

            image_data = generate_board_image(
                fen,
                mate,
                light_square,
                dark_square
            )

            self.send_response(200)
            self.send_cors_headers()

            self.send_header("Content-Type", "image/png")
            self.send_header("Content-Length", str(len(image_data)))
            self.send_header("Cache-Control", "no-store")
            self.send_header("X-Puzzle-Mate", str(mate))

            self.end_headers()
            self.wfile.write(image_data)

            print(
                f"Generated MateIn{mate} | "
                f"Move: {requested_move or 'Any'} | "
                f"Light: {light_square} | "
                f"Dark: {dark_square}"
            )

        except LookupError as error:
            message = str(error).encode("utf-8")

            self.send_response(404)
            self.send_cors_headers()
            self.send_header("Content-Type", "text/plain")
            self.send_header("Content-Length", str(len(message)))
            self.end_headers()
            self.wfile.write(message)

        except Exception as error:
            print(f"API ERROR: {error}")

            message = str(error).encode("utf-8")

            self.send_response(400)
            self.send_cors_headers()
            self.send_header("Content-Type", "text/plain")
            self.send_header("Content-Length", str(len(message)))
            self.end_headers()
            self.wfile.write(message)

    def log_message(self, format, *args):
        print(f"[API] {format % args}")


# ============================================================
# START SERVER
# ============================================================

def main():

    server = ThreadingHTTPServer(
        (HOST, PORT),
        PuzzleHandler
    )

    print("=" * 45)
    print("CHESS PUZZLE IMAGE API")
    print("=" * 45)
    print(f"Random: http://localhost:{PORT}/puzzle/image")
    print(f"Mate 3: http://localhost:{PORT}/puzzle/image?matein=3")
    print(f"Black:  http://localhost:{PORT}/puzzle/image?move=black")
    print("=" * 45)

    try:
        server.serve_forever()

    except KeyboardInterrupt:
        print("\nStopping server...")

    finally:
        server.server_close()


if __name__ == "__main__":
    main()
