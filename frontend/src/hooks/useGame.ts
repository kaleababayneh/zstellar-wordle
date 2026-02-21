import { useState, useCallback, useRef, useEffect } from "react";
import { PHASE } from "../config";
import type { GameState } from "../gameState";
import { loadGame, clearGame } from "../gameState";

/**
 * All UI state related to the game, grouped into a single hook.
 * Provides a single `resetGame()` to return everything to defaults.
 */
export function useGame() {
  const [game, setGame] = useState<GameState | null>(null);
  const [currentGuess, setCurrentGuess] = useState("");
  const [status, setStatus] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [gameOver, setGameOver] = useState(false);
  const [withdrawing, setWithdrawing] = useState(false);
  const [gameWon, setGameWon] = useState(false);
  const [letterStates, setLetterStates] = useState<Record<string, number | undefined>>({});

  // Two-player / on-chain state
  const [myTimeLeft, setMyTimeLeft] = useState<number | null>(null);
  const [oppTimeLeft, setOppTimeLeft] = useState<number | null>(null);
  const [isMyTurn, setIsMyTurn] = useState(false);
  const [onChainPhase, setOnChainPhase] = useState<number>(PHASE.NONE);
  const [chainTurn, setChainTurn] = useState(0);
  const [winner, setWinner] = useState("");
  const [creatingGame, setCreatingGame] = useState(false);
  const [copiedGameId, setCopiedGameId] = useState(false);
  const [myDrawRevealed, setMyDrawRevealed] = useState(false);
  const [oppDrawRevealed, setOppDrawRevealed] = useState(false);
  const [oppRevealedWord, setOppRevealedWord] = useState("");
  const [drawDeadline, setDrawDeadline] = useState<number | null>(null);
  const [chainPolled, setChainPolled] = useState(false);

  // Refs for interval cleanup
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Helpers ──────────────────────────────────────────────────────────

  const addStatus = useCallback((msg: string) => {
    setStatus((prev) => [...prev, msg]);
  }, []);

  const updateLetterStates = useCallback((word: string, results: number[]) => {
    setLetterStates((prev) => {
      const next = { ...prev };
      for (let i = 0; i < word.length; i++) {
        const letter = word[i].toLowerCase();
        const current = next[letter];
        if (current === undefined || results[i] > current) {
          next[letter] = results[i];
        }
      }
      return next;
    });
  }, []);

  /** Reset every piece of state back to "no game" defaults. */
  const resetGame = useCallback(() => {
    clearGame();
    setGame(null);
    setCurrentGuess("");
    setGameOver(false);
    setLetterStates({});
    setStatus([]);
    setMyTimeLeft(null);
    setOppTimeLeft(null);
    setGameWon(false);
    setOnChainPhase(PHASE.NONE);
    setChainPolled(false);
    setChainTurn(0);
    setWinner("");
    setCopiedGameId(false);
    setMyDrawRevealed(false);
    setOppDrawRevealed(false);
    setOppRevealedWord("");
    setDrawDeadline(null);
  }, []);

  // ── Load saved game on mount ─────────────────────────────────────────

  useEffect(() => {
    const saved = loadGame();
    if (saved) {
      setGame(saved);
      if (saved.drawRevealed) setMyDrawRevealed(true);
      // Restore letter states from verified guesses
      const states: Record<string, number | undefined> = {};
      for (const g of saved.myGuesses) {
        if (g.results) {
          for (let i = 0; i < g.word.length; i++) {
            const letter = g.word[i].toLowerCase();
            const current = states[letter];
            if (current === undefined || g.results[i] > current) {
              states[letter] = g.results[i];
            }
          }
        }
      }
      setLetterStates(states);
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  return {
    // Core game
    game, setGame,
    currentGuess, setCurrentGuess,
    status, setStatus,
    busy, setBusy,
    gameOver, setGameOver,
    withdrawing, setWithdrawing,
    gameWon, setGameWon,
    letterStates, setLetterStates,

    // Two-player
    myTimeLeft, setMyTimeLeft,
    oppTimeLeft, setOppTimeLeft,
    isMyTurn, setIsMyTurn,
    onChainPhase, setOnChainPhase,
    chainTurn, setChainTurn,
    winner, setWinner,
    creatingGame, setCreatingGame,
    copiedGameId, setCopiedGameId,
    myDrawRevealed, setMyDrawRevealed,
    oppDrawRevealed, setOppDrawRevealed,
    oppRevealedWord, setOppRevealedWord,
    drawDeadline, setDrawDeadline,
    chainPolled, setChainPolled,

    // Refs
    timerRef, pollRef,

    // Helpers
    addStatus,
    updateLetterStates,
    resetGame,
  };
}

export type UseGameReturn = ReturnType<typeof useGame>;
