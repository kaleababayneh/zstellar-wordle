# From Noir Circuit to On-Chain Verification

End-to-end: write a Noir Wordle circuit, generate a proof, and verify it on Soroban.

---

## 1. The Circuit

`circuit/src/main.nr` — a ZK Wordle verifier. The game host commits to a secret word via a Poseidon2 hash. A player submits a guess, and the circuit proves the result feedback (correct/wrong-position/absent) is honest — without revealing the secret word.

```noir
fn main(
    commitment_hashes: pub Field,       // Poseidon2 hash of [salt, letters...]
    first_letter_guess: pub Field,      // Player's guess (ASCII)
    second_letter_guess: pub Field,
    third_letter_guess: pub Field,
    fourth_letter_guess: pub Field,
    fifth_letter_guess: pub Field,
    calculated_result: pub [u8; 5],     // 2=correct, 1=wrong position, 0=absent
    first_letter: Field,                // Private: actual word letters
    second_letter: Field,
    third_letter: Field,
    fourth_letter: Field,
    fifth_letter: Field,
    salt: Field,                        // Private: salt for commitment
)
```

`circuit/Prover.toml` — example: word is "apple", guess is "appao":

```toml
# Private inputs (never go on-chain)
first_letter  = "97"   # a
second_letter = "112"  # p
third_letter  = "112"  # p
fourth_letter = "108"  # l
fifth_letter  = "101"  # e
salt = "0"

# Public inputs
commitment_hashes = "0x042cf71f..."  # Poseidon2([salt, a, p, p, l, e])
first_letter_guess  = "97"   # a
second_letter_guess = "112"  # p
third_letter_guess  = "112"  # p
fourth_letter_guess = "97"   # a
fifth_letter_guess  = "111"  # o
calculated_result = [2, 2, 2, 1, 0]  # a✓ p✓ p✓ a~ o✗
```

## 2. Build ZK Artifacts

Install Noir (`nargo`) and Barretenberg (`bb`), then generate the verification key, proof, and public inputs:

```bash
tests/build_circuits.sh
```

Outputs in `circuit/target/`:
- `vk` — verification key (embedded in the contract at deploy)
- `proof` — the proof blob
- `public_inputs` — serialized public inputs (commitment hash, guess letters, result feedback)

## 3. Build the Soroban Contract

```bash
rustup target add wasm32v1-none
stellar contract build --optimize
```

Produces `target/wasm32v1-none/release/rs_soroban_ultrahonk.wasm`.

## 4. Start Localnet & Fund Account

```bash
stellar container start -t future --name local --limits unlimited

stellar network add local \
  --rpc-url http://localhost:8000/soroban/rpc \
  --network-passphrase "Standalone Network ; February 2017"
stellar network use local

stellar keys generate alice
stellar keys fund alice --network local
```

## 5. Deploy (VK baked in at deploy)

```bash
stellar contract deploy \
  --wasm target/wasm32v1-none/release/rs_soroban_ultrahonk.wasm \
  --source alice \
  -- \
  --vk_bytes-file-path circuit/target/vk
```

Save the returned `CONTRACT_ID`.

## 6. Verify Proof On-Chain

```bash
stellar contract invoke \
  --id <CONTRACT_ID> \
  --source alice \
  --network local \
  --send yes \
  -- \
  verify_proof \
  --public_inputs-file-path circuit/target/public_inputs \
  --proof_bytes-file-path circuit/target/proof
```

Returns `null` (success) — the Wordle result feedback is verified on-chain without revealing the secret word.

---

**That's it.** Write circuit → generate proof → deploy contract → verify on Soroban.
