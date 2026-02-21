import type { FreighterState } from "../hooks/useFreighter";
import { CONTRACT_ID } from "../config";

interface HeaderProps {
  wallet: FreighterState;
  addStatus: (msg: string) => void;
  proverReady: boolean;
}

export function Header({ wallet, addStatus, proverReady }: HeaderProps) {
  return (
    <header className="w-full border-b border-border">
      <div className="max-w-2xl mx-auto flex items-center justify-between px-4 py-3">
        <h1 className="text-xl font-bold tracking-tight text-foreground">ZK Wordle Duel</h1>
        {wallet.address ? (
          <div className="flex items-center gap-2">
            <span className="text-xs text-primary font-mono bg-primary/10 px-2 py-1 rounded-md">
              {wallet.address.slice(0, 6)}…{wallet.address.slice(-4)}
            </span>
            <button
              onClick={wallet.disconnect}
              className="text-xs bg-destructive/20 hover:bg-destructive/30 text-destructive-foreground px-2.5 py-1.5 rounded-md font-medium transition-colors"
            >
              Disconnect
            </button>
          </div>
        ) : (
          <button
            onClick={() => wallet.connect().catch((e) => addStatus(`Wallet: ${e.message}`))}
            disabled={wallet.connecting}
            className="text-sm bg-primary hover:bg-primary/90 text-primary-foreground disabled:opacity-50 px-4 py-2 rounded-lg font-semibold transition-colors"
          >
            {wallet.connecting ? "Connecting…" : "Connect Wallet"}
          </button>
        )}
      </div>

      {/* Prover loading indicator */}
      {!proverReady && (
        <div className="max-w-2xl mx-auto px-4 pb-3">
          <div className="px-4 py-2.5 bg-accent/20 border border-accent/40 rounded-lg text-accent text-sm flex items-center gap-2">
            <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
              <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" className="opacity-25" />
              <path fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" className="opacity-75" />
            </svg>
            Loading prover WASM…
          </div>
        </div>
      )}

      {/* No wallet hint */}
      {!wallet.address && (
        <div className="max-w-2xl mx-auto px-4 pb-3">
          <div className="px-4 py-3 bg-card border border-border rounded-lg text-muted-foreground text-sm text-center">
            <p className="mb-1">Two-player ZK Wordle. Each player commits a secret word. Take turns guessing.</p>
            <p className="text-xs text-muted-foreground/70 font-mono">Contract: {CONTRACT_ID.slice(0, 12)}…{CONTRACT_ID.slice(-6)}</p>
          </div>
        </div>
      )}
    </header>
  );
}
