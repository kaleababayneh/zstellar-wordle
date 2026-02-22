import { useEffect, useRef } from "react";

interface HowToPlayProps {
  open: boolean;
  onClose: () => void;
}

export function HowToPlay({ open, onClose }: HowToPlayProps) {
  const backdropRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      ref={backdropRef}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm animate-fade-in"
      onClick={(e) => e.target === backdropRef.current && onClose()}
    >
      <div className="relative w-full max-w-md mx-4 max-h-[85vh] overflow-y-auto rounded-xl border border-border bg-background shadow-2xl">
        {/* Close button */}
        <button
          onClick={onClose}
          className="absolute top-3 right-3 p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
        >
          <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>

        <div className="p-6 space-y-5">
          <h2 className="text-xl font-bold text-foreground text-center">How to Play</h2>

          {/* Intro */}
          <p className="text-sm text-muted-foreground leading-relaxed text-center">
            A <span className="font-semibold text-foreground">PvP Wordle</span> on Stellar — each player picks a secret word and races to guess the opponent's.
          </p>

          {/* Steps */}
          <div className="space-y-4">
            <Step
              num={1}
              title="Create or Join"
              desc="Create a game with a secret 5-letter word and an optional XLM escrow, or join an open game. Both players deposit the same escrow."
            />
            <Step
              num={2}
              title="Take Turns Guessing"
              desc="Players alternate guessing their opponent's word. You have 6 attempts and 5 minutes per player."
            />
            <Step
              num={3}
              title="Read the Clues"
              desc=""
            >
              <div className="mt-2 space-y-1.5">
                <ClueRow color="bg-green-600" label="Green" desc="Correct letter, correct spot" />
                <ClueRow color="bg-yellow-500" label="Yellow" desc="Correct letter, wrong spot" />
                <ClueRow color="bg-neutral-600" label="Gray" desc="Letter not in the word" />
              </div>
            </Step>
            <Step
              num={4}
              title="Win the Pot"
              desc="The first player to guess the word wins and collects the entire escrow pot. If neither guesses in 6 tries, the pot is split."
            />
          </div>

          {/* ZK note */}
          <div className="rounded-lg bg-primary/5 border border-primary/20 px-4 py-3">
            <div className="flex items-start gap-2.5">
              <span className="text-lg mt-0.5">🔒</span>
              <div>
                <p className="text-xs font-semibold text-primary uppercase tracking-wider mb-0.5">Provably Fair</p>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  Every guess is verified with a <span className="font-semibold text-foreground">zero-knowledge proof</span> on-chain — your secret word is never revealed until the game ends. No cheating possible.
                </p>
              </div>
            </div>
          </div>

          <button
            onClick={onClose}
            className="w-full h-11 bg-primary hover:bg-primary/90 text-primary-foreground font-bold rounded-md text-sm transition-colors"
          >
            Got it!
          </button>
        </div>
      </div>
    </div>
  );
}

function Step({ num, title, desc, children }: { num: number; title: string; desc: string; children?: React.ReactNode }) {
  return (
    <div className="flex gap-3">
      <div className="shrink-0 w-7 h-7 rounded-full bg-primary/10 text-primary text-xs font-bold flex items-center justify-center mt-0.5">
        {num}
      </div>
      <div className="flex-1">
        <p className="text-sm font-semibold text-foreground">{title}</p>
        {desc && <p className="text-xs text-muted-foreground leading-relaxed mt-0.5">{desc}</p>}
        {children}
      </div>
    </div>
  );
}

function ClueRow({ color, label, desc }: { color: string; label: string; desc: string }) {
  return (
    <div className="flex items-center gap-2">
      <div className={`w-5 h-5 rounded ${color} flex items-center justify-center`}>
        <span className="text-[10px] font-bold text-white">A</span>
      </div>
      <span className="text-xs text-foreground font-semibold">{label}</span>
      <span className="text-xs text-muted-foreground">— {desc}</span>
    </div>
  );
}
