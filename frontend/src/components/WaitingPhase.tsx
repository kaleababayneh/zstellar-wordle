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
    <div className="mb-6 text-center">
      <div className="bg-yellow-900/40 border border-yellow-600 rounded-lg p-4 mb-3 max-w-md">
        <p className="text-yellow-300 font-medium mb-2">Waiting for Player 2 to join…</p>
        <p className="text-gray-400 text-xs mb-2">Share this link or Game ID with your opponent:</p>

        {/* Shareable link */}
        <div className="flex items-center gap-2 bg-gray-800 p-2 rounded mb-2">
          <p className="text-blue-400 font-mono text-xs break-all flex-1 select-all">
            {shareUrl}
          </p>
          <button
            onClick={() => {
              navigator.clipboard.writeText(shareUrl);
              setCopiedLink(true);
              setTimeout(() => setCopiedLink(false), 2000);
            }}
            className="text-xs bg-gray-700 hover:bg-gray-600 text-white px-2 py-1 rounded whitespace-nowrap"
          >
            {copiedLink ? "Copied!" : "Copy Link"}
          </button>
        </div>

        {/* Game ID */}
        <div className="flex items-center gap-2 bg-gray-800 p-2 rounded">
          <p className="text-green-400 font-mono text-xs break-all flex-1 select-all">
            {game.gameId}
          </p>
          <button
            onClick={() => {
              navigator.clipboard.writeText(game.gameId);
              setCopiedId(true);
              setTimeout(() => setCopiedId(false), 2000);
            }}
            className="text-xs bg-gray-700 hover:bg-gray-600 text-white px-2 py-1 rounded whitespace-nowrap"
          >
            {copiedId ? "Copied!" : "Copy ID"}
          </button>
        </div>

        {game.escrowAmount > 0 && (
          <p className="text-gray-400 text-xs mt-2">Escrow: {game.escrowAmount} XLM</p>
        )}

        <div className="mt-3 flex items-center justify-center gap-2 text-gray-400 text-xs">
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
