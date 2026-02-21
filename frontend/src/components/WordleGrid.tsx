import { memo, useEffect, useRef, useState } from "react";

interface WordleGridProps {
  guesses: Array<{
    word: string;
    results?: number[];
    verified: boolean;
  }>;
  currentGuess: string;
  maxRows?: number;
  shakeCurrentRow?: boolean;
  onShakeEnd?: () => void;
}

/** Map result number → CSS class for the back face */
const resultClass = (r: number | undefined): string => {
  switch (r) {
    case 2:
      return "result-correct";
    case 1:
      return "result-present";
    default:
      return "result-absent";
  }
};

/**
 * Single tile with a flip animation.
 * Flips when `result` transitions from undefined → a number,
 * with a per-column stagger delay.
 */
function FlipTile({
  letter,
  result,
  delay,
}: {
  letter: string;
  result: number | undefined;
  delay: number; // ms
}) {
  const [flipped, setFlipped] = useState(result !== undefined);
  const [displayResult, setDisplayResult] = useState(result);
  const prevResultRef = useRef(result);

  useEffect(() => {
    // Only trigger a flip when result goes from undefined → defined
    if (prevResultRef.current === undefined && result !== undefined) {
      // Set the back-face colour immediately (it's hidden until the flip)
      setDisplayResult(result);

      // Start the flip after the stagger delay
      const flipTimer = setTimeout(() => {
        setFlipped(true);
      }, delay);

      prevResultRef.current = result;
      return () => clearTimeout(flipTimer);
    }

    // If result was already set on mount (page reload), just show it
    if (result !== undefined && !flipped) {
      setFlipped(true);
      setDisplayResult(result);
    }

    prevResultRef.current = result;
  }, [result, delay]); // flipped intentionally excluded to avoid cleanup race

  return (
    <div className="tile-flip-container">
      <div className={`tile-flip-inner ${flipped ? "flipped" : ""}`}>
        {/* Front face — shows the letter before the result is known */}
        <div className="tile-front">{letter}</div>
        {/* Back face — shows the letter with the coloured result */}
        <div className={`tile-back ${resultClass(displayResult)}`}>{letter}</div>
      </div>
    </div>
  );
}

export const WordleGrid = memo(function WordleGrid({
  guesses,
  currentGuess,
  maxRows = 6,
  shakeCurrentRow = false,
  onShakeEnd,
}: WordleGridProps) {
  const emptyCellClass =
    "w-[58px] h-[58px] sm:w-[62px] sm:h-[62px] border-2 flex items-center justify-center text-2xl sm:text-3xl font-bold uppercase select-none border-border bg-transparent text-transparent";
  const typingCellClass =
    "w-[58px] h-[58px] sm:w-[62px] sm:h-[62px] border-2 flex items-center justify-center text-2xl sm:text-3xl font-bold uppercase select-none border-muted-foreground bg-transparent text-foreground tile-pop";

  const rows: React.ReactNode[] = [];

  // Submitted guesses
  for (let i = 0; i < guesses.length && i < maxRows; i++) {
    const g = guesses[i];
    rows.push(
      <div key={`g-${i}`} className="flex gap-[5px] justify-center">
        {Array.from({ length: 5 }).map((_, j) => (
          <FlipTile
            key={`${i}-${j}`}
            letter={g.word[j] || ""}
            result={g.results?.[j]}
            delay={j * 300} // stagger 300ms per tile
          />
        ))}
      </div>
    );
  }

  // Current guess row
  if (guesses.length < maxRows) {
    rows.push(
      <div
        key="current"
        className={`flex gap-[5px] justify-center ${shakeCurrentRow ? "animate-shake" : ""}`}
        onAnimationEnd={onShakeEnd}
      >
        {Array.from({ length: 5 }).map((_, j) => (
          <div
            key={j}
            className={currentGuess[j] ? typingCellClass : emptyCellClass}
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
      <div key={`e-${i}`} className="flex gap-[5px] justify-center">
        {Array.from({ length: 5 }).map((_, j) => (
          <div key={j} className={emptyCellClass} />
        ))}
      </div>
    );
  }

  return <div className="flex flex-col gap-[5px]">{rows}</div>;
});
