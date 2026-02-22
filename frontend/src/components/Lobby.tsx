import { useState, useEffect, useCallback, useRef } from "react";
import type { OpenGame } from "../soroban";
import { fetchOpenGames, queryGameState, getGameCreator } from "../soroban";
import { Spinner } from "./Spinner";
import { isWordInList, WORD_LIST } from "../gameState";
import { PHASE, WORD_LENGTH, STROOPS_PER_XLM } from "../config";

type Tab = "open" | "create" | "join";

interface LobbyProps {
  currentAddress: string;
  busy?: boolean;
  onJoinGame: (gameId: string, customWord?: string) => void;
  onCreateGame: (escrowXlm: number, customWord?: string) => void;
}

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

export function Lobby({ currentAddress, busy, onJoinGame, onCreateGame }: LobbyProps) {
  const [tab, setTab] = useState<Tab>("open");
  const [openGames, setOpenGames] = useState<OpenGame[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // Create game form
  const [escrowInput, setEscrowInput] = useState("10");
  const [secretWord, setSecretWord] = useState("");

  // Join game form
  const [joinGameId, setJoinGameId] = useState("");
  const [joinSecretWord, setJoinSecretWord] = useState("");

  // Toast message (wordle-style)
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [createShake, setCreateShake] = useState(false);
  const [joinShake, setJoinShake] = useState(false);

  const showToast = useCallback((msg: string) => {
    clearTimeout(toastTimer.current);
    setToastMsg(msg);
    toastTimer.current = setTimeout(() => setToastMsg(null), 1500);
  }, []);

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
  const lookupInFlight = useRef(false);

  const doLookup = useCallback(async (gameId: string, force = false) => {
    if (!gameId || !isValidStellarId(gameId)) return;
    if (lookupInFlight.current && !force) return;
    lookupInFlight.current = true;
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
      lookupInFlight.current = false;
    }
  }, []);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      // Fetch open games from events
      const open = await fetchOpenGames();
      // Filter out my own games
      const filtered = open.filter((g) => g.creator !== currentAddress);
      setOpenGames(filtered);
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
      const trimmed = gameParam.trim();
      setJoinGameId(trimmed);
      setTab("join");
      window.history.replaceState({}, "", window.location.pathname);
      doLookup(trimmed);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const copyLink = (gameId: string) => {
    const url = `${window.location.origin}${window.location.pathname}?game=${gameId}`;
    navigator.clipboard.writeText(url);
  };

  const tabClass = (t: Tab) =>
    `px-4 py-2 text-sm font-semibold uppercase tracking-wider transition-colors ${
      tab === t
        ? "text-foreground border-b-2 border-foreground"
        : "text-muted-foreground hover:text-foreground border-b-2 border-transparent"
    }`;

  return (
    <div className="w-full max-w-lg">
      {/* Tab bar */}
      <div className="flex items-center justify-center gap-1 border-b border-border mb-6">
        <button className={tabClass("open")} onClick={() => setTab("open")}>
          Games {openGames.length > 0 && <span className="ml-1 text-xs font-mono text-primary">{openGames.length}</span>}
        </button>
        <button className={tabClass("create")} onClick={() => setTab("create")}>
          Create
        </button>
        <button className={tabClass("join")} onClick={() => setTab("join")}>
          Join
        </button>
        <button
          onClick={refresh}
          disabled={loading}
          className="ml-auto px-2 py-1 text-muted-foreground hover:text-foreground disabled:opacity-50 transition-colors"
          title="Refresh"
        >
          {loading ? (
            <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
              <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" className="opacity-25" />
              <path fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" className="opacity-75" />
            </svg>
          ) : (
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16"/><path d="M16 16h5v5"/></svg>
          )}
        </button>
      </div>

      {/* Toast (wordle-style) */}
      {toastMsg && (
        <div className="fixed top-20 left-1/2 -translate-x-1/2 z-50 animate-fade-in-up">
          <div className="px-4 py-2 rounded-lg text-sm font-bold bg-foreground text-background shadow-lg">
            {toastMsg}
          </div>
        </div>
      )}

      {/* Tab content */}
      <div className="min-h-60">
        {error && <p className="text-destructive text-xs mb-3">{error}</p>}

        {/* ── Open Games Tab ──────────────────────────────────────── */}
        {tab === "open" && (
          <>
            {!loading && openGames.length === 0 && (
              <div className="flex flex-col items-center gap-3 py-12">
                <p className="text-muted-foreground text-sm">No open games right now.</p>
                <button
                  onClick={() => setTab("create")}
                  className="text-sm bg-primary hover:bg-primary/90 text-primary-foreground font-semibold px-5 py-2.5 rounded-md transition-colors"
                >
                  Create a Game
                </button>
              </div>
            )}
            <div className="space-y-2 max-h-96 overflow-y-auto">
              {openGames.map((game) => (
                <div
                  key={game.gameId}
                  className="flex items-center justify-between rounded-md px-4 py-3 border border-border hover:border-muted-foreground/30 transition-colors"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      {game.escrowXlm > 0 ? (
                        <span className="text-accent text-sm font-bold">{game.escrowXlm} XLM</span>
                      ) : (
                        <span className="text-muted-foreground text-sm">Free</span>
                      )}
                      <span className="text-muted-foreground/40">·</span>
                      <span className="text-muted-foreground font-mono text-xs">{formatAddr(game.creator)}</span>
                      {game.createdAt && (
                        <>
                          <span className="text-muted-foreground/40">·</span>
                          <span className="text-muted-foreground/60 text-xs">{timeAgo(game.createdAt)}</span>
                        </>
                      )}
                    </div>
                  </div>
                  <div className="flex gap-1.5 ml-3 shrink-0">
                    <button
                      onClick={() => copyLink(game.gameId)}
                      className="text-muted-foreground hover:text-foreground p-1.5 rounded-md transition-colors"
                      title="Copy join link"
                    >
                      <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
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

        {/* ── Create Game Tab ─────────────────────────────────────── */}
        {tab === "create" && (
          <div className="flex flex-col items-center gap-6 w-full max-w-sm mx-auto py-4">
            <div className="flex flex-col items-center gap-2 text-center">
              <div className="flex items-center justify-center w-14 h-14 rounded-2xl bg-primary/10 border border-primary/20">
                <svg className="h-7 w-7 text-primary" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
              </div>
              <h2 className="text-xl font-bold text-foreground font-sans">Create a Challenge</h2>
              <p className="text-muted-foreground text-sm leading-relaxed max-w-xs">
                Pick a secret word and set your escrow. Your opponent will try to guess it.
              </p>
            </div>

            <div className="w-full flex flex-col gap-3">
              {/* Secret word */}
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">Secret Word</label>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    maxLength={WORD_LENGTH}
                    value={secretWord}
                    onChange={(e) => {
                      setSecretWord(e.target.value.replace(/[^a-zA-Z]/g, "").toLowerCase().slice(0, WORD_LENGTH));
                    }}
                    placeholder="Leave blank for random"
                    className={`flex-1 text-center text-xl uppercase tracking-[0.3em] font-bold h-14 bg-muted border border-border rounded-md text-foreground placeholder:tracking-normal placeholder:text-sm placeholder:normal-case placeholder:font-normal placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring/50 transition-shadow ${createShake ? "animate-shake" : ""}`}
                    onAnimationEnd={() => setCreateShake(false)}
                    autoFocus
                  />
                  <div className="relative group shrink-0">
                    <button
                      type="button"
                      onClick={() => setSecretWord(WORD_LIST[Math.floor(Math.random() * WORD_LIST.length)])}
                      className="h-14 w-14 flex items-center justify-center rounded-md border border-primary/30 bg-primary/10 hover:bg-primary/20 text-primary hover:text-primary transition-colors"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="2" width="20" height="20" rx="3"/><circle cx="8" cy="8" r="1.5" fill="currentColor" stroke="none"/><circle cx="16" cy="8" r="1.5" fill="currentColor" stroke="none"/><circle cx="8" cy="16" r="1.5" fill="currentColor" stroke="none"/><circle cx="16" cy="16" r="1.5" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none"/></svg>
                    </button>
                    <span className="pointer-events-none absolute -bottom-8 left-1/2 -translate-x-1/2 whitespace-nowrap rounded bg-foreground px-2 py-1 text-[12px] font-medium text-background opacity-0 group-hover:opacity-100 transition-opacity">
                      Random word
                    </span>
                  </div>
                </div>
              </div>

              {/* Escrow */}
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">Escrow Amount</label>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min="0"
                    step="any"
                    value={escrowInput}
                    onChange={(e) => setEscrowInput(e.target.value)}
                    placeholder="0"
                    className="flex-1 h-12 bg-muted border border-border rounded-md px-4 text-sm font-mono text-foreground text-center focus:outline-none focus:ring-2 focus:ring-ring/50 transition-shadow"
                  />
                  <span className="text-muted-foreground text-sm font-semibold">XLM</span>
                  <span className="text-xl shrink-0">💰</span>
                </div>
                <p className="text-muted-foreground/70 text-xs mt-1 text-center">Both players deposit. Winner takes the pot.</p>
              </div>

              <button
                disabled={busy}
                onClick={() => {
                  if (secretWord && secretWord.length !== WORD_LENGTH) {
                    showToast("Not enough letters");
                    setCreateShake(true);
                    return;
                  }
                  if (secretWord && !isWordInList(secretWord)) {
                    showToast("Not in a valid English word");
                    setCreateShake(true);
                    return;
                  }
                  const escrow = parseFloat(escrowInput) || 0;
                  onCreateGame(escrow, secretWord || undefined);
                }}
                className="w-full h-12 bg-primary hover:bg-primary/90 disabled:opacity-50 text-primary-foreground font-bold rounded-md text-sm transition-colors"
              >
                {busy ? (
                  <span className="flex items-center justify-center gap-2">
                    <Spinner size={4} />
                    Processing…
                  </span>
                ) : secretWord ? `Create with "${secretWord.toUpperCase()}"` : "Create with Random Word"}
              </button>
            </div>
          </div>
        )}

        {/* ── Join Game Tab ────────────────────────────────────────── */}
        {tab === "join" && (
          <div className="flex flex-col items-center gap-6 w-full max-w-sm mx-auto py-4">
            <div className="flex flex-col items-center gap-2 text-center">
              <div className="flex items-center justify-center w-14 h-14 rounded-2xl bg-accent/10 border border-accent/20">
                <svg className="h-7 w-7 text-accent" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><polyline points="10 17 15 12 10 7"/><line x1="15" y1="12" x2="3" y2="12"/></svg>
              </div>
              <h2 className="text-xl font-bold text-foreground font-sans">Join a Game</h2>
              <p className="text-muted-foreground text-sm leading-relaxed max-w-xs">
                Paste a Game ID to look up a challenge and join it.
              </p>
            </div>

            <div className="w-full flex flex-col gap-3">
              {/* Game ID */}
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">Game ID</label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={joinGameId}
                    onChange={(e) => {
                      const newId = e.target.value.trim();
                      setJoinGameId(newId);
                      setJoinPreview(null);
                      setJoinLookupError("");
                      lookupInFlight.current = false;
                      if (newId && isValidStellarId(newId)) {
                        doLookup(newId);
                      }
                    }}
                    placeholder="Paste Game ID…"
                    className="flex-1 h-12 bg-muted border border-border rounded-md px-3 text-xs font-mono text-foreground focus:outline-none focus:ring-2 focus:ring-ring/50 transition-shadow"
                  />
                  <button
                    onClick={() => doLookup(joinGameId, true)}
                    disabled={!joinGameId || !isValidStellarId(joinGameId) || joinLooking}
                    className="bg-secondary hover:bg-secondary/80 disabled:opacity-50 text-secondary-foreground text-sm font-semibold px-4 rounded-md transition-colors"
                  >
                    {joinLooking ? "…" : "Look up"}
                  </button>
                </div>
                {joinLookupError && <p className="text-destructive text-sm text-center mt-1">{joinLookupError}</p>}
              </div>

              {/* Preview card */}
              {joinPreview && (
                <div className="bg-muted border border-border rounded-md p-4">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Game Details</span>
                    <span className="text-xs px-2 py-0.5 rounded-md border bg-accent/20 text-accent border-accent/40">Waiting</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <div>
                      <span className="text-muted-foreground text-xs">Creator</span>
                      <p className="text-foreground font-mono text-xs">{formatAddr(joinPreview.creator)}</p>
                    </div>
                    <div className="text-right">
                      <span className="text-muted-foreground text-xs">Escrow</span>
                      <p className={`font-semibold text-sm ${joinPreview.escrowXlm > 0 ? "text-accent" : "text-muted-foreground"}`}>
                        {joinPreview.escrowXlm > 0 ? `${joinPreview.escrowXlm} XLM` : "Free"}
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {/* Secret word + Join button (only after lookup) */}
              {joinPreview && (
                <>
                  <div>
                    <label className="block text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">Your Secret Word</label>
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        maxLength={WORD_LENGTH}
                        value={joinSecretWord}
                        onChange={(e) => {
                          setJoinSecretWord(e.target.value.replace(/[^a-zA-Z]/g, "").toLowerCase().slice(0, WORD_LENGTH));
                        }}
                        placeholder="Leave blank for random"
                        className={`flex-1 text-center text-xl uppercase tracking-[0.3em] font-bold h-14 bg-muted border border-border rounded-md text-foreground placeholder:tracking-normal placeholder:text-sm placeholder:normal-case placeholder:font-normal placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring/50 transition-shadow ${joinShake ? "animate-shake" : ""}`}
                        onAnimationEnd={() => setJoinShake(false)}
                      />
                      <div className="relative group shrink-0">
                        <button
                          type="button"
                          onClick={() => setJoinSecretWord(WORD_LIST[Math.floor(Math.random() * WORD_LIST.length)])}
                          className="h-14 w-14 flex items-center justify-center rounded-md border border-primary/30 bg-primary/10 hover:bg-primary/20 text-primary hover:text-primary transition-colors"
                        >
                          <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="2" width="20" height="20" rx="3"/><circle cx="8" cy="8" r="1.5" fill="currentColor" stroke="none"/><circle cx="16" cy="8" r="1.5" fill="currentColor" stroke="none"/><circle cx="8" cy="16" r="1.5" fill="currentColor" stroke="none"/><circle cx="16" cy="16" r="1.5" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none"/></svg>
                        </button>
                        <span className="pointer-events-none absolute -bottom-8 left-1/2 -translate-x-1/2 whitespace-nowrap rounded bg-foreground px-2 py-1 text-[10px] font-medium text-background opacity-0 group-hover:opacity-100 transition-opacity">
                          Random word
                        </span>
                      </div>
                    </div>
                  </div>

                  <button
                    onClick={() => {
                      if (!joinGameId) return;
                      if (joinSecretWord && joinSecretWord.length !== WORD_LENGTH) {
                        showToast("Not enough letters");
                        setJoinShake(true);
                        return;
                      }
                      if (joinSecretWord && !isWordInList(joinSecretWord)) {
                        showToast("Not in a valid English word");
                        setJoinShake(true);
                        return;
                      }
                      onJoinGame(joinGameId, joinSecretWord || undefined);
                    }}
                    disabled={!joinGameId || busy}
                    className="w-full h-12 bg-primary hover:bg-primary/90 disabled:opacity-50 text-primary-foreground font-bold rounded-md text-sm transition-colors"
                  >
                    {busy ? (
                      <span className="flex items-center justify-center gap-2">
                        <Spinner size={4} />
                        Processing…
                      </span>
                    ) : joinPreview.escrowXlm > 0 ? `Join · Deposit ${joinPreview.escrowXlm} XLM` : "Join Game"}
                  </button>
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
