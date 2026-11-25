
import sqlite3
import shutil
from pathlib import Path
from datetime import datetime

import chess
import chess.engine


# ============================================
# SETTINGS
# ============================================

FOLDER = Path(__file__).resolve().parent

DATABASE = FOLDER / "MateIn1.db"
STOCKFISH = FOLDER / "stockfish.exe"

TABLE = "puzzles"
FEN_COLUMN = "fen"

ENGINE_DEPTH = 20


# ============================================
# CHECK FILES
# ============================================

if not DATABASE.exists():
    raise FileNotFoundError(f"Database not found: {DATABASE}")

if not STOCKFISH.exists():
    raise FileNotFoundError(f"Stockfish not found: {STOCKFISH}")


# ============================================
# BACKUP DATABASE
# ============================================

timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
BACKUP = FOLDER / f"MateIn1_backup_{timestamp}.db"

shutil.copy2(DATABASE, BACKUP)

print("=" * 55)
print("MATE IN 1 DATABASE AUDIT")
print("=" * 55)
print(f"Database: {DATABASE}")
print(f"Stockfish: {STOCKFISH}")
print(f"Backup: {BACKUP}")
print()


# ============================================
# CONNECT TO DATABASE
# ============================================

connection = sqlite3.connect(DATABASE)
cursor = connection.cursor()

cursor.execute(f"PRAGMA table_info({TABLE})")
columns = [column[1] for column in cursor.fetchall()]

if FEN_COLUMN not in columns:
    connection.close()
    raise RuntimeError(
        f"Column '{FEN_COLUMN}' not found in table '{TABLE}'. "
        f"Available columns: {columns}"
    )

cursor.execute(f"SELECT rowid, {FEN_COLUMN} FROM {TABLE}")
records = cursor.fetchall()

total = len(records)

print(f"Total puzzles: {total}")
print()


# ============================================
# START STOCKFISH
# ============================================

engine = chess.engine.SimpleEngine.popen_uci(str(STOCKFISH))

engine.configure({
    "Threads": 1,
    "Hash": 128
})


# ============================================
# ANALYZE EVERY PUZZLE
# ============================================

delete_ids = []
keep_count = 0
invalid_count = 0
analysis_errors = []

try:
    for index, (row_id, fen) in enumerate(records, start=1):

        try:
            board = chess.Board(fen)

            # Reject illegal positions.
            if not board.is_valid():
                delete_ids.append(row_id)
                invalid_count += 1
                result = "INVALID"

            # A position already checkmated is not a Mate-in-1 puzzle.
            elif board.is_checkmate():
                delete_ids.append(row_id)
                invalid_count += 1
                result = "ALREADY MATED"

            # Search specifically for mate in one.
            else:
                info = engine.analyse(
                    board,
                    chess.engine.Limit(mate=1)
                )

                mate_score = info["score"].pov(board.turn).mate()

                if mate_score == 1:
                    keep_count += 1
                    result = "KEEP"
                else:
                    delete_ids.append(row_id)
                    result = "DELETE"

        except Exception as error:
            analysis_errors.append((row_id, str(error)))
            result = "ERROR"

        if index % 100 == 0 or index == total:
            print(
                f"Progress: {index}/{total} | "
                f"Keep: {keep_count} | "
                f"Delete: {len(delete_ids)} | "
                f"Invalid: {invalid_count} | "
                f"Errors: {len(analysis_errors)}"
            )

finally:
    engine.quit()


# ============================================
# SAFETY CHECK
# ============================================

if analysis_errors:
    connection.close()

    print()
    print("AUDIT ABORTED.")
    print("Some positions could not be analyzed.")
    print("No database entries were deleted.")
    print("Backup is available at:")
    print(BACKUP)

    for row_id, error in analysis_errors[:10]:
        print(f"Row {row_id}: {error}")

    raise RuntimeError(
        f"{len(analysis_errors)} analysis errors. "
        "Database was not modified."
    )


# ============================================
# CONFIRM DELETION
# ============================================

delete_count = len(delete_ids)

print()
print("=" * 55)
print("AUDIT RESULTS")
print("=" * 55)
print(f"Original puzzles: {total}")
print(f"Valid Mate-in-1 puzzles: {keep_count}")
print(f"Entries to delete: {delete_count}")
print(f"Invalid positions: {invalid_count}")
print()

if delete_count == 0:
    print("Nothing needs to be deleted.")
    connection.close()
    raise SystemExit

confirmation = input(
    "Type DELETE to permanently remove the non-Mate-in-1 entries: "
)

if confirmation != "DELETE":
    print("Cancelled. Database was not modified.")
    connection.close()
    raise SystemExit


# ============================================
# DELETE NONQUALIFYING ENTRIES
# ============================================

try:
    cursor.executemany(
        f"DELETE FROM {TABLE} WHERE rowid = ?",
        [(row_id,) for row_id in delete_ids]
    )

    connection.commit()

except Exception:
    connection.rollback()
    connection.close()
    raise


# ============================================
# VERIFY DATABASE
# ============================================

cursor.execute(f"SELECT COUNT(*) FROM {TABLE}")
remaining = cursor.fetchone()[0]

connection.close()

print()
print("=" * 55)
print("CLEANUP COMPLETE")
print("=" * 55)
print(f"Remaining puzzles: {remaining}")
print(f"Deleted puzzles: {delete_count}")
print(f"Backup saved: {BACKUP}")
print()
print("MateIn1 database cleanup finished.")
