import * as StellarSdk from "@stellar/stellar-sdk";
import { CONTRACT_ID, RPC_URL, NETWORK_PASSPHRASE } from "./config";
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
 * Verify a proof on-chain via the Soroban UltraHonk verifier contract.
 *
 * Uses Freighter (or any compatible wallet) to sign the transaction
 * instead of requiring a raw secret key.
 */
export async function verifyProofOnChain(
  proofBlob: Uint8Array,
  vkBytes: Uint8Array,
  publicKey: string,
  signTx: SignTransaction,
  onStatus?: (msg: string) => void
): Promise<boolean> {
  const log = onStatus ?? console.log;

  log("Preparing Soroban transaction…");

  const server = getServer();
  const account = await server.getAccount(publicKey);

  const contract = new StellarSdk.Contract(CONTRACT_ID);

  const tx = new StellarSdk.TransactionBuilder(account, {
    fee: "10000000", // 1 XLM max fee (verification is CPU-expensive)
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(
      contract.call(
        "verify_proof",
        StellarSdk.xdr.ScVal.scvBytes(Buffer.from(vkBytes)),
        StellarSdk.xdr.ScVal.scvBytes(Buffer.from(proofBlob))
      )
    )
    .setTimeout(120)
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

  const preparedTx = StellarSdk.rpc.assembleTransaction(
    tx,
    simulated as StellarSdk.rpc.Api.SimulateTransactionSuccessResponse
  ).build();

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

  // Poll for result
  let result = await server.getTransaction(response.hash);
  while (result.status === "NOT_FOUND") {
    await new Promise((r) => setTimeout(r, 2000));
    result = await server.getTransaction(response.hash);
  }

  if (result.status === "SUCCESS") {
    log("On-chain verification succeeded ✅");
    log(`Transaction hash: ${response.hash}`);
    return true;
  } else {
    log("On-chain verification failed ❌");
    return false;
  }
}
