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
    <div className="mt-4 flex flex-col items-center gap-3 max-w-md animate-fade-in-up">
      <div className="px-6 py-4 rounded-lg text-center bg-accent/15 border border-accent/40 w-full">
        <p className="text-accent font-bold text-lg mb-1">Draw!</p>
        <p className="text-muted-foreground text-sm">
          Both players must reveal their secret word to withdraw escrow.
        </p>
        <p className="text-muted-foreground text-sm mt-1">
          Your word: <span className="font-mono font-bold text-foreground">{game.word.toUpperCase()}</span>
        </p>
      </div>

      {/* My reveal */}
      {!myDrawRevealed ? (
        <button
          onClick={onRevealWordDraw}
          disabled={busy}
          className="bg-primary hover:bg-primary/90 disabled:opacity-50 text-primary-foreground font-bold px-5 py-2.5 rounded-lg w-full transition-colors"
        >
          {busy ? "Revealing…" : `Reveal "${game.word.toUpperCase()}"`}
        </button>
      ) : (
        <div className="px-4 py-2.5 bg-correct/15 border border-correct/40 rounded-lg text-correct text-sm w-full text-center font-medium">
          You have revealed your word ✓
        </div>
      )}

      {/* Opponent reveal */}
      {oppDrawRevealed ? (
        <div className="px-4 py-2.5 bg-correct/15 border border-correct/40 rounded-lg text-correct text-sm w-full text-center font-medium">
          Opponent revealed: <span className="font-mono font-bold text-foreground">{oppRevealedWord.toUpperCase() || "???"}</span> ✓
        </div>
      ) : (
        <div className="px-4 py-2.5 bg-card border border-border rounded-lg text-muted-foreground text-sm w-full text-center">
          Waiting for opponent to reveal…
        </div>
      )}

      {/* Withdraw */}
      {myDrawRevealed && game.escrowAmount > 0 && !game.escrowWithdrawn && (
        <button
          onClick={onWithdraw}
          disabled={withdrawing}
          className="bg-accent hover:bg-accent/90 disabled:opacity-50 text-accent-foreground font-bold px-5 py-2.5 rounded-lg w-full transition-colors"
        >
          {withdrawing ? "Withdrawing…" : `Withdraw ${game.escrowAmount} XLM`}
        </button>
      )}
      {game.escrowWithdrawn && (
        <p className="text-primary text-sm font-medium">Escrow withdrawn ✓</p>
      )}

      {busy && (
        <div className="mt-2 flex items-center gap-2 text-accent">
          <Spinner size={5} />
          Processing…
        </div>
      )}

      <button
        onClick={onNewGame}
        className="bg-secondary hover:bg-secondary/80 text-secondary-foreground font-bold px-5 py-2.5 rounded-lg transition-colors"
      >
        New Game
      </button>
    </div>
  );
}
