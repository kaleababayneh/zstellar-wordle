import type { GameState } from "../gameState";
import { Spinner } from "./Spinner.tsx";
import { formatTime } from "../utils.ts";

interface DrawPhaseProps {
  game: GameState;
  busy: boolean;
  myDrawRevealed: boolean;
  oppDrawRevealed: boolean;
  oppRevealedWord: string;
  drawDeadline: number | null;
  withdrawing: boolean;
  onRevealWordDraw: () => void;
  onWithdraw: () => void;
  onClaimTimeout: () => void;
  onNewGame: () => void;
}

export function DrawPhase({
  game, busy,
  myDrawRevealed, oppDrawRevealed, oppRevealedWord,
  drawDeadline, withdrawing,
  onRevealWordDraw, onWithdraw, onClaimTimeout, onNewGame,
}: DrawPhaseProps) {
  return (
    <div className="mt-4 flex flex-col items-center gap-3 max-w-md">
      <div className="px-6 py-4 rounded-lg text-center bg-yellow-900/50 border border-yellow-600 w-full">
        <p className="text-yellow-300 font-bold text-lg mb-1">Draw!</p>
        <p className="text-gray-400 text-sm">
          Both players must reveal their secret word to withdraw escrow.
        </p>
        <p className="text-gray-400 text-sm mt-1">
          Your word: <span className="font-mono font-bold text-white">{game.word.toUpperCase()}</span>
        </p>
        {drawDeadline !== null && (
          <p className="text-gray-500 text-xs mt-2 font-mono">
            Reveal deadline: {formatTime(drawDeadline)}
          </p>
        )}
      </div>

      {/* My reveal */}
      {!myDrawRevealed ? (
        <button
          onClick={onRevealWordDraw}
          disabled={busy}
          className="bg-purple-600 hover:bg-purple-500 disabled:opacity-50 text-white font-bold px-5 py-2 rounded-lg w-full"
        >
          {busy ? "Revealing…" : `Reveal "${game.word.toUpperCase()}"`}
        </button>
      ) : (
        <div className="px-4 py-2 bg-green-900/40 border border-green-600 rounded-lg text-green-300 text-sm w-full text-center">
          You have revealed your word ✓
        </div>
      )}

      {/* Opponent reveal */}
      {oppDrawRevealed ? (
        <div className="px-4 py-2 bg-green-900/40 border border-green-600 rounded-lg text-green-300 text-sm w-full text-center">
          Opponent revealed: <span className="font-mono font-bold text-white">{oppRevealedWord.toUpperCase() || "???"}</span> ✓
        </div>
      ) : (
        <div className="px-4 py-2 bg-gray-800 border border-gray-600 rounded-lg text-gray-400 text-sm w-full text-center">
          Waiting for opponent to reveal…
        </div>
      )}

      {/* Withdraw */}
      {myDrawRevealed && game.escrowAmount > 0 && !game.escrowWithdrawn && (
        <button
          onClick={onWithdraw}
          disabled={withdrawing}
          className="bg-yellow-600 hover:bg-yellow-500 disabled:opacity-50 text-white font-bold px-5 py-2 rounded-lg w-full"
        >
          {withdrawing ? "Withdrawing…" : `Withdraw ${game.escrowAmount} XLM`}
        </button>
      )}
      {game.escrowWithdrawn && (
        <p className="text-green-400 text-sm">Escrow withdrawn ✓</p>
      )}

      {/* Claim timeout */}
      {myDrawRevealed && !oppDrawRevealed && drawDeadline !== null && drawDeadline <= 0 && (
        <button
          onClick={onClaimTimeout}
          disabled={busy}
          className="bg-red-600 hover:bg-red-500 disabled:opacity-50 text-white font-bold px-5 py-2 rounded text-sm w-full"
        >
          Opponent didn't reveal — Claim Full Pot
        </button>
      )}

      {busy && (
        <div className="mt-2 flex items-center gap-2 text-yellow-400">
          <Spinner size={5} />
          Processing…
        </div>
      )}

      <button
        onClick={onNewGame}
        className="bg-gray-700 hover:bg-gray-600 text-white font-bold px-5 py-2 rounded-lg"
      >
        New Game
      </button>
    </div>
  );
}
