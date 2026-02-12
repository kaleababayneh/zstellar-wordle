// Game configuration & constants

// The contract deployed on Stellar testnet
export const CONTRACT_ID = "CCC3BEXJHMLDWIJWFBK36V7K7ZOPYPVSXWTI5ZICSIVTLZN5OHMAFWY3";

// Stellar testnet RPC
export const RPC_URL = "https://soroban-testnet.stellar.org";
export const NETWORK_PASSPHRASE = "Test SDF Network ; September 2015";

// The secret word committed on-chain (word="apple", salt=0)
// The commitment hash is baked into the VK at deploy time.
// In a real game, the server would hold { word, salt } and just expose the commitment.
export const GAME_SECRET = {
  word: "apple",
  letterCodes: [97, 112, 112, 108, 101], // a, p, p, l, e
  salt: "0",
  commitmentHash:
    "0x042cf71f7e7ebd3fbd6f5a1807f1894c1d738690451e51516070c1688e2f3c96",
};

export const WORD_LENGTH = 5;
export const MAX_GUESSES = 6;

export const WORDLE_RESULTS = {
  INCORRECT: 0, // gray
  WRONG_POSITION: 1, // yellow
  CORRECT: 2, // green
} as const;
