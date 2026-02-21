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
      return { text: "Waiting for P2", color: "bg-accent/20 text-accent border-accent/40" };
    case PHASE.ACTIVE:
      return { text: "In Progress", color: "bg-primary/20 text-primary border-primary/40" };
    case PHASE.REVEAL:
      return { text: "Reveal Phase", color: "bg-ring/20 text-ring border-ring/40" };
    case PHASE.FINALIZED:
      return { text: "Finished", color: "bg-muted text-muted-foreground border-border" };
    case PHASE.DRAW:
      return { text: "Draw", color: "bg-accent/20 text-accent border-accent/40" };
    default:
      return { text: "Expired", color: "bg-muted text-muted-foreground border-border" };
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

  // Validate that a string looks like a valid Stellar public key (G... 56 chars, base32)
  const isValidStellarId = (id: string): boolean => {
    return /^G[A-Z2-7]{55}$/.test(id);
  };

  // Extracted lookup logic so it can be called from button or auto-trigger
  const doLookup = useCallback(async (gameId: string) => {
    if (!gameId || !isValidStellarId(gameId)) return;
    setJoinLooking(true);
    setJoinLookupError("");
    setJoinPreview(null);
    try {
      const [chain, creator] = await Promise.all([
        queryGameState(gameId),
        getGameCreator(gameId),
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
  }, []);

  // Auto-lookup when a valid Game ID is pasted/set
  useEffect(() => {
    if (joinGameId && isValidStellarId(joinGameId) && !joinPreview && !joinLooking) {
      doLookup(joinGameId);
    }
  }, [joinGameId, joinPreview, joinLooking, doLookup]);

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
    `px-4 py-2.5 text-sm font-medium rounded-t-lg transition-colors ${
      tab === t
        ? "bg-card text-foreground border-t border-l border-r border-border"
        : "bg-transparent text-muted-foreground hover:text-foreground border-b border-border"
    }`;

  // Active (non-finished) my games
  const activeMyGames = myGameSummaries.filter((g) => g.phase < PHASE.FINALIZED || g.phase === PHASE.DRAW);
  const finishedMyGames = myGameSummaries.filter((g) => g.phase === PHASE.FINALIZED);

  return (
    <div className="w-full max-w-2xl">
      {/* Tab bar */}
      <div className="flex border-b border-border mb-0">
        <button className={tabClass("open")} onClick={() => setTab("open")}>
          Open Games {openGames.length > 0 && <span className="ml-1 bg-primary text-primary-foreground text-xs px-1.5 py-0.5 rounded-full">{openGames.length}</span>}
        </button>
        <button className={tabClass("my")} onClick={() => setTab("my")}>
          My Games {activeMyGames.length > 0 && <span className="ml-1 bg-ring text-primary-foreground text-xs px-1.5 py-0.5 rounded-full">{activeMyGames.length}</span>}
        </button>
        <button className={tabClass("create")} onClick={() => setTab("create")}>
          Create
        </button>
        <button className={tabClass("join")} onClick={() => setTab("join")}>
          Join
        </button>
        <div className="flex-1 border-b border-border" />
        <button
          onClick={refresh}
          disabled={loading}
          className="px-3 py-1 text-xs text-muted-foreground hover:text-foreground disabled:opacity-50 self-center transition-colors"
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
      <div className="bg-card rounded-b-lg border border-t-0 border-border p-4 min-h-70">
        {error && <p className="text-destructive text-xs mb-3">{error}</p>}

        {/* ── Open Games Tab ──────────────────────────────────────── */}
        {tab === "open" && (
          <>
            {!loading && openGames.length === 0 && (
              <div className="text-center py-8">
                <p className="text-muted-foreground text-sm mb-2">No open games right now.</p>
                <button
                  onClick={() => setTab("create")}
                  className="text-primary hover:text-primary/80 text-sm underline transition-colors"
                >
                  Create one to get started
                </button>
              </div>
            )}
            <div className="space-y-2 max-h-80 overflow-y-auto">
              {openGames.map((game) => (
                <div
                  key={game.gameId}
                  className="flex items-center justify-between bg-muted rounded-lg px-4 py-3 border border-border hover:border-muted-foreground/30 transition-colors"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-xs px-2 py-0.5 rounded border bg-accent/20 text-accent border-accent/40">
                        Waiting for P2
                      </span>
                      {game.escrowXlm > 0 && (
                        <span className="text-accent text-xs font-medium">
                          {game.escrowXlm} XLM
                        </span>
                      )}
                      {game.escrowXlm === 0 && (
                        <span className="text-muted-foreground text-xs">No escrow</span>
                      )}
                    </div>
                    <p className="text-muted-foreground text-xs">
                      Created by <span className="text-primary font-mono">{formatAddr(game.creator)}</span>
                      {game.createdAt && <span className="ml-2 text-muted-foreground/60">{timeAgo(game.createdAt)}</span>}
                    </p>
                    <p className="text-muted-foreground/50 font-mono text-[10px] truncate mt-0.5">
                      {game.gameId}
                    </p>
                  </div>
                  <div className="flex gap-2 ml-3 shrink-0">
                    <button
                      onClick={() => copyLink(game.gameId)}
                      className="text-xs bg-secondary hover:bg-secondary/80 text-secondary-foreground px-2 py-1.5 rounded-md transition-colors"
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
                      className="text-xs bg-primary hover:bg-primary/90 text-primary-foreground font-bold px-4 py-1.5 rounded-md transition-colors"
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
                <p className="text-muted-foreground text-sm mb-2">You haven't created or joined any games yet.</p>
                <button
                  onClick={() => setTab("create")}
                  className="text-primary hover:text-primary/80 text-sm underline transition-colors"
                >
                  Create your first game
                </button>
              </div>
            )}

            {/* Active games */}
            {activeMyGames.length > 0 && (
              <div className="mb-4">
                <h3 className="text-sm font-medium text-muted-foreground mb-2">Active Games</h3>
                <div className="space-y-2">
                  {activeMyGames.map((game) => {
                    const pl = phaseLabel(game.phase);
                    const entry = getMyGameEntries().find((e) => e.gameId === game.gameId);
                    return (
                      <div
                        key={game.gameId}
                        className="flex items-center justify-between bg-muted rounded-lg px-4 py-3 border border-border hover:border-muted-foreground/30 transition-colors"
                      >
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <span className={`text-xs px-2 py-0.5 rounded border ${pl.color}`}>
                              {pl.text}
                            </span>
                            {entry && (
                              <span className="text-xs text-muted-foreground">
                                You: {entry.role === "p1" ? "Player 1" : "Player 2"}
                              </span>
                            )}
                            {game.escrowXlm > 0 && (
                              <span className="text-accent text-xs">{game.escrowXlm} XLM</span>
                            )}
                          </div>
                          <p className="text-muted-foreground/50 font-mono text-[10px] truncate">
                            {game.gameId}
                          </p>
                        </div>
                        <div className="flex gap-2 ml-3 shrink-0">
                          {game.phase === PHASE.WAITING && (
                            <button
                              onClick={() => copyLink(game.gameId)}
                              className="text-xs bg-secondary hover:bg-secondary/80 text-secondary-foreground px-2 py-1.5 rounded-md transition-colors"
                              title="Copy invite link"
                            >
                              🔗 Share
                            </button>
                          )}
                          <button
                            onClick={() => onResumeGame(game.gameId)}
                            className="text-xs bg-primary hover:bg-primary/90 text-primary-foreground font-bold px-4 py-1.5 rounded-md transition-colors"
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
                <h3 className="text-sm font-medium text-muted-foreground mb-2">Finished Games</h3>
                <div className="space-y-2">
                  {finishedMyGames.map((game) => (
                    <div
                      key={game.gameId}
                      className="flex items-center justify-between bg-muted/50 rounded-lg px-4 py-2 border border-border/50"
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-0.5">
                          <span className="text-xs px-2 py-0.5 rounded border bg-muted text-muted-foreground border-border">
                            Finished
                          </span>
                        </div>
                        <p className="text-muted-foreground/50 font-mono text-[10px] truncate">
                          {game.gameId}
                        </p>
                      </div>
                      <button
                        onClick={() => removeMyGameEntry(game.gameId)}
                        className="text-xs text-muted-foreground hover:text-destructive px-2 py-1 transition-colors"
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
            <h3 className="text-lg font-bold mb-4 text-foreground">Create New Game</h3>

            {/* Escrow */}
            <div className="mb-4">
              <label className="block text-muted-foreground text-sm mb-1.5 font-medium">Escrow Amount</label>
              <div className="flex gap-2 items-center">
                <input
                  type="number"
                  min="0"
                  step="any"
                  value={escrowInput}
                  onChange={(e) => setEscrowInput(e.target.value)}
                  placeholder="0"
                  className="flex-1 bg-input border border-border rounded-lg px-3 py-2.5 text-sm font-mono text-foreground focus:outline-none focus:ring-2 focus:ring-ring/50 transition-shadow"
                />
                <span className="text-muted-foreground text-sm font-medium">XLM</span>
              </div>
              <p className="text-muted-foreground/70 text-xs mt-1.5">Both players must deposit. Winner takes the pot.</p>
            </div>

            {/* Secret word */}
            <div className="mb-4">
              <label className="block text-muted-foreground text-sm mb-1.5 font-medium">Secret Word (optional)</label>
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
                  className="flex-1 bg-input border border-border rounded-lg px-3 py-2.5 text-sm tracking-widest font-mono uppercase focus:outline-none focus:ring-2 focus:ring-ring/50 transition-shadow"
                />
              </div>
              {secretWordError && <p className="text-destructive text-xs mt-1">{secretWordError}</p>}
              <p className="text-muted-foreground/70 text-xs mt-1.5">Your opponent will try to guess this word.</p>
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
                className="flex-1 bg-primary hover:bg-primary/90 disabled:opacity-50 text-primary-foreground font-bold px-6 py-3 rounded-lg text-sm transition-colors"
              >
                {secretWord ? `Create with "${secretWord.toUpperCase()}"` : "Create with Random Word"}
              </button>
            </div>
          </div>
        )}

        {/* ── Join Game Tab ────────────────────────────────────────── */}
        {tab === "join" && (
          <div className="max-w-md mx-auto">
            <h3 className="text-lg font-bold mb-4 text-foreground">Join Game</h3>

            {/* Game ID */}
            <div className="mb-4">
              <label className="block text-muted-foreground text-sm mb-1.5 font-medium">Game ID</label>
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
                  className="flex-1 bg-input border border-border rounded-lg px-3 py-2.5 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-ring/50 transition-shadow"
                />
                <button
                  onClick={() => doLookup(joinGameId)}
                  disabled={!joinGameId || !isValidStellarId(joinGameId) || joinLooking}
                  className="bg-secondary hover:bg-secondary/80 disabled:opacity-50 text-secondary-foreground text-sm font-medium px-4 py-2.5 rounded-lg transition-colors"
                >
                  {joinLooking ? "Looking up…" : "Look up"}
                </button>
              </div>
              {joinLookupError && <p className="text-destructive text-xs mt-1">{joinLookupError}</p>}
            </div>

            {/* Preview card: show escrow + creator when looked up */}
            {joinPreview && (
              <div className="mb-4 bg-muted border border-border rounded-lg p-4">
                <h4 className="text-sm font-semibold text-foreground mb-2">Game Details</h4>
                <div className="flex items-center gap-3 mb-2">
                  <span className="text-xs px-2 py-0.5 rounded border bg-accent/20 text-accent border-accent/40">
                    Waiting for P2
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <div>
                    <span className="text-muted-foreground text-xs">Created by</span>
                    <p className="text-primary font-mono text-xs">{formatAddr(joinPreview.creator)}</p>
                  </div>
                  <div>
                    <span className="text-muted-foreground text-xs">Escrow (per player)</span>
                    <p className={`font-medium text-sm ${joinPreview.escrowXlm > 0 ? "text-accent" : "text-muted-foreground"}`}>
                      {joinPreview.escrowXlm > 0 ? `${joinPreview.escrowXlm} XLM` : "No escrow"}
                    </p>
                  </div>
                </div>
                {joinPreview.escrowXlm > 0 && (
                  <p className="text-accent/70 text-xs mt-2">
                    You will deposit <strong>{joinPreview.escrowXlm} XLM</strong> to match Player 1's escrow. Winner takes the full pot ({joinPreview.escrowXlm * 2} XLM).
                  </p>
                )}
              </div>
            )}

            {/* Secret word (only shown after successful lookup) */}
            {joinPreview && (
              <>
                <div className="mb-4">
                  <label className="block text-muted-foreground text-sm mb-1.5 font-medium">Your Secret Word (optional)</label>
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
                      className="flex-1 bg-input border border-border rounded-lg px-3 py-2.5 text-sm tracking-widest font-mono uppercase focus:outline-none focus:ring-2 focus:ring-ring/50 transition-shadow"
                    />
                  </div>
                  {joinSecretWordError && <p className="text-destructive text-xs mt-1">{joinSecretWordError}</p>}
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
                  className="w-full bg-primary hover:bg-primary/90 disabled:opacity-50 text-primary-foreground font-bold px-6 py-3 rounded-lg text-sm transition-colors"
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
