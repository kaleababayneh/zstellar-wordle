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
    <div className="mt-4 flex flex-col items-center gap-3 max-w-md animate-fade-in-up">
      <div
        className={`px-6 py-4 rounded-lg text-center w-full border ${
          gameWon
            ? "bg-correct/15 border-correct/40"
            : !winner
              ? "bg-accent/15 border-accent/40"
              : "bg-destructive/15 border-destructive/40"
        }`}
      >
        {gameWon ? (
          <p className="text-correct font-bold text-lg">You Won!</p>
        ) : !winner ? (
          <p className="text-accent font-bold text-lg">Draw!</p>
        ) : (
          <p className="text-destructive font-bold text-lg">You Lost</p>
        )}
        <p className="text-muted-foreground text-sm mt-2">
          Your word: <span className="font-mono font-bold text-foreground">{game.word.toUpperCase()}</span>
        </p>
        {oppRevealedWord && (
          <p className="text-muted-foreground text-sm mt-1">
            Opponent's word: <span className="font-mono font-bold text-foreground">{oppRevealedWord.toUpperCase()}</span>
          </p>
        )}
      </div>

      {/* Withdraw */}
      {game.escrowAmount > 0 && !game.escrowWithdrawn && (gameWon || !winner) && (
        <button
          onClick={onWithdraw}
          disabled={withdrawing}
          className="w-full bg-accent hover:bg-accent/90 disabled:opacity-50 text-accent-foreground font-bold px-5 py-2.5 rounded-lg transition-colors"
        >
          {withdrawing ? "Withdrawing…" : `Withdraw ${gameWon ? game.escrowAmount * 2 : game.escrowAmount} XLM`}
        </button>
      )}
      {game.escrowWithdrawn && (
        <p className="text-primary text-sm font-medium">Escrow withdrawn ✓</p>
      )}

      <button
        onClick={onNewGame}
        className="w-full bg-primary hover:bg-primary/90 text-primary-foreground font-bold px-5 py-2.5 rounded-lg transition-colors"
      >
        New Game
      </button>
    </div>
  );
}
