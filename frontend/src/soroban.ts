import * as StellarSdk from "@stellar/stellar-sdk";
import { CONTRACT_ID, RPC_URL, NETWORK_PASSPHRASE, GAME_DURATION_MS } from "./config";
import { Buffer } from "buffer";

let _server: StellarSdk.rpc.Server | null = null;
function getServer() {
  if (!_server) _server = new StellarSdk.rpc.Server(RPC_URL);
  return _server;
}

/**
 * Sign callback type — matches Freighter's signTransaction shape.
 */
export type SignTransaction = (
  xdr: string,
  networkPassphrase: string
) => Promise<string>;

/**
 * Create a game on-chain. Records deadline = ledger_timestamp + 5 min.
 * Returns the local deadline (Date.now() + 5 min) for UI countdown.
 */
export async function createGameOnChain(
  publicKey: string,
  signTx: SignTransaction,
  onStatus?: (msg: string) => void
): Promise<number> {
  const log = onStatus ?? console.log;
  log("Registering game timer on-chain (5 min)…");

  const server = getServer();
  const account = await server.getAccount(publicKey);
  const contract = new StellarSdk.Contract(CONTRACT_ID);

  const tx = new StellarSdk.TransactionBuilder(account, {
    fee: "10000000",
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(
      contract.call(
        "create_game",
        new StellarSdk.Address(publicKey).toScVal()
      )
    )
    .setTimeout(60)
    .build();

  log("Simulating create_game…");
  const simulated = await server.simulateTransaction(tx);

  if (StellarSdk.rpc.Api.isSimulationError(simulated)) {
    const errMsg =
      "error" in simulated
        ? (simulated as any).error
        : JSON.stringify(simulated);
    throw new Error(`Simulation failed: ${errMsg}`);
  }

  const simSuccess = simulated as StellarSdk.rpc.Api.SimulateTransactionSuccessResponse;
  const preparedTx = StellarSdk.rpc.assembleTransaction(tx, simSuccess).build();

  log("Please approve the game creation in Freighter…");
  const signedXdr = await signTx(preparedTx.toXDR(), NETWORK_PASSPHRASE);

  const signedTx = StellarSdk.TransactionBuilder.fromXDR(
    signedXdr,
    NETWORK_PASSPHRASE
  ) as StellarSdk.Transaction;

  log("Submitting create_game to Stellar testnet…");
  const response = await server.sendTransaction(signedTx);

  if (response.status === "ERROR") {
    throw new Error("Transaction rejected by network");
  }

  // Poll for result
  let result = await server.getTransaction(response.hash);
  let attempts = 0;
  while (result.status === "NOT_FOUND") {
    if (attempts >= 30) {
      throw new Error("create_game transaction not confirmed in time");
    }
    attempts++;
    await new Promise((r) => setTimeout(r, 2000));
    result = await server.getTransaction(response.hash);
  }

  if (result.status !== "SUCCESS") {
    throw new Error("create_game transaction failed on-chain");
  }

  // Return local deadline for UI countdown
  const deadline = Date.now() + GAME_DURATION_MS;
  log("Game timer registered on-chain ✅");
  return deadline;
}

/**
 * Verify a proof on-chain via the Soroban UltraHonk verifier contract.
 *
 * The deployed contract interface:
 *   verify_proof(public_inputs: Bytes, proof_bytes: Bytes) -> Result<(), Error>
 *   VK is already stored on-chain at deploy time.
 *
 * Uses Freighter (or any compatible wallet) to sign the transaction.
 */
export async function verifyProofOnChain(
  publicInputsBytes: Uint8Array,
  proofBytes: Uint8Array,
  publicKey: string,
  signTx: SignTransaction,
  onStatus?: (msg: string) => void
): Promise<boolean> {
  const log = onStatus ?? console.log;

  log("Preparing Soroban transaction…");
  log(`Proof size: ${proofBytes.length} bytes, Public inputs: ${publicInputsBytes.length} bytes`);

  const server = getServer();
  const account = await server.getAccount(publicKey);

  const contract = new StellarSdk.Contract(CONTRACT_ID);

  const tx = new StellarSdk.TransactionBuilder(account, {
    fee: "1000000000", // 100 XLM max fee — ZK verification is extremely heavy
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(
      contract.call(
        "verify_proof",
        StellarSdk.xdr.ScVal.scvBytes(Buffer.from(publicInputsBytes)),
        StellarSdk.xdr.ScVal.scvBytes(Buffer.from(proofBytes))
      )
    )
    .setTimeout(300)
    .build();

  log("Simulating transaction…");
  const simulated = await server.simulateTransaction(tx);

  if (StellarSdk.rpc.Api.isSimulationError(simulated)) {
    const errMsg =
      "error" in simulated
        ? (simulated as any).error
        : JSON.stringify(simulated);
    throw new Error(`Simulation failed: ${errMsg}`);
  }

  const simSuccess = simulated as StellarSdk.rpc.Api.SimulateTransactionSuccessResponse;

  // Log simulation resource details
  const sorobanXdr = simSuccess.transactionData.build();
  const res = sorobanXdr.resources();
  const simCpu = res.instructions();
  log(`Simulation resources:`);
  log(`  CPU instructions: ${simCpu.toLocaleString()}`);
  log(`  Disk read bytes: ${res.diskReadBytes().toLocaleString()}`);
  log(`  Write bytes: ${res.writeBytes().toLocaleString()}`);
  log(`  Min resource fee: ${simSuccess.minResourceFee}`);

  // The Soroban testnet CPU limit is 400,000,000 instructions.
  // Simulation overestimates by ~0.1% (safety margin), which pushes us over.
  // The stellar CLI works because it caps instructions at the network limit.
  // Actual execution uses fewer instructions than the simulation estimate,
  // so capping at the limit is safe.
  const NETWORK_CPU_LIMIT = 400_000_000;
  if (simCpu > NETWORK_CPU_LIMIT) {
    log(`⚠️ Capping CPU from ${simCpu.toLocaleString()} → ${NETWORK_CPU_LIMIT.toLocaleString()} (network limit)`);
    simSuccess.transactionData.setResources(
      NETWORK_CPU_LIMIT,
      res.diskReadBytes(),
      res.writeBytes()
    );
  }

  const preparedTx = StellarSdk.rpc.assembleTransaction(tx, simSuccess).build();

  // Sign via Freighter wallet extension
  log("Please approve the transaction in Freighter…");
  const signedXdr = await signTx(
    preparedTx.toXDR(),
    NETWORK_PASSPHRASE
  );

  const signedTx = StellarSdk.TransactionBuilder.fromXDR(
    signedXdr,
    NETWORK_PASSPHRASE
  ) as StellarSdk.Transaction;

  log("Submitting to Stellar testnet…");
  const response = await server.sendTransaction(signedTx);

  // Check if the network immediately rejected the transaction
  if (response.status === "ERROR") {
    // Log diagnostic events for debugging
    const sendResp = response as StellarSdk.rpc.Api.SendTransactionResponse;
    if (sendResp.diagnosticEvents && sendResp.diagnosticEvents.length > 0) {
      log(`⚠️ Diagnostic events (${sendResp.diagnosticEvents.length}):`);
      for (const evt of sendResp.diagnosticEvents) {
        try {
          log(`  ${evt.toXDR("base64")}`);
        } catch {
          log(`  (could not serialize event)`);
        }
      }
    }
    if (sendResp.errorResult) {
      log(`Error result: ${sendResp.errorResult.toXDR("base64")}`);
    }
    throw new Error(
      `Transaction rejected by network (${(sendResp.errorResult as any)?._attributes?.result?._switch?.name ?? "unknown"})`
    );
  }
  log(`Transaction accepted (status: ${response.status}, hash: ${response.hash})`);

  // Poll for result with progress indicator and timeout
  const MAX_POLL_ATTEMPTS = 60; // 120 seconds max
  let result = await server.getTransaction(response.hash);
  let attempts = 0;
  while (result.status === "NOT_FOUND") {
    if (attempts >= MAX_POLL_ATTEMPTS) {
      throw new Error(
        `Transaction not confirmed after ${MAX_POLL_ATTEMPTS * 2}s. ` +
        `Hash: ${response.hash} — check https://stellar.expert/explorer/testnet/tx/${response.hash}`
      );
    }
    attempts++;
    log(`Waiting for network to include transaction… (${attempts * 2}s)`);
    await new Promise((r) => setTimeout(r, 2000));
    result = await server.getTransaction(response.hash);
  }

  if (result.status === "SUCCESS") {
    log("On-chain verification succeeded ✅");
    log(`Transaction hash: ${response.hash}`);
    return true;
  } else {
    log("On-chain verification failed ❌");
    // Log failure diagnostic events
    const failResult = result as StellarSdk.rpc.Api.GetFailedTransactionResponse;
    if (failResult.diagnosticEventsXdr) {
      log(`Failure diagnostics (${failResult.diagnosticEventsXdr.length} events):`);
      for (const evt of failResult.diagnosticEventsXdr) {
        try {
          log(`  ${evt.toXDR("base64")}`);
        } catch {
          log(`  (could not serialize)`);
        }
      }
    }
    return false;
  }
}

/**
 * Combined: verify the guess word is in the dictionary AND verify the ZK proof.
 * Single Soroban transaction calling verify_guess_and_proof.
 */
export async function verifyGuessAndProofOnChain(
  guessWordBytes: Uint8Array,
  pathElementsBytes: Uint8Array[],
  pathIndices: number[],
  publicInputsBytes: Uint8Array,
  proofBytes: Uint8Array,
  publicKey: string,
  signTx: SignTransaction,
  onStatus?: (msg: string) => void
): Promise<boolean> {
  const log = onStatus ?? console.log;

  log("Preparing combined Merkle + ZK verification transaction…");
  log(`Proof: ${proofBytes.length}B, Public inputs: ${publicInputsBytes.length}B, Merkle path: ${pathElementsBytes.length} elements`);

  const server = getServer();
  const account = await server.getAccount(publicKey);
  const contract = new StellarSdk.Contract(CONTRACT_ID);

  // Build Soroban Vec<BytesN<32>> for path elements
  const pathElementsScVal = StellarSdk.xdr.ScVal.scvVec(
    pathElementsBytes.map((el) =>
      StellarSdk.xdr.ScVal.scvBytes(Buffer.from(el))
    )
  );

  // Build Soroban Vec<u32> for path indices
  const pathIndicesScVal = StellarSdk.xdr.ScVal.scvVec(
    pathIndices.map((idx) =>
      StellarSdk.nativeToScVal(idx, { type: "u32" })
    )
  );

  const tx = new StellarSdk.TransactionBuilder(account, {
    fee: "1000000000", // 100 XLM max fee
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(
      contract.call(
        "verify_guess_and_proof",
        new StellarSdk.Address(publicKey).toScVal(),
        StellarSdk.xdr.ScVal.scvBytes(Buffer.from(guessWordBytes)),
        pathElementsScVal,
        pathIndicesScVal,
        StellarSdk.xdr.ScVal.scvBytes(Buffer.from(publicInputsBytes)),
        StellarSdk.xdr.ScVal.scvBytes(Buffer.from(proofBytes))
      )
    )
    .setTimeout(300)
    .build();

  log("Simulating transaction…");
  const simulated = await server.simulateTransaction(tx);

  if (StellarSdk.rpc.Api.isSimulationError(simulated)) {
    const errMsg =
      "error" in simulated
        ? (simulated as any).error
        : JSON.stringify(simulated);
    throw new Error(`Simulation failed: ${errMsg}`);
  }

  const simSuccess = simulated as StellarSdk.rpc.Api.SimulateTransactionSuccessResponse;

  // Log simulation resource details
  const sorobanXdr = simSuccess.transactionData.build();
  const res = sorobanXdr.resources();
  const simCpu = res.instructions();
  log(`Simulation resources:`);
  log(`  CPU instructions: ${simCpu.toLocaleString()}`);
  log(`  Disk read bytes: ${res.diskReadBytes().toLocaleString()}`);
  log(`  Write bytes: ${res.writeBytes().toLocaleString()}`);
  log(`  Min resource fee: ${simSuccess.minResourceFee}`);

  // Cap CPU at network limit (same fix as verify_proof)
  const NETWORK_CPU_LIMIT = 400_000_000;
  if (simCpu > NETWORK_CPU_LIMIT) {
    log(`⚠️ Capping CPU from ${simCpu.toLocaleString()} → ${NETWORK_CPU_LIMIT.toLocaleString()} (network limit)`);
    simSuccess.transactionData.setResources(
      NETWORK_CPU_LIMIT,
      res.diskReadBytes(),
      res.writeBytes()
    );
  }

  const preparedTx = StellarSdk.rpc.assembleTransaction(tx, simSuccess).build();

  log("Please approve the transaction in Freighter…");
  const signedXdr = await signTx(
    preparedTx.toXDR(),
    NETWORK_PASSPHRASE
  );

  const signedTx = StellarSdk.TransactionBuilder.fromXDR(
    signedXdr,
    NETWORK_PASSPHRASE
  ) as StellarSdk.Transaction;

  log("Submitting to Stellar testnet…");
  const response = await server.sendTransaction(signedTx);

  if (response.status === "ERROR") {
    const sendResp = response as StellarSdk.rpc.Api.SendTransactionResponse;
    if (sendResp.diagnosticEvents && sendResp.diagnosticEvents.length > 0) {
      log(`⚠️ Diagnostic events (${sendResp.diagnosticEvents.length}):`);
      for (const evt of sendResp.diagnosticEvents) {
        try {
          log(`  ${evt.toXDR("base64")}`);
        } catch {
          log(`  (could not serialize event)`);
        }
      }
    }
    if (sendResp.errorResult) {
      log(`Error result: ${sendResp.errorResult.toXDR("base64")}`);
    }
    throw new Error(
      `Transaction rejected by network (${(sendResp.errorResult as any)?._attributes?.result?._switch?.name ?? "unknown"})`
    );
  }
  log(`Transaction accepted (status: ${response.status}, hash: ${response.hash})`);

  // Poll for result
  const MAX_POLL_ATTEMPTS = 60;
  let result = await server.getTransaction(response.hash);
  let attempts = 0;
  while (result.status === "NOT_FOUND") {
    if (attempts >= MAX_POLL_ATTEMPTS) {
      throw new Error(
        `Transaction not confirmed after ${MAX_POLL_ATTEMPTS * 2}s. ` +
        `Hash: ${response.hash}`
      );
    }
    attempts++;
    log(`Waiting for network to include transaction… (${attempts * 2}s)`);
    await new Promise((r) => setTimeout(r, 2000));
    result = await server.getTransaction(response.hash);
  }

  if (result.status === "SUCCESS") {
    log("On-chain Merkle + ZK verification succeeded ✅");
    log(`Transaction hash: ${response.hash}`);
    return true;
  } else {
    log("On-chain verification failed ❌");
    const failResult = result as StellarSdk.rpc.Api.GetFailedTransactionResponse;
    if (failResult.diagnosticEventsXdr) {
      log(`Failure diagnostics (${failResult.diagnosticEventsXdr.length} events):`);
      for (const evt of failResult.diagnosticEventsXdr) {
        try {
          log(`  ${evt.toXDR("base64")}`);
        } catch {
          log(`  (could not serialize)`);
        }
      }
    }
    return false;
  }
}

