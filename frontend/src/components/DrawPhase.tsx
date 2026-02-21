import type { GameState } from "../gameState";
import { Spinner } from "./Spinner.tsx";

interface DrawPhaseProps {
  game: GameState;
  busy: boolean;
  myDrawRevealed: boolean;
  oppDrawRevealed: boolean;
  oppRevealedWord: string;
  withdrawing: boolean;
  onRevealWordDraw: () => void;
  onWithdraw: () => void;
  onNewGame: () => void;
}

export function DrawPhase({
  game, busy,
  myDrawRevealed, oppDrawRevealed, oppRevealedWord,
  withdrawing,
  onRevealWordDraw, onWithdraw, onNewGame,
}: DrawPhaseProps) {
  return (
    <div className="flex flex-col items-center gap-3 w-full max-w-sm mx-auto animate-fade-in-up py-6">
      <div className="w-full text-center">
        <p className="text-accent font-bold text-2xl mb-1">Draw!</p>
        <p className="text-muted-foreground text-sm">
          Both players reveal their word to withdraw escrow.
        </p>
        <p className="text-foreground text-sm mt-2 font-mono font-bold tracking-widest">{game.word.toUpperCase()}</p>
      </div>

      {/* My reveal */}
      {!myDrawRevealed ? (
        <button
          onClick={onRevealWordDraw}
          disabled={busy}
          className="w-full h-12 bg-primary hover:bg-primary/90 disabled:opacity-50 text-primary-foreground font-bold rounded-md transition-colors"
        >
          {busy ? "Revealing…" : `Reveal "${game.word.toUpperCase()}"`}
        </button>
      ) : (
        <div className="w-full bg-foreground text-background rounded-md px-4 py-2.5 text-sm text-center font-bold">
          You revealed your word ✓
        </div>
      )}

      {/* Opponent reveal */}
      {oppDrawRevealed ? (
        <div className="w-full bg-foreground text-background rounded-md px-4 py-2.5 text-sm text-center font-bold">
          Opponent: <span className="font-mono tracking-widest">{oppRevealedWord.toUpperCase() || "???"}</span> ✓
        </div>
      ) : (
        <div className="w-full border border-border rounded-md px-4 py-2.5 text-muted-foreground text-sm text-center">
          Waiting for opponent to reveal…
        </div>
      )}

      {/* Withdraw */}
      {myDrawRevealed && game.escrowAmount > 0 && !game.escrowWithdrawn && (
        <button
          onClick={onWithdraw}
          disabled={withdrawing}
          className="w-full h-12 bg-accent hover:bg-accent/90 disabled:opacity-50 text-accent-foreground font-bold rounded-md transition-colors"
        >
          {withdrawing ? "Withdrawing…" : `Withdraw ${game.escrowAmount} XLM`}
        </button>
      )}
      {game.escrowWithdrawn && (
        <p className="text-primary text-sm font-semibold">Escrow withdrawn ✓</p>
      )}

      {busy && (
        <div className="flex items-center gap-2 text-muted-foreground text-sm">
          <Spinner size={4} />
          Processing…
        </div>
      )}

      <button
        onClick={onNewGame}
        className="w-full h-12 bg-primary hover:bg-primary/90 text-primary-foreground font-bold rounded-md transition-colors"
      >
        New Game
      </button>
      {!myDrawRevealed && (
        <p className="text-muted-foreground text-xs text-center">
          You can start a new game anytime — reveal first to withdraw your escrow.
        </p>
      )}
    </div>
  );
}
