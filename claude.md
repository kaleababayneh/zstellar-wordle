# ZK Wordle on Stellar — Project Reference

## Project Overview

A **ZK Wordle** game where guesses are proven in-browser using Noir/UltraHonk and verified on-chain via a Soroban smart contract on the Stellar testnet. Features a 5-minute game timer enforced on-chain and an optional XLM escrow system.

**Stack**: Noir circuits → UltraHonk proofs (via `@aztec/bb.js`) → Soroban smart contract (Rust) → Stellar testnet → React/TypeScript frontend

### Game Flow
1. Player connects Freighter wallet
2. Player sets a word (or picks random), optionally deposits XLM escrow
3. `create_game` is called on-chain — records a 5-minute deadline and holds escrow tokens
4. Player guesses 5-letter words; each guess triggers:
   - Merkle proof validation (word exists in dictionary)
   - ZK proof generation in-browser (Noir circuit proves the wordle result is correct without revealing the secret word)
   - On-chain verification via `verify_guess_and_proof` (checks timer, Merkle proof, cross-checks letters, verifies ZK proof)
5. If the player wins (all letters correct) within 6 guesses and 5 minutes, the contract marks the game as won
6. Player can withdraw escrowed XLM after winning

---

## Architecture

### Smart Contract (`src/lib.rs`)

**Soroban contract** deployed on Stellar testnet. Uses `ultrahonk_soroban_verifier` crate for ZK proof verification.

**Exported functions (7):**

| Function | Description |
|----------|-------------|
| `__constructor(vk_bytes)` | Stores the UltraHonk verification key on-chain at deploy time |
| `create_game(player, token_addr, amount)` | Starts a new game: records `deadline = now + 300s` in temporary storage. If `amount > 0`, transfers tokens from player to contract as escrow. Requires player auth |
| `get_game_deadline(player)` | Returns the deadline timestamp for a player's active game (0 if none) |
| `verify_proof(public_inputs, proof_bytes)` | Standalone UltraHonk proof verification against stored VK |
| `verify_guess(guess_word, path_elements, path_indices)` | Standalone Merkle proof verification that a word is in the dictionary |
| `verify_guess_and_proof(player, guess_word, path_elements, path_indices, public_inputs, proof_bytes)` | **Main game function**: verifies timer not expired, validates Merkle proof, cross-checks guess letters against public inputs, verifies ZK proof, detects wins and marks game as won |
| `withdraw(player)` | Transfers escrowed tokens back to player after a verified win. Requires player auth |

**Key design decisions:**
- **Merkle root is hardcoded** as `const MERKLE_ROOT: [u8; 32]` — keccak256 Merkle tree of 12,653 five-letter words, depth 14. Not passed at deploy time.
- **Timer enforcement**: `create_game` stores `ledger.timestamp() + 300` per player in temporary storage. `verify_guess_and_proof` checks `timestamp > deadline → GameExpired`.
- **Escrow**: Uses Soroban `token::TokenClient` to transfer native XLM (via SAC) from player to contract, and back on withdrawal.
- **Win detection**: After ZK proof passes, contract reads the 5 result fields from public inputs (offset 192, each 32 bytes BE). If all are `2` (correct), sets `gm_won` flag in storage.
- **Storage**: VK in `instance()` storage. All per-player data (deadline, escrow, win flag) in `temporary()` storage with TTL 500 ledgers.

**Error codes:**
| Code | Name | Meaning |
|------|------|---------|
| 1 | VkParseError | Failed to parse verification key |
| 2 | ProofParseError | Invalid proof size (must be exactly `PROOF_BYTES`) |
| 3 | VerificationFailed | ZK proof verification failed |
| 4 | VkNotSet | No VK stored on-chain |
| 5 | InvalidGuessLength | Guess word is not exactly 5 bytes |
| 6 | InvalidCharacter | Guess contains non-lowercase ASCII |
| 7 | InvalidMerkleProof | Merkle proof doesn't match hardcoded root |
| 8 | MerkleRootNotSet | (Legacy, no longer used — root is hardcoded) |
| 9 | GuessWordMismatch | Merkle word doesn't match letters in ZK public inputs |
| 10 | GameExpired | 5-minute timer has elapsed |
| 11 | NoActiveGame | No game found for player (never called `create_game`) |
| 12 | GameNotWon | Attempted withdrawal without winning |
| 13 | NoEscrow | No escrow deposited for this player |

### Noir Circuit (`circuit/src/main.nr`)

ZK Wordle verifier — proves that the result feedback (correct/wrong-position/absent) is honest given a committed secret word and a player's guess.

**Public inputs**: commitment hash, 5 guess letter ASCII codes, 5 result values
**Private inputs**: 5 secret word letters, salt

The commitment is `Poseidon2([salt, letter1, letter2, letter3, letter4, letter5])`.

> **Important**: The circuit does NOT track "used" letters for duplicates. It checks: exact match → 2, letter exists anywhere → 1, absent → 0. The frontend's `gameLogic.ts` matches this simplified logic.

### Frontend (`frontend/src/`)

React + TypeScript + Vite. Tailwind CSS for styling.

| File | Purpose |
|------|---------|
| `App.tsx` | Main UI — game creation, guess submission, countdown timer, escrow UI, wallet connection |
| `config.ts` | Contract ID, RPC URL, network passphrase, token IDs, game constants |
| `soroban.ts` | All Soroban transaction building: `createGameOnChain`, `verifyGuessAndProofOnChain`, `withdrawEscrow`, `verifyProofOnChain` |
| `gameState.ts` | `GameState` type, localStorage persistence, Poseidon2 commitment via Barretenberg, word list management |
| `gameLogic.ts` | `calculateWordleResults` — must match Noir circuit logic exactly |
| `generateProof.ts` | Browser-side proof generation via `@aztec/bb.js` WASM |
| `merkleProof.ts` | Loads precomputed keccak256 Merkle tree from `public/`, generates proofs for words |
| `hooks/useFreighter.ts` | Freighter wallet connection hook |
| `components/WordleGrid.tsx` | Wordle grid display |
| `components/Keyboard.tsx` | On-screen keyboard with letter state coloring |
| `components/StatusBar.tsx` | Scrollable log of status messages |

**GameState** (persisted in localStorage):
```typescript
interface GameState {
  word: string;           // secret word
  letterCodes: number[];  // ASCII codes
  salt: string;           // random salt for commitment
  commitmentHash: string; // Poseidon2 hash
  contractId: string;
  guesses: Array<{ word: string; results: number[]; verified: boolean }>;
  createdAt: number;
  deadline: number;       // Unix ms when game expires (0 before on-chain registration)
  escrowAmount: number;   // XLM amount escrowed (0 = none)
  escrowWithdrawn: boolean;
}
```

### Merkle Tree (`js-scripts/`, `frontend/public/`)

Precomputed keccak256 Merkle tree of 12,653 valid 5-letter English words. Depth 14.

- `js-scripts/merkleTreeKeccak.js` — generates `merkle-tree-keccak.json` (metadata + wordIndex) and `merkle-tree-keccak-levels.json` (all tree levels)
- These JSON files are copied to `frontend/public/` for the frontend to load
- Frontend generates Merkle proofs client-side and submits them with each guess
- Contract walks the Merkle path (14 keccak256 hashes via host calls) and compares to the hardcoded root

---

## Configuration

- **Contract ID**: `CDDUIQSCZSNQNMGSH7SP57ILEGUIWJVT6L73GBJZVSFBHJRNHR7DXJ27`
- **Native XLM SAC (testnet)**: `CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC`
- **Testnet RPC**: `https://soroban-testnet.stellar.org`
- **Network passphrase**: `Test SDF Network ; September 2015`
- **Merkle root**: `0xca5182bac9d0ec16a66d0c25214807a6e3627ba89e19d1c6ae11cee16ec420c3` (hardcoded in contract)
- **Deploy account**: `alice-testnet` (stellar keys)

## Deployment

```bash
# 1. Build circuit artifacts (VK, proof, public inputs)
tests/build_circuits.sh

# 2. Build contract WASM
rustup target add wasm32v1-none
stellar contract build --optimize

# 3. Deploy (only needs VK — merkle root is hardcoded)
stellar contract deploy \
  --wasm target/wasm32v1-none/release/rs_soroban_ultrahonk.wasm \
  --source alice-testnet \
  --network testnet \
  -- \
  --vk_bytes-file-path circuit/target/vk

# 4. Update CONTRACT_ID in frontend/src/config.ts with the new ID
```

## Important Constraints

1. **CPU Budget**: The contract uses ~400M of the 400M testnet CPU limit for ZK verification. Any circuit changes that increase computation will break on-chain verification.
2. **CPU Capping**: The frontend caps simulated CPU instructions at `400_000_000` (the network limit) because simulation overestimates by ~0.1%. This mirrors what the `stellar` CLI does internally.
3. **Proof size**: Raw proof is 14,592 bytes (456 × 32). Public inputs are 352 bytes (11 fields × 32 bytes).
4. **Fee**: Set to 100 XLM max fee for ZK verification transactions, 10 XLM for create_game/withdraw. Actual cost is ~0.36 XLM for verification.
5. **Wordle logic**: Does NOT match standard Wordle for duplicate letters — see circuit note above.
6. **Timer**: 5 minutes (300 ledger seconds). Frontend starts a local countdown from `Date.now() + GAME_DURATION_MS` immediately after `create_game` succeeds. On-chain enforcement uses `env.ledger().timestamp()`.

## Past Issues & Fixes

### Soroban `txSorobanInvalid` (-17) — CPU Instructions Exceed Network Limit
Simulation overestimates CPU by ~0.1%, pushing past the 400M testnet limit. Fixed by capping instructions at `NETWORK_CPU_LIMIT` in `soroban.ts` before assembling the transaction.

### "Cannot satisfy constraint" — Wordle Logic Mismatch
The Noir circuit's wordle logic doesn't track used letters for duplicates. Frontend was using standard two-pass logic. Fixed by rewriting `calculateWordleResults` to match the circuit's simpler approach.
