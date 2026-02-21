# Deployment Guide

## 1. Build the Contract (Optimized)

```bash
stellar contract build --optimize
```

## 2. Deploy to Testnet

The constructor requires two verification keys:
- `vk_bytes` — guess-result circuit VK (`circuit/target/vk`)
- `wc_vk_bytes` — word-commit circuit VK (`circuit-word-commit/target/vk`)

```bash
cd /Users/kaleab/Documents/zstellar-wordle && stellar contract deploy \
  --wasm target/wasm32v1-none/release/rs_soroban_ultrahonk.wasm \
  --network testnet \
  --source alice-testnet \
  -- \
  --vk_bytes "$(python3 -c "
import sys
data = open('circuit-word-guess/target/vk', 'rb').read()
sys.stdout.write(data.hex())
")" \
  --wc_vk_bytes "$(python3 -c "
import sys
data = open('circuit-word-commit/target/vk', 'rb').read()
sys.stdout.write(data.hex())
")"
```

## 3. Update Frontend Contract ID

After deployment, copy the new contract ID and update it in:

```
frontend/src/config.ts → CONTRACT_ID
```
