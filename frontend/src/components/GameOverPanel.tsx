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
    <div className="mt-4 flex flex-col items-center gap-3 max-w-md">
      <div
        className={`px-6 py-3 rounded-lg text-center ${
          gameWon
            ? "bg-green-900/50 border border-green-600"
            : !winner
              ? "bg-yellow-900/50 border border-yellow-600"
              : "bg-red-900/50 border border-red-600"
        }`}
      >
        {gameWon ? (
          <p className="text-green-300 font-bold text-lg">You Won!</p>
        ) : !winner ? (
          <p className="text-yellow-300 font-bold text-lg">Draw!</p>
        ) : (
          <p className="text-red-300 font-bold text-lg">You Lost</p>
        )}
        <p className="text-gray-400 text-sm mt-1">
          Your word: <span className="font-mono font-bold text-white">{game.word.toUpperCase()}</span>
        </p>
        {oppRevealedWord && (
          <p className="text-gray-400 text-sm mt-1">
            Opponent's word: <span className="font-mono font-bold text-white">{oppRevealedWord.toUpperCase()}</span>
          </p>
        )}
      </div>

      {/* Withdraw */}
      {game.escrowAmount > 0 && !game.escrowWithdrawn && (gameWon || !winner) && (
        <button
          onClick={onWithdraw}
          disabled={withdrawing}
          className="bg-yellow-600 hover:bg-yellow-500 disabled:opacity-50 text-white font-bold px-5 py-2 rounded-lg"
        >
          {withdrawing ? "Withdrawing…" : `Withdraw ${gameWon ? game.escrowAmount * 2 : game.escrowAmount} XLM`}
        </button>
      )}
      {game.escrowWithdrawn && (
        <p className="text-green-400 text-sm">Escrow withdrawn ✓</p>
      )}

      <button
        onClick={onNewGame}
        className="bg-green-600 hover:bg-green-500 text-white font-bold px-5 py-2 rounded-lg"
      >
        New Game
      </button>
    </div>
  );
}
