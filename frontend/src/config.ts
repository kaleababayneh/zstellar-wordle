// Game configuration & constants

// The contract deployed on Stellar testnet
export const CONTRACT_ID = "CDDUIQSCZSNQNMGSH7SP57ILEGUIWJVT6L73GBJZVSFBHJRNHR7DXJ27";

// Stellar testnet RPC
export const RPC_URL = "https://soroban-testnet.stellar.org";
export const NETWORK_PASSPHRASE = "Test SDF Network ; September 2015";

export const WORD_LENGTH = 5;
export const MAX_GUESSES = 6;

// Game timer: 5 minutes in milliseconds
export const GAME_DURATION_MS = 5 * 60 * 1000;

// Native XLM Stellar Asset Contract on testnet
export const NATIVE_TOKEN_ID = "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC";

// 1 XLM = 10^7 stroops
export const STROOPS_PER_XLM = 10_000_000;

export const WORDLE_RESULTS = {
  INCORRECT: 0, // gray
  WRONG_POSITION: 1, // yellow
  CORRECT: 2, // green
} as const;

