import { useCallback } from "react";
import * as StellarSdk from "@stellar/stellar-sdk";
import { WORD_LENGTH, PHASE } from "../config";
import { calculateWordleResults } from "../gameLogic";
import type { GuessEntry } from "../gameState";
import {
  createGameState,
  loadGame,
  saveGame,
  addMyGuess,
  addOpponentGuess,
  getGameSecret,
  commitmentToBytes,
  addMyGameEntry,
  markEscrowWithdrawn,
  markDrawRevealed,
} from "../gameState";
import {
  createGameOnChain,
  joinGameOnChain,
  submitTurnOnChain,
  revealWordOnChain,
  revealWordDrawOnChain,
  claimTimeoutOnChain,
  withdrawEscrow,
  queryGameState,
} from "../soroban";
import type { UseGameReturn } from "./useGame";
import type { FreighterState } from "./useFreighter";

interface UseGameActionsOpts {
  gs: UseGameReturn;
  wallet: FreighterState;
  proverReady: boolean;
  pollGameState: () => Promise<void>;
}

/**
 * All action callbacks: create, join, submit, verify-only, reveal, claim timeout, withdraw.
 */
export function useGameActions({ gs, wallet, proverReady, pollGameState }: UseGameActionsOpts) {
  const {
    game, setGame,
    currentGuess, setCurrentGuess,
    busy, setBusy,
    gameOver,
    setStatus,
    isMyTurn,
    creatingGame, setCreatingGame,
    setOnChainPhase, setChainTurn, setIsMyTurn,
    chainTurn,
    setGameOver, setLetterStates, setGameWon,
    setWithdrawing, withdrawing,
    setMyDrawRevealed,
    addStatus,
  } = gs;

  // ── Create Game (Player 1) ──────────────────────────────────────────

  const handleCreateGame = useCallback(async (escrowXlm: number, customWord?: string) => {
    if (creatingGame || !wallet.address) return;
    setCreatingGame(true);
    setStatus([]);
    try {
      const gameKeypair = StellarSdk.Keypair.random();
      const gameId = gameKeypair.publicKey();
      addStatus(`Game ID: ${gameId.slice(0, 12)}…`);

      const newGame = await createGameState("p1", wallet.address, gameId, "", escrowXlm, addStatus, customWord);
      const commitBytes = commitmentToBytes(newGame.commitmentHash);

      addStatus("Generating word-commit proof…");
      const { getPoseidonMerkleProof } = await import("../poseidonMerkleProof");
      const posMerkle = await getPoseidonMerkleProof(newGame.word);
      if (!posMerkle) {
        addStatus("Word not found in Poseidon Merkle tree.");
        setCreatingGame(false);
        return;
      }

      const { generateWordCommitProof } = await import("../generateWordCommitProof");
      const wcProof = await generateWordCommitProof(
        newGame.commitmentHash, newGame.salt, newGame.letterCodes,
        posMerkle.pathElements, posMerkle.pathIndices, posMerkle.root, addStatus,
      );

      await createGameOnChain(
        gameId, wallet.address, wallet.sign, commitBytes,
        escrowXlm, wcProof.publicInputsBytes, wcProof.proof, addStatus,
      );

      addMyGameEntry({ gameId, role: "p1", createdAt: Date.now() });

      setGame(newGame);
      setOnChainPhase(PHASE.WAITING);
      setIsMyTurn(false);
      setCurrentGuess("");
      setGameOver(false);
      setLetterStates({});
      setGameWon(false);

      addStatus("Game created! Share your Game ID with your opponent:");
      addStatus(`Game ID: ${gameId}`);
      addStatus("Waiting for Player 2 to join…");
    } catch (err: any) {
      addStatus(`Error: ${err.message ?? err}`);
    } finally {
      setCreatingGame(false);
    }
  }, [creatingGame, wallet.address, wallet.sign, addStatus, setCreatingGame, setStatus, setGame, setOnChainPhase, setIsMyTurn, setCurrentGuess, setGameOver, setLetterStates, setGameWon]);

  // ── Join Game (Player 2) ────────────────────────────────────────────

  const handleJoinGame = useCallback(async (joinId: string, customWord?: string) => {
    if (creatingGame || !wallet.address || !joinId) return;
    setCreatingGame(true);
    setStatus([]);
    try {
      const gameId = joinId.trim();
      const chain = await queryGameState(gameId);
      if (chain.phase !== PHASE.WAITING) {
        addStatus("Game is not in waiting state — cannot join.");
        setCreatingGame(false);
        return;
      }

      const escrowXlm = chain.escrowAmount / 10_000_000;

      const { getGameCreator } = await import("../soroban");
      const creatorAddr = await getGameCreator(gameId);
      const opponentAddr = creatorAddr || gameId;

      const newGame = await createGameState("p2", wallet.address, gameId, opponentAddr, escrowXlm, addStatus, customWord);
      const commitBytes = commitmentToBytes(newGame.commitmentHash);

      addStatus("Generating word-commit proof…");
      const { getPoseidonMerkleProof } = await import("../poseidonMerkleProof");
      const posMerkle = await getPoseidonMerkleProof(newGame.word);
      if (!posMerkle) {
        addStatus("Word not found in Poseidon Merkle tree.");
        setCreatingGame(false);
        return;
      }

      const { generateWordCommitProof } = await import("../generateWordCommitProof");
      const wcProof = await generateWordCommitProof(
        newGame.commitmentHash, newGame.salt, newGame.letterCodes,
        posMerkle.pathElements, posMerkle.pathIndices, posMerkle.root, addStatus,
      );

      await joinGameOnChain(
        gameId, wallet.address, wallet.sign, commitBytes,
        wcProof.publicInputsBytes, wcProof.proof, addStatus,
      );

      addMyGameEntry({ gameId, role: "p2", createdAt: Date.now() });

      setGame(newGame);
      setOnChainPhase(PHASE.ACTIVE);
      setChainTurn(1);
      setIsMyTurn(false);
      setCurrentGuess("");
      setGameOver(false);
      setLetterStates({});
      setGameWon(false);

      addStatus("Joined game! Waiting for Player 1 to guess first…");
    } catch (err: any) {
      addStatus(`Error: ${err.message ?? err}`);
    } finally {
      setCreatingGame(false);
    }
  }, [creatingGame, wallet.address, wallet.sign, addStatus, setCreatingGame, setStatus, setGame, setOnChainPhase, setChainTurn, setIsMyTurn, setCurrentGuess, setGameOver, setLetterStates, setGameWon]);

  // ── Submit Turn ─────────────────────────────────────────────────────

  const handleSubmit = useCallback(async () => {
    if (busy || gameOver || !game || !wallet.address) return;
    if (!isMyTurn) {
      addStatus("It's not your turn yet. Wait for your opponent.");
      return;
    }
    if (currentGuess.length !== WORD_LENGTH) return;
    if (!proverReady) {
      addStatus("Prover still loading, please wait…");
      return;
    }

    setBusy(true);
    setStatus([]);

    try {
      const { isValidWord, getMerkleProof, proofToBytes } = await import("../merkleProof");

      const valid = await isValidWord(currentGuess);
      if (!valid) {
        addStatus(`"${currentGuess}" is not in the word list.`);
        setBusy(false);
        return;
      }

      const merkleProof = await getMerkleProof(currentGuess);
      if (!merkleProof) {
        addStatus(`Could not generate Merkle proof for "${currentGuess}".`);
        setBusy(false);
        return;
      }

      const { pathElementsBytes, pathIndices } = proofToBytes(merkleProof);
      const guessWordBytes = new Uint8Array(currentGuess.toLowerCase().split("").map((ch) => ch.charCodeAt(0)));
      addStatus(`"${currentGuess}" is a valid word (Merkle proof ready)`);

      // Reload from localStorage to get latest state (React state may be stale)
      let freshG = loadGame();
      if (freshG) setGame({ ...freshG });

      // Also check on-chain turn: if turn >= 2, a ZK proof is required
      const onChainTurn = chainTurn;
      const localHasUnverified = (freshG ?? game).opponentGuesses.length > 0 &&
        (freshG ?? game).opponentGuesses.some((g: GuessEntry) => !g.verified);

      // If on-chain says turn >= 2 but we have no unverified opponent guess locally,
      // sync opponent's last guess from on-chain before proceeding
      if (onChainTurn >= 2 && !localHasUnverified) {
        addStatus("Syncing opponent's guess from on-chain…");
        const chain = await queryGameState(game.gameId);
        if (chain.lastGuess && chain.lastGuess.length === 5) {
          const { calculateWordleResults: calcResults } = await import("../gameLogic");
          const results = calcResults(chain.lastGuess, (freshG ?? game).word);
          addOpponentGuess({ word: chain.lastGuess, results, verified: false });
          freshG = loadGame();
          if (freshG) setGame({ ...freshG });
        }
      }

      const latestGame = freshG ?? game;
      const needsZkProof = onChainTurn >= 2 &&
        latestGame.opponentGuesses.length > 0 &&
        latestGame.opponentGuesses.some((g: GuessEntry) => !g.verified);
      let publicInputsBytes: Uint8Array = new Uint8Array(0);
      let proofBytes: Uint8Array = new Uint8Array(0);

      if (needsZkProof) {
        const unverifiedGuesses = latestGame.opponentGuesses.filter((g: GuessEntry) => !g.verified);
        const lastUnverified = unverifiedGuesses[unverifiedGuesses.length - 1];
        if (!lastUnverified) throw new Error("No unverified opponent guess found");

        addStatus(`Verifying opponent's guess "${lastUnverified.word}"…`);
        const results = calculateWordleResults(lastUnverified.word, latestGame.word);
        addStatus(`Results: ${results.map((r) => (r === 2 ? "🟩" : r === 1 ? "🟨" : "⬛")).join("")}`);

        const { generateProof } = await import("../generateProof");
        const proofArtifacts = await generateProof(lastUnverified.word, getGameSecret(latestGame), addStatus);
        publicInputsBytes = new Uint8Array(proofArtifacts.publicInputsBytes);
        proofBytes = new Uint8Array(proofArtifacts.proof);

        let idx = -1;
        for (let i = latestGame.opponentGuesses.length - 1; i >= 0; i--) {
          if (!latestGame.opponentGuesses[i].verified) { idx = i; break; }
        }
        if (idx >= 0) {
          latestGame.opponentGuesses[idx].verified = true;
          latestGame.opponentGuesses[idx].results = results;
          saveGame(latestGame);
        }
      }

      const myGuess: GuessEntry = { word: currentGuess, results: [], verified: false };
      addMyGuess(myGuess);

      const freshState = loadGame();
      if (freshState) setGame({ ...freshState });
      setCurrentGuess("");

      addStatus("Submitting turn on Stellar testnet…");
      await submitTurnOnChain(
        game.gameId, wallet.address, wallet.sign,
        guessWordBytes, pathElementsBytes, pathIndices,
        publicInputsBytes, proofBytes, addStatus,
      );

      const updated = loadGame();
      if (updated) setGame({ ...updated });
      addStatus("Turn submitted! Waiting for opponent…");
      await pollGameState();
    } catch (err: any) {
      addStatus(`Error: ${err.message ?? err}`);
      const rollback = loadGame();
      if (rollback && rollback.myGuesses.length > 0) {
        const lastGuess = rollback.myGuesses[rollback.myGuesses.length - 1];
        if (!lastGuess.verified && lastGuess.results.length === 0) {
          rollback.myGuesses.pop();
          saveGame(rollback);
          setGame({ ...rollback });
          setCurrentGuess(lastGuess.word);
        }
      }
    } finally {
      setBusy(false);
    }
  }, [busy, gameOver, currentGuess, game, wallet.address, wallet.sign, proverReady, isMyTurn, chainTurn, addStatus, pollGameState, setBusy, setStatus, setGame, setCurrentGuess]);

  // ── Verify-Only (turn 13) ──────────────────────────────────────────

  const handleVerifyOnly = useCallback(async () => {
    if (busy || !game || !wallet.address || !isMyTurn) return;
    setBusy(true);
    setStatus([]);

    try {
      const unverifiedOpp = game.opponentGuesses.filter((g: GuessEntry) => !g.verified);
      const lastUnverified = unverifiedOpp[unverifiedOpp.length - 1];
      if (!lastUnverified) {
        addStatus("No unverified opponent guess to verify.");
        setBusy(false);
        return;
      }

      addStatus(`Final verification: verifying opponent's guess "${lastUnverified.word}"…`);
      const results = calculateWordleResults(lastUnverified.word, game.word);
      addStatus(`Results: ${results.map((r) => (r === 2 ? "🟩" : r === 1 ? "🟨" : "⬛")).join("")}`);

      const { generateProof } = await import("../generateProof");
      const proofArtifacts = await generateProof(lastUnverified.word, getGameSecret(game), addStatus);

      await submitTurnOnChain(
        game.gameId, wallet.address, wallet.sign,
        new Uint8Array(0), [], [],
        proofArtifacts.publicInputsBytes, proofArtifacts.proof, addStatus,
      );

      let idx = -1;
      for (let i = game.opponentGuesses.length - 1; i >= 0; i--) {
        if (!game.opponentGuesses[i].verified) { idx = i; break; }
      }
      if (idx >= 0) {
        game.opponentGuesses[idx].verified = true;
        game.opponentGuesses[idx].results = results;
        saveGame(game);
      }

      const updated = loadGame();
      if (updated) setGame({ ...updated });
      await pollGameState();
    } catch (err: any) {
      addStatus(`Error: ${err.message ?? err}`);
    } finally {
      setBusy(false);
    }
  }, [busy, game, wallet.address, wallet.sign, isMyTurn, addStatus, pollGameState, setBusy, setStatus, setGame]);

  // ── Reveal Word (winner) ────────────────────────────────────────────

  const handleRevealWord = useCallback(async () => {
    if (busy || !game || !wallet.address) return;
    setBusy(true);
    setStatus([]);

    try {
      addStatus("Revealing your secret word on-chain…");
      const { generateProof } = await import("../generateProof");
      const proofArtifacts = await generateProof(game.word, getGameSecret(game), addStatus);
      const guessWordBytes = new Uint8Array(game.word.toLowerCase().split("").map((ch) => ch.charCodeAt(0)));

      await revealWordOnChain(
        game.gameId, wallet.address, wallet.sign,
        guessWordBytes, proofArtifacts.publicInputsBytes, proofArtifacts.proof, addStatus,
      );

      addStatus("Word revealed! Game finalized.");
      await pollGameState();
    } catch (err: any) {
      addStatus(`Error: ${err.message ?? err}`);
    } finally {
      setBusy(false);
    }
  }, [busy, game, wallet.address, wallet.sign, addStatus, pollGameState, setBusy, setStatus]);

  // ── Reveal Word for Draw ────────────────────────────────────────────

  const handleRevealWordDraw = useCallback(async () => {
    if (busy || !game || !wallet.address) return;
    setBusy(true);
    setStatus([]);

    try {
      addStatus("Revealing your word for draw…");
      const { generateProof } = await import("../generateProof");
      const proofArtifacts = await generateProof(game.word, getGameSecret(game), addStatus);
      const guessWordBytes = new Uint8Array(game.word.toLowerCase().split("").map((ch) => ch.charCodeAt(0)));

      await revealWordDrawOnChain(
        game.gameId, wallet.address, wallet.sign,
        guessWordBytes, proofArtifacts.publicInputsBytes, proofArtifacts.proof, addStatus,
      );

      markDrawRevealed();
      setMyDrawRevealed(true);
      setGame((prev) => prev ? { ...prev, drawRevealed: true } : prev);

      addStatus("Word revealed! You can now withdraw your escrow.");
      await pollGameState();
    } catch (err: any) {
      addStatus(`Error: ${err.message ?? err}`);
    } finally {
      setBusy(false);
    }
  }, [busy, game, wallet.address, wallet.sign, addStatus, pollGameState, setBusy, setStatus, setGame, setMyDrawRevealed]);

  // ── Claim Timeout ───────────────────────────────────────────────────

  const handleClaimTimeout = useCallback(async () => {
    if (busy || !game || !wallet.address) return;
    setBusy(true);
    try {
      await claimTimeoutOnChain(game.gameId, wallet.address, wallet.sign, addStatus);
      await pollGameState();
    } catch (err: any) {
      addStatus(`Error: ${err.message ?? err}`);
    } finally {
      setBusy(false);
    }
  }, [busy, game, wallet.address, wallet.sign, addStatus, pollGameState, setBusy]);

  // ── Withdraw Escrow ─────────────────────────────────────────────────

  const handleWithdraw = useCallback(async () => {
    if (withdrawing || !wallet.address || !game) return;
    setWithdrawing(true);
    try {
      await withdrawEscrow(game.gameId, wallet.address, wallet.sign, addStatus);
      markEscrowWithdrawn();
      setGame((prev) => prev ? { ...prev, escrowWithdrawn: true } : prev);
    } catch (err: any) {
      addStatus(`Withdraw error: ${err.message ?? err}`);
    } finally {
      setWithdrawing(false);
    }
  }, [withdrawing, wallet.address, wallet.sign, game, addStatus, setWithdrawing, setGame]);

  // ── Keyboard ────────────────────────────────────────────────────────

  const handleKey = useCallback(
    (key: string) => {
      if (busy || gameOver) return;
      if (key === "Enter") {
        handleSubmit();
        return;
      }
      if (key === "⌫" || key === "Backspace") {
        setCurrentGuess((prev) => prev.slice(0, -1));
        return;
      }
      if (/^[a-zA-Z]$/.test(key) && currentGuess.length < WORD_LENGTH) {
        setCurrentGuess((prev) => prev + key.toLowerCase());
      }
    },
    [busy, gameOver, currentGuess, handleSubmit, setCurrentGuess]
  );

  return {
    handleCreateGame,
    handleJoinGame,
    handleSubmit,
    handleVerifyOnly,
    handleRevealWord,
    handleRevealWordDraw,
    handleClaimTimeout,
    handleWithdraw,
    handleKey,
  };
}
