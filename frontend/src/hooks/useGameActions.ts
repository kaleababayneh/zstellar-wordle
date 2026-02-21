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
      const { isPoseidonValidWord, getPoseidonMerkleProof, poseidonProofToBytes } = await import("../poseidonMerkleProof");

      const valid = await isPoseidonValidWord(currentGuess);
      if (!valid) {
        addStatus(`"${currentGuess}" is not in the word list.`);
        setBusy(false);
        return;
      }

      const merkleProof = await getPoseidonMerkleProof(currentGuess);
      if (!merkleProof) {
        addStatus(`Could not generate Merkle proof for "${currentGuess}".`);
        setBusy(false);
        return;
      }

      const { pathElementsBytes, pathIndices } = poseidonProofToBytes(merkleProof);
      const guessWordBytes = new Uint8Array(currentGuess.toLowerCase().split("").map((ch) => ch.charCodeAt(0)));
      addStatus(`"${currentGuess}" is a valid word (Merkle proof ready)`);

      // Reload from localStorage to get latest state (React state may be stale)
      let freshG = loadGame();
      if (freshG) setGame({ ...freshG });

      // Determine if a ZK proof is required: the contract requires one for turn >= 2.
      // Always fetch the opponent's guess directly from on-chain — local state may be
      // stale or may have been incorrectly marked as "verified" by a prior failed attempt.
      const onChainTurn = chainTurn;
      let publicInputsBytes: Uint8Array = new Uint8Array(0);
      let proofBytes: Uint8Array = new Uint8Array(0);
      let verifiedGuessWord: string | null = null;
      let verifiedResults: number[] = [];

      if (onChainTurn >= 2) {
        addStatus("Fetching opponent's last guess from on-chain…");
        const chain = await queryGameState(game.gameId);

        if (!chain.lastGuess || chain.lastGuess.length !== 5) {
          throw new Error("Could not fetch opponent's guess from on-chain");
        }

        const opponentGuessWord = chain.lastGuess;
        const latestGame = freshG ?? game;

        // Ensure the guess is in local state for display
        const expectedOpp = Math.floor(onChainTurn / 2);
        addOpponentGuess({ word: opponentGuessWord, results: [], verified: false }, expectedOpp);
        freshG = loadGame();
        if (freshG) setGame({ ...freshG });

        addStatus(`Verifying opponent's guess "${opponentGuessWord}"…`);
        const results = calculateWordleResults(opponentGuessWord, latestGame.word);
        addStatus(`Results: ${results.map((r) => (r === 2 ? "🟩" : r === 1 ? "🟨" : "⬛")).join("")}`);

        const { generateProof } = await import("../generateProof");
        const proofArtifacts = await generateProof(opponentGuessWord, getGameSecret(latestGame), addStatus);
        publicInputsBytes = new Uint8Array(proofArtifacts.publicInputsBytes);
        proofBytes = new Uint8Array(proofArtifacts.proof);

        verifiedGuessWord = opponentGuessWord;
        verifiedResults = results;
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

      // Only mark opponent guess as verified AFTER successful on-chain submission
      if (verifiedGuessWord) {
        const postSubmit = loadGame();
        if (postSubmit) {
          for (let i = postSubmit.opponentGuesses.length - 1; i >= 0; i--) {
            if (!postSubmit.opponentGuesses[i].verified &&
                postSubmit.opponentGuesses[i].word === verifiedGuessWord) {
              postSubmit.opponentGuesses[i].verified = true;
              postSubmit.opponentGuesses[i].results = verifiedResults;
              saveGame(postSubmit);
              break;
            }
          }
        }
      }

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
