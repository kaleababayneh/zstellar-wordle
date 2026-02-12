interface KeyboardProps {
  onKey: (key: string) => void;
  letterStates: Record<string, number | undefined>;
}

const ROWS = [
  ["q", "w", "e", "r", "t", "y", "u", "i", "o", "p"],
  ["a", "s", "d", "f", "g", "h", "j", "k", "l"],
  ["Enter", "z", "x", "c", "v", "b", "n", "m", "⌫"],
];

export function Keyboard({ onKey, letterStates }: KeyboardProps) {
  const keyColor = (key: string): string => {
    const base =
      "rounded font-semibold transition-colors duration-200 flex items-center justify-center";
    const state = letterStates[key];
    if (state === 2)
      return `${base} bg-green-600 text-white`;
    if (state === 1)
      return `${base} bg-yellow-500 text-white`;
    if (state === 0)
      return `${base} bg-gray-700 text-gray-400`;
    return `${base} bg-gray-500 text-white hover:bg-gray-400`;
  };

  return (
    <div className="flex flex-col items-center gap-1 mt-4">
      {ROWS.map((row, ri) => (
        <div key={ri} className="flex gap-1">
          {row.map((key) => (
            <button
              key={key}
              onClick={() => onKey(key)}
              className={`${keyColor(key)} ${
                key.length > 1 ? "px-3 py-3 text-xs" : "w-9 h-12 text-sm"
              }`}
            >
              {key}
            </button>
          ))}
        </div>
      ))}
    </div>
  );
}
