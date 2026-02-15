// Game configuration & constants

// The contract deployed on Stellar testnet
export const CONTRACT_ID = "CAUNX2V5ATBGBF7ECPGZNCF4PFEBGIER45XCUZA2XLCDQXJJ6B4OCDEM";

// Stellar testnet RPC
export const RPC_URL = "https://soroban-testnet.stellar.org";
export const NETWORK_PASSPHRASE = "Test SDF Network ; September 2015";

export const WORD_LENGTH = 5;
export const MAX_GUESSES = 6;

export const WORDLE_RESULTS = {
  INCORRECT: 0, // gray
  WRONG_POSITION: 1, // yellow
  CORRECT: 2, // green
} as const;

