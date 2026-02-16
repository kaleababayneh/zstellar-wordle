import { useState, useEffect, useCallback } from "react";
import type { OpenGame } from "../soroban";
import { fetchOpenGames } from "../soroban";

interface LobbyProps {
  onJoinGame: (gameId: string) => void;
  currentAddress?: string;
}

export function Lobby({ onJoinGame, currentAddress }: LobbyProps) {
  const [games, setGames] = useState<OpenGame[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const openGames = await fetchOpenGames();
      // Don't show my own games
      const filtered = currentAddress
        ? openGames.filter((g) => g.gameId !== currentAddress)
        : openGames;
      setGames(filtered);
    } catch (err: any) {
      setError(err.message ?? "Failed to load lobby");
    } finally {
      setLoading(false);
    }
  }, [currentAddress]);

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, 15000);
    return () => clearInterval(interval);
  }, [refresh]);

  const copyLink = (gameId: string) => {
    const url = `${window.location.origin}${window.location.pathname}?game=${gameId}`;
    navigator.clipboard.writeText(url);
  };

  const timeAgo = (dateStr: string): string => {
    if (!dateStr) return "";
    try {
      const diff = Date.now() - new Date(dateStr).getTime();
      const mins = Math.floor(diff / 60000);
      if (mins < 1) return "just now";
      if (mins < 60) return `${mins}m ago`;
      const hours = Math.floor(mins / 60);
      return `${hours}h ago`;
    } catch {
      return "";
    }
  };

  return (
    <div className="w-full bg-gray-800 rounded-lg p-4 border border-gray-700">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-lg font-bold">Open Games</h2>
        <button
          onClick={refresh}
          disabled={loading}
          className="text-xs bg-gray-700 hover:bg-gray-600 disabled:opacity-50 text-gray-300 px-3 py-1 rounded flex items-center gap-1"
        >
          {loading ? (
            <svg
              className="animate-spin h-3 w-3"
              viewBox="0 0 24 24"
              fill="none"
            >
              <circle
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                strokeWidth="4"
                className="opacity-25"
              />
              <path
                fill="currentColor"
                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                className="opacity-75"
              />
            </svg>
          ) : (
            "↻"
          )}
          Refresh
        </button>
      </div>

      {error && (
        <p className="text-red-400 text-xs mb-2">{error}</p>
      )}

      {!loading && games.length === 0 && (
        <p className="text-gray-500 text-sm text-center py-4">
          No open games right now. Create one or check back later.
        </p>
      )}

      {games.length > 0 && (
        <div className="space-y-2 max-h-64 overflow-y-auto">
          {games.map((game) => (
            <div
              key={game.gameId}
              className="flex items-center justify-between bg-gray-900 rounded-lg px-3 py-2 border border-gray-700"
            >
              <div className="flex-1 min-w-0">
                <p className="text-green-400 font-mono text-xs truncate">
                  {game.gameId}
                </p>
                <div className="flex gap-3 text-gray-500 text-xs mt-0.5">
                  {game.escrowXlm > 0 && (
                    <span className="text-yellow-400">
                      {game.escrowXlm} XLM
                    </span>
                  )}
                  {game.escrowXlm === 0 && (
                    <span>No escrow</span>
                  )}
                  {game.createdAt && (
                    <span>{timeAgo(game.createdAt)}</span>
                  )}
                </div>
              </div>
              <div className="flex gap-1 ml-2 shrink-0">
                <button
                  onClick={() => copyLink(game.gameId)}
                  className="text-xs bg-gray-700 hover:bg-gray-600 text-gray-300 px-2 py-1 rounded"
                  title="Copy join link"
                >
                  🔗
                </button>
                <button
                  onClick={() => onJoinGame(game.gameId)}
                  className="text-xs bg-blue-600 hover:bg-blue-500 text-white font-bold px-3 py-1 rounded"
                >
                  Join
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
