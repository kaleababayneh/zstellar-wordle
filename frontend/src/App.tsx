import { useState, useCallback, useEffect, useRef } from "react";
import { WordleGrid } from "./components/WordleGrid";
import { Keyboard } from "./components/Keyboard";
import { StatusBar } from "./components/StatusBar";
import { Lobby } from "./components/Lobby";
import { WORD_LENGTH, MAX_GUESSES, CONTRACT_ID, PHASE, POLL_INTERVAL_MS } from "./config";
import { calculateWordleResults } from "./gameLogic";
import { useFreighter } from "./hooks/useFreighter";
import * as StellarSdk from "@stellar/stellar-sdk";
import {
  type GameState,
  type GuessEntry,
  createGameState,
  loadGame,
  clearGame,
  saveGame,
  addMyGuess,
  addOpponentGuess,
  updateMyGuessResults,
  markEscrowWithdrawn,
  markDrawRevealed,
  getGameSecret,
  commitmentToBytes,
  addMyGameEntry,
} from "./gameState";
import {
  createGameOnChain,
  joinGameOnChain,
  submitTurnOnChain,
  revealWordOnChain,
  revealWordDrawOnChain,
  claimTimeoutOnChain,
  withdrawEscrow,
  queryGameState,
} from "./soroban";

function App() {
  const [game, setGame] = useState<GameState | null>(null);
  const [currentGuess, setCurrentGuess] = useState("");
  const [status, setStatus] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [gameOver, setGameOver] = useState(false);
  const [proverReady, setProverReady] = useState(false);
  const [withdrawing, setWithdrawing] = useState(false);
  const [gameWon, setGameWon] = useState(false);

  // Two-player state
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

  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Freighter wallet
  const wallet = useFreighter();

  const [letterStates, setLetterStates] = useState<Record<string, number | undefined>>({});

  const addStatus = useCallback((msg: string) => {
    setStatus((prev) => [...prev, msg]);
  }, []);

  const formatTime = (secs: number): string => {
    if (secs <= 0) return "00:00";
    const min = Math.floor(secs / 60);
    const sec = Math.ceil(secs % 60);
    return `${min.toString().padStart(2, "0")}:${sec.toString().padStart(2, "0")}`;
  };

  // Determine if it's my turn based on on-chain turn number
  const checkMyTurn = useCallback((turn: number, role: "p1" | "p2") => {
    // odd turns = p1, even turns = p2
    return role === "p1" ? turn % 2 === 1 : turn % 2 === 0;
  }, []);

  // ── Polling: sync with on-chain state ─────────────────────────────────

  const pollGameState = useCallback(async () => {
    const g = loadGame();
    if (!g || !g.gameId) return;

    try {
      const chain = await queryGameState(g.gameId);

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

      // Check if opponent verified our last guess — update results
      // Only apply when it's MY turn: that means opponent just submitted
      // and lastResults are the results of MY previous guess.
      // Guard: only apply if we have fewer verified guesses than the opponent
      // has actually verified on-chain, preventing stale results from being
      // applied to a newly submitted (not-yet-verified) guess.
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
              // Update letter states
              const guess = updated.myGuesses[lastUnverified];
              updateLetterStates(guess.word, guess.results);
            }
          }
        }
      }

      // Check if new opponent guess appeared (turn advanced)
      // Expected opponent guesses at current turn = floor(turn / 2)
      // This works for both P1 and P2 regardless of role.
      const expectedOppGuesses = Math.floor(chain.turn / 2);
      if (chain.lastGuess && chain.phase === PHASE.ACTIVE && myTurn && g.opponentGuesses.length < expectedOppGuesses) {
        // New opponent guess — compute results locally (their guess vs MY word)
        const results = calculateWordleResults(chain.lastGuess, g.word);
        addOpponentGuess({
          word: chain.lastGuess,
          results,
          verified: false, // will be verified when I submit my turn
        });
        const updated = loadGame();
        if (updated) setGame({ ...updated });
      }

      // REVEAL phase: apply winning results to the winner's last unverified guess
      // When the opponent verifies the winning guess ([2,2,2,2,2]), the phase
      // transitions to REVEAL so the ACTIVE-phase block above never runs.
      // We handle it here so the winner's board shows green tiles.
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

      // Check for game over states
      if (chain.phase === PHASE.FINALIZED) {
        setGameOver(true);
        // Contract returns game_id as fallback when no winner is set;
        // only treat as real winner if it differs from game_id.
        const hasRealWinner = chain.winner && chain.winner !== g.gameId;
        if (hasRealWinner && chain.winner === g.myAddress) {
          setGameWon(true);
        }
        setWinner(hasRealWinner ? chain.winner : "");

        // Sync escrow from chain (chain.escrowAmount is already in stroops)
        const chainEscrowXlm = chain.escrowAmount / 10_000_000;
        if (chainEscrowXlm > 0 && (!g.escrowAmount || g.escrowAmount !== chainEscrowXlm)) {
          g.escrowAmount = chainEscrowXlm;
        }
        // Ensure escrowAmount is never NaN
        if (!g.escrowAmount || isNaN(g.escrowAmount)) {
          g.escrowAmount = chainEscrowXlm > 0 ? chainEscrowXlm : 0;
        }
        saveGame(g);
        // Always refresh React state so withdraw button renders
        setGame({ ...g });

        // Track opponent's revealed word if available
        const iAmP1 = g.myRole === "p1";
        const oppWord = iAmP1 ? chain.p2Word : chain.p1Word;
        if (oppWord) setOppRevealedWord(oppWord);
      }

      // Draw phase: track reveal status, don't set gameOver yet
      if (chain.phase === PHASE.DRAW) {
        const iAmP1 = g.myRole === "p1";
        setMyDrawRevealed(iAmP1 ? chain.p1Revealed : chain.p2Revealed);
        setOppDrawRevealed(iAmP1 ? chain.p2Revealed : chain.p1Revealed);
        const oppWord = iAmP1 ? chain.p2Word : chain.p1Word;
        if (oppWord) setOppRevealedWord(oppWord);
        // Track draw deadline for countdown
        if (chain.deadline > 0) {
          const nowSecs = Date.now() / 1000;
          setDrawDeadline(Math.max(0, chain.deadline - nowSecs));
        }
        // Sync escrow from chain (chain.escrowAmount is already in stroops)
        const chainEscrowXlm = chain.escrowAmount / 10_000_000;
        if (chainEscrowXlm > 0 && (!g.escrowAmount || g.escrowAmount !== chainEscrowXlm)) {
          g.escrowAmount = chainEscrowXlm;
        }
        // Ensure escrowAmount is never NaN
        if (!g.escrowAmount || isNaN(g.escrowAmount)) {
          g.escrowAmount = chainEscrowXlm > 0 ? chainEscrowXlm : 0;
        }
        saveGame(g);
        setGame({ ...g });
      }

      if (chain.phase === PHASE.REVEAL) {
        setWinner(chain.winner);
        // Track opponent's word if they've already revealed
        const iAmP1 = g.myRole === "p1";
        const oppWord = iAmP1 ? chain.p2Word : chain.p1Word;
        if (oppWord) setOppRevealedWord(oppWord);
      }
    } catch (err) {
      // silently ignore poll errors
    }
  }, [checkMyTurn]);

  // Start polling when game is active
  useEffect(() => {
    if (game && !gameOver) {
      pollGameState(); // immediate first poll
      pollRef.current = setInterval(pollGameState, POLL_INTERVAL_MS);
    }
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [game, gameOver, pollGameState]);

  // Countdown timer for active player + draw deadline
  useEffect(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    if (!game || gameOver) return;

    timerRef.current = setInterval(() => {
      if (onChainPhase === PHASE.DRAW) {
        // Count down the draw reveal deadline
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
  }, [game, gameOver, isMyTurn, myTimeLeft, oppTimeLeft, onChainPhase]);

  // Load existing game on mount + parse URL params
  useEffect(() => {
    const saved = loadGame();
    if (saved) {
      setGame(saved);
      if (saved.drawRevealed) setMyDrawRevealed(true);
      // Restore letter states from my guesses
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
    } else {
      // URL ?game=GAME_ID is handled by the Lobby component
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  // Pre-load the prover WASM on mount
  useEffect(() => {
    import("./generateProof").then(({ preloadProver }) =>
      preloadProver((msg) => setStatus((prev) => [...prev, msg]))
        .then(() => setProverReady(true))
        .catch((err) =>
          setStatus((prev) => [...prev, `Prover init error: ${err.message}`])
        )
    );
  }, []);

  const updateLetterStates = (word: string, results: number[]) => {
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
  };

  // ── Create Game (Player 1) ────────────────────────────────────────────

  const handleCreateGame = useCallback(async (escrowXlm: number, customWord?: string) => {
    if (creatingGame || !wallet.address) return;
    setCreatingGame(true);
    setStatus([]);
    try {
      // Generate a unique game ID (random Stellar keypair address)
      const gameKeypair = StellarSdk.Keypair.random();
      const gameId = gameKeypair.publicKey();
      addStatus(`Game ID: ${gameId.slice(0, 12)}…`);

      // Create local game state
      const newGame = await createGameState(
        "p1",
        wallet.address,
        gameId,
        "",             // opponent unknown yet
        escrowXlm,
        addStatus,
        customWord
      );

      // Register on-chain
      const commitBytes = commitmentToBytes(newGame.commitmentHash);
      await createGameOnChain(
        gameId,
        wallet.address,
        wallet.sign,
        commitBytes,
        escrowXlm,
        addStatus
      );

      // Track in my games
      addMyGameEntry({ gameId, role: "p1", createdAt: Date.now() });

      setGame(newGame);
      setOnChainPhase(PHASE.WAITING);
      setIsMyTurn(false);
      setCurrentGuess("");
      setGameOver(false);
      setLetterStates({});
      setGameWon(false);

      addStatus(`Game created! Share your Game ID with your opponent:`);
      addStatus(`Game ID: ${gameId}`);
      addStatus("Waiting for Player 2 to join…");
    } catch (err: any) {
      addStatus(`Error: ${err.message ?? err}`);
    } finally {
      setCreatingGame(false);
    }
  }, [creatingGame, wallet.address, wallet.sign, addStatus]);

  // ── Join Game (Player 2) ──────────────────────────────────────────────

  const handleJoinGame = useCallback(async (joinId: string, customWord?: string) => {
    if (creatingGame || !wallet.address || !joinId) return;
    setCreatingGame(true);
    setStatus([]);
    try {
      const gameId = joinId.trim();

      // Query escrow amount and creator
      const chain = await queryGameState(gameId);
      if (chain.phase !== PHASE.WAITING) {
        addStatus("Game is not in waiting state — cannot join.");
        setCreatingGame(false);
        return;
      }

      // chain.escrowAmount is already parsed from i128 to a JS number in queryGameState
      const escrowXlm = chain.escrowAmount / 10_000_000;

      // Get creator (player1) address from on-chain
      const { getGameCreator } = await import("./soroban");
      const creatorAddr = await getGameCreator(gameId);
      const opponentAddr = creatorAddr || gameId; // fallback for old-style games

      // Create local game state
      const newGame = await createGameState(
        "p2",
        wallet.address,
        gameId,
        opponentAddr,
        escrowXlm,
        addStatus,
        customWord
      );

      // Join on-chain
      const commitBytes = commitmentToBytes(newGame.commitmentHash);
      await joinGameOnChain(
        gameId,
        wallet.address,
        wallet.sign,
        commitBytes,
        addStatus
      );

      // Track in my games
      addMyGameEntry({ gameId, role: "p2", createdAt: Date.now() });

      setGame(newGame);
      setOnChainPhase(PHASE.ACTIVE);
      setChainTurn(1);
      setIsMyTurn(false); // P2 waits for P1's first guess
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
  }, [creatingGame, wallet.address, wallet.sign, addStatus]);

  // ── Submit Turn ───────────────────────────────────────────────────────

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
      const { isValidWord, getMerkleProof, proofToBytes } = await import("./merkleProof");

      // Validate guess is a real word
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

      // Derive word bytes directly from the typed guess for guaranteed correctness
      const guessWordBytes = new Uint8Array(currentGuess.toLowerCase().split('').map(ch => ch.charCodeAt(0)));

      addStatus(`"${currentGuess}" is a valid word (Merkle proof ready)`);

      // Check if we need to provide ZK proof (turn > 1)
      // We need ZK proof if there's an unverified opponent guess
      const needsZkProof = game.opponentGuesses.length > 0 &&
        game.opponentGuesses.some((g) => !g.verified);

      let publicInputsBytes: Uint8Array = new Uint8Array(0);
      let proofBytes: Uint8Array = new Uint8Array(0);

      if (needsZkProof) {
        // Find the last unverified opponent guess
        const unverifiedGuesses = game.opponentGuesses.filter((g: GuessEntry) => !g.verified);
        const lastUnverified = unverifiedGuesses[unverifiedGuesses.length - 1];
        if (!lastUnverified) throw new Error("No unverified opponent guess found");

        addStatus(`Verifying opponent's guess "${lastUnverified.word}"…`);

        // Calculate results: opponent's guess vs MY word
        const results = calculateWordleResults(lastUnverified.word, game.word);
        addStatus(
          `Results: ${results.map((r) => (r === 2 ? "🟩" : r === 1 ? "🟨" : "⬛")).join("")}`
        );

        // Generate ZK proof
        const { generateProof } = await import("./generateProof");
        const proofArtifacts = await generateProof(
          lastUnverified.word,
          getGameSecret(game),
          addStatus
        );

        publicInputsBytes = new Uint8Array(proofArtifacts.publicInputsBytes);
        proofBytes = new Uint8Array(proofArtifacts.proof);

        // Mark opponent's guess as verified locally
        let idx = -1;
        for (let i = game.opponentGuesses.length - 1; i >= 0; i--) {
          if (!game.opponentGuesses[i].verified) { idx = i; break; }
        }
        if (idx >= 0) {
          game.opponentGuesses[idx].verified = true;
          game.opponentGuesses[idx].results = results;
          saveGame(game);
        }
      }

      // Add my guess locally (results unknown until opponent verifies)
      const myGuess: GuessEntry = {
        word: currentGuess,
        results: [],
        verified: false,
      };
      addMyGuess(myGuess);

      // Update React state immediately so the grid shows the guess
      // before the on-chain tx completes (avoids blink/glitch)
      const freshState = loadGame();
      if (freshState) setGame({ ...freshState });
      setCurrentGuess("");

      // Submit turn on-chain
      addStatus("Submitting turn on Stellar testnet…");
      await submitTurnOnChain(
        game.gameId,
        wallet.address,
        wallet.sign,
        guessWordBytes,
        pathElementsBytes,
        pathIndices,
        publicInputsBytes,
        proofBytes,
        addStatus
      );

      // Refresh local state
      const updated = loadGame();
      if (updated) setGame({ ...updated });

      addStatus("Turn submitted! Waiting for opponent…");

      // Trigger immediate poll
      await pollGameState();
    } catch (err: any) {
      addStatus(`Error: ${err.message ?? err}`);
    } finally {
      setBusy(false);
    }
  }, [busy, gameOver, currentGuess, game, wallet.address, wallet.sign, proverReady, isMyTurn, addStatus, pollGameState]);

  // ── Submit Turn 13 (verify-only, no new guess) ────────────────────────

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

      const { generateProof } = await import("./generateProof");
      const proofArtifacts = await generateProof(
        lastUnverified.word,
        getGameSecret(game),
        addStatus
      );

      // Empty guess and Merkle proof for verify-only
      await submitTurnOnChain(
        game.gameId,
        wallet.address,
        wallet.sign,
        new Uint8Array(0),
        [],
        [],
        proofArtifacts.publicInputsBytes,
        proofArtifacts.proof,
        addStatus
      );

      let idx2 = -1;
      for (let i = game.opponentGuesses.length - 1; i >= 0; i--) {
        if (!game.opponentGuesses[i].verified) { idx2 = i; break; }
      }
      if (idx2 >= 0) {
        game.opponentGuesses[idx2].verified = true;
        game.opponentGuesses[idx2].results = results;
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
  }, [busy, game, wallet.address, wallet.sign, isMyTurn, addStatus, pollGameState]);

  // ── Reveal Word (winner proves their word is valid) ───────────────────

  const handleRevealWord = useCallback(async () => {
    if (busy || !game || !wallet.address) return;

    setBusy(true);
    setStatus([]);

    try {
      addStatus("Revealing your secret word on-chain…");

      // Generate ZK proof: "guess my own word" → all results = 2
      const { generateProof } = await import("./generateProof");
      const proofArtifacts = await generateProof(
        game.word, // guess my own word
        getGameSecret(game),
        addStatus
      );

      // Generate Merkle proof for my word
      const { getMerkleProof, proofToBytes } = await import("./merkleProof");
      const merkleProof = await getMerkleProof(game.word);
      if (!merkleProof) throw new Error("Could not generate Merkle proof for your word!");

      const { pathElementsBytes, pathIndices } = proofToBytes(merkleProof);

      // Derive word bytes directly from game.word for guaranteed correctness
      const guessWordBytes = new Uint8Array(game.word.toLowerCase().split('').map(ch => ch.charCodeAt(0)));

      await revealWordOnChain(
        game.gameId,
        wallet.address,
        wallet.sign,
        guessWordBytes,
        pathElementsBytes,
        pathIndices,
        proofArtifacts.publicInputsBytes,
        proofArtifacts.proof,
        addStatus
      );

      addStatus("Word revealed! Game finalized.");
      await pollGameState();
    } catch (err: any) {
      addStatus(`Error: ${err.message ?? err}`);
    } finally {
      setBusy(false);
    }
  }, [busy, game, wallet.address, wallet.sign, addStatus, pollGameState]);

  // ── Reveal Word for Draw (both players reveal) ────────────────────────

  const handleRevealWordDraw = useCallback(async () => {
    if (busy || !game || !wallet.address) return;

    setBusy(true);
    setStatus([]);

    try {
      addStatus("Revealing your word for draw…");

      // Generate ZK proof: "guess my own word" → all results = 2
      const { generateProof } = await import("./generateProof");
      const proofArtifacts = await generateProof(
        game.word,
        getGameSecret(game),
        addStatus
      );

      // Generate Merkle proof for my word
      const { getMerkleProof, proofToBytes } = await import("./merkleProof");
      const merkleProof = await getMerkleProof(game.word);
      if (!merkleProof) throw new Error("Could not generate Merkle proof for your word!");

      const { pathElementsBytes, pathIndices } = proofToBytes(merkleProof);

      // Derive word bytes directly from game.word for guaranteed correctness
      const guessWordBytes = new Uint8Array(game.word.toLowerCase().split('').map(ch => ch.charCodeAt(0)));

      await revealWordDrawOnChain(
        game.gameId,
        wallet.address,
        wallet.sign,
        guessWordBytes,
        pathElementsBytes,
        pathIndices,
        proofArtifacts.publicInputsBytes,
        proofArtifacts.proof,
        addStatus
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
  }, [busy, game, wallet.address, wallet.sign, addStatus, pollGameState]);

  // ── Claim Timeout ─────────────────────────────────────────────────────

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
  }, [busy, game, wallet.address, wallet.sign, addStatus, pollGameState]);

  // ── Keyboard ──────────────────────────────────────────────────────────

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
    [busy, gameOver, currentGuess, handleSubmit]
  );

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      handleKey(e.key);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [handleKey]);

  // ── Build grid data ───────────────────────────────────────────────────

  const myGridGuesses = game
    ? game.myGuesses.map((g) => ({
        word: g.word,
        results: g.results.length > 0 ? g.results : undefined,
        verified: g.verified,
      }))
    : [];

  const opponentGridGuesses = game
    ? game.opponentGuesses.map((g) => ({
        word: g.word,
        results: g.results.length > 0 ? g.results : undefined,
        verified: g.verified,
      }))
    : [];

  // ── Render ────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-gray-900 text-white flex flex-col items-center py-6 px-4">
      {/* Header */}
      <div className="w-full max-w-2xl flex justify-between items-center mb-4">
        <h1 className="text-2xl font-bold tracking-wide">ZK Wordle PvP</h1>
        {wallet.address ? (
          <div className="flex items-center gap-2">
            <span className="text-xs text-green-400 font-mono">
              {wallet.address.slice(0, 6)}…{wallet.address.slice(-4)}
            </span>
            <button
              onClick={wallet.disconnect}
              className="text-xs bg-red-900/50 hover:bg-red-800 text-red-300 px-2 py-1 rounded"
            >
              Disconnect
            </button>
          </div>
        ) : (
          <button
            onClick={() => wallet.connect().catch((e) => addStatus(`Wallet: ${e.message}`))}
            disabled={wallet.connecting}
            className="text-sm bg-blue-600 hover:bg-blue-500 disabled:opacity-50 px-3 py-1.5 rounded font-medium"
          >
            {wallet.connecting ? "Connecting…" : "Connect Wallet"}
          </button>
        )}
      </div>

      <p className="text-gray-400 text-xs mb-4 max-w-md text-center">
        Two-player ZK Wordle. Each player commits a secret word. Take turns guessing.
        Winner reveals their word to claim the pot.
      </p>

      <p className="text-gray-500 text-xs mb-4 font-mono">
        Contract: {CONTRACT_ID.slice(0, 12)}…{CONTRACT_ID.slice(-6)}
      </p>

      {/* Prover loading */}
      {!proverReady && (
        <div className="mb-4 px-4 py-2 bg-yellow-900/50 border border-yellow-600 rounded text-yellow-300 text-sm flex items-center gap-2">
          <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" className="opacity-25" />
            <path fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" className="opacity-75" />
          </svg>
          Loading prover WASM…
        </div>
      )}

      {/* No wallet */}
      {!wallet.address && (
        <div className="mb-4 px-4 py-2 bg-blue-900/30 border border-blue-600 rounded text-blue-300 text-sm text-center max-w-md">
          Connect your Freighter wallet to play.
        </div>
      )}

      {/* ── No Game: Game Lobby ──────────────────────────────────────── */}
      {!game && wallet.address && (
        <div className="mb-6 flex flex-col items-center w-full">
          <Lobby
            currentAddress={wallet.address}
            onJoinGame={(gameId, customWord) => handleJoinGame(gameId, customWord)}
            onCreateGame={(escrow, word) => handleCreateGame(escrow, word)}
            onResumeGame={() => {
              const saved = loadGame();
              if (saved) {
                setGame(saved);
                setStatus([]);
              }
            }}
          />
        </div>
      )}

      {/* ── Loading on-chain state / Game expired ────────────────────── */}
      {game && onChainPhase === PHASE.NONE && !gameOver && (
        <div className="mb-6 text-center">
          <div className={`border rounded-lg p-6 max-w-md flex flex-col items-center gap-3 ${
            chainPolled
              ? "bg-red-900/30 border-red-700"
              : "bg-gray-800 border-gray-600"
          }`}>
            {!chainPolled ? (
              <>
                <svg className="animate-spin h-6 w-6 text-gray-400" viewBox="0 0 24 24" fill="none">
                  <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" className="opacity-25" />
                  <path fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" className="opacity-75" />
                </svg>
                <p className="text-gray-400 text-sm">Loading game state from chain…</p>
              </>
            ) : (
              <>
                <p className="text-red-300 font-bold text-lg">Game Not Found</p>
                <p className="text-gray-400 text-sm text-center">
                  This game no longer exists on-chain. It may have expired or was created on a previous contract.
                </p>
              </>
            )}
            <button
              onClick={() => {
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
              }}
              className={chainPolled
                ? "mt-2 bg-gray-700 hover:bg-gray-600 text-white font-bold px-5 py-2 rounded-lg text-sm"
                : "mt-2 text-xs text-gray-500 hover:text-gray-300 underline"
              }
            >
              Back to lobby
            </button>
          </div>
        </div>
      )}

      {/* ── Waiting for Player 2 ─────────────────────────────────────── */}
      {game && onChainPhase === PHASE.WAITING && (
        <div className="mb-6 text-center">
          <div className="bg-yellow-900/40 border border-yellow-600 rounded-lg p-4 mb-3 max-w-md">
            <p className="text-yellow-300 font-medium mb-2">Waiting for Player 2 to join…</p>
            <p className="text-gray-400 text-xs mb-2">Share this link or Game ID with your opponent:</p>

            {/* Shareable link */}
            <div className="flex items-center gap-2 bg-gray-800 p-2 rounded mb-2">
              <p className="text-blue-400 font-mono text-xs break-all flex-1 select-all">
                {`${window.location.origin}${window.location.pathname}?game=${game.gameId}`}
              </p>
              <button
                onClick={() => {
                  const url = `${window.location.origin}${window.location.pathname}?game=${game.gameId}`;
                  navigator.clipboard.writeText(url);
                  setCopiedGameId(true);
                  setTimeout(() => setCopiedGameId(false), 2000);
                }}
                className="text-xs bg-gray-700 hover:bg-gray-600 text-white px-2 py-1 rounded whitespace-nowrap"
              >
                {copiedGameId ? "Copied!" : "Copy Link"}
              </button>
            </div>

            {/* Game ID fallback */}
            <div className="flex items-center gap-2 bg-gray-800 p-2 rounded">
              <p className="text-green-400 font-mono text-xs break-all flex-1 select-all">
                {game.gameId}
              </p>
              <button
                onClick={() => {
                  navigator.clipboard.writeText(game.gameId);
                  setCopiedGameId(true);
                  setTimeout(() => setCopiedGameId(false), 2000);
                }}
                className="text-xs bg-gray-700 hover:bg-gray-600 text-white px-2 py-1 rounded whitespace-nowrap"
              >
                Copy ID
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
      )}

      {/* ── Active Game ──────────────────────────────────────────────── */}
      {game && (onChainPhase === PHASE.ACTIVE || onChainPhase === PHASE.REVEAL) && (
        <>
          {/* Timers */}
          <div className="flex gap-4 mb-4">
            <div className={`px-4 py-2 rounded-lg font-mono text-sm ${
              isMyTurn
                ? "bg-green-900/50 border border-green-600 text-green-300"
                : "bg-gray-800 border border-gray-600 text-gray-400"
            }`}>
              You: {formatTime(myTimeLeft ?? 0)}
              {isMyTurn && " (your turn)"}
            </div>
            <div className={`px-4 py-2 rounded-lg font-mono text-sm ${
              !isMyTurn
                ? "bg-red-900/50 border border-red-600 text-red-300"
                : "bg-gray-800 border border-gray-600 text-gray-400"
            }`}>
              Opponent: {formatTime(oppTimeLeft ?? 0)}
              {!isMyTurn && " (their turn)"}
            </div>
          </div>

          {/* Game info */}
          <div className="text-gray-500 text-xs mb-4">
            Role: {game.myRole === "p1" ? "Player 1" : "Player 2"}
            {" | Turn "}{chainTurn}
            {game.escrowAmount > 0 && ` | Pot: ${game.escrowAmount * 2} XLM`}
          </div>

          {/* Waiting for opponent indicator */}
          {!isMyTurn && onChainPhase === PHASE.ACTIVE && (
            <div className="mb-4 px-4 py-2 bg-blue-900/30 border border-blue-600 rounded text-blue-300 text-sm flex items-center gap-2">
              <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" className="opacity-25" />
                <path fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" className="opacity-75" />
              </svg>
              Waiting for opponent's move…
            </div>
          )}

          {/* Reveal phase notice */}
          {onChainPhase === PHASE.REVEAL && (
            <div className="mb-4 px-4 py-3 bg-purple-900/50 border border-purple-500 rounded-lg max-w-md text-center">
              {winner === game.myAddress ? (
                <>
                  <p className="text-purple-300 font-bold mb-2">You won! Reveal your word to claim the pot.</p>
                  <button
                    onClick={handleRevealWord}
                    disabled={busy}
                    className="bg-purple-600 hover:bg-purple-500 disabled:opacity-50 text-white font-bold px-5 py-2 rounded"
                  >
                    {busy ? "Revealing…" : `Reveal "${game.word.toUpperCase()}"`}
                  </button>
                </>
              ) : (
                <>
                  <p className="text-yellow-300 font-medium">Opponent must reveal their word…</p>
                  <p className="text-gray-400 text-xs mt-1">If they don't reveal in time, you can claim timeout.</p>
                  {(oppTimeLeft !== null && oppTimeLeft <= 0) && (
                    <button
                      onClick={handleClaimTimeout}
                      disabled={busy}
                      className="mt-2 bg-red-600 hover:bg-red-500 text-white font-bold px-4 py-2 rounded text-sm"
                    >
                      Claim Timeout
                    </button>
                  )}
                </>
              )}
            </div>
          )}

          {/* Timeout claim button */}
          {onChainPhase === PHASE.ACTIVE && !isMyTurn && oppTimeLeft !== null && oppTimeLeft <= 0 && (
            <div className="mb-4">
              <button
                onClick={handleClaimTimeout}
                disabled={busy}
                className="bg-red-600 hover:bg-red-500 disabled:opacity-50 text-white font-bold px-5 py-2 rounded"
              >
                Claim Timeout Win
              </button>
            </div>
          )}

          {/* Final turn: verify-only (turn 13 — no new guess) */}
          {onChainPhase === PHASE.ACTIVE && isMyTurn && game.myGuesses.length >= MAX_GUESSES && (
            <div className="mb-4">
              <button
                onClick={handleVerifyOnly}
                disabled={busy}
                className="bg-orange-600 hover:bg-orange-500 disabled:opacity-50 text-white font-bold px-5 py-2 rounded"
              >
                {busy ? "Verifying…" : "Submit Final Verification"}
              </button>
              <p className="text-gray-500 text-xs mt-1">No more guesses — only verifying opponent's last guess.</p>
            </div>
          )}

          {/* Two grids side by side */}
          <div className="flex gap-6 mb-4 flex-wrap justify-center">
            <div className="flex flex-col items-center">
              <p className="text-gray-400 text-xs mb-1">Your Guesses</p>
              <WordleGrid
                guesses={myGridGuesses}
                currentGuess={isMyTurn && onChainPhase === PHASE.ACTIVE ? currentGuess : ""}
                maxRows={MAX_GUESSES}
              />
            </div>
            <div className="flex flex-col items-center">
              <p className="text-gray-400 text-xs mb-1">Opponent's Guesses</p>
              <WordleGrid
                guesses={opponentGridGuesses}
                currentGuess=""
                maxRows={MAX_GUESSES}
              />
            </div>
          </div>

          {/* Keyboard */}
          {onChainPhase === PHASE.ACTIVE && (
            <Keyboard onKey={handleKey} letterStates={letterStates} />
          )}

          {/* Loading spinner */}
          {busy && (
            <div className="mt-4 flex items-center gap-2 text-yellow-400">
              <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24" fill="none">
                <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" className="opacity-25" />
                <path fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" className="opacity-75" />
              </svg>
              Processing…
            </div>
          )}
        </>
      )}

      {/* ── Draw Phase: Both Players Reveal ───────────────────────── */}
      {game && onChainPhase === PHASE.DRAW && !gameOver && (
        <div className="mt-4 flex flex-col items-center gap-3 max-w-md">
          <div className="px-6 py-4 rounded-lg text-center bg-yellow-900/50 border border-yellow-600 w-full">
            <p className="text-yellow-300 font-bold text-lg mb-1">Draw!</p>
            <p className="text-gray-400 text-sm">
              Both players must reveal their secret word to withdraw escrow.
            </p>
            <p className="text-gray-400 text-sm mt-1">Your word: <span className="font-mono font-bold text-white">{game.word.toUpperCase()}</span></p>

            {/* Draw deadline countdown */}
            {drawDeadline !== null && (
              <p className="text-gray-500 text-xs mt-2 font-mono">
                Reveal deadline: {formatTime(drawDeadline)}
              </p>
            )}
          </div>

          {/* My reveal status */}
          {!myDrawRevealed ? (
            <button
              onClick={handleRevealWordDraw}
              disabled={busy}
              className="bg-purple-600 hover:bg-purple-500 disabled:opacity-50 text-white font-bold px-5 py-2 rounded-lg w-full"
            >
              {busy ? "Revealing…" : `Reveal "${game.word.toUpperCase()}"`}
            </button>
          ) : (
            <div className="px-4 py-2 bg-green-900/40 border border-green-600 rounded-lg text-green-300 text-sm w-full text-center">
              You have revealed your word ✓
            </div>
          )}

          {/* Opponent reveal status */}
          {oppDrawRevealed ? (
            <div className="px-4 py-2 bg-green-900/40 border border-green-600 rounded-lg text-green-300 text-sm w-full text-center">
              Opponent revealed: <span className="font-mono font-bold text-white">{oppRevealedWord.toUpperCase() || "???"}</span> ✓
            </div>
          ) : (
            <div className="px-4 py-2 bg-gray-800 border border-gray-600 rounded-lg text-gray-400 text-sm w-full text-center">
              Waiting for opponent to reveal…
            </div>
          )}

          {/* Withdraw button: only after I have revealed */}
          {myDrawRevealed && game.escrowAmount > 0 && !game.escrowWithdrawn && (
            <button
              onClick={async () => {
                if (withdrawing || !wallet.address) return;
                setWithdrawing(true);
                try {
                  await withdrawEscrow(game.gameId, wallet.address!, wallet.sign, addStatus);
                  markEscrowWithdrawn();
                  setGame((prev) => prev ? { ...prev, escrowWithdrawn: true } : prev);
                } catch (err: any) {
                  addStatus(`Withdraw error: ${err.message ?? err}`);
                } finally {
                  setWithdrawing(false);
                }
              }}
              disabled={withdrawing}
              className="bg-yellow-600 hover:bg-yellow-500 disabled:opacity-50 text-white font-bold px-5 py-2 rounded-lg w-full"
            >
              {withdrawing ? "Withdrawing…" : `Withdraw ${game.escrowAmount} XLM`}
            </button>
          )}
          {game.escrowWithdrawn && (
            <p className="text-green-400 text-sm">Escrow withdrawn ✓</p>
          )}

          {/* Claim timeout if opponent hasn't revealed and deadline passed */}
          {myDrawRevealed && !oppDrawRevealed && drawDeadline !== null && drawDeadline <= 0 && (
            <button
              onClick={handleClaimTimeout}
              disabled={busy}
              className="bg-red-600 hover:bg-red-500 disabled:opacity-50 text-white font-bold px-5 py-2 rounded text-sm w-full"
            >
              Opponent didn't reveal — Claim Full Pot
            </button>
          )}

          {/* Loading spinner */}
          {busy && (
            <div className="mt-2 flex items-center gap-2 text-yellow-400">
              <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24" fill="none">
                <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" className="opacity-25" />
                <path fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" className="opacity-75" />
              </svg>
              Processing…
            </div>
          )}

          <button
            onClick={() => {
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
              setChainTurn(0);
              setWinner("");
              setCopiedGameId(false);
              setMyDrawRevealed(false);
              setOppDrawRevealed(false);
              setOppRevealedWord("");
              setDrawDeadline(null);
            }}
            className="bg-gray-700 hover:bg-gray-600 text-white font-bold px-5 py-2 rounded-lg"
          >
            New Game
          </button>
        </div>
      )}

      {/* ── Game Over (Finalized — Win/Loss/Draw) ───────────────────────── */}
      {gameOver && game && (
        <div className="mt-4 flex flex-col items-center gap-3 max-w-md">
          <div className={`px-6 py-3 rounded-lg text-center ${
            gameWon
              ? "bg-green-900/50 border border-green-600"
              : !winner
                ? "bg-yellow-900/50 border border-yellow-600"
                : "bg-red-900/50 border border-red-600"
          }`}>
            {gameWon ? (
              <p className="text-green-300 font-bold text-lg">You Won!</p>
            ) : !winner ? (
              <p className="text-yellow-300 font-bold text-lg">Draw!</p>
            ) : (
              <p className="text-red-300 font-bold text-lg">You Lost</p>
            )}
            <p className="text-gray-400 text-sm mt-1">Your word: <span className="font-mono font-bold text-white">{game.word.toUpperCase()}</span></p>
            {oppRevealedWord && (
              <p className="text-gray-400 text-sm mt-1">Opponent's word: <span className="font-mono font-bold text-white">{oppRevealedWord.toUpperCase()}</span></p>
            )}
          </div>

          {/* Escrow actions — show for winner OR draw (no winner) */}
          {game.escrowAmount > 0 && !game.escrowWithdrawn && (gameWon || !winner) && (
            <button
              onClick={async () => {
                if (withdrawing || !wallet.address) return;
                setWithdrawing(true);
                try {
                  await withdrawEscrow(game.gameId, wallet.address!, wallet.sign, addStatus);
                  markEscrowWithdrawn();
                  setGame((prev) => prev ? { ...prev, escrowWithdrawn: true } : prev);
                } catch (err: any) {
                  addStatus(`Withdraw error: ${err.message ?? err}`);
                } finally {
                  setWithdrawing(false);
                }
              }}
              disabled={withdrawing}
              className="bg-yellow-600 hover:bg-yellow-500 disabled:opacity-50 text-white font-bold px-5 py-2 rounded-lg"
            >
              {withdrawing ? "Withdrawing…" : `Withdraw ${gameWon ? game.escrowAmount * 2 : game.escrowAmount} XLM`}
            </button>
          )}
          {game.escrowWithdrawn && (
            <p className="text-green-400 text-sm">Escrow withdrawn ✓</p>
          )}

          <button
            onClick={() => {
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
              setChainTurn(0);
              setWinner("");
              setCopiedGameId(false);
              setMyDrawRevealed(false);
              setOppDrawRevealed(false);
              setOppRevealedWord("");
              setDrawDeadline(null);
            }}
            className="bg-green-600 hover:bg-green-500 text-white font-bold px-5 py-2 rounded-lg"
          >
            New Game
          </button>
        </div>
      )}

      {/* Status messages */}
      <StatusBar messages={status} />

      {/* Legend */}
      <div className="mt-6 flex gap-4 text-xs text-gray-500">
        <span className="flex items-center gap-1">
          <span className="w-4 h-4 bg-green-600 rounded inline-block" /> Correct
        </span>
        <span className="flex items-center gap-1">
          <span className="w-4 h-4 bg-yellow-500 rounded inline-block" /> Wrong pos
        </span>
        <span className="flex items-center gap-1">
          <span className="w-4 h-4 bg-gray-700 rounded inline-block" /> Absent
        </span>
      </div>
    </div>
  );
}

export default App;
