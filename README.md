# rs-soroban-ultrahonk

Verify Noir (UltraHonk) proofs on Stellar/Soroban. The verification key is set at deploy time; proofs are verified on-chain via `verify_proof`.

## Project structure

```
circuit/             ← Noir circuit (simple_circuit: assert x != y)
  src/main.nr
  Prover.toml
  Nargo.toml
src/lib.rs           ← Soroban contract wrapper
ultrahonk-soroban-verifier/  ← Pure verifier library
tests/
  build_circuits.sh  ← Builds circuit artifacts (vk, proof, public_inputs)
  integration_tests.rs
scripts/
  invoke_ultrahonk/  ← Helper to invoke verify_proof via CLI
  run_localnet_e2e.sh
```

## Quickstart (localnet)

### Prerequisites

- `stellar` CLI
- Rust + `wasm32v1-none` target
- Docker (for localnet)
- Noir tooling (`nargo 1.0.0-beta.9`) and `bb v0.87.0` (auto-installed by `build_circuits.sh`)

### 1. Build circuit artifacts

```bash
tests/build_circuits.sh
```

This generates `circuit/target/{vk, proof, public_inputs}`.

### 2. Start localnet

```bash
stellar container start -t future --name local --limits unlimited

stellar network add local \
  --rpc-url http://localhost:8000/soroban/rpc \
  --network-passphrase "Standalone Network ; February 2017"
stellar network use local

stellar keys generate alice
stellar keys fund alice --network local
```

### 3. Build & deploy contract

```bash
rustup target add wasm32v1-none
stellar contract build --optimize

stellar contract deploy \
  --wasm target/wasm32v1-none/release/rs_soroban_ultrahonk.wasm \
  --source alice \
  -- \
  --vk_bytes-file-path circuit/target/vk
```

### 4. Verify proof

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

## Tests

```bash
RUST_TEST_THREADS=1 cargo test --test integration_tests -- --nocapture
```

## References

- [Noir language](https://noir-lang.org/)
- [Barretenberg (bb)](https://github.com/AztecProtocol/aztec-packages)
- [Soroban documentation](https://developers.stellar.org/docs/build/smart-contracts)

## License

MIT
