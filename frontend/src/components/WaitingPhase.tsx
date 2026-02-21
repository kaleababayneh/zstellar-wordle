import { useState } from "react";
import type { GameState } from "../gameState";
import { POLL_INTERVAL_MS } from "../config";

interface WaitingPhaseProps {
  game: GameState;
}

export function WaitingPhase({ game }: WaitingPhaseProps) {
  const [copiedLink, setCopiedLink] = useState(false);

  const shareUrl = `${window.location.origin}${window.location.pathname}?game=${game.gameId}`;

  return (
    <div className="flex flex-col items-center gap-4 w-full max-w-sm mx-auto animate-fade-in-up py-6">
      <div className="w-full text-center">
        <p className="text-foreground font-bold text-xl mb-1">Waiting for Player 2</p>
        <p className="text-muted-foreground text-sm">Share this link with your opponent</p>
      </div>

      <div className="w-full flex flex-col gap-2">
        {/* Shareable link */}
        <div className="flex items-center gap-2 w-full bg-muted rounded-md p-3 border border-border">
          <code className="text-xs text-foreground truncate flex-1 font-mono select-all">
            {shareUrl}
          </code>
          <button
            onClick={() => {
              navigator.clipboard.writeText(shareUrl);
              setCopiedLink(true);
              setTimeout(() => setCopiedLink(false), 2000);
            }}
            className="shrink-0 text-muted-foreground hover:text-foreground p-1 transition-colors"
          >
            {copiedLink ? (
              <svg className="h-4 w-4 text-primary" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
            ) : (
              <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
            )}
          </button>
        </div>

        <button
          onClick={() => {
            navigator.clipboard.writeText(shareUrl);
            setCopiedLink(true);
            setTimeout(() => setCopiedLink(false), 2000);
          }}
          className="w-full h-12 bg-primary hover:bg-primary/90 text-primary-foreground font-bold rounded-md transition-colors"
        >
          {copiedLink ? "Copied!" : "Copy Challenge Link"}
        </button>
      </div>

      {game.escrowAmount > 0 && (
        <p className="text-muted-foreground text-sm">Escrow: <span className="text-accent font-semibold">{game.escrowAmount} XLM</span></p>
      )}

      <div className="flex items-center gap-2 text-muted-foreground text-xs">
        <svg className="animate-spin h-3 w-3" viewBox="0 0 24 24" fill="none">
          <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" className="opacity-25" />
          <path fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" className="opacity-75" />
        </svg>
        Polling every {POLL_INTERVAL_MS / 1000}s
      </div>
    </div>
  );
}
