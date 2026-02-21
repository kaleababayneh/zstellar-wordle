import type { FreighterState } from "../hooks/useFreighter";
import { CONTRACT_ID } from "../config";

interface HeaderProps {
  wallet: FreighterState;
  addStatus: (msg: string) => void;
  proverReady: boolean;
}

export function Header({ wallet, addStatus, proverReady }: HeaderProps) {
  return (
    <>
      {/* Title + wallet */}
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

      {/* Prover loading indicator */}
      {!proverReady && (
        <div className="mb-4 px-4 py-2 bg-yellow-900/50 border border-yellow-600 rounded text-yellow-300 text-sm flex items-center gap-2">
          <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" className="opacity-25" />
            <path fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" className="opacity-75" />
          </svg>
          Loading prover WASM…
        </div>
      )}

      {/* No wallet hint */}
      {!wallet.address && (
        <div className="mb-4 px-4 py-2 bg-blue-900/30 border border-blue-600 rounded text-blue-300 text-sm text-center max-w-md">
          Connect your Freighter wallet to play.
        </div>
      )}
    </>
  );
}
