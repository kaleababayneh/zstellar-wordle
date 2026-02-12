import { WORD_LENGTH, WORDLE_RESULTS } from "./config";

/** Convert a word to an array of ASCII code strings */
export function wordToAsciiCodes(word: string): string[] {
  return word
    .toLowerCase()
    .split("")
    .map((ch) => ch.charCodeAt(0).toString());
}

/** Wordle comparison: returns [2,2,1,0,0] etc. */
export function calculateWordleResults(
  guess: string,
  correct: string
): number[] {
  const g = guess.toLowerCase().split("");
  const c = correct.toLowerCase().split("");
  const results: number[] = new Array(WORD_LENGTH).fill(WORDLE_RESULTS.INCORRECT);

  // First pass: mark correct positions
  const usedCorrect = new Array(WORD_LENGTH).fill(false);
  for (let i = 0; i < WORD_LENGTH; i++) {
    if (g[i] === c[i]) {
      results[i] = WORDLE_RESULTS.CORRECT;
      usedCorrect[i] = true;
    }
  }

  // Second pass: mark wrong positions
  for (let i = 0; i < WORD_LENGTH; i++) {
    if (results[i] === WORDLE_RESULTS.CORRECT) continue;
    for (let j = 0; j < WORD_LENGTH; j++) {
      if (!usedCorrect[j] && g[i] === c[j]) {
        results[i] = WORDLE_RESULTS.WRONG_POSITION;
        usedCorrect[j] = true;
        break;
      }
    }
  }

  return results;
}
