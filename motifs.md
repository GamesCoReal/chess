# Chess Knowledge Reference

This file contains the chess rules, evaluation concepts, strategic concepts, tactical motifs, positional motifs, endgame concepts, opening concepts, and explanations used by the chess engine and motif detector.

---

# 1. Rules of Chess

## Piece Movement

### King

The king moves one square in any direction.

### Queen

The queen moves any number of squares horizontally, vertically, or diagonally.

### Rook

The rook moves any number of squares horizontally or vertically.

### Bishop

The bishop moves any number of squares diagonally.

### Knight

The knight moves in an L-shape: two squares in one direction and one square perpendicular to it.

### Pawn

Pawns move forward and capture diagonally.

---

## Special Moves

### Castling

A king and rook move simultaneously as part of one legal move.

### Kingside Castling

The king moves two squares toward the h-file rook and the rook moves to the square immediately beside the king.

### Queenside Castling

The king moves two squares toward the a-file rook and the rook moves to the square immediately beside the king.

### En Passant

A pawn can capture an opposing pawn that has just advanced two squares from its starting position as though that pawn had moved only one square.

### Promotion

A pawn reaching the final rank must promote to a queen, rook, bishop, or knight.

---

## Check

A king is in check when an enemy piece currently attacks its square.

## Checkmate

A king is in check and there is no legal move that removes the check.

## Stalemate

A player has no legal moves, but their king is not in check. The game is drawn.

---

## Draw

A game can be drawn through several mechanisms.

### Stalemate

A player has the move, their king is not in check, but they have no legal move.

The game ends immediately as a draw.

### Threefold Repetition

The same position occurs three times.

The relevant position includes:

- The same pieces on the same squares
- The same player to move
- The same castling rights
- The same en-passant rights

Depending on the rules being used, the draw may need to be claimed.

### Fifty-Move Rule

A draw can be claimed after 50 moves by each player without a pawn move or a capture.

### Insufficient Mating Material

The remaining material cannot produce checkmate through any legal sequence.

Common examples include:

- King vs. King
- King + Bishop vs. King
- King + Knight vs. King

### Agreement

Both players may agree to a draw.

### Other Draw Rules

Other applicable chess rules can also result in a draw, including certain dead positions and automatic-draw conditions depending on the ruleset.

---

# 2. Materials & Evaluation

## Piece Values

Piece values are conventional material estimates used to compare pieces. They are not literal points awarded during a game.

### Pawn

**1 point**

The basic unit of material.

### Knight

**3 points**

A knight is commonly valued at approximately three pawns.

Its ability to jump over pieces and create forks makes it particularly useful in many positions.

### Bishop

**3 points**

A bishop is commonly valued at approximately three pawns.

Bishops can control long diagonals and become especially powerful in open positions.

### Rook

**5 points**

A rook is commonly valued at approximately five pawns.

Rooks are particularly effective on open and semi-open files and on advanced ranks.

### Queen

**9 points**

A queen is commonly valued at approximately nine pawns.

It combines rook-like and bishop-like movement.

### King

The king has no conventional material value because it cannot be captured.

Checkmate ends the game.

These values are guidelines rather than absolute measurements. A piece's actual value depends on the position.

---

## Evaluation Factors

### Material

The difference in the value of the pieces and pawns remaining on the board.

### King Safety

How vulnerable each king is to checks, attacks, mating threats, and exposed lines.

### Piece Activity

How effectively the pieces control useful squares and participate in the position.

### Development

How quickly pieces are brought into useful positions.

### Center Control

Control and occupation of central squares.

### Space

The amount of useful territory controlled by a player.

### Pawn Structure

The strengths and weaknesses created by the arrangement of pawns.

### Initiative

The ability to create threats and force the opponent to respond.

### Mobility

The number and quality of useful legal moves available to the pieces.

### Passed Pawns

Advanced pawns that cannot be stopped by enemy pawns on their file or adjacent files.

### Weak Squares

Squares that cannot easily be defended by pawns and may become useful invasion points.

### Piece Coordination

How effectively the pieces support each other.

---

# 3. Opening Concepts

## Development

Moving knights and bishops from their starting squares to useful active squares.

Good development generally aims to bring pieces into positions where they control important squares, support other pieces, or prepare strategic plans.

## Center Control

Controlling or occupying central squares, especially:

- e4
- d4
- e5
- d5

The center can be controlled with pawns or pieces without necessarily occupying it with a pawn.

## King Safety

Getting the king to safety, usually through castling.

## Tempo

A useful move or unit of time gained while developing, creating a threat, attacking a piece, or accomplishing another useful purpose.

## Opening Principles

Common goals include:

- Develop pieces
- Control the center
- Castle
- Connect the rooks
- Avoid unnecessary repeated moves
- Avoid premature queen movement
- Develop pieces toward useful squares

These are principles rather than absolute rules. A move that violates one of them can still be correct when there is a tactical or strategic reason for it.

## Fianchetto

Developing a bishop to:

- b2 or g2 for White
- b7 or g7 for Black

A fianchetto typically places the bishop on a long diagonal toward the center or opposite side of the board.

## Open File

A file containing no pawns.

Open files can provide useful routes for rooks and queens.

## Semi-open File

A file containing one side's pawn but not the other side's pawn.

The side without the pawn can often use the file as a rook route.

## Connect the Rooks

The rooks become connected when the pieces between them have been cleared from the back rank.

This commonly happens after the king has castled and the minor pieces have developed.

## Avoid Unnecessary Repeated Moves

Moving the same piece repeatedly in the opening can spend tempi that could have been used to develop other pieces or improve the position.

## Avoid Premature Queen Movement

Moving the queen too early can allow the opponent to gain tempi by attacking it with developing pieces.

Early queen movement is not automatically bad when there is a concrete reason for it.

## Develop Toward Useful Squares

Development is not simply moving a piece away from its starting square.

A useful developing square can:

- Control the center
- Attack an enemy piece
- Defend a piece
- Prepare castling
- Support another piece
- Create a tactical threat
- Prepare a strategic plan

---

# 4. Middlegame Concepts

## Piece Activity

Keeping pieces on active squares where they control important areas.

## Initiative

Creating threats that force the opponent to react.

## Prophylaxis

Preventing or reducing the opponent's intended plan.

## Outpost

An advanced square, usually protected from enemy pawn attacks, where a piece can establish itself.

## Weak Square

A square that is difficult for the opponent to control with pawns.

## Pawn Break

A pawn move intended to change the pawn structure and open lines or create weaknesses.

## Open Lines

Opening files, ranks, or diagonals for rooks, bishops, or queens.

## Attack

Concentrating pieces and threats against a target, especially the king.

## Restriction

Reducing the opponent's useful moves and limiting their pieces.

---

# 5. Endgame Concepts

## King Activity

In endgames the king becomes an important active piece and can participate directly in attacking pawns, defending pieces, and controlling key squares.

## Opposition

Two kings face each other with an odd number of squares between them, allowing one king to control the other's approach.

## Zugzwang

A position where having to make a move worsens the player's position.

## Passed Pawn

A pawn with no enemy pawn capable of stopping it on its file or adjacent files.

## Pawn Promotion

Advancing a pawn to the final rank and promoting it to a:

- Queen
- Rook
- Bishop
- Knight

## Rook Activity

Active rooks are especially important for:

- Attacking passed pawns
- Supporting one's own passed pawns
- Checking the enemy king
- Controlling important files and ranks

## Rule of the Square

A method of determining whether a king can catch a passed pawn without calculating every move.

## Lucena Position

A fundamental rook-and-pawn winning technique in which the stronger side uses the rook and king to force promotion.

## Philidor Position

A fundamental rook-and-pawn defensive technique in which the defending rook prevents the opposing king from advancing and supports checks from the rear.

## Opposition in King-and-Pawn Endgames

Using king positioning to force the opposing king away from critical squares and allow your king or pawn to advance.

---

# 6. Tactical Concepts

## Fork

A move that attacks two or more enemy pieces or important targets simultaneously.

## Pin

A piece is unable or reluctant to move because moving it would expose a more valuable piece, commonly the king or queen, to attack.

## Skewer

An attack on a valuable piece that forces it to move, exposing a less valuable piece behind it.

## Battery

Two friendly pieces are aligned so that one supports or reinforces the other, often along a file, rank, or diagonal.

## Removal of Defender

A move removes or distracts a defending piece, making another enemy piece vulnerable.

## Overloaded Piece

A piece is responsible for defending multiple important targets and cannot adequately perform all of its defensive duties.

## Sacrifice

Giving up material intentionally in exchange for compensation such as:

- King attack
- Development
- Initiative
- Positional advantage
- Tactical gain
- Checkmate

## Hanging Piece

A piece is undefended or insufficiently defended and can potentially be captured without adequate compensation.

## Trapped Piece

A piece has very limited or no safe squares and can potentially be won because its escape routes are unavailable.

---

# 7. King Attack Concepts

## Greek Gift

A classic bishop sacrifice on h7 or h2 against a castled king, usually involving a follow-up attack with the queen and knight.

## Back-Rank Mate

A checkmate or mating threat against a king trapped on its back rank, often because its own pawns prevent escape.

## Smothered Mate

A checkmate delivered by a knight against a king whose escape squares are blocked by its own pieces.

## Anastasia's Mate

A mating pattern involving a knight restricting the king while a rook attacks along the king's rank or file.

## Boden's Mate

A mating pattern involving two bishops attacking the king from different-colored diagonals.

## Arabian Mate

A mating pattern typically involving a rook restricting the king along a rank or file while a knight controls nearby escape squares.

## Luft

An escape square created for the king, usually by moving a pawn near the castled king to reduce back-rank mating threats.

---

# 8. Pawn Structure Concepts

## Doubled Pawns

Two friendly pawns occupying the same file.

## Isolated Pawn

A pawn with no friendly pawn on either adjacent file.

## Isolated Queen Pawn

An isolated pawn on the d-file, commonly called an IQP.

## Backward Pawn

A pawn that is behind neighboring friendly pawns and cannot safely advance because of enemy control.

## Hanging Pawns

A pair of adjacent pawns, usually on neighboring files, that are not protected by pawns on the files behind them and can become targets.

## Pawn Storm

A series of pawn advances, usually toward the enemy king, intended to gain space and open attacking lines.

## Passed Pawn

A pawn with no enemy pawn on its file or adjacent files capable of stopping it.

## Pawn Breakthrough

A pawn advance or capture that creates or enables a passed pawn or otherwise significantly changes the pawn structure.

---

# 9. Positional Concepts

## Knight on the Rim

A knight placed on the a- or h-file.

It can have fewer useful squares because of its location.

## Bishop Pair

Having both bishops while the opponent has fewer than two bishops.

The bishop pair can become especially valuable in open positions.

## Bad Bishop

A bishop whose activity is restricted by its own pawns, particularly when those pawns occupy squares of the same color as the bishop.

## Color Complex

A group of squares of the same color that becomes strategically important because of weaknesses in control of those squares.

## Long Diagonal

One of the two diagonals running from corner to corner:

- a1–h8
- h1–a8

## Rook Lift

Moving a rook away from its normal back-rank position to an active rank, often to support an attack.

## Rook on the Seventh Rank

A rook placed on the opponent's seventh rank, or second rank for Black, where it can attack pawns and restrict the enemy king.

## Open File Rook

A rook using a file containing no pawns.

## Semi-Open File Rook

A rook using a file containing the opponent's pawn but no friendly pawn.

## Centralization

Moving a piece toward central squares where it can control a greater number of important squares.

## Piece Invasion

Moving a piece into the opponent's territory to attack important targets or establish a strong position.

---

# 10. Strategic Concepts

## Multi-Purpose Move

A move that accomplishes several useful objectives simultaneously.

For example, one move might:

- Develop a piece
- Attack an enemy piece
- Defend a pawn
- Prepare castling

## Prophylaxis

A move designed primarily to prevent or reduce an opponent's plan.

## Restriction

Limiting the opponent's legal moves, useful squares, or piece activity.

## Piece Coordination

Creating positions where pieces support each other and work together toward common targets.

## Initiative

Maintaining the ability to make threats and force the opponent to respond.

## Simplification

Trading pieces or pawns to reduce the complexity of the position, often when the resulting position is favorable.

## Exchange

Trading one piece for another, commonly pieces of similar material value.

## Pawn Lever

A pawn move that attacks an enemy pawn or creates the possibility of changing the pawn structure.

## Pawn Break

A pawn move that deliberately changes the structure to open lines, create weaknesses, or gain space.

---

# 11. Move-Class Basics

## castling

Detects when the move is kingside or queenside castling.

It can also detect when castling connects the two rooks.

## promotion

Detects a pawn promotion and identifies the piece the pawn promotes to.

## en passant

Detects an en passant capture.

## capture or trade

Classifies captures and trades.

It distinguishes:

- Normal captures
- Same-piece trades
- Queen trades
- Simplification while ahead
- Trades into an endgame
- Exchange sacrifices

## check class

Determines whether a move gives:

- Normal check
- Discovered check
- Double check

---

# 12. Tactics

## pin

Detects when a rook, bishop, or queen attacks along a line through one enemy piece to a more valuable enemy piece behind it.

The front piece is effectively pinned to the more valuable piece.

## skewer

Detects when a rook, bishop, or queen attacks two enemy pieces on the same line, with the more valuable piece in front.

The front piece is expected to be forced away, exposing the less valuable piece behind it.

## fork

Detects when the moved piece attacks at least two enemy targets and the attack represents a real material threat.

The detector gives special treatment to forks involving the king.

## battery

Detects two friendly sliding pieces aligned on the same line, with the rear piece supporting or reinforcing the front piece toward an important target such as a king, queen, or rook.

## threats and creates

Detects a new concrete threat created by the move, such as:

- Attacking a valuable enemy piece
- Creating a mating threat
- Making another enemy piece become hanging
- Creating a tactical threat

## traps piece

Detects when an enemy non-pawn, non-king piece has no safe legal escape because its possible moves lose material.

## removal of defender

Detects when a move removes a piece that was defending another enemy piece, causing that other piece to become hanging.

## overloaded

Detects an enemy piece that is the critical defender of at least two other pieces, where removing that defender would make both targets tactically vulnerable.

## sacrifice or hangs

Determines whether the moved piece is being given up.

### sacrifice

Material is sacrificed but the position provides enough compensation.

### hangs

The piece is lost without enough compensation.

## defends hanging

Detects when a move saves one of your previously hanging pieces by making it no longer vulnerable.

---

# 13. King Attack

## greek gift

Detects the classic bishop sacrifice on h7/h2 against a castled king when the attacking side has a suitable follow-up with a knight or queen.

## back rank mate threat

Detects a position where the enemy king is stuck on the back rank and a rook or queen has a realistic route to create a back-rank mate.

## attacks king

Detects a move that newly increases the moved piece's pressure around the enemy king.

It specifically identifies newly attacked king-zone squares.

## eyes king zone

Detects a rook, bishop, or queen that newly controls important squares around the enemy king or has a potential line toward the king blocked by a piece.

## smothered mate hint

Detects a knight check where the enemy king's surrounding squares are heavily occupied by its own pieces, indicating a possible smothered-mate pattern.

## anastasia mate threat

Detects the setup for an Anastasia-style mate:

- A knight restricting the king
- A rook prepared to attack along the king's rim file or rank

## bodens mate threat

Detects the setup for Boden's mate, where two bishops attack the enemy king from opposite-colored diagonals.

## arabian mate threat

Detects the Arabian-mate setup:

- A rook attacks along the king's rank or file
- A nearby knight controls the king's escape squares

## luft

Detects a pawn move that creates an escape square for a king trapped on the back rank in response to a real back-rank threat.

---

# 14. Positional / Piece-specific

## knight invasion

Detects a knight entering the opponent's territory on an outpost-like square that cannot easily be challenged by enemy pawns.

## outpost

Detects a knight or bishop establishing itself on an advanced square that cannot be effectively challenged by enemy pawns.

## fianchetto

Detects a bishop developing to b2/g2 for White or b7/g7 for Black.

## long diagonal

Detects a bishop or queen moving onto one of the two long diagonals:

- a1–h8
- h1–a8

## rook lift

Detects a rook moving from the back rank to an attacking rank on the kingside, such as a rook lift toward rank 3 for White or rank 6 for Black.

## rook play

Detects useful rook placement such as:

- Doubling rooks
- Using an open file
- Using a semi-open file
- Placing a rook on the seventh rank

## opens line for

Detects when moving a piece off a square opens a useful file or diagonal for one of your bishops, rooks, or queens.

## bad bishop

Detects a bishop whose movement is heavily restricted by its own pawns on squares of the bishop's color.

## bishop pair lost

Detects when you give up your bishop pair, particularly when the opponent still has both bishops.

## color complex

Detects when a side has no bishop controlling one color of squares while having enough pawns on that color to make those squares a lasting weakness.

## centralizes

Detects a piece moving onto a central square.

For pawns it uses a broader definition of the center.

## attacks pawn

Detects when a piece newly attacks an enemy pawn and the attack represents a real or positional pressure on that pawn, especially if the pawn is isolated or backward.

## prepares castling

Detects a move that clears the necessary squares for kingside or queenside castling.

## knight on rim

Detects an early knight move to the a- or h-file, which is generally considered a less active location.

## offers trade

Detects a quiet move that places a defended piece where an equal-value enemy piece can exchange with it cleanly.

## pawn breakthrough

Detects a pawn capture that creates or unlocks a passed pawn, creating a potential promotion threat.

---

# 15. Pawn Structure

## pawn structure changes

Detects structural changes involving:

- Isolated queen pawns (IQPs)
- Hanging pawn pairs
- Doubled pawns
- Backward pawns

It can identify these structures appearing for either side.

## pawn specific

Detects pawn-specific ideas such as:

- Pawn breaks
- Pawn levers
- Passed pawns
- Pawn storms
- Isolated pawns

---

# 16. Restriction / Development

## restricts

Detects when a move significantly reduces the opponent's available legal moves.

## develops

Detects useful development or activation of knights and bishops, with its wording changing depending on whether the game is in the opening, middlegame, or endgame.

---

# 17. Higher-order Strategic Features

## loss of castling rights

Detects when a king or rook move permanently removes kingside or queenside castling rights in the opening or middlegame.

## decisive combination

Detects a capture that also gives check or creates a serious follow-up threat, provided the move produces a significant evaluation improvement.

## prophylaxis

Detects a move that restricts the opponent by blocking an enemy attacking line, intended as a heuristic for prophylactic play.

## multi purpose

Detects a quiet move that accomplishes at least three useful strategic goals at once, without already being classified as a major tactical motif.