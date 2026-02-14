# ZK Wordle on Stellar — Session Handoff

## Project Overview

A **ZK Wordle** game where guesses are proven in-browser using Noir/UltraHonk and verified on-chain via a Soroban smart contract on the Stellar testnet.

**Stack**: Noir circuits → UltraHonk proofs (via `@aztec/bb.js`) → Soroban smart contract (Rust) → Stellar testnet

**Flow**:
1. User guesses a 5-letter word in the browser UI
2. Browser generates a ZK proof using Noir circuit + Barretenberg WASM
3. Proof + public inputs are submitted to a Soroban contract via Freighter wallet
4. Contract verifies the UltraHonk proof on-chain against a stored verification key (VK)

## Key Files

| File | Purpose |
|------|---------|
| `circuit/src/main.nr` | Noir circuit — wordle logic + Poseidon2 commitment |
| `src/lib.rs` | Soroban contract — calls `ultrahonk_soroban_verifier` |
| `frontend/src/soroban.ts` | Transaction building, simulation, resource capping, submission |
| `frontend/src/generateProof.ts` | Browser-side proof generation via `@aztec/bb.js` |
| `frontend/src/gameLogic.ts` | Wordle result calculation (must match circuit exactly) |
| `frontend/src/config.ts` | Contract ID, RPC URL, secret word ("apple"), commitment hash |
| `frontend/src/App.tsx` | React UI — connects wallet, generates proof, verifies on-chain |

## What We Fixed

### 1. Soroban `txSorobanInvalid` (-17) — CPU Instructions Exceed Network Limit

**Problem**: The UltraHonk proof verification requires ~400.4M CPU instructions. The Stellar testnet limit is exactly 400,000,000. The Soroban RPC simulation overestimates by ~0.1% (safety margin), pushing the declared instructions over the network limit.

**Why CLI worked but frontend didn't**: The `stellar contract invoke` CLI caps instruction counts at the network limit internally. Our frontend was using the raw simulation value.

**Fix** in `frontend/src/soroban.ts`:
```typescript
const NETWORK_CPU_LIMIT = 400_000_000;
if (simCpu > NETWORK_CPU_LIMIT) {
  simSuccess.transactionData.setResources(
    NETWORK_CPU_LIMIT,
    res.diskReadBytes(),
    res.writeBytes()
  );
}
```

**Things that did NOT work** (tried before finding the real issue):
- Bumping CPU by 25% or 3x → made it worse (exceeded limit more)
- Bumping resource fee via `setResourceFee()` → caused inner fee > outer tx fee mismatch
- Raising outer transaction fee to 100 XLM → fee was never the issue, it's a hard CPU cap

**Diagnostic logging**: Added `diagnosticEvents` and `errorResult` logging to `sendTransaction` error handler. This revealed the exact error message: *"transaction instructions resources exceed network config limit"*.

### 2. "Cannot satisfy constraint" — Wordle Logic Mismatch

**Problem**: The Noir circuit's wordle logic does NOT track "used" letters for duplicate handling. It simply checks: exact match → 2, letter exists anywhere in word → 1, absent → 0.

The frontend was using standard Wordle two-pass logic that marks letters as consumed. For guesses with duplicate letters (e.g., "hello" vs secret word "apple"), the results differ:
- **Circuit expects**: `[0, 1, 1, 2, 0]` — both `l`s get 🟨/🟩 because `l` exists in "apple"
- **Frontend computed**: `[0, 1, 0, 2, 0]` — first `l` gets ⬛ because the `l` in "apple" is "used" by the second `l`

The circuit's `assert(calculated_result == result_array)` fails → "Cannot satisfy constraint".

**Fix** in `frontend/src/gameLogic.ts`: Rewrote `calculateWordleResults` to match the circuit's simpler logic (no used-letter tracking).

> [!WARNING]
> This means the game's wordle behavior differs from standard Wordle for duplicate letters. If you want standard Wordle behavior, update the Noir circuit's logic instead.

## Configuration

- **Contract ID**: `CCC3BEXJHMLDWIJWFBK36V7K7ZOPYPVSXWTI5ZICSIVTLZN5OHMAFWY3`
- **Secret word**: "apple" (hardcoded in `config.ts` for hackathon; the commitment hash is baked into the VK)
- **Testnet RPC**: `https://soroban-testnet.stellar.org`
- **Network passphrase**: `Test SDF Network ; September 2015`

## Important Constraints

1. **CPU Budget**: The contract uses ~400M of the 400M testnet CPU limit. Any circuit changes that increase computation will break on-chain verification.
2. **Proof size**: Raw proof is 14,592 bytes (456 × 32). There's also a `proofBlob` format (header + publicInputs + proof) used for reference but NOT sent to the contract.
3. **The contract receives**: `public_inputs` (352 bytes, 11 fields) and `proof_bytes` (14,592 bytes) as separate `Bytes` arguments. VK is stored on-chain at deploy time.
4. **Fee**: Set to 100 XLM max fee to ensure it covers the heavy computation. The actual fee charged is ~0.36 XLM.

## Verified Transaction

Successfully submitted and verified: [`def26b02d166d4b14c298bfb03322484d03c37cd528ae928477372f87957b71e`](https://stellar.expert/explorer/testnet/tx/def26b02d166d4b14c298bfb03322484d03c37cd528ae928477372f87957b71e)
