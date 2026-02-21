import type { GameState } from "../gameState";

interface GameOverPanelProps {
  game: GameState;
  gameWon: boolean;
  winner: string;
  oppRevealedWord: string;
  withdrawing: boolean;
  onWithdraw: () => void;
  onNewGame: () => void;
}

export function GameOverPanel({
  game, gameWon, winner, oppRevealedWord,
  withdrawing, onWithdraw, onNewGame,
}: GameOverPanelProps) {
  return (
    <div className="flex flex-col items-center gap-4 w-full max-w-sm mx-auto animate-fade-in-up py-6">
      <div className="w-full text-center">
        {gameWon ? (
          <p className="text-correct font-bold text-3xl">You Won!</p>
        ) : !winner ? (
          <p className="text-accent font-bold text-3xl">Draw!</p>
        ) : (
          <p className="text-destructive font-bold text-3xl">You Lost</p>
        )}
        <div className="mt-3 flex items-center justify-center gap-4 text-sm text-muted-foreground">
          <span>You: <span className="font-mono font-bold text-foreground tracking-widest">{game.word.toUpperCase()}</span></span>
          {oppRevealedWord && (
            <span>Opp: <span className="font-mono font-bold text-foreground tracking-widest">{oppRevealedWord.toUpperCase()}</span></span>
          )}
        </div>
      </div>

      {/* Withdraw */}
      {game.escrowAmount > 0 && !game.escrowWithdrawn && (gameWon || !winner) && (
        <button
          onClick={onWithdraw}
          disabled={withdrawing}
          className="w-full h-12 bg-accent hover:bg-accent/90 disabled:opacity-50 text-accent-foreground font-bold rounded-md transition-colors"
        >
          {withdrawing ? "Withdrawing…" : `Withdraw ${gameWon ? game.escrowAmount * 2 : game.escrowAmount} XLM`}
        </button>
      )}
      {game.escrowWithdrawn && (
        <p className="text-primary text-sm font-semibold">Escrow withdrawn ✓</p>
      )}

      <button
        onClick={onNewGame}
        className="w-full h-12 bg-primary hover:bg-primary/90 text-primary-foreground font-bold rounded-md transition-colors"
      >
        New Game
      </button>
    </div>
  );
}
