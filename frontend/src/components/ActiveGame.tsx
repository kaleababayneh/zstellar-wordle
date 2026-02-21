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
  toastMessage: string | null;
  shakeRow: boolean;
  onClearShake: () => void;
  onKey: (key: string) => void;
  onRevealWord: () => void;
  onClaimTimeout: () => void;
  onVerifyOnly: () => void;
  onNewGame: () => void;
}

export function ActiveGame({
  game, currentGuess, busy,
  isMyTurn, myTimeLeft, oppTimeLeft,
  onChainPhase, chainTurn, winner,
  letterStates, toastMessage, shakeRow, onClearShake,
  onKey,
  onRevealWord, onClaimTimeout, onVerifyOnly, onNewGame,
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
    <div className="flex flex-col items-center w-full max-w-2xl relative">
      {/* Toast (wordle-style) */}
      {toastMessage && (
        <div className="absolute top-12 left-1/2 -translate-x-1/2 z-50 animate-fade-in-up">
          <div className="px-4 py-2 rounded-lg text-sm font-bold bg-foreground text-background shadow-lg whitespace-nowrap">
            {toastMessage}
          </div>
        </div>
      )}

      {/* Game info bar */}
      <div className="w-full flex items-center justify-between text-xs text-muted-foreground font-mono px-1 mb-3">
        <span>{game.myRole === "p1" ? "Player 1" : "Player 2"} · Turn {chainTurn}</span>
        {game.escrowAmount > 0 && <span>Pot: {game.escrowAmount * 2} XLM</span>}
      </div>

      {/* Timers */}
      <div className="flex gap-2 mb-4 w-full">
        <div
          className={`flex-1 px-3 py-2 rounded-md font-mono text-sm text-center border transition-colors ${
            isMyTurn
              ? "bg-correct/15 border-correct/40 text-correct font-semibold"
              : "bg-secondary border-border text-muted-foreground"
          }`}
        >
          You: {formatTime(myTimeLeft ?? 0)}
          {isMyTurn && " ●"}
        </div>
        <div
          className={`flex-1 px-3 py-2 rounded-md font-mono text-sm text-center border transition-colors ${
            !isMyTurn
              ? "bg-destructive/15 border-destructive/40 text-destructive font-semibold"
              : "bg-secondary border-border text-muted-foreground"
          }`}
        >
          Opp: {formatTime(oppTimeLeft ?? 0)}
          {!isMyTurn && " ●"}
        </div>
      </div>

      {/* Waiting for opponent */}
      {!isMyTurn && onChainPhase === PHASE.ACTIVE && (
        <div className="mb-4 w-full px-5 py-3.5 bg-[#ECE7D1] border border-zinc-700 rounded-xl text-center">
          <div className="flex items-center justify-center gap-2 text-zinc-800 font-semibold text-[15px] tracking-wide">
            <span className="inline-flex gap-0.75">
              <span className="animate-bounce [animation-delay:0ms] text-lg">·</span>
              <span className="animate-bounce [animation-delay:150ms] text-lg">·</span>
              <span className="animate-bounce [animation-delay:300ms] text-lg">·</span>
            </span>
            Opponent is thinking
            <span className="inline-flex gap-0.75">
              <span className="animate-bounce [animation-delay:0ms] text-lg">·</span>
              <span className="animate-bounce [animation-delay:150ms] text-lg">·</span>
              <span className="animate-bounce [animation-delay:300ms] text-lg">·</span>
            </span>
          </div>
        </div>
      )}

      {/* Reveal phase */}
      {onChainPhase === PHASE.REVEAL && (
        <div className="mb-4 w-full px-5 py-4 bg-card border border-border rounded-xl text-center">
          {winner === game.myAddress ? (
            <>
              <p className="text-correct font-bold mb-3 text-lg">You won! Reveal your word to claim the pot.</p>
              <button
                onClick={onRevealWord}
                disabled={busy}
                className="bg-primary hover:bg-primary/90 disabled:opacity-50 text-primary-foreground font-bold px-6 py-2.5 rounded-md transition-colors w-full"
              >
                {busy ? "Revealing…" : `Reveal "${game.word.toUpperCase()}"`}
              </button>
            </>
          ) : (
            <>
              <p className="text-destructive font-bold text-lg mb-1">You Lost</p>
              <p className="text-muted-foreground text-sm mb-3">
                Wait a moment to see your opponent's word, or start a new game.
              </p>
              <div className="flex items-center justify-center gap-2 text-muted-foreground text-sm mb-3">
                <span className="inline-flex gap-0.75">
                  <span className="animate-bounce [animation-delay:0ms] text-lg">·</span>
                  <span className="animate-bounce [animation-delay:150ms] text-lg">·</span>
                  <span className="animate-bounce [animation-delay:300ms] text-lg">·</span>
                </span>
                Opponent is revealing
                <span className="inline-flex gap-0.75">
                  <span className="animate-bounce [animation-delay:0ms] text-lg">·</span>
                  <span className="animate-bounce [animation-delay:150ms] text-lg">·</span>
                  <span className="animate-bounce [animation-delay:300ms] text-lg">·</span>
                </span>
              </div>
              <button
                onClick={onNewGame}
                className="w-full bg-primary hover:bg-primary/90 text-primary-foreground font-bold px-6 py-2.5 rounded-md transition-colors"
              >
                New Game
              </button>
            </>
          )}
        </div>
      )}

      {/* Timeout claim */}
      {onChainPhase === PHASE.ACTIVE && !isMyTurn && oppTimeLeft !== null && oppTimeLeft <= 0 && (
        <div className="mb-4 w-full">
          <button
            onClick={onClaimTimeout}
            disabled={busy}
            className="w-full bg-destructive hover:bg-destructive/90 disabled:opacity-50 text-white font-bold px-5 py-2.5 rounded-md transition-colors"
          >
            Claim Timeout Win
          </button>
        </div>
      )}

      {/* Final verify-only turn */}
      {onChainPhase === PHASE.ACTIVE && isMyTurn && game.myGuesses.length >= MAX_GUESSES && (
        <div className="mb-4 w-full">
          <button
            onClick={onVerifyOnly}
            disabled={busy}
            className="w-full bg-present hover:bg-present/90 disabled:opacity-50 text-background font-bold px-5 py-2.5 rounded-md transition-colors"
          >
            {busy ? "Verifying…" : "Submit Final Verification"}
          </button>
          <p className="text-muted-foreground text-xs mt-1.5 text-center">No more guesses — only verifying opponent's last guess.</p>
        </div>
      )}

      {/* Grids — always side-by-side */}
      <div className="flex gap-6 mb-6 justify-center items-start">
        <div className="flex flex-col items-center min-w-0">
          <p className="text-muted-foreground text-xs mb-2 font-semibold uppercase tracking-wider">Your Board</p>
          <WordleGrid
            guesses={myGridGuesses}
            currentGuess={isMyTurn && onChainPhase === PHASE.ACTIVE ? currentGuess : ""}
            maxRows={MAX_GUESSES}
            shakeCurrentRow={shakeRow}
            onShakeEnd={onClearShake}
          />
        </div>
        <div className="flex flex-col items-center min-w-0 relative">
          <p className="text-muted-foreground text-xs mb-2 font-semibold uppercase tracking-wider">Opponent</p>
          <div className="relative">
            <div className="blur-[2px] pointer-events-none">
              <WordleGrid
                guesses={opponentGridGuesses}
                currentGuess=""
                maxRows={MAX_GUESSES}
              />
            </div>
            {/* subtle frosted overlay */}
            <div className="absolute inset-0 bg-background/10 rounded-md pointer-events-none" />
          </div>
        </div>
      </div>

      {/* Keyboard */}
      {onChainPhase === PHASE.ACTIVE && (
        <div className="w-full pb-2">
          <Keyboard onKey={onKey} letterStates={letterStates} />
        </div>
      )}

      {/* Busy spinner */}
      {busy && (
        <div className="mt-3 px-4 py-2 bg-foreground text-background rounded-md text-sm font-bold flex items-center gap-2">
          <Spinner size={4} />
          Processing…
        </div>
      )}
    </div>
  );
}
