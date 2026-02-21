interface KeyboardProps {
  onKey: (key: string) => void;
  onResign?: () => void;
  letterStates: Record<string, number | undefined>;
}

const ROWS = [
  ["q", "w", "e", "r", "t", "y", "u", "i", "o", "p"],
  ["a", "s", "d", "f", "g", "h", "j", "k", "l"],
  ["Enter", "z", "x", "c", "v", "b", "n", "m", "⌫"],
];

export function Keyboard({ onKey, onResign, letterStates }: KeyboardProps) {
  const keyClass = (key: string): string => {
    const state = letterStates[key];
    const base =
      "flex items-center justify-center rounded-md font-semibold uppercase select-none transition-all duration-150 active:scale-95";
    const size = key.length > 1
      ? "min-w-[60px] sm:min-w-[68px] px-2 h-[52px] sm:h-[58px] text-xs sm:text-sm"
      : "min-w-[30px] sm:min-w-[36px] flex-1 h-[52px] sm:h-[58px] text-sm sm:text-base";
    if (state === 2) return `${base} ${size} bg-correct text-background`;
    if (state === 1) return `${base} ${size} bg-present text-background`;
    if (state === 0) return `${base} ${size} bg-absent text-muted-foreground`;
    return `${base} ${size} bg-secondary text-secondary-foreground hover:bg-secondary/80`;
  };

  return (
    <div className="flex flex-col items-center gap-1.5 w-full max-w-lg px-1.5 mt-4" role="group" aria-label="Keyboard">
      {ROWS.map((row, ri) => (
        <div key={ri} className="flex gap-1 sm:gap-1.5 w-full justify-center">
          {ri === 2 && <div className="w-0" />}
          {row.map((key) => (
            <button
              key={key}
              onClick={() => onKey(key)}
              className={keyClass(key)}
              aria-label={key === "Enter" ? "Submit guess" : key === "⌫" ? "Delete letter" : key}
            >
              {key === "⌫" ? (
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 4H8l-7 8 7 8h13a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2z"/><line x1="18" y1="9" x2="12" y2="15"/><line x1="12" y1="9" x2="18" y2="15"/></svg>
              ) : key}
            </button>
          ))}
          {ri === 2 && onResign && (
            <button
              onClick={onResign}
              className="flex flex-col items-center justify-center rounded-md min-w-[42px] sm:min-w-[48px] h-[52px] sm:h-[58px] text-[9px] sm:text-[10px] font-bold uppercase select-none transition-all duration-150 active:scale-95 bg-destructive/15 text-destructive hover:bg-destructive hover:text-white border border-destructive/30 leading-none gap-0.5"
              aria-label="Resign game"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 -rotate-12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" y1="22" x2="4" y2="15"/></svg>
              <span>Resign</span>
            </button>
          )}
          {ri === 2 && <div className="w-0" />}
        </div>
      ))}
    </div>
  );
}
