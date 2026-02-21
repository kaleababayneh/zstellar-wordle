interface GameLoadingProps {
  chainPolled: boolean;
  onBackToLobby: () => void;
}

/**
 * Shown when a game exists in localStorage but the on-chain phase
 * hasn't been determined yet (PHASE.NONE) — either loading or expired.
 */
export function GameLoading({ chainPolled, onBackToLobby }: GameLoadingProps) {
  return (
    <div className="mb-6 text-center">
      <div
        className={`border rounded-lg p-6 max-w-md flex flex-col items-center gap-3 ${
          chainPolled
            ? "bg-red-900/30 border-red-700"
            : "bg-gray-800 border-gray-600"
        }`}
      >
        {!chainPolled ? (
          <>
            <svg className="animate-spin h-6 w-6 text-gray-400" viewBox="0 0 24 24" fill="none">
              <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" className="opacity-25" />
              <path fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" className="opacity-75" />
            </svg>
            <p className="text-gray-400 text-sm">Loading game state from chain…</p>
          </>
        ) : (
          <>
            <p className="text-red-300 font-bold text-lg">Game Not Found</p>
            <p className="text-gray-400 text-sm text-center">
              This game no longer exists on-chain. It may have expired or was created on a previous contract.
            </p>
          </>
        )}
        <button
          onClick={onBackToLobby}
          className={
            chainPolled
              ? "mt-2 bg-gray-700 hover:bg-gray-600 text-white font-bold px-5 py-2 rounded-lg text-sm"
              : "mt-2 text-xs text-gray-500 hover:text-gray-300 underline"
          }
        >
          Back to lobby
        </button>
      </div>
    </div>
  );
}
