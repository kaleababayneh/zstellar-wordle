import { useCallback, useEffect, useRef } from "react";
import { PHASE, POLL_INTERVAL_MS } from "../config";
import { calculateWordleResults } from "../gameLogic";
import type { GuessEntry } from "../gameState";
import {
  loadGame,
  saveGame,
  addOpponentGuess,
  updateMyGuessResults,
} from "../gameState";
import { queryGameState } from "../soroban";
import { sessionKeyService } from "../services/sessionKeyService";
import type { UseGameReturn } from "./useGame";

/**
 * Determines whose turn it is from on-chain turn number + role.
 */
function checkMyTurn(turn: number, role: "p1" | "p2"): boolean {
  return role === "p1" ? turn % 2 === 1 : turn % 2 === 0;
}

/**
 * Polls on-chain game state and manages countdown timers.
 */
export function useGamePolling(gs: UseGameReturn) {
  const {
    game, setGame,
    gameOver, setGameOver,
    gameWon, setGameWon,
    setMyTimeLeft, setOppTimeLeft,
    isMyTurn, setIsMyTurn,
    myTimeLeft, oppTimeLeft,
    onChainPhase, setOnChainPhase,
    setChainTurn, setChainPolled,
    setWinner, setMyDrawRevealed, setOppDrawRevealed,
    setOppRevealedWord, setDrawDeadline,
    timerRef, pollRef,
    updateLetterStates,
  } = gs;

  // ── Poll on-chain state ──────────────────────────────────────────────

  const pollGameState = useCallback(async () => {
    const g = loadGame();
    if (!g || !g.gameId) return;

    try {
      const chain = await queryGameState(g.gameId);

      // After the async call, re-check localStorage — if the game was
      // cleared (e.g. user clicked "New Game") while we were awaiting,
      // discard the results so we don't resurrect the old game state.
      if (!loadGame()) return;

      setOnChainPhase(chain.phase);
      setChainPolled(true);
      setChainTurn(chain.turn);
      const myTurn = checkMyTurn(chain.turn, g.myRole);
      setIsMyTurn(myTurn);

      // Update times
      if (chain.phase === PHASE.ACTIVE || chain.phase === PHASE.REVEAL) {
        const nowSecs = Date.now() / 1000;
        if (myTurn) {
          const remaining = Math.max(0, chain.deadline - nowSecs);
          setMyTimeLeft(remaining);
          const oppKey = g.myRole === "p1" ? chain.p2Time : chain.p1Time;
          setOppTimeLeft(oppKey);
        } else {
          const remaining = Math.max(0, chain.deadline - nowSecs);
          setOppTimeLeft(remaining);
          const myKey = g.myRole === "p1" ? chain.p1Time : chain.p2Time;
          setMyTimeLeft(myKey);
        }
      }

      // Opponent verified our last guess — update results
      if (myTurn && chain.lastResults.length === 5 && chain.phase === PHASE.ACTIVE) {
        const expectedVerified = g.myRole === "p1"
          ? Math.floor(chain.turn / 2)
          : Math.floor(chain.turn / 2) - 1;
        const verifiedCount = g.myGuesses.filter(
          (guess: GuessEntry) => guess.verified
        ).length;

        if (verifiedCount < expectedVerified) {
          const lastUnverified = g.myGuesses.findIndex(
            (guess: GuessEntry) => !guess.verified
          );
          if (lastUnverified >= 0) {
            updateMyGuessResults(lastUnverified, chain.lastResults);
            const updated = loadGame();
            if (updated) {
              setGame({ ...updated });
              const guess = updated.myGuesses[lastUnverified];
              updateLetterStates(guess.word, guess.results);
            }
          }
        }
      }

      // New opponent guess appeared
      const expectedOppGuesses = Math.floor(chain.turn / 2);
      if (chain.lastGuess && chain.phase === PHASE.ACTIVE && myTurn) {
        // Re-read from localStorage to get the latest count (avoid race with concurrent polls)
        const freshG = loadGame();
        if (freshG && freshG.opponentGuesses.length < expectedOppGuesses) {
          const results = calculateWordleResults(chain.lastGuess, freshG.word);
          addOpponentGuess({ word: chain.lastGuess, results, verified: false }, expectedOppGuesses);
          const updated = loadGame();
          if (updated) setGame({ ...updated });
        }
      }

      // REVEAL phase: apply winning results
      if (chain.phase === PHASE.REVEAL && chain.winner === g.myAddress && chain.lastResults.length === 5) {
        const lastUnverified = g.myGuesses.findIndex(
          (guess: GuessEntry) => !guess.verified
        );
        if (lastUnverified >= 0) {
          updateMyGuessResults(lastUnverified, chain.lastResults);
          const updated = loadGame();
          if (updated) {
            setGame({ ...updated });
            const guess = updated.myGuesses[lastUnverified];
            updateLetterStates(guess.word, guess.results);
          }
        }
      }

      // Finalized
      if (chain.phase === PHASE.FINALIZED) {
        setGameOver(true);
        const hasRealWinner = chain.winner && chain.winner !== g.gameId;
        if (hasRealWinner && chain.winner === g.myAddress) {
          setGameWon(true);
        }
        setWinner(hasRealWinner ? chain.winner : "");

        const chainEscrowXlm = chain.escrowAmount / 10_000_000;
        if (chainEscrowXlm > 0 && (!g.escrowAmount || g.escrowAmount !== chainEscrowXlm)) {
          g.escrowAmount = chainEscrowXlm;
        }
        if (!g.escrowAmount || isNaN(g.escrowAmount)) {
          g.escrowAmount = chainEscrowXlm > 0 ? chainEscrowXlm : 0;
        }
        saveGame(g);
        setGame({ ...g });

        const iAmP1 = g.myRole === "p1";
        const oppWord = iAmP1 ? chain.p2Word : chain.p1Word;
        if (oppWord) setOppRevealedWord(oppWord);
      }

      // Draw phase
      if (chain.phase === PHASE.DRAW) {
        const iAmP1 = g.myRole === "p1";
        setMyDrawRevealed(iAmP1 ? chain.p1Revealed : chain.p2Revealed);
        setOppDrawRevealed(iAmP1 ? chain.p2Revealed : chain.p1Revealed);
        const oppWord = iAmP1 ? chain.p2Word : chain.p1Word;
        if (oppWord) setOppRevealedWord(oppWord);

        if (chain.deadline > 0) {
          const nowSecs = Date.now() / 1000;
          setDrawDeadline(Math.max(0, chain.deadline - nowSecs));
        }

        const chainEscrowXlm = chain.escrowAmount / 10_000_000;
        if (chainEscrowXlm > 0 && (!g.escrowAmount || g.escrowAmount !== chainEscrowXlm)) {
          g.escrowAmount = chainEscrowXlm;
        }
        if (!g.escrowAmount || isNaN(g.escrowAmount)) {
          g.escrowAmount = chainEscrowXlm > 0 ? chainEscrowXlm : 0;
        }
        saveGame(g);
        setGame({ ...g });
      }

      if (chain.phase === PHASE.REVEAL) {
        setWinner(chain.winner);
        const iAmP1 = g.myRole === "p1";
        const oppWord = iAmP1 ? chain.p2Word : chain.p1Word;
        if (oppWord) setOppRevealedWord(oppWord);
      }
    } catch {
      // silently ignore poll errors
    }
  }, [
    setGame, setOnChainPhase, setChainPolled, setChainTurn, setIsMyTurn,
    setMyTimeLeft, setOppTimeLeft, setGameOver, setGameWon, setWinner,
    setMyDrawRevealed, setOppDrawRevealed, setOppRevealedWord, setDrawDeadline,
    updateLetterStates,
  ]);

  // Start polling when game is active
  useEffect(() => {
    if (game && !gameOver) {
      pollGameState();
      pollRef.current = setInterval(pollGameState, POLL_INTERVAL_MS);
    }
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [game, gameOver, pollGameState, pollRef]);

  // Countdown timer
  useEffect(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    if (!game || gameOver) return;

    timerRef.current = setInterval(() => {
      if (onChainPhase === PHASE.DRAW) {
        setDrawDeadline((prev) => (prev !== null ? Math.max(0, prev - 1) : null));
      } else if (isMyTurn && myTimeLeft !== null) {
        setMyTimeLeft((prev) => (prev !== null ? Math.max(0, prev - 1) : null));
      } else if (!isMyTurn && oppTimeLeft !== null) {
        setOppTimeLeft((prev) => (prev !== null ? Math.max(0, prev - 1) : null));
      }
    }, 1000);

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [game, gameOver, isMyTurn, myTimeLeft, oppTimeLeft, onChainPhase, setDrawDeadline, setMyTimeLeft, setOppTimeLeft, timerRef]);
  // ── Auto-reclaim session key funds when game ends ─────────────────────

  const reclaimedRef = useRef(false);

  useEffect(() => {
    // Reset the ref when the game changes
    if (!game) {
      reclaimedRef.current = false;
      return;
    }

    // Only auto-reclaim on FINALIZED — NOT DRAW.
    // During DRAW, the session key is still needed for reveal_word_draw + withdraw.
    const isGameOver = onChainPhase === PHASE.FINALIZED;
    if (!isGameOver || reclaimedRef.current) return;
    if (!game.myAddress || !sessionKeyService.isReady(game.gameId)) return;

    // DON'T auto-reclaim for the WINNER — they still need the session key
    // to sign `withdraw`. Their reclaim happens in handleWithdraw's finally block.
    // Only auto-reclaim for the LOSER (who can't withdraw and has no other action).
    if (gameWon && !game.escrowWithdrawn) return;

    reclaimedRef.current = true; // prevent repeated attempts

    (async () => {
      try {
        console.log("[SessionKey] Game over — auto-reclaiming session key funds…");
        await sessionKeyService.reclaimFunds(game.myAddress);
        console.log("[SessionKey] Funds reclaimed ✅");
        sessionKeyService.clear();
      } catch (err) {
        console.warn("[SessionKey] Auto-reclaim failed:", err);
      }
    })();
  }, [game, onChainPhase, gameWon]);

  return { pollGameState };
}
