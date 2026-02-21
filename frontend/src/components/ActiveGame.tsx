import type { GameState } from "../gameState";
import { PHASE, MAX_GUESSES } from "../config";
import { WordleGrid } from "./WordleGrid";
import { Keyboard } from "./Keyboard";
import { Spinner } from "./Spinner.tsx";
import { formatTime } from "../utils.ts";

interface ActiveGameProps {
  game: GameState;
  currentGuess: string;
  busy: boolean;
  isMyTurn: boolean;
  myTimeLeft: number | null;
  oppTimeLeft: number | null;
  onChainPhase: number;
  chainTurn: number;
  winner: string;
  letterStates: Record<string, number | undefined>;
  onKey: (key: string) => void;
  onRevealWord: () => void;
  onClaimTimeout: () => void;
  onVerifyOnly: () => void;
}

export function ActiveGame({
  game, currentGuess, busy,
  isMyTurn, myTimeLeft, oppTimeLeft,
  onChainPhase, chainTurn, winner,
  letterStates, onKey,
  onRevealWord, onClaimTimeout, onVerifyOnly,
}: ActiveGameProps) {
  const myGridGuesses = game.myGuesses.map((g) => ({
    word: g.word,
    results: g.results.length > 0 ? g.results : undefined,
    verified: g.verified,
  }));

  const opponentGridGuesses = game.opponentGuesses.map((g) => ({
    word: g.word,
    results: g.results.length > 0 ? g.results : undefined,
    verified: g.verified,
  }));

  return (
    <>
      {/* Timers */}
      <div className="flex gap-3 mb-4">
        <div
          className={`px-4 py-2.5 rounded-lg font-mono text-sm border transition-colors ${
            isMyTurn
              ? "bg-primary/15 border-primary/40 text-primary"
              : "bg-card border-border text-muted-foreground"
          }`}
        >
          You: {formatTime(myTimeLeft ?? 0)}
          {isMyTurn && " (your turn)"}
        </div>
        <div
          className={`px-4 py-2.5 rounded-lg font-mono text-sm border transition-colors ${
            !isMyTurn
              ? "bg-destructive/15 border-destructive/40 text-destructive-foreground"
              : "bg-card border-border text-muted-foreground"
          }`}
        >
          Opponent: {formatTime(oppTimeLeft ?? 0)}
          {!isMyTurn && " (their turn)"}
        </div>
      </div>

      {/* Game info */}
      <div className="text-muted-foreground text-xs mb-4 font-mono">
        Role: {game.myRole === "p1" ? "Player 1" : "Player 2"}
        {" | Turn "}{chainTurn}
        {game.escrowAmount > 0 && ` | Pot: ${game.escrowAmount * 2} XLM`}
      </div>

      {/* Waiting for opponent */}
      {!isMyTurn && onChainPhase === PHASE.ACTIVE && (
        <div className="mb-4 px-4 py-2.5 bg-card border border-border rounded-lg text-muted-foreground text-sm flex items-center gap-2">
          <Spinner size={4} />
          Waiting for opponent's move…
        </div>
      )}

      {/* Reveal phase */}
      {onChainPhase === PHASE.REVEAL && (
        <div className="mb-4 px-5 py-4 bg-card border border-border rounded-lg max-w-md text-center">
          {winner === game.myAddress ? (
            <>
              <p className="text-primary font-bold mb-3">You won! Reveal your word to claim the pot.</p>
              <button
                onClick={onRevealWord}
                disabled={busy}
                className="bg-primary hover:bg-primary/90 disabled:opacity-50 text-primary-foreground font-bold px-5 py-2.5 rounded-lg transition-colors"
              >
                {busy ? "Revealing…" : `Reveal "${game.word.toUpperCase()}"`}
              </button>
            </>
          ) : (
            <>
              <p className="text-accent font-medium">Opponent must reveal their word…</p>
            </>
          )}
        </div>
      )}

      {/* Timeout claim */}
      {onChainPhase === PHASE.ACTIVE && !isMyTurn && oppTimeLeft !== null && oppTimeLeft <= 0 && (
        <div className="mb-4">
          <button
            onClick={onClaimTimeout}
            disabled={busy}
            className="bg-destructive hover:bg-destructive/90 disabled:opacity-50 text-destructive-foreground font-bold px-5 py-2.5 rounded-lg transition-colors"
          >
            Claim Timeout Win
          </button>
        </div>
      )}

      {/* Final verify-only turn */}
      {onChainPhase === PHASE.ACTIVE && isMyTurn && game.myGuesses.length >= MAX_GUESSES && (
        <div className="mb-4">
          <button
            onClick={onVerifyOnly}
            disabled={busy}
            className="bg-accent hover:bg-accent/90 disabled:opacity-50 text-accent-foreground font-bold px-5 py-2.5 rounded-lg transition-colors"
          >
            {busy ? "Verifying…" : "Submit Final Verification"}
          </button>
          <p className="text-muted-foreground text-xs mt-1.5">No more guesses — only verifying opponent's last guess.</p>
        </div>
      )}

      {/* Grids */}
      <div className="flex gap-6 mb-4 flex-wrap justify-center">
        <div className="flex flex-col items-center">
          <p className="text-muted-foreground text-xs mb-2 font-medium">Your Guesses</p>
          <WordleGrid
            guesses={myGridGuesses}
            currentGuess={isMyTurn && onChainPhase === PHASE.ACTIVE ? currentGuess : ""}
            maxRows={MAX_GUESSES}
          />
        </div>
        <div className="flex flex-col items-center">
          <p className="text-muted-foreground text-xs mb-2 font-medium">Opponent's Guesses</p>
          <WordleGrid
            guesses={opponentGridGuesses}
            currentGuess=""
            maxRows={MAX_GUESSES}
          />
        </div>
      </div>

      {/* Keyboard */}
      {onChainPhase === PHASE.ACTIVE && (
        <Keyboard onKey={onKey} letterStates={letterStates} />
      )}

      {/* Busy spinner */}
      {busy && (
        <div className="mt-4 flex items-center gap-2 text-accent">
          <Spinner size={5} />
          Processing…
        </div>
      )}
    </>
  );
}
