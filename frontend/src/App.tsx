import { useState, useCallback, useEffect, useRef } from "react";
import { WordleGrid } from "./components/WordleGrid";
import { Keyboard } from "./components/Keyboard";
import { StatusBar } from "./components/StatusBar";
import { WORD_LENGTH, MAX_GUESSES, CONTRACT_ID } from "./config";
import { calculateWordleResults } from "./gameLogic";
import { useFreighter } from "./hooks/useFreighter";
import {
  type GameState,
  createGame,
  loadGame,
  clearGame,
  saveGuess,
  markLastVerified,
  setGameDeadline,
  setGameEscrow,
  markEscrowWithdrawn,
  getGameSecret,
  isWordInList,
} from "./gameState";
import { createGameOnChain, withdrawEscrow } from "./soroban";

interface Guess {
  word: string;
  results?: number[];
  verified: boolean;
}

function App() {
  const [game, setGame] = useState<GameState | null>(null);
  const [guesses, setGuesses] = useState<Guess[]>([]);
  const [currentGuess, setCurrentGuess] = useState("");
  const [status, setStatus] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [gameOver, setGameOver] = useState(false);
  const [proverReady, setProverReady] = useState(false);
  const [creatingGame, setCreatingGame] = useState(false);
  const [secretWord, setSecretWord] = useState("");
  const [secretWordError, setSecretWordError] = useState("");
  const [timeLeft, setTimeLeft] = useState<number | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [escrowInput, setEscrowInput] = useState("");
  const [withdrawing, setWithdrawing] = useState(false);
  const [gameWon, setGameWon] = useState(false);

  // Freighter wallet integration
  const wallet = useFreighter();

  // Track best letter state per key for keyboard coloring
  const [letterStates, setLetterStates] = useState<
    Record<string, number | undefined>
  >({});

  const addStatus = useCallback((msg: string) => {
    setStatus((prev) => [...prev, msg]);
  }, []);

  // Format timeLeft (ms) as MM:SS
  const formatTime = (ms: number): string => {
    if (ms <= 0) return "00:00";
    const totalSec = Math.ceil(ms / 1000);
    const min = Math.floor(totalSec / 60);
    const sec = totalSec % 60;
    return `${min.toString().padStart(2, "0")}:${sec.toString().padStart(2, "0")}`;
  };

  // Start / restart the countdown interval based on a deadline timestamp
  const startCountdown = useCallback((deadline: number) => {
    if (timerRef.current) clearInterval(timerRef.current);
    const tick = () => {
      const remaining = deadline - Date.now();
      if (remaining <= 0) {
        setTimeLeft(0);
        setGameOver(true);
        setStatus((prev) => [...prev, "⏰ Time's up! The 5-minute game timer has expired."]);
        if (timerRef.current) clearInterval(timerRef.current);
        return;
      }
      setTimeLeft(remaining);
    };
    tick();
    timerRef.current = setInterval(tick, 1000);
  }, []);

  // Load existing game on mount
  useEffect(() => {
    const saved = loadGame();
    if (saved) {
      setGame(saved);
      // Restore guesses
      const restored: Guess[] = saved.guesses.map((g) => ({
        word: g.word,
        results: g.results,
        verified: g.verified,
      }));
      setGuesses(restored);
      // Restore letter states
      const states: Record<string, number | undefined> = {};
      for (const g of saved.guesses) {
        for (let i = 0; i < g.word.length; i++) {
          const letter = g.word[i].toLowerCase();
          const current = states[letter];
          if (current === undefined || g.results[i] > current) {
            states[letter] = g.results[i];
          }
        }
      }
      setLetterStates(states);
      // Check if game is already over
      const lastGuess = saved.guesses[saved.guesses.length - 1];
      if (lastGuess && lastGuess.results.every((r) => r === 2)) {
        setGameOver(true);
        setGameWon(true);
      } else if (saved.guesses.length >= MAX_GUESSES) {
        setGameOver(true);
      } else if (saved.deadline && saved.deadline > 0) {
        // Restore countdown timer
        if (Date.now() >= saved.deadline) {
          setGameOver(true);
          setTimeLeft(0);
        } else {
          startCountdown(saved.deadline);
        }
      }
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [startCountdown]);

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

  const handleNewGame = useCallback(async (customWord?: string) => {
    if (creatingGame) return;
    if (!wallet.address) {
      addStatus("\u26a0\ufe0f Please connect your Freighter wallet first to start a game.");
      return;
    }
    setCreatingGame(true);
    setStatus([]);
    try {
      const newGame = await createGame(addStatus, customWord);

      // Parse escrow amount
      const escrowXlm = parseFloat(escrowInput) || 0;

      // Register game timer on-chain (+ escrow deposit if > 0)
      const deadline = await createGameOnChain(
        wallet.address!,
        wallet.sign,
        escrowXlm,
        addStatus
      );

      // Persist deadline + escrow in localStorage
      newGame.deadline = deadline;
      newGame.escrowAmount = escrowXlm;
      setGameDeadline(deadline);
      setGameEscrow(escrowXlm);

      setGame(newGame);
      setGuesses([]);
      setCurrentGuess("");
      setGameOver(false);
      setLetterStates({});
      setTimeLeft(deadline - Date.now());
      startCountdown(deadline);
      setGameWon(false);
      addStatus(escrowXlm > 0
        ? `Ready to play! You have 5 minutes. ${escrowXlm} XLM escrowed.`
        : "Ready to play! You have 5 minutes. Start guessing.");
    } catch (err: any) {
      addStatus(`Error creating game: ${err.message ?? err}`);
    } finally {
      setCreatingGame(false);
    }
  }, [creatingGame, addStatus, wallet.address, wallet.sign, startCountdown]);

  const handleSubmit = useCallback(async () => {
    if (busy || gameOver || currentGuess.length !== WORD_LENGTH || !game) return;

    if (!wallet.address) {
      addStatus("⚠️ Please connect your Freighter wallet first.");
      return;
    }

    if (!proverReady) {
      addStatus("⏳ Prover still loading, please wait…");
      return;
    }

    setBusy(true);
    setStatus([]);

    try {
      // 0. Validate guess is a real word via Merkle tree
      const { isValidWord, getMerkleProof, proofToBytes } = await import("./merkleProof");
      const valid = await isValidWord(currentGuess);
      if (!valid) {
        addStatus(`❌ "${currentGuess}" is not in the word list.`);
        setBusy(false);
        return;
      }

      // Generate Merkle proof for the guess word
      const merkleProof = await getMerkleProof(currentGuess);

      if (!merkleProof) {
        addStatus(`❌ Could not generate Merkle proof for "${currentGuess}".`);
        setBusy(false);
        return;
      }
      addStatus(`✅ "${currentGuess}" is a valid word (Merkle proof ready)`);

      // Calculate wordle results locally
      const results = calculateWordleResults(currentGuess, game.word);
      addStatus(`Result: ${results.map((r) => (r === 2 ? "🟩" : r === 1 ? "🟨" : "⬛")).join("")}`);

      // Add guess with results immediately
      const savedGuess = currentGuess;
      const newGuess: Guess = {
        word: savedGuess,
        results,
        verified: false,
      };
      setGuesses((prev) => [...prev, newGuess]);
      setCurrentGuess("");
      updateLetterStates(savedGuess, results);

      // Save guess to localStorage
      saveGuess({ word: savedGuess, results, verified: false });

      // 1. Generate ZK proof in browser
      const { generateProof } = await import("./generateProof");
      const { proof, publicInputsBytes, proofId } = await generateProof(
        savedGuess,
        getGameSecret(game),
        addStatus
      );

      addStatus(`Proof ID: ${proofId.slice(0, 16)}…`);

      // 2. Verify on-chain: Merkle word check + ZK proof in one transaction
      addStatus("Submitting Merkle + ZK proof to Stellar testnet…");
      const { verifyGuessAndProofOnChain } = await import("./soroban");
      const { pathElementsBytes, pathIndices, guessWordBytes } = proofToBytes(merkleProof);

      const verified = await verifyGuessAndProofOnChain(
        guessWordBytes,
        pathElementsBytes,
        pathIndices,
        publicInputsBytes,
        proof,
        wallet.address!,
        wallet.sign,
        addStatus
      );

      // Mark as verified
      setGuesses((prev) =>
        prev.map((g, i) =>
          i === prev.length - 1 ? { ...g, verified } : g
        )
      );
      markLastVerified(verified);

      // Check win/loss
      const won = results.every((r) => r === 2);
      if (won) {
        addStatus(`🎉 You guessed "${game.word}" — verified on Stellar!`);
        setGameOver(true);
        setGameWon(true);
        if (game.escrowAmount > 0) {
          addStatus(`💰 You can now withdraw your ${game.escrowAmount} XLM escrow!`);
        }
      } else if (guesses.length + 1 >= MAX_GUESSES) {
        addStatus(
          `Game over. The word was "${game.word}". Better luck next time!`
        );
        setGameOver(true);
      }
    } catch (err: any) {
      addStatus(`Error: ${err.message ?? err}`);
    } finally {
      setBusy(false);
    }
  }, [busy, gameOver, currentGuess, game, wallet.address, wallet.sign, proverReady, guesses.length, addStatus]);

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

  // Physical keyboard listener
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      handleKey(e.key);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [handleKey]);

  return (
    <div className="min-h-screen bg-gray-900 text-white flex flex-col items-center py-6 px-4">
      {/* Header */}
      <div className="w-full max-w-lg flex justify-between items-center mb-6">
        <h1 className="text-3xl font-bold tracking-wide">🔤 ZK Wordle</h1>
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
            onClick={() => wallet.connect().catch((e) => addStatus(`Wallet error: ${e.message}`))}
            disabled={wallet.connecting}
            className="text-sm bg-blue-600 hover:bg-blue-500 disabled:opacity-50 px-3 py-1.5 rounded font-medium"
          >
            {wallet.connecting ? "Connecting…" : "Connect Wallet"}
          </button>
        )}
      </div>

      <p className="text-gray-400 text-sm mb-2 max-w-md text-center">
        Guess the 5-letter word. Each guess is proven in-browser with Noir and
        verified on-chain via Soroban on Stellar testnet.
      </p>

      <p className="text-gray-500 text-xs mb-6 font-mono">
        Contract: {CONTRACT_ID.slice(0, 12)}…{CONTRACT_ID.slice(-6)}
      </p>

      {/* Countdown Timer */}
      {game && timeLeft !== null && (
        <div
          className={`mb-4 px-5 py-2 rounded-lg text-center font-mono text-lg font-bold ${
            timeLeft <= 0
              ? "bg-red-900/70 border border-red-500 text-red-300"
              : timeLeft <= 60_000
              ? "bg-red-900/50 border border-red-600 text-red-400 animate-pulse"
              : timeLeft <= 120_000
              ? "bg-yellow-900/50 border border-yellow-600 text-yellow-300"
              : "bg-gray-800 border border-gray-600 text-gray-200"
          }`}
        >
          {timeLeft <= 0 ? (
            <span>⏰ Time&apos;s up!</span>
          ) : (
            <span>⏱ {formatTime(timeLeft)}</span>
          )}
        </div>
      )}

      {!proverReady && (
        <div className="mb-4 px-4 py-2 bg-yellow-900/50 border border-yellow-600 rounded text-yellow-300 text-sm flex items-center gap-2">
          <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" className="opacity-25" />
            <path fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" className="opacity-75" />
          </svg>
          Loading prover WASM… (first time may take 10-20s)
        </div>
      )}

      {!wallet.address && (
        <div className="mb-4 px-4 py-2 bg-blue-900/30 border border-blue-600 rounded text-blue-300 text-sm text-center max-w-md">
          Connect your Freighter wallet to start a game and submit guesses on-chain.
          <br />
          <a
            href="https://freighter.app"
            target="_blank"
            rel="noopener noreferrer"
            className="text-blue-400 underline text-xs"
          >
            Get Freighter
          </a>
        </div>
      )}

      {/* No game — show Set Word input + Random Word button */}
      {!game && (
        <div className="mb-6 flex flex-col items-center gap-4 w-full max-w-sm">
          <p className="text-gray-400 text-sm">No active game.</p>

          {/* Escrow amount */}
          <div className="flex w-full gap-2 items-center">
            <label className="text-gray-400 text-sm whitespace-nowrap">💰 Escrow:</label>
            <input
              type="number"
              min="0"
              step="any"
              value={escrowInput}
              onChange={(e) => setEscrowInput(e.target.value)}
              placeholder="0"
              className="flex-1 bg-gray-800 border border-gray-600 rounded-lg px-3 py-2.5 text-sm font-mono text-white placeholder-gray-500 focus:outline-none focus:border-purple-500"
            />
            <span className="text-gray-400 text-sm font-medium">XLM</span>
          </div>
          <p className="text-gray-500 text-xs -mt-2">
            Optional: deposit XLM that you can withdraw after winning.
          </p>

          {/* Set a word for a friend */}
          <div className="flex w-full gap-2">
            <input
              type="text"
              maxLength={WORD_LENGTH}
              value={secretWord}
              onChange={(e) => {
                const val = e.target.value.replace(/[^a-zA-Z]/g, "").toLowerCase();
                setSecretWord(val.slice(0, WORD_LENGTH));
                setSecretWordError("");
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && secretWord.length === WORD_LENGTH) {
                  if (!isWordInList(secretWord)) {
                    setSecretWordError(`"${secretWord}" is not a valid word.`);
                    return;
                  }
                  handleNewGame(secretWord);
                  setSecretWord("");
                }
              }}
              placeholder="Enter a word…"
              className="flex-1 bg-gray-800 border border-gray-600 rounded-lg px-3 py-2.5 text-sm tracking-widest font-mono text-white uppercase placeholder-gray-500 focus:outline-none focus:border-purple-500"
            />
            <button
              onClick={() => {
                if (secretWord.length !== WORD_LENGTH) {
                  setSecretWordError(`Must be ${WORD_LENGTH} letters.`);
                  return;
                }
                if (!isWordInList(secretWord)) {
                  setSecretWordError(`"${secretWord}" is not a valid word.`);
                  return;
                }
                handleNewGame(secretWord);
                setSecretWord("");
              }}
              disabled={creatingGame || secretWord.length !== WORD_LENGTH}
              className="bg-purple-600 hover:bg-purple-500 disabled:opacity-50 text-white font-bold px-4 py-2.5 rounded-lg shadow-lg transition-all text-sm whitespace-nowrap"
            >
              🤝 Set a Word
            </button>
          </div>
          {secretWordError && (
            <p className="text-red-400 text-xs">{secretWordError}</p>
          )}

          {/* Or play with a random word */}
          <button
            onClick={() => handleNewGame()}
            disabled={creatingGame}
            className="bg-green-600 hover:bg-green-500 disabled:opacity-50 text-white font-bold px-6 py-3 rounded-lg text-lg shadow-lg transition-all w-full"
          >
            {creatingGame ? "Creating game…" : "🎲 Random Word"}
          </button>
        </div>
      )}

      {/* Grid */}
      {game && (
        <WordleGrid
          guesses={guesses}
          currentGuess={currentGuess}
          maxRows={MAX_GUESSES}
        />
      )}

      {/* Keyboard */}
      {game && <Keyboard onKey={handleKey} letterStates={letterStates} />}

      {/* Loading spinner */}
      {busy && (
        <div className="mt-4 flex items-center gap-2 text-yellow-400">
          <svg
            className="animate-spin h-5 w-5"
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
          Generating proof & verifying on-chain…
        </div>
      )}

      {/* Status */}
      <StatusBar messages={status} />

      {/* Game Over actions */}
      {gameOver && game && (
        <div className="mt-4 flex flex-col items-center gap-3">
          <p className="text-gray-300 text-sm">
            The word was: <span className="font-bold text-green-400 text-lg">{game.word.toUpperCase()}</span>
          </p>

          {/* Escrow info */}
          {game.escrowAmount > 0 && (
            <div className={`px-4 py-2 rounded-lg text-sm font-medium ${
              gameWon && !game.escrowWithdrawn
                ? "bg-green-900/50 border border-green-600 text-green-300"
                : game.escrowWithdrawn
                ? "bg-gray-800 border border-gray-600 text-gray-400"
                : "bg-red-900/50 border border-red-600 text-red-300"
            }`}>
              {game.escrowWithdrawn ? (
                <span>✅ {game.escrowAmount} XLM withdrawn</span>
              ) : gameWon ? (
                <span>💰 {game.escrowAmount} XLM available to withdraw</span>
              ) : (
                <span>💸 {game.escrowAmount} XLM escrow forfeited</span>
              )}
            </div>
          )}

          {/* Withdraw button */}
          {gameWon && game.escrowAmount > 0 && !game.escrowWithdrawn && (
            <button
              onClick={async () => {
                if (withdrawing || !wallet.address) return;
                setWithdrawing(true);
                try {
                  await withdrawEscrow(wallet.address!, wallet.sign, addStatus);
                  markEscrowWithdrawn();
                  setGame((prev) => prev ? { ...prev, escrowWithdrawn: true } : prev);
                } catch (err: any) {
                  addStatus(`Withdraw error: ${err.message ?? err}`);
                } finally {
                  setWithdrawing(false);
                }
              }}
              disabled={withdrawing}
              className="bg-yellow-600 hover:bg-yellow-500 disabled:opacity-50 text-white font-bold px-5 py-2 rounded-lg shadow-lg transition-all"
            >
              {withdrawing ? "Withdrawing…" : `💰 Withdraw ${game.escrowAmount} XLM`}
            </button>
          )}

          <button
            onClick={() => {
              clearGame();
              setGame(null);
              setGuesses([]);
              setCurrentGuess("");
              setGameOver(false);
              setLetterStates({});
              setStatus([]);
              setTimeLeft(null);
              setGameWon(false);
              setEscrowInput("");
              if (timerRef.current) clearInterval(timerRef.current);
            }}
            className="bg-green-600 hover:bg-green-500 text-white font-bold px-5 py-2 rounded-lg shadow-lg transition-all"
          >
            🎲 New Game
          </button>
        </div>
      )}

      {/* Legend */}
      <div className="mt-6 flex gap-4 text-xs text-gray-500">
        <span className="flex items-center gap-1">
          <span className="w-4 h-4 bg-green-600 rounded inline-block" /> Correct
        </span>
        <span className="flex items-center gap-1">
          <span className="w-4 h-4 bg-yellow-500 rounded inline-block" /> Wrong
          pos
        </span>
        <span className="flex items-center gap-1">
          <span className="w-4 h-4 bg-gray-700 rounded inline-block" /> Absent
        </span>
      </div>
    </div>
  );
}

export default App;
