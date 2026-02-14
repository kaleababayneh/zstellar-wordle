import { WORD_LENGTH, WORDLE_RESULTS } from "./config";

/** Convert a word to an array of ASCII code strings */
export function wordToAsciiCodes(word: string): string[] {
  return word
    .toLowerCase()
    .split("")
    .map((ch) => ch.charCodeAt(0).toString());
}

/** Wordle comparison — matches the Noir circuit logic exactly.
 *
 * The circuit does NOT track "used" letters for duplicate handling.
 * It simply checks: exact match → 2, exists anywhere → 1, absent → 0.
 * This differs from standard Wordle rules but must match the circuit
 * to avoid "Cannot satisfy constraint" errors during witness generation.
 */
export function calculateWordleResults(
  guess: string,
  correct: string
): number[] {
  const g = guess.toLowerCase().split("");
  const c = correct.toLowerCase().split("");
  const results: number[] = new Array(WORD_LENGTH).fill(WORDLE_RESULTS.INCORRECT);

  for (let i = 0; i < WORD_LENGTH; i++) {
    if (g[i] === c[i]) {
      results[i] = WORDLE_RESULTS.CORRECT;
    } else {
      // Check if letter exists ANYWHERE in the correct word (no used tracking)
      let found = false;
      for (let j = 0; j < WORD_LENGTH; j++) {
        if (c[j] === g[i]) {
          found = true;
          break;
        }
      }
      if (found) {
        results[i] = WORDLE_RESULTS.WRONG_POSITION;
      }
    }
  }

  return results;
}
