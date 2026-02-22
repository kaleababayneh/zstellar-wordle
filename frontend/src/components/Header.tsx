import { useMemo, useState, useEffect } from "react";
import type { FreighterState } from "../hooks/useFreighter";
import { CONTRACT_ID } from "../config";

const COLORS = ["correct", "present", "absent"] as const;
const TITLE_LETTERS = "ZKWORDLEDUEL".split("");
const WORD_BREAKS = [2, 8]; // indices where gaps go (after ZK, after WORDLE)

function randomColors() {
  return TITLE_LETTERS.map(() => COLORS[Math.floor(Math.random() * COLORS.length)]);
}

interface HeaderProps {
  wallet: FreighterState;
  addStatus: (msg: string) => void;
  proverReady: boolean;
}

export function Header({ wallet, addStatus, proverReady }: HeaderProps) {
  const tileColors = useMemo(randomColors, []);
  const [revealed, setRevealed] = useState<boolean[]>(() => TITLE_LETTERS.map(() => false));

  useEffect(() => {
    const timers = TITLE_LETTERS.map((_, i) =>
      setTimeout(() => {
        setRevealed((prev) => {
          const next = [...prev];
          next[i] = true;
          return next;
        });
      }, 300 + i * 150)
    );
    return () => timers.forEach(clearTimeout);
  }, []);

  return (
    <header className="w-full border-b border-border">
      <div className="max-w-2xl mx-auto flex items-center justify-between px-4 py-3">
        <div className="flex items-center select-none">
          {TITLE_LETTERS.map((letter, i) => {
            const color = tileColors[i];
            const isFlipped = revealed[i];
            return (
              <div
                key={i}
                style={{
                  perspective: "400px",
                  width: 24,
                  height: 24,
                  marginLeft: WORD_BREAKS.includes(i) ? 12 : i > 0 ? 4 : 0,
                }}
              >
                <div
                  style={{
                    position: "relative",
                    width: "100%",
                    height: "100%",
                    transformStyle: "preserve-3d",
                    transition: "transform 0.5s ease-in-out",
                    transform: isFlipped ? "rotateX(180deg)" : "rotateX(0)",
                  }}
                >
                  {/* Front — plain tile */}
                  <div
                    className="absolute inset-0 flex items-center justify-center text-[14px] font-bold uppercase rounded-[3px] border-2 border-border text-foreground bg-transparent"
                    style={{ backfaceVisibility: "hidden" }}
                  >
                    {letter}
                  </div>
                  {/* Back — colored tile */}
                  <div
                    className="absolute inset-0 flex items-center justify-center text-[14px] font-bold uppercase rounded-[3px] border-2"
                    style={{
                      backfaceVisibility: "hidden",
                      transform: "rotateX(180deg)",
                      background: `var(--${color})`,
                      borderColor: `var(--${color})`,
                      color: color === "absent" ? "var(--foreground)" : "var(--background)",
                    }}
                  >
                    {letter}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
        <div className="flex items-center gap-2">
          {wallet.address ? (
            <>
              <span className="text-xs text-muted-foreground font-mono">
                {wallet.address.slice(0, 6)}…{wallet.address.slice(-4)}
              </span>
              <button
                onClick={wallet.disconnect}
                className="text-xs text-destructive hover:text-destructive/80 transition-colors"
              >
                Disconnect
              </button>
            </>
          ) : (
            <button
              onClick={() => wallet.connect().catch((e) => addStatus(`Wallet: ${e.message}`))}
              disabled={wallet.connecting}
              className="text-sm bg-primary hover:bg-primary/90 text-primary-foreground disabled:opacity-50 px-4 py-2 rounded-md font-medium transition-colors"
            >
              {wallet.connecting ? "Connecting…" : "Connect Wallet"}
            </button>
          )}
        </div>
      </div>

      {/* Prover loading */}
      {!proverReady && (
        <div className="max-w-2xl mx-auto px-4 pb-3">
          <div className="px-4 py-2 bg-foreground text-background rounded-md text-sm font-bold flex items-center gap-2 justify-center">
            <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
              <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" className="opacity-25" />
              <path fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" className="opacity-75" />
            </svg>
            Loading prover WASM…
          </div>
        </div>
      )}

      {/* No wallet */}
      {!wallet.address && (
        <div className="max-w-2xl mx-auto px-4 pb-3">
          <div className="text-center">
            <p className="text-muted-foreground text-sm">Two-player ZK Wordle on Stellar. Connect your wallet to play.</p>
            <p className="text-xs text-muted-foreground/60 font-mono mt-1">Contract: {CONTRACT_ID.slice(0, 12)}…{CONTRACT_ID.slice(-6)}</p>
          </div>
        </div>
      )}
    </header>
  );
}
