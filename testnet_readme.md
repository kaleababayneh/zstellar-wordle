# Deploying to Stellar Testnet

## 1. Build circuit artifacts

```bash
tests/build_circuits.sh
```

## 2. Build contract

```bash
rustup target add wasm32v1-none
stellar contract build --optimize
```

## 3. Configure testnet & fund account

```bash
stellar network add testnet \
  --rpc-url https://soroban-testnet.stellar.org \
  --network-passphrase "Test SDF Network ; September 2015"
stellar network use testnet

stellar keys generate alice-testnet
stellar keys fund alice-testnet --network testnet
```

## 4. Deploy

```bash
stellar contract deploy \
  --wasm target/wasm32v1-none/release/rs_soroban_ultrahonk.wasm \
  --source alice-testnet \
  --network testnet \
  -- \
  --vk_bytes-file-path circuit/target/vk
```

## 5. Verify proof

```bash
stellar contract invoke \
  --id <CONTRACT_ID> \
  --source alice-testnet \
  --network testnet \
  --send yes \
  -- \
  verify_proof \
  --public_inputs-file-path circuit/target/public_inputs \
  --proof_bytes-file-path circuit/target/proof
```

Returns `null` on success.
