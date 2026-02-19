import { useState, useEffect, useCallback } from "react";
import type { OpenGame, GameSummary } from "../soroban";
import { fetchOpenGames, fetchGameSummaries, queryGameState, getGameCreator } from "../soroban";
import { getMyGameEntries, removeMyGameEntry, isWordInList } from "../gameState";
import { PHASE, WORD_LENGTH, STROOPS_PER_XLM } from "../config";

type Tab = "open" | "my" | "create" | "join";

interface LobbyProps {
  currentAddress: string;
  onJoinGame: (gameId: string, customWord?: string) => void;
  onCreateGame: (escrowXlm: number, customWord?: string) => void;
  onResumeGame: (gameId: string) => void;
}

const phaseLabel = (phase: number): { text: string; color: string } => {
  switch (phase) {
    case PHASE.WAITING:
      return { text: "Waiting for P2", color: "bg-yellow-900/50 text-yellow-300 border-yellow-600" };
    case PHASE.ACTIVE:
      return { text: "In Progress", color: "bg-blue-900/50 text-blue-300 border-blue-500" };
    case PHASE.REVEAL:
      return { text: "Reveal Phase", color: "bg-purple-900/50 text-purple-300 border-purple-500" };
    case PHASE.FINALIZED:
      return { text: "Finished", color: "bg-gray-800 text-gray-400 border-gray-600" };
    case PHASE.DRAW:
      return { text: "Draw", color: "bg-orange-900/50 text-orange-300 border-orange-600" };
    default:
      return { text: "Expired", color: "bg-gray-800 text-gray-500 border-gray-700" };
  }
};

const formatAddr = (addr: string) =>
  addr ? `${addr.slice(0, 6)}…${addr.slice(-4)}` : "—";

const timeAgo = (dateStr: string): string => {
  if (!dateStr) return "";
  try {
    const diff = Date.now() - new Date(dateStr).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return "just now";
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    return `${Math.floor(hours / 24)}d ago`;
  } catch {
    return "";
  }
};

export function Lobby({ currentAddress, onJoinGame, onCreateGame, onResumeGame }: LobbyProps) {
  const [tab, setTab] = useState<Tab>("open");
  const [openGames, setOpenGames] = useState<OpenGame[]>([]);
  const [myGameSummaries, setMyGameSummaries] = useState<GameSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // Create game form
  const [escrowInput, setEscrowInput] = useState("10");
  const [secretWord, setSecretWord] = useState("");
  const [secretWordError, setSecretWordError] = useState("");

  // Join game form
  const [joinGameId, setJoinGameId] = useState("");
  const [joinSecretWord, setJoinSecretWord] = useState("");
  const [joinSecretWordError, setJoinSecretWordError] = useState("");

  // Join game preview (looked-up info)
  const [joinPreview, setJoinPreview] = useState<{
    escrowXlm: number;
    creator: string;
    phase: number;
  } | null>(null);
  const [joinLooking, setJoinLooking] = useState(false);
  const [joinLookupError, setJoinLookupError] = useState("");

  const refresh = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      // Fetch open games from events
      const open = await fetchOpenGames();
      // Filter out my own games
      const filtered = open.filter((g) => g.creator !== currentAddress);
      setOpenGames(filtered);

      // Fetch my games from localStorage + check their on-chain state
      const myEntries = getMyGameEntries();
      if (myEntries.length > 0) {
        const summaries = await fetchGameSummaries(myEntries.map((e) => e.gameId));
        setMyGameSummaries(summaries);
      } else {
        setMyGameSummaries([]);
      }
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

  // Check URL for ?game= on mount
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const gameParam = params.get("game");
    if (gameParam) {
      setJoinGameId(gameParam.trim());
      setTab("join");
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, []);

  const copyLink = (gameId: string) => {
    const url = `${window.location.origin}${window.location.pathname}?game=${gameId}`;
    navigator.clipboard.writeText(url);
  };

  const tabClass = (t: Tab) =>
    `px-4 py-2 text-sm font-medium rounded-t-lg transition-colors ${
      tab === t
        ? "bg-gray-800 text-white border-t border-l border-r border-gray-600"
        : "bg-gray-900 text-gray-400 hover:text-gray-200 border-b border-gray-600"
    }`;

  // Active (non-finished) my games
  const activeMyGames = myGameSummaries.filter((g) => g.phase < PHASE.FINALIZED || g.phase === PHASE.DRAW);
  const finishedMyGames = myGameSummaries.filter((g) => g.phase === PHASE.FINALIZED);

  return (
    <div className="w-full max-w-2xl">
      {/* Tab bar */}
      <div className="flex border-b border-gray-600 mb-0">
        <button className={tabClass("open")} onClick={() => setTab("open")}>
          Open Games {openGames.length > 0 && <span className="ml-1 bg-green-600 text-white text-xs px-1.5 py-0.5 rounded-full">{openGames.length}</span>}
        </button>
        <button className={tabClass("my")} onClick={() => setTab("my")}>
          My Games {activeMyGames.length > 0 && <span className="ml-1 bg-blue-600 text-white text-xs px-1.5 py-0.5 rounded-full">{activeMyGames.length}</span>}
        </button>
        <button className={tabClass("create")} onClick={() => setTab("create")}>
          Create
        </button>
        <button className={tabClass("join")} onClick={() => setTab("join")}>
          Join
        </button>
        <div className="flex-1 border-b border-gray-600" />
        <button
          onClick={refresh}
          disabled={loading}
          className="px-3 py-1 text-xs text-gray-400 hover:text-white disabled:opacity-50 self-center"
          title="Refresh"
        >
          {loading ? (
            <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
              <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" className="opacity-25" />
              <path fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" className="opacity-75" />
            </svg>
          ) : (
            "↻"
          )}
        </button>
      </div>

      {/* Tab content */}
      <div className="bg-gray-800 rounded-b-lg border border-t-0 border-gray-600 p-4 min-h-[280px]">
        {error && <p className="text-red-400 text-xs mb-3">{error}</p>}

        {/* ── Open Games Tab ──────────────────────────────────────── */}
        {tab === "open" && (
          <>
            {!loading && openGames.length === 0 && (
              <div className="text-center py-8">
                <p className="text-gray-500 text-sm mb-2">No open games right now.</p>
                <button
                  onClick={() => setTab("create")}
                  className="text-blue-400 hover:text-blue-300 text-sm underline"
                >
                  Create one to get started
                </button>
              </div>
            )}
            <div className="space-y-2 max-h-80 overflow-y-auto">
              {openGames.map((game) => (
                <div
                  key={game.gameId}
                  className="flex items-center justify-between bg-gray-900 rounded-lg px-4 py-3 border border-gray-700 hover:border-gray-500 transition-colors"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-xs px-2 py-0.5 rounded border bg-yellow-900/50 text-yellow-300 border-yellow-600">
                        Waiting for P2
                      </span>
                      {game.escrowXlm > 0 && (
                        <span className="text-yellow-400 text-xs font-medium">
                          {game.escrowXlm} XLM
                        </span>
                      )}
                      {game.escrowXlm === 0 && (
                        <span className="text-gray-500 text-xs">No escrow</span>
                      )}
                    </div>
                    <p className="text-gray-400 text-xs">
                      Created by <span className="text-green-400 font-mono">{formatAddr(game.creator)}</span>
                      {game.createdAt && <span className="ml-2 text-gray-600">{timeAgo(game.createdAt)}</span>}
                    </p>
                    <p className="text-gray-600 font-mono text-[10px] truncate mt-0.5">
                      {game.gameId}
                    </p>
                  </div>
                  <div className="flex gap-2 ml-3 shrink-0">
                    <button
                      onClick={() => copyLink(game.gameId)}
                      className="text-xs bg-gray-700 hover:bg-gray-600 text-gray-300 px-2 py-1.5 rounded"
                      title="Copy join link"
                    >
                      🔗
                    </button>
                    <button
                      onClick={() => {
                        setJoinGameId(game.gameId);
                        setJoinPreview({
                          escrowXlm: game.escrowXlm,
                          creator: game.creator,
                          phase: PHASE.WAITING,
                        });
                        setJoinLookupError("");
                        setTab("join");
                      }}
                      className="text-xs bg-green-600 hover:bg-green-500 text-white font-bold px-4 py-1.5 rounded"
                    >
                      Join
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}

        {/* ── My Games Tab ────────────────────────────────────────── */}
        {tab === "my" && (
          <>
            {myGameSummaries.length === 0 && !loading && (
              <div className="text-center py-8">
                <p className="text-gray-500 text-sm mb-2">You haven't created or joined any games yet.</p>
                <button
                  onClick={() => setTab("create")}
                  className="text-blue-400 hover:text-blue-300 text-sm underline"
                >
                  Create your first game
                </button>
              </div>
            )}

            {/* Active games */}
            {activeMyGames.length > 0 && (
              <div className="mb-4">
                <h3 className="text-sm font-medium text-gray-400 mb-2">Active Games</h3>
                <div className="space-y-2">
                  {activeMyGames.map((game) => {
                    const pl = phaseLabel(game.phase);
                    const entry = getMyGameEntries().find((e) => e.gameId === game.gameId);
                    return (
                      <div
                        key={game.gameId}
                        className="flex items-center justify-between bg-gray-900 rounded-lg px-4 py-3 border border-gray-700 hover:border-gray-500 transition-colors"
                      >
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <span className={`text-xs px-2 py-0.5 rounded border ${pl.color}`}>
                              {pl.text}
                            </span>
                            {entry && (
                              <span className="text-xs text-gray-500">
                                You: {entry.role === "p1" ? "Player 1" : "Player 2"}
                              </span>
                            )}
                            {game.escrowXlm > 0 && (
                              <span className="text-yellow-400 text-xs">{game.escrowXlm} XLM</span>
                            )}
                          </div>
                          <p className="text-gray-600 font-mono text-[10px] truncate">
                            {game.gameId}
                          </p>
                        </div>
                        <div className="flex gap-2 ml-3 shrink-0">
                          {game.phase === PHASE.WAITING && (
                            <button
                              onClick={() => copyLink(game.gameId)}
                              className="text-xs bg-gray-700 hover:bg-gray-600 text-gray-300 px-2 py-1.5 rounded"
                              title="Copy invite link"
                            >
                              🔗 Share
                            </button>
                          )}
                          <button
                            onClick={() => onResumeGame(game.gameId)}
                            className="text-xs bg-blue-600 hover:bg-blue-500 text-white font-bold px-4 py-1.5 rounded"
                          >
                            {game.phase === PHASE.WAITING ? "View" : "Play"}
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Finished games */}
            {finishedMyGames.length > 0 && (
              <div>
                <h3 className="text-sm font-medium text-gray-400 mb-2">Finished Games</h3>
                <div className="space-y-2">
                  {finishedMyGames.map((game) => (
                    <div
                      key={game.gameId}
                      className="flex items-center justify-between bg-gray-900/50 rounded-lg px-4 py-2 border border-gray-700/50"
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-0.5">
                          <span className="text-xs px-2 py-0.5 rounded border bg-gray-800 text-gray-500 border-gray-700">
                            Finished
                          </span>
                        </div>
                        <p className="text-gray-600 font-mono text-[10px] truncate">
                          {game.gameId}
                        </p>
                      </div>
                      <button
                        onClick={() => removeMyGameEntry(game.gameId)}
                        className="text-xs text-gray-600 hover:text-red-400 px-2 py-1"
                        title="Remove from list"
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}

        {/* ── Create Game Tab ─────────────────────────────────────── */}
        {tab === "create" && (
          <div className="max-w-md mx-auto">
            <h3 className="text-lg font-bold mb-4">Create New Game</h3>

            {/* Escrow */}
            <div className="mb-4">
              <label className="block text-gray-400 text-sm mb-1">Escrow Amount</label>
              <div className="flex gap-2 items-center">
                <input
                  type="number"
                  min="0"
                  step="any"
                  value={escrowInput}
                  onChange={(e) => setEscrowInput(e.target.value)}
                  placeholder="0"
                  className="flex-1 bg-gray-700 border border-gray-600 rounded px-3 py-2 text-sm font-mono text-white"
                />
                <span className="text-gray-400 text-sm">XLM</span>
              </div>
              <p className="text-gray-600 text-xs mt-1">Both players must deposit. Winner takes the pot.</p>
            </div>

            {/* Secret word */}
            <div className="mb-4">
              <label className="block text-gray-400 text-sm mb-1">Secret Word (optional)</label>
              <div className="flex gap-2">
                <input
                  type="text"
                  maxLength={WORD_LENGTH}
                  value={secretWord}
                  onChange={(e) => {
                    setSecretWord(e.target.value.replace(/[^a-zA-Z]/g, "").toLowerCase().slice(0, WORD_LENGTH));
                    setSecretWordError("");
                  }}
                  placeholder="Leave blank for random…"
                  className="flex-1 bg-gray-700 border border-gray-600 rounded px-3 py-2 text-sm tracking-widest font-mono uppercase"
                />
              </div>
              {secretWordError && <p className="text-red-400 text-xs mt-1">{secretWordError}</p>}
              <p className="text-gray-600 text-xs mt-1">Your opponent will try to guess this word.</p>
            </div>

            <div className="flex gap-2">
              <button
                onClick={() => {
                  if (secretWord && secretWord.length !== WORD_LENGTH) {
                    setSecretWordError(`Must be ${WORD_LENGTH} letters.`);
                    return;
                  }
                  if (secretWord && !isWordInList(secretWord)) {
                    setSecretWordError(`"${secretWord}" is not a valid word.`);
                    return;
                  }
                  const escrow = parseFloat(escrowInput) || 0;
                  onCreateGame(escrow, secretWord || undefined);
                }}
                className="flex-1 bg-green-600 hover:bg-green-500 disabled:opacity-50 text-white font-bold px-6 py-3 rounded-lg text-sm"
              >
                {secretWord ? `Create with "${secretWord.toUpperCase()}"` : "Create with Random Word"}
              </button>
            </div>
          </div>
        )}

        {/* ── Join Game Tab ────────────────────────────────────────── */}
        {tab === "join" && (
          <div className="max-w-md mx-auto">
            <h3 className="text-lg font-bold mb-4">Join Game</h3>

            {/* Game ID */}
            <div className="mb-4">
              <label className="block text-gray-400 text-sm mb-1">Game ID</label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={joinGameId}
                  onChange={(e) => {
                    setJoinGameId(e.target.value.trim());
                    setJoinPreview(null);
                    setJoinLookupError("");
                  }}
                  placeholder="Paste Game ID…"
                  className="flex-1 bg-gray-700 border border-gray-600 rounded px-3 py-2 text-sm font-mono"
                />
                <button
                  onClick={async () => {
                    if (!joinGameId) return;
                    setJoinLooking(true);
                    setJoinLookupError("");
                    setJoinPreview(null);
                    try {
                      const [chain, creator] = await Promise.all([
                        queryGameState(joinGameId),
                        getGameCreator(joinGameId),
                      ]);
                      if (chain.phase !== PHASE.WAITING) {
                        setJoinLookupError("This game is not accepting new players.");
                      } else {
                        setJoinPreview({
                          escrowXlm: chain.escrowAmount / STROOPS_PER_XLM,
                          creator: creator || "Unknown",
                          phase: chain.phase,
                        });
                      }
                    } catch (err: any) {
                      setJoinLookupError(err.message ?? "Failed to look up game");
                    } finally {
                      setJoinLooking(false);
                    }
                  }}
                  disabled={!joinGameId || joinLooking}
                  className="bg-gray-600 hover:bg-gray-500 disabled:opacity-50 text-white text-sm font-medium px-4 py-2 rounded"
                >
                  {joinLooking ? "Looking up…" : "Look up"}
                </button>
              </div>
              {joinLookupError && <p className="text-red-400 text-xs mt-1">{joinLookupError}</p>}
            </div>

            {/* Preview card: show escrow + creator when looked up */}
            {joinPreview && (
              <div className="mb-4 bg-gray-900 border border-gray-600 rounded-lg p-4">
                <h4 className="text-sm font-semibold text-gray-300 mb-2">Game Details</h4>
                <div className="flex items-center gap-3 mb-2">
                  <span className="text-xs px-2 py-0.5 rounded border bg-yellow-900/50 text-yellow-300 border-yellow-600">
                    Waiting for P2
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <div>
                    <span className="text-gray-500 text-xs">Created by</span>
                    <p className="text-green-400 font-mono text-xs">{formatAddr(joinPreview.creator)}</p>
                  </div>
                  <div>
                    <span className="text-gray-500 text-xs">Escrow (per player)</span>
                    <p className={`font-medium text-sm ${joinPreview.escrowXlm > 0 ? "text-yellow-400" : "text-gray-400"}`}>
                      {joinPreview.escrowXlm > 0 ? `${joinPreview.escrowXlm} XLM` : "No escrow"}
                    </p>
                  </div>
                </div>
                {joinPreview.escrowXlm > 0 && (
                  <p className="text-yellow-500/80 text-xs mt-2">
                    You will deposit <strong>{joinPreview.escrowXlm} XLM</strong> to match Player 1's escrow. Winner takes the full pot ({joinPreview.escrowXlm * 2} XLM).
                  </p>
                )}
              </div>
            )}

            {/* Secret word (only shown after successful lookup) */}
            {joinPreview && (
              <>
                <div className="mb-4">
                  <label className="block text-gray-400 text-sm mb-1">Your Secret Word (optional)</label>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      maxLength={WORD_LENGTH}
                      value={joinSecretWord}
                      onChange={(e) => {
                        setJoinSecretWord(e.target.value.replace(/[^a-zA-Z]/g, "").toLowerCase().slice(0, WORD_LENGTH));
                        setJoinSecretWordError("");
                      }}
                      placeholder="Leave blank for random…"
                      className="flex-1 bg-gray-700 border border-gray-600 rounded px-3 py-2 text-sm tracking-widest font-mono uppercase"
                    />
                  </div>
                  {joinSecretWordError && <p className="text-red-400 text-xs mt-1">{joinSecretWordError}</p>}
                </div>

                <button
                  onClick={() => {
                    if (!joinGameId) return;
                    if (joinSecretWord && joinSecretWord.length !== WORD_LENGTH) {
                      setJoinSecretWordError(`Must be ${WORD_LENGTH} letters.`);
                      return;
                    }
                    if (joinSecretWord && !isWordInList(joinSecretWord)) {
                      setJoinSecretWordError(`"${joinSecretWord}" is not valid.`);
                      return;
                    }
                    onJoinGame(joinGameId, joinSecretWord || undefined);
                  }}
                  disabled={!joinGameId}
                  className="w-full bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white font-bold px-6 py-3 rounded-lg text-sm"
                >
                  {joinSecretWord
                    ? `Join with "${joinSecretWord.toUpperCase()}" (deposit ${joinPreview.escrowXlm > 0 ? joinPreview.escrowXlm + " XLM" : "no escrow"})`
                    : `Join with Random Word (deposit ${joinPreview.escrowXlm > 0 ? joinPreview.escrowXlm + " XLM" : "no escrow"})`}
                </button>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
