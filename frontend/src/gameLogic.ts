import { WORD_LENGTH, WORDLE_RESULTS } from "./config";

/** Convert a word to an array of ASCII code strings */
export function wordToAsciiCodes(word: string): string[] {
  return word
    .toLowerCase()
    .split("")
    .map((ch) => ch.charCodeAt(0).toString());
}

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
