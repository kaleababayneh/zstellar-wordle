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
      <div className="flex gap-4 mb-4">
        <div
          className={`px-4 py-2 rounded-lg font-mono text-sm ${
            isMyTurn
              ? "bg-green-900/50 border border-green-600 text-green-300"
              : "bg-gray-800 border border-gray-600 text-gray-400"
          }`}
        >
          You: {formatTime(myTimeLeft ?? 0)}
          {isMyTurn && " (your turn)"}
        </div>
        <div
          className={`px-4 py-2 rounded-lg font-mono text-sm ${
            !isMyTurn
              ? "bg-red-900/50 border border-red-600 text-red-300"
              : "bg-gray-800 border border-gray-600 text-gray-400"
          }`}
        >
          Opponent: {formatTime(oppTimeLeft ?? 0)}
          {!isMyTurn && " (their turn)"}
        </div>
      </div>

      {/* Game info */}
      <div className="text-gray-500 text-xs mb-4">
        Role: {game.myRole === "p1" ? "Player 1" : "Player 2"}
        {" | Turn "}{chainTurn}
        {game.escrowAmount > 0 && ` | Pot: ${game.escrowAmount * 2} XLM`}
      </div>

      {/* Waiting for opponent */}
      {!isMyTurn && onChainPhase === PHASE.ACTIVE && (
        <div className="mb-4 px-4 py-2 bg-blue-900/30 border border-blue-600 rounded text-blue-300 text-sm flex items-center gap-2">
          <Spinner size={4} />
          Waiting for opponent's move…
        </div>
      )}

      {/* Reveal phase */}
      {onChainPhase === PHASE.REVEAL && (
        <div className="mb-4 px-4 py-3 bg-purple-900/50 border border-purple-500 rounded-lg max-w-md text-center">
          {winner === game.myAddress ? (
            <>
              <p className="text-purple-300 font-bold mb-2">You won! Reveal your word to claim the pot.</p>
              <button
                onClick={onRevealWord}
                disabled={busy}
                className="bg-purple-600 hover:bg-purple-500 disabled:opacity-50 text-white font-bold px-5 py-2 rounded"
              >
                {busy ? "Revealing…" : `Reveal "${game.word.toUpperCase()}"`}
              </button>
            </>
          ) : (
            <>
              <p className="text-yellow-300 font-medium">Opponent must reveal their word…</p>
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
            className="bg-red-600 hover:bg-red-500 disabled:opacity-50 text-white font-bold px-5 py-2 rounded"
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
            className="bg-orange-600 hover:bg-orange-500 disabled:opacity-50 text-white font-bold px-5 py-2 rounded"
          >
            {busy ? "Verifying…" : "Submit Final Verification"}
          </button>
          <p className="text-gray-500 text-xs mt-1">No more guesses — only verifying opponent's last guess.</p>
        </div>
      )}

      {/* Grids */}
      <div className="flex gap-6 mb-4 flex-wrap justify-center">
        <div className="flex flex-col items-center">
          <p className="text-gray-400 text-xs mb-1">Your Guesses</p>
          <WordleGrid
            guesses={myGridGuesses}
            currentGuess={isMyTurn && onChainPhase === PHASE.ACTIVE ? currentGuess : ""}
            maxRows={MAX_GUESSES}
          />
        </div>
        <div className="flex flex-col items-center">
          <p className="text-gray-400 text-xs mb-1">Opponent's Guesses</p>
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
        <div className="mt-4 flex items-center gap-2 text-yellow-400">
          <Spinner size={5} />
          Processing…
        </div>
      )}
    </>
  );
}
