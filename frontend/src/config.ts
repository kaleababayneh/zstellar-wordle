// Game configuration & constants

// The contract deployed on Stellar testnet
export const CONTRACT_ID = "CANNDXJFJIRFDVPY55A4HMKZUKY2H2ZUJJEDSS25VUPYTVFDU4JK3VSQ";

// Stellar testnet RPC
export const RPC_URL = "https://stellar.liquify.com/api=41EEWAH79Y5OCGI7/testnet";
export const NETWORK_PASSPHRASE = "Test SDF Network ; September 2015";

export const WORD_LENGTH = 5;
export const MAX_GUESSES = 6;

// Per-turn timer: 5 minutes in milliseconds
export const TURN_DURATION_MS = 5 * 60 * 1000;

// Native XLM Stellar Asset Contract on testnet
export const NATIVE_TOKEN_ID = "CANNDXJFJIRFDVPY55A4HMKZUKY2H2ZUJJEDSS25VUPYTVFDU4JK3VSQ";

// 1 XLM = 10^7 stroops
export const STROOPS_PER_XLM = 10_000_000;

export const WORDLE_RESULTS = {
  INCORRECT: 0, // gray
  WRONG_POSITION: 1, // yellow
  CORRECT: 2, // green
} as const;

// Game phases (match contract constants)
export const PHASE = {
  WAITING: 0,    // Waiting for player 2 to join
  ACTIVE: 1,     // Game in progress
  REVEAL: 2,     // Winner must reveal their word
  FINALIZED: 3,  // Game over, winner confirmed
  DRAW: 4,       // Max turns reached, no winner
  NONE: 255,     // No game found
} as const;

// Max turns: 6 guesses per player = 12 + 1 final verification = 13
export const MAX_TURNS = 13;

// Polling interval for checking on-chain state (ms)
export const POLL_INTERVAL_MS = 1000;

