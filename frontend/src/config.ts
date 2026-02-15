// Game configuration & constants

// The contract deployed on Stellar testnet
export const CONTRACT_ID = "CDPHM3RIXQIKQHGQISH2VVQCE5NIUUK2P65BOGOQIPQAP7YAPY4RBELF";

// Stellar testnet RPC
export const RPC_URL = "https://soroban-testnet.stellar.org";
export const NETWORK_PASSPHRASE = "Test SDF Network ; September 2015";

export const WORD_LENGTH = 5;
export const MAX_GUESSES = 6;

// Game timer: 5 minutes in milliseconds
export const GAME_DURATION_MS = 5 * 60 * 1000;

export const WORDLE_RESULTS = {
  INCORRECT: 0, // gray
  WRONG_POSITION: 1, // yellow
  CORRECT: 2, // green
} as const;

