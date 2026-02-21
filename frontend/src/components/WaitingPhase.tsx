import { useState } from "react";
import type { GameState } from "../gameState";
import { POLL_INTERVAL_MS } from "../config";

interface WaitingPhaseProps {
  game: GameState;
}

export function WaitingPhase({ game }: WaitingPhaseProps) {
  const [copiedLink, setCopiedLink] = useState(false);
  const [copiedId, setCopiedId] = useState(false);

  const shareUrl = `${window.location.origin}${window.location.pathname}?game=${game.gameId}`;

  return (
    <div className="mb-6 text-center animate-fade-in-up">
      <div className="bg-accent/15 border border-accent/40 rounded-lg p-5 mb-3 max-w-md">
        <p className="text-accent font-semibold mb-2">Waiting for Player 2 to join…</p>
        <p className="text-muted-foreground text-xs mb-3">Share this link or Game ID with your opponent:</p>

        {/* Shareable link */}
        <div className="flex items-center gap-2 bg-muted p-2.5 rounded-lg mb-2">
          <p className="text-primary font-mono text-xs break-all flex-1 select-all">
            {shareUrl}
          </p>
          <button
            onClick={() => {
              navigator.clipboard.writeText(shareUrl);
              setCopiedLink(true);
              setTimeout(() => setCopiedLink(false), 2000);
            }}
            className="text-xs bg-secondary hover:bg-secondary/80 text-secondary-foreground px-2.5 py-1.5 rounded-md whitespace-nowrap transition-colors font-medium"
          >
            {copiedLink ? "Copied!" : "Copy Link"}
          </button>
        </div>

        {/* Game ID */}
        <div className="flex items-center gap-2 bg-muted p-2.5 rounded-lg">
          <p className="text-primary font-mono text-xs break-all flex-1 select-all">
            {game.gameId}
          </p>
          <button
            onClick={() => {
              navigator.clipboard.writeText(game.gameId);
              setCopiedId(true);
              setTimeout(() => setCopiedId(false), 2000);
            }}
            className="text-xs bg-secondary hover:bg-secondary/80 text-secondary-foreground px-2.5 py-1.5 rounded-md whitespace-nowrap transition-colors font-medium"
          >
            {copiedId ? "Copied!" : "Copy ID"}
          </button>
        </div>

        {game.escrowAmount > 0 && (
          <p className="text-muted-foreground text-xs mt-3">Escrow: {game.escrowAmount} XLM</p>
        )}

        <div className="mt-3 flex items-center justify-center gap-2 text-muted-foreground text-xs">
          <svg className="animate-spin h-3 w-3" viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" className="opacity-25" />
            <path fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" className="opacity-75" />
          </svg>
          Polling chain every {POLL_INTERVAL_MS / 1000}s…
        </div>
      </div>
    </div>
  );
}
