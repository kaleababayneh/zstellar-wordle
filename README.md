# ZK Wordle on Stellar

A **peer-to-peer Wordle** where each player picks a secret word and races to guess the opponent's. Both players' secret words stay privately in the browser while proven correct with zero-knowledge proofs written in Noir. The proofs are later verified on-chain via a Soroban smart contract on the Stellar testnet. Optional XLM escrow makes it a stakes game.

## Why Zero-Knowledge?

Simply hashing a word and committing it on-chain is vulnerable to dictionary brute-force attacks, after all, there are only ~12K five-letter English words. ZK proofs solve this: each secret word is hashed together with a random private **salt** using Poseidon2, and only the resulting commitment is stored on-chain, making it impractical to reverse engineer the word from the commitment. The word and salt never leave the player’s device. Without the salt, an attacker only needs ~12,653 Poseidon2 hashes to crack any commitment—trivial in milliseconds. The salt is provided as a **Field** element; **if we assume it has *b* bits of entropy** (e.g., **b = 64** for an 8-byte uniformly random salt), the brute-force space becomes **12,653 × 2ᵇ**. For **b = 64**, that’s **≈ 2.3 × 10²³** combinations; at **1 billion hashes/sec** this is **~7.4 million years** of work, and higher-entropy (field-sized) salts increase the margin even further.

When a player makes a guess, the opponent generates the wordle result (🟩🟨⬛) locally and send the result of the guess along with  a ZK proof that the result is computed honestly against the already-committed word. The proof is verified on-chain, each guess result is proven correct *without ever revealing the secret word*.

We also need to ensure every word — both committed and guessed — is a valid English word. All 12,653 five-letter words are hashed and stored off-chain in a Poseidon2 Merkle tree whose root is hardcoded in the contract. For **committed words**, verifying the Merkle proof on-chain would reveal the secret word through the witness, so instead the proof is done *inside the ZK circuit* (zero-knowledge Merkle membership). For **guessed words**, since guesses are public anyway, the contract verifies the Merkle proof directly on-chain, not requiring a ZK proof.

## How It Works

```
Player 1                         Stellar Testnet                         Player 2
────────                         ───────────────                         ────────
  Choose word + salt                                                Choose word + salt
  Generate word-commit proof ──▶  create_game (+ XLM escrow)
                                  Stores commitment, starts timer
                                                                   ◀── join_game (+ escrow)
                                                                       Generate word-commit proof
  Guess P2's word ──────────────▶ verify_guess_and_proof
  ZK proof in browser (bb.js)     ├─ Check 5-min turn timer
  Merkle proof for dictionary     ├─ Verify Merkle membership
                                  ├─ Cross-check guess letters
                                  └─ Verify UltraHonk proof        ◀── (alternating turns)
                                  ...
                                  Winner reveals word ───────────▶ reveal_word (word-commit proof)
                                  withdraw() → XLM returned
```

## Architecture

| Layer | Tech | What It Does |
|-------|------|-------------|
| **Circuits** | [Noir](https://noir-lang.org/) | `circuit-word-guess/` — proves wordle feedback is correct given a committed word. `circuit-word-commit/` — proves the committed word exists in the dictionary (Poseidon2 Merkle proof) |
| **On-chain verifier** | Rust / [UltraHonk](https://github.com/AztecProtocol/barretenberg) | `word-guess-verifier/` — Soroban-compatible UltraHonk verification library |
| **Smart contract** | [Soroban](https://soroban.stellar.org/) (Rust) | `src/lib.rs` — two-player game state machine (create → join → active → reveal → finalize), turn timer, XLM escrow, on-chain proof & Merkle verification |
| **Frontend** | React · TypeScript · Vite · Tailwind | `frontend/` — in-browser proof generation via `@aztec/bb.js` WASM, Freighter wallet integration, lobby system, real-time game UI |
| **Merkle tree** | Node.js | `js-scripts/` — precomputes Poseidon2 Merkle tree of 12,653 five-letter words (depth 14) |


## Quick Start

### Prerequisites

- [Rust](https://rustup.rs/) + `wasm32v1-none` target
- [Nargo](https://noir-lang.org/docs/getting_started/installation/) (Noir toolchain)
- [Stellar CLI](https://developers.stellar.org/docs/tools/developer-tools/cli/stellar-cli)
- [Node.js](https://nodejs.org/) ≥ 18
- [Freighter wallet](https://www.freighter.app/) browser extension

### Build & Deploy

```bash
# 1. Build Noir circuits
cd circuit-word-guess && nargo compile && bb write_vk -b target/circuit-word-guess.json
cd ../circuit-word-commit && nargo compile && bb write_vk -b target/circuit-word-commit.json

# 2. Build & deploy Soroban contract
stellar contract build --optimize
stellar contract deploy \
  --wasm target/wasm32v1-none/release/rs_soroban_ultrahonk.wasm \
  --network testnet --source alice-testnet \
  -- --vk_bytes <guess-vk-hex> --wc_vk_bytes <commit-vk-hex>

# 3. Update CONTRACT_ID in frontend/src/config.ts

# 4. Run frontend
cd frontend && npm install && npm run dev
```

## Key Design Decisions

- **CPU budget is tight**: On-chain UltraHonk verification uses ~400M of the 400M testnet CPU instruction limit. The frontend caps simulated instructions at the limit since simulation overestimates by ~0.1%.
- **Simplified duplicate-letter logic**: The circuit does *not* track "used" letters for duplicates (exact match → 2, letter exists anywhere → 1, absent → 0). This is intentional for circuit size constraints.
- **Hardcoded Merkle root**: The Poseidon2 Merkle root of the word dictionary is hardcoded in the contract — not passed at deploy time.
- **Per-turn timer**: Each turn has a 5-minute on-chain deadline (`ledger.timestamp() + 300s`). Frontend mirrors this with a local countdown.

## Contract API

| Function | Description |
|----------|-------------|
| `__constructor(vk_bytes, wc_vk_bytes)` | Stores both UltraHonk verification keys on-chain at deploy time |
| `create_game(player, token, amount)` | Creates a game lobby, records Poseidon2 commitment, optionally escrows XLM |
| `join_game(game_id, player, token, amount)` | Player 2 joins with their own commitment and matching escrow |
| `verify_guess_and_proof(...)` | Main game function — validates turn timer, Merkle proof, cross-checks guess letters, verifies ZK proof |
| `reveal_word(game_id, caller, word, proof)` | Winner reveals their word via word-commit proof to finalize the game |
| `withdraw(game_id, caller)` | Transfers escrowed XLM back after game finalization |

<details>
<summary><strong>Error Codes</strong></summary>

| Code | Name | Meaning |
|------|------|---------|
| 1 | VkParseError | Failed to parse verification key |
| 2 | ProofParseError | Invalid proof size |
| 3 | VerificationFailed | ZK proof didn't verify |
| 4 | VkNotSet | No VK stored on-chain |
| 5 | InvalidGuessLength | Word is not exactly 5 bytes |
| 6 | InvalidCharacter | Non-lowercase ASCII |
| 7 | InvalidMerkleProof | Merkle proof doesn't match root |
| 10 | NoActiveGame | No game found for player |
| 11 | GameAlreadyExists | Duplicate game creation |
| 12 | WrongPlayer | Caller isn't part of this game |
| 13 | WrongPhase | Action not valid in current phase |
| 14 | NotYourTurn | Out-of-turn guess attempt |
| 16 | AlreadyWithdrawn | Escrow already claimed |
| 17 | NotWinner | Withdrawal without winning |
| 18 | InvalidReveal | Revealed word doesn't match commitment |

</details>

## Proof & Fee Specs

| Metric | Value |
|--------|-------|
| Raw proof size | 14,592 bytes (456 × 32) |
| Public inputs | 352 bytes (11 fields × 32) |
| Max fee (ZK verification tx) | 100 XLM |
| Max fee (create/join/withdraw) | 10 XLM |
| Actual verification cost | ~0.36 XLM |

## Known Issues & Fixes

- **`txSorobanInvalid` (-17)** — Simulation overestimates CPU by ~0.1%, exceeding the 400M testnet limit. Fixed by capping instructions at `NETWORK_CPU_LIMIT` in `soroban.ts` before assembling the transaction.
- **"Cannot satisfy constraint"** — The Noir circuit's wordle logic doesn't track used letters for duplicates. Frontend was using standard two-pass Wordle logic. Fixed by rewriting `calculateWordleResults` in `gameLogic.ts` to match the circuit's simpler approach.

## Network Config

| Parameter | Value |
|-----------|-------|
| Network | Stellar Testnet |
| RPC | `https://soroban-testnet.stellar.org` |
| Passphrase | `Test SDF Network ; September 2015` |
| Native XLM SAC | `CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC` |

## License

See individual component licenses. `word-guess-verifier/` is MIT-licensed.
