import { memo } from "react";

interface WordleGridProps {
  guesses: Array<{
    word: string;
    results?: number[];
    verified: boolean;
  }>;
  currentGuess: string;
  maxRows?: number;
}

export const WordleGrid = memo(function WordleGrid({
  guesses,
  currentGuess,
  maxRows = 6,
}: WordleGridProps) {
  const cellStyle = (result?: number, hasLetter = false): string => {
    const base =
      "w-14 h-14 border-2 flex items-center justify-center text-xl font-bold uppercase transition-all duration-300 rounded";

    if (!hasLetter)
      return `${base} bg-white/5 border-gray-600 text-transparent`;
    if (result === undefined)
      return `${base} bg-white/10 border-gray-400 text-white`;

    switch (result) {
      case 2:
        return `${base} bg-green-600 border-green-600 text-white`;
      case 1:
        return `${base} bg-yellow-500 border-yellow-500 text-white`;
      default:
        return `${base} bg-gray-700 border-gray-700 text-white`;
    }
  };

  const rows: any[] = [];

  // Submitted guesses
  for (let i = 0; i < guesses.length && i < maxRows; i++) {
    const g = guesses[i];
    rows.push(
      <div key={`g-${i}`} className="flex gap-1 justify-center">
        {Array.from({ length: 5 }).map((_, j) => (
          <div
            key={j}
            className={cellStyle(
              g.results?.[j],
              !!g.word[j]
            )}
          >
            {g.word[j] || ""}
          </div>
        ))}
      </div>
    );
  }

  // Current guess row
  if (guesses.length < maxRows) {
    rows.push(
      <div key="current" className="flex gap-1 justify-center">
        {Array.from({ length: 5 }).map((_, j) => (
          <div
            key={j}
            className={cellStyle(undefined, !!currentGuess[j])}
          >
            {currentGuess[j] || ""}
          </div>
        ))}
      </div>
    );
  }

  // Empty rows
  const remaining = maxRows - rows.length;
  for (let i = 0; i < remaining; i++) {
    rows.push(
      <div key={`e-${i}`} className="flex gap-1 justify-center">
        {Array.from({ length: 5 }).map((_, j) => (
          <div key={j} className={cellStyle(undefined, false)} />
        ))}
      </div>
    );
  }

  return <div className="flex flex-col gap-1">{rows}</div>;
});
