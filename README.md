# 🟩 ZK Wordle on Stellar 

A **peer-to-peer Wordle** (can be played in [zkwordle.app](https://zkwordle.app) as well) a fun game where each player picks a secret word and races to crack each other's word. Both players' secret words stay privately in the browser while proven correct with zero-knowledge proofs using circuits written in Noir. The proofs are verified on-chain via a Soroban smart contract on the Stellar testnet. Optional XLM escrow makes it a stakes game.
 


## Why Zero-Knowledge?

Simply hashing a word and committing it on-chain is vulnerable to dictionary brute-force attacks, after all, there are only ~12K five-letter English words. ZK proofs solve this: each secret word is hashed together with a random private **salt** using Poseidon2, and only the resulting commitment is stored on-chain, making it impractical to reverse engineer the word from the commitment. The word and salt never leave the player's device. Without the salt, an attacker only needs ~12,653 Poseidon2 hashes to crack any commitment—trivial in milliseconds. The salt is a **Field** element with **64 bits of entropy** (8 random bytes), making the brute-force space **12,653 × 2⁶⁴ ≈ 2.3 × 10²³** combinations; at **1 billion hashes/sec** this would take **~7.4 million years**.

When a player makes a guess, the opponent generates the wordle result (🟩🟨⬛) locally and send the result of the guess along with  a ZK proof that the result is computed honestly against the already-committed word. The proof is verified on-chain, each guess result is proven correct *without ever revealing the secret word*.

We also need to ensure every word — both committed and guessed — is a valid English word. The 12,653 five-letter words (sourced from the [`an-array-of-english-words`](https://www.npmjs.com/package/an-array-of-english-words) npm package) are hashed and stored off-chain in a Poseidon2 Merkle tree whose root is hardcoded in the contract. After the Merkle tree is constructed, it can also be stored in decentralized storage accessible to everyone; currently the tree is saved as a JSON file in the frontend. For **committed words**, verifying the Merkle proof on-chain would reveal the secret word through the witness, so instead the proof is done *inside the ZK circuit* (zero-knowledge Merkle membership). For **guessed words**, since guesses are public anyway, the contract verifies the Merkle proof directly on-chain, not requiring a ZK proof.

## How It Works

```
    ┌──────────┐                                                    ┌──────────┐
    │ Player 1 │                                                    │ Player 2 │
    └────┬─────┘                                                    └────┬─────┘
         │  choose word + salt                        choose word + salt │
         │  compute commitment                        compute commitment │
         │                                                               │
  ╔══════╪═══════════════════════  SETUP  ═══════════════════════════════╪══════╗
  ║      │                                                               │      ║
  ║      ├── word-commit ZK proof ──────▶ create_game (+ XLM escrow)     │      ║
  ║      │                                stores commitment              │      ║
  ║      │                                                               │      ║
  ║      │                                join_game (auto-match) ◀───────┤      ║
  ║      │                                word-commit ZK proof           │      ║
  ╚══════╪═══════════════════════════════════════════════════════════════╪══════╝
         │                                                               │
  ╔══════╪═════════════════  ACTIVE PLAY (max 13 turns)   ═══════════════╪══════╗
  ║      │                                                               │      ║
  ║      ├── submit_turn (guess only) ──▶ T1: Merkle ✓, store guess      │      ║
  ║      │                                                               │      ║
  ║      │    T2+: ZK proof + guess       submit_turn ◀──────────────────┤      ║
  ║      │         ├─ verify ZK proof     ┌────────────────────────┐     │      ║
  ║      │         ├─ cross-check letters │ ♟ chess clock ticks    │     │      ║
  ║      │         ├─ validate guess      │   down for active      │     │      ║
  ║      │         └─ store results       │   player only          │     │      ║
  ║      │                                └────────────────────────┘     │      ║
  ║      │         ... alternating turns ...                             │      ║
  ╚══════╪═══════════════════════════════════════════════════════════════╪══════╝
         │                                                               │
  ╔══════╪═══════════════════════  END GAME  ════════════════════════════╪══════╗
  ║      │                                                               │      ║
  ║      │  🏆 win ──▶ reveal_word (ZK proof) ──▶ finalize + withdraw    │      ║
  ║      │  🤝 draw ─▶ both reveal_word_draw ──▶ each withdraws escrow   │      ║
  ║      │  🏳️ resign ──────────────────────────▶ opponent wins          │      ║
  ║      │  ⏱️ timeout ─▶ claim_timeout ────────▶ claimer wins           │      ║
  ║      │                                                               │      ║
  ╚══════╪═══════════════════════════════════════════════════════════════╪══════╝
```


## Architecture

| Layer | Tech | What It Does |
|-------|------|-------------|
| **Circuits** | [Noir](https://noir-lang.org/) | `circuit-word-guess/` — proves wordle feedback is correct given a committed word. `circuit-word-commit/` — proves the committed word exists in the dictionary (Poseidon2 Merkle proof inside ZK) |
| **On-chain verifier** | Rust / [UltraHonk](https://github.com/AztecProtocol/barretenberg) | `wordle-soroban-verifier/` — Soroban-compatible UltraHonk verification library, used by the main contract for both guess-result and word-commit proof verification |
| **Smart contract** | [Soroban](https://soroban.stellar.org/) (Rust) | `src/lib.rs` — two-player game state machine (create → join → active → reveal/draw → finalize), chess clock timer, XLM escrow, on-chain ZK proof & Merkle verification, game hub integration |
| **Frontend** | React · TypeScript · Tailwind CSS | `frontend/` — in-browser proof generation via `@aztec/bb.js` WASM + `@noir-lang/noir_js`, Freighter wallet integration, lobby system, real-time game UI |
| **Merkle tree** | Node.js | `js-scripts/` — precomputes Poseidon2 Merkle tree of 12,653 five-letter words (depth 14) |

## Key Design Decisions

- **CPU budget is tight**: On-chain UltraHonk verification uses ~400M of the 400M testnet CPU instruction limit. The frontend caps simulated instructions at the limit since simulation overestimates by ~0.1%.
- **Simplified duplicate-letter logic**: The circuit does *not* track "used" letters for duplicates (exact match → 2, letter exists anywhere → 1, absent → 0). This is intentional for circuit size constraints.
- **Hardcoded Merkle root**: The Poseidon2 Merkle root of the word dictionary is hardcoded in the contract — not passed at deploy time.
- **Chess clock timer**: Each player gets a 5-minute total time bank (`300s`). Time decreases only on your turns, and remaining time carries across turns.
- **Turn structure**: Max 13 turns (6 guesses per player + 1 final verification). Turn 1 is guess-only (no ZK proof needed); turns 2–12 combine ZK verification of the previous guess with a new guess; turn 13 is verify-only.
- **Game hub integration**: The contract notifies an external game hub contract on game start/end for cross-game tracking.

## Session Keys

Soroban contracts require a wallet signature for every transaction, which means **8–12+ Freighter popups per game**. Session keys reduce this to **just 2 popups** for the entire game.

### How It Works

1. **Create/Join game** — Freighter popup #1 (escrow deposit)
2. **Fund session key** — Freighter popup #2 (sends 9 XLM to a temporary keypair via `createAccount`)
3. **Register session key** — the funded keypair self-registers on-chain (silent, no popup)
4. **All gameplay** (submit turns, reveal word, resign, claim timeout, withdraw) — signed by the session key, **zero popups**
5. **Game ends** — the 9 XLM is automatically reclaimed back to the player's wallet via `accountMerge` (silent)

### Security Model

- Session keys **cannot steal funds**: the contract's `withdraw` function always resolves the session key back to the real player address via `resolve_caller_simple` before transferring tokens
- Session keys are **game-scoped**: each key is bound to a single `game_id` via bidirectional storage mappings (`key_session_key` / `key_session_reverse`)
- Session keys are **ephemeral**: stored in `sessionStorage` (cleared when the browser tab closes) and backed by Soroban temporary storage (auto-expires on-chain)
- **Funds auto-reclaim**: a `useEffect` in the frontend polls for game-over phase transitions and triggers `accountMerge` automatically for both winner and loser

## Quick Start

### Prerequisites

- [Rust](https://rustup.rs/) + `wasm32v1-none` target
- [Nargo](https://noir-lang.org/docs/getting_started/installation/) (Noir toolchain, ≥1.0.0-beta.9)
- [Barretenberg](https://github.com/AztecProtocol/aztec-packages) (`bb` CLI, v0.87.0)
- [Stellar CLI](https://developers.stellar.org/docs/tools/developer-tools/cli/stellar-cli)
- [Node.js](https://nodejs.org/) ≥ 18
- [Freighter wallet](https://www.freighter.app/) browser extension

### Build & Deploy

```bash
# 1. Build Noir circuits
cd circuit-word-guess && nargo compile && bb write_vk -b target/circuit.json \
  --scheme ultra_honk --oracle_hash keccak --output_format bytes_and_fields
cd ../circuit-word-commit && nargo compile && bb write_vk -b target/circuit.json \
  --scheme ultra_honk --oracle_hash keccak --output_format bytes_and_fields

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

## Contract API

| Function | Description |
|----------|-------------|
| `__constructor(vk_bytes, wc_vk_bytes)` | Stores both UltraHonk verification keys on-chain at deploy time |
| `create_game(game_id, player1, commitment1, token_addr, amount, wc_public_inputs, wc_proof_bytes)` | Creates a game lobby with word-commit ZK proof, records Poseidon2 commitment, optionally escrows XLM |
| `join_game(game_id, player2, commitment2, wc_public_inputs, wc_proof_bytes)` | Player 2 joins with their own commitment + word-commit proof; escrow is auto-matched from on-chain amount |
| `submit_turn(game_id, caller, my_guess_word, path_elements, path_indices, public_inputs, proof_bytes)` | Main game function — validates chess clock, Merkle proof for guess, cross-checks letters, verifies ZK proof |
| `reveal_word(game_id, caller, reveal_word, public_inputs, proof_bytes)` | Winner reveals their word via ZK proof (proves word matches commitment) to finalize the game |
| `reveal_word_draw(game_id, caller, reveal_word, public_inputs, proof_bytes)` | In a draw, each player reveals their word; must reveal before withdrawing |
| `resign(game_id, caller)` | Forfeit the game immediately; opponent wins |
| `claim_timeout(game_id, caller, reveal_word, public_inputs, proof_bytes)` | Claim timeout win when opponent's clock expires; bundles reveal + finalize in one tx |
| `withdraw(game_id, caller)` | Winner gets 2× escrow; in draw, each player gets their escrow back (must reveal first) |
| `register_session_key(game_id, player, session_key)` | Session key self-registers for silent gameplay; auth from session key, validates player is in game |
| `get_session_key(game_id, player)` | Returns the registered session key address for a player in a game |

<details>
<summary><strong>Query Functions</strong></summary>

| Function | Returns |
|----------|---------|
| `get_game_phase(game_id)` | Current phase (0=waiting, 1=active, 2=reveal, 3=finalized, 4=draw) |
| `get_game_turn(game_id)` | Current turn number |
| `get_game_deadline(game_id)` | Current turn deadline (Unix timestamp) |
| `get_last_guess(game_id)` | Last guess word bytes |
| `get_last_results(game_id)` | Last wordle results (5 bytes) |
| `get_player1(game_id)` / `get_player2(game_id)` | Player addresses |
| `get_winner(game_id)` | Winner address |
| `get_escrow_amount(game_id)` | Per-player escrow amount |
| `get_p1_time(game_id)` / `get_p2_time(game_id)` | Remaining chess clock time |
| `get_p1_revealed(game_id)` / `get_p2_revealed(game_id)` | Whether player has revealed their word |
| `get_p1_word(game_id)` / `get_p2_word(game_id)` | Revealed word (after reveal) |
| `get_game_count()` | Total games ever created |
| `get_game_id_at(index)` | Game ID at registry index |
| `get_game_creator(game_id)` | Creator (player 1) of a game |
| `verify_guess(guess_word, path_elements, path_indices)` | Standalone Merkle proof check |

</details>

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
| 8 | GuessWordMismatch | Guess letters or commitment don't match public inputs |
| 9 | GameExpired | Turn deadline has passed |
| 10 | NoActiveGame | No game found for given ID |
| 11 | GameAlreadyExists | Duplicate game creation |
| 12 | WrongPlayer | Caller isn't part of this game |
| 13 | WrongPhase | Action not valid in current phase |
| 14 | NotYourTurn | Out-of-turn guess attempt |
| 16 | AlreadyWithdrawn | Escrow already claimed |
| 17 | NotWinner | Withdrawal without winning |
| 18 | InvalidReveal | Revealed word doesn't match commitment |
| 19 | InvalidSessionKey | Session key is not registered for this game |

</details>

## Proof & Fee Specs

| Metric | Value |
|--------|-------|
| Raw proof size | 14,592 bytes (456 × 32) |
| Public inputs (guess circuit) | 352 bytes (11 fields × 32) |
| Public inputs (word-commit circuit) | 64 bytes (2 fields × 32) |
| Max fee (all transactions) | 1 XLM |
| Actual verification cost | ~0.36 XLM |

## Network Config

| Parameter | Value |
|-----------|-------|
| Network | Stellar Testnet |
| RPC | `https://stellar.liquify.com/api=41EEWAH79Y5OCGI7/testnet` |
| Passphrase | `Test SDF Network ; September 2015` |
| Native XLM SAC | `CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC` |