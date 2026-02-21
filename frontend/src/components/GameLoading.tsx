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
    <div className="flex flex-col items-center gap-4 w-full max-w-sm mx-auto py-12">
      {!chainPolled ? (
        <>
          <svg className="animate-spin h-6 w-6 text-muted-foreground" viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" className="opacity-25" />
            <path fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" className="opacity-75" />
          </svg>
          <p className="text-muted-foreground text-sm">Loading game…</p>
          <button
            onClick={onBackToLobby}
            className="text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            ← Back to lobby
          </button>
        </>
      ) : (
        <>
          <p className="text-foreground font-bold text-xl">Game Not Found</p>
          <p className="text-muted-foreground text-sm text-center max-w-xs">
            This game no longer exists on-chain. It may have expired.
          </p>
          <button
            onClick={onBackToLobby}
            className="h-10 bg-primary hover:bg-primary/90 text-primary-foreground font-bold px-6 rounded-md text-sm transition-colors"
          >
            Back to lobby
          </button>
        </>
      )}
    </div>
  );
}
