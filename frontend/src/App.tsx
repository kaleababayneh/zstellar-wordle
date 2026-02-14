import { useState, useCallback, useEffect } from "react";
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
  getGameSecret,
} from "./gameState";

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

  // Freighter wallet integration
  const wallet = useFreighter();

  // Track best letter state per key for keyboard coloring
  const [letterStates, setLetterStates] = useState<
    Record<string, number | undefined>
  >({});

  const addStatus = useCallback((msg: string) => {
    setStatus((prev) => [...prev, msg]);
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
      } else if (saved.guesses.length >= MAX_GUESSES) {
        setGameOver(true);
      }
    }
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

  const handleNewGame = useCallback(async () => {
    if (creatingGame) return;
    setCreatingGame(true);
    setStatus([]);
    try {
      const newGame = await createGame(addStatus);
      setGame(newGame);
      setGuesses([]);
      setCurrentGuess("");
      setGameOver(false);
      setLetterStates({});
      addStatus("Ready to play! Start guessing.");
    } catch (err: any) {
      addStatus(`Error creating game: ${err.message ?? err}`);
    } finally {
      setCreatingGame(false);
    }
  }, [creatingGame, addStatus]);

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
      // Calculate results locally first
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

      // 2. Verify on-chain
      addStatus("Submitting proof to Stellar testnet…");
      const { verifyProofOnChain } = await import("./soroban");
      const verified = await verifyProofOnChain(
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
          Connect your Freighter wallet to submit guesses on-chain.
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

      {/* No game — show New Game button */}
      {!game && (
        <div className="mb-6 flex flex-col items-center gap-3">
          <p className="text-gray-400 text-sm">No active game.</p>
          <button
            onClick={handleNewGame}
            disabled={creatingGame}
            className="bg-green-600 hover:bg-green-500 disabled:opacity-50 text-white font-bold px-6 py-3 rounded-lg text-lg shadow-lg transition-all"
          >
            {creatingGame ? "Creating game…" : "🎲 New Game"}
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
          <button
            onClick={() => {
              clearGame();
              setGame(null);
              setGuesses([]);
              setCurrentGuess("");
              setGameOver(false);
              setLetterStates({});
              setStatus([]);
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
