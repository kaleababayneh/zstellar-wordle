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
            ? "bg-destructive/15 border-destructive/40"
            : "bg-card border-border"
        }`}
      >
        {!chainPolled ? (
          <>
            <svg className="animate-spin h-6 w-6 text-muted-foreground" viewBox="0 0 24 24" fill="none">
              <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" className="opacity-25" />
              <path fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" className="opacity-75" />
            </svg>
            <p className="text-muted-foreground text-sm">Loading game state from chain…</p>
          </>
        ) : (
          <>
            <p className="text-destructive-foreground font-bold text-lg">Game Not Found</p>
            <p className="text-muted-foreground text-sm text-center">
              This game no longer exists on-chain. It may have expired or was created on a previous contract.
            </p>
          </>
        )}
        <button
          onClick={onBackToLobby}
          className={
            chainPolled
              ? "mt-2 bg-secondary hover:bg-secondary/80 text-secondary-foreground font-bold px-5 py-2 rounded-lg text-sm transition-colors"
              : "mt-2 text-xs text-muted-foreground hover:text-foreground underline transition-colors"
          }
        >
          Back to lobby
        </button>
      </div>
    </div>
  );
}
