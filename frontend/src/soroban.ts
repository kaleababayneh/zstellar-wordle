import * as StellarSdk from "@stellar/stellar-sdk";
import { CONTRACT_ID, RPC_URL, NETWORK_PASSPHRASE, NATIVE_TOKEN_ID, STROOPS_PER_XLM } from "./config";
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

// ── Helper: build, simulate, sign, submit, poll ──────────────────────────

async function buildSignSubmit(
  publicKey: string,
  signTx: SignTransaction,
  contractCall: StellarSdk.xdr.Operation,
  feeStroops: string,
  log: (msg: string) => void,
  capCpu: boolean = false
): Promise<StellarSdk.rpc.Api.GetSuccessfulTransactionResponse> {
  const server = getServer();
  const account = await server.getAccount(publicKey);

  const tx = new StellarSdk.TransactionBuilder(account, {
    fee: feeStroops,
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(contractCall)
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

  if (capCpu) {
    const sorobanXdr = simSuccess.transactionData.build();
    const res = sorobanXdr.resources();
    const simCpu = res.instructions();
    log(`CPU instructions: ${simCpu.toLocaleString()}`);
    const NETWORK_CPU_LIMIT = 400_000_000;
    if (simCpu > NETWORK_CPU_LIMIT) {
      log(`⚠️ Capping CPU from ${simCpu.toLocaleString()} → ${NETWORK_CPU_LIMIT.toLocaleString()}`);
      simSuccess.transactionData.setResources(
        NETWORK_CPU_LIMIT,
        res.diskReadBytes(),
        res.writeBytes()
      );
    }
  }

  const preparedTx = StellarSdk.rpc.assembleTransaction(tx, simSuccess).build();

  log("Please approve in Freighter…");
  const signedXdr = await signTx(preparedTx.toXDR(), NETWORK_PASSPHRASE);

  const signedTx = StellarSdk.TransactionBuilder.fromXDR(
    signedXdr,
    NETWORK_PASSPHRASE
  ) as StellarSdk.Transaction;

  log("Submitting to Stellar testnet…");
  const response = await server.sendTransaction(signedTx);

  if (response.status === "ERROR") {
    throw new Error("Transaction rejected by network");
  }

  log(`Tx accepted (hash: ${response.hash})`);

  let result = await server.getTransaction(response.hash);
  let attempts = 0;
  while (result.status === "NOT_FOUND") {
    if (attempts >= 60) throw new Error("Transaction not confirmed in time");
    attempts++;
    if (attempts % 5 === 0) log(`Waiting… (${attempts * 2}s)`);
    await new Promise((r) => setTimeout(r, 2000));
    result = await server.getTransaction(response.hash);
  }

  if (result.status !== "SUCCESS") {
    throw new Error("Transaction failed on-chain");
  }

  return result as StellarSdk.rpc.Api.GetSuccessfulTransactionResponse;
}

// ── Query helpers ──────────────────────────────────────────────────────────

async function queryContract(
  funcName: string,
  args: StellarSdk.xdr.ScVal[]
): Promise<StellarSdk.xdr.ScVal | null> {
  const server = getServer();
  const contract = new StellarSdk.Contract(CONTRACT_ID);

  // Use a dummy source account for view calls
  const dummyKey = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";
  let account;
  try {
    account = await server.getAccount(dummyKey);
  } catch {
    // If dummy doesn't work, the contract sim should still work
    account = new StellarSdk.Account(dummyKey, "0");
  }

  const tx = new StellarSdk.TransactionBuilder(account, {
    fee: "100",
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(contract.call(funcName, ...args))
    .setTimeout(30)
    .build();

  const sim = await server.simulateTransaction(tx);
  if (StellarSdk.rpc.Api.isSimulationError(sim)) return null;

  const success = sim as StellarSdk.rpc.Api.SimulateTransactionSuccessResponse;
  if (!success.result) return null;
  return success.result.retval;
}

/**
 * Query game state from the contract — all fields at once.
 */
export async function queryGameState(gameId: string): Promise<{
  phase: number;
  turn: number;
  deadline: number;
  p1Time: number;
  p2Time: number;
  lastGuess: string;
  lastResults: number[];
  winner: string;
  escrowAmount: number;
  p1Revealed: boolean;
  p2Revealed: boolean;
  p1Word: string;
  p2Word: string;
}> {
  const gameIdScVal = new StellarSdk.Address(gameId).toScVal();

  const [phaseVal, turnVal, deadlineVal, p1TimeVal, p2TimeVal, guessVal, resultsVal, winnerVal, escrowVal, p1RevVal, p2RevVal, p1WordVal, p2WordVal] =
    await Promise.all([
      queryContract("get_game_phase", [gameIdScVal]),
      queryContract("get_game_turn", [gameIdScVal]),
      queryContract("get_game_deadline", [gameIdScVal]),
      queryContract("get_p1_time", [gameIdScVal]),
      queryContract("get_p2_time", [gameIdScVal]),
      queryContract("get_last_guess", [gameIdScVal]),
      queryContract("get_last_results", [gameIdScVal]),
      queryContract("get_winner", [gameIdScVal]),
      queryContract("get_escrow_amount", [gameIdScVal]),
      queryContract("get_p1_revealed", [gameIdScVal]),
      queryContract("get_p2_revealed", [gameIdScVal]),
      queryContract("get_p1_word", [gameIdScVal]),
      queryContract("get_p2_word", [gameIdScVal]),
    ]);

  const phase = phaseVal ? phaseVal.value() as number : 255;
  const turn = turnVal ? turnVal.value() as number : 0;
  const deadline = deadlineVal ? Number(deadlineVal.value()) : 0;
  const p1Time = p1TimeVal ? Number(p1TimeVal.value()) : 0;
  const p2Time = p2TimeVal ? Number(p2TimeVal.value()) : 0;

  // Decode last guess bytes to string
  let lastGuess = "";
  if (guessVal) {
    try {
      const guessBytes = guessVal.value() as Buffer;
      if (guessBytes && guessBytes.length === 5) {
        lastGuess = String.fromCharCode(...Array.from(guessBytes));
      }
    } catch { /* empty */ }
  }

  // Decode results (5 bytes)
  let lastResults: number[] = [];
  if (resultsVal) {
    try {
      const resBytes = resultsVal.value() as Buffer;
      if (resBytes && resBytes.length > 0) {
        lastResults = Array.from(resBytes);
      }
    } catch { /* empty */ }
  }

  // Decode winner address
  let winner = "";
  if (winnerVal) {
    try {
      winner = StellarSdk.Address.fromScVal(winnerVal).toString();
    } catch { /* empty */ }
  }

  let escrowAmount = 0;
  if (escrowVal) {
    try {
      escrowAmount = Number(escrowVal.value());
    } catch { /* empty */ }
  }

  const p1Revealed = p1RevVal ? Boolean(p1RevVal.value()) : false;
  const p2Revealed = p2RevVal ? Boolean(p2RevVal.value()) : false;

  let p1Word = "";
  if (p1WordVal) {
    try {
      const wb = p1WordVal.value() as Buffer;
      if (wb && wb.length === 5) p1Word = String.fromCharCode(...Array.from(wb));
    } catch { /* empty */ }
  }
  let p2Word = "";
  if (p2WordVal) {
    try {
      const wb = p2WordVal.value() as Buffer;
      if (wb && wb.length === 5) p2Word = String.fromCharCode(...Array.from(wb));
    } catch { /* empty */ }
  }

  return { phase, turn, deadline, p1Time, p2Time, lastGuess, lastResults, winner, escrowAmount, p1Revealed, p2Revealed, p1Word, p2Word };
}

// ── Create Game (Player 1) ─────────────────────────────────────────────

/**
 * Player 1 creates a new game on-chain with commitment and escrow.
 */
export async function createGameOnChain(
  publicKey: string,
  signTx: SignTransaction,
  commitmentBytes: Uint8Array,
  escrowXlm: number,
  onStatus?: (msg: string) => void
): Promise<void> {
  const log = onStatus ?? console.log;
  const escrowStroops = BigInt(Math.round(escrowXlm * STROOPS_PER_XLM));
  log(escrowXlm > 0
    ? `Creating game on-chain (${escrowXlm} XLM escrow)…`
    : "Creating game on-chain…");

  const contract = new StellarSdk.Contract(CONTRACT_ID);

  await buildSignSubmit(
    publicKey,
    signTx,
    contract.call(
      "create_game",
      new StellarSdk.Address(publicKey).toScVal(),
      StellarSdk.xdr.ScVal.scvBytes(Buffer.from(commitmentBytes)),
      new StellarSdk.Address(NATIVE_TOKEN_ID).toScVal(),
      StellarSdk.nativeToScVal(escrowStroops, { type: "i128" })
    ),
    "10000000", // 1 XLM max fee
    log
  );

  log("Game created on-chain ✅");
}

// ── Join Game (Player 2) ───────────────────────────────────────────────

/**
 * Player 2 joins an existing game on-chain with their commitment.
 * Escrow is automatically matched from on-chain stored amount.
 */
export async function joinGameOnChain(
  gameId: string,
  publicKey: string,
  signTx: SignTransaction,
  commitmentBytes: Uint8Array,
  onStatus?: (msg: string) => void
): Promise<void> {
  const log = onStatus ?? console.log;
  log("Joining game on-chain…");

  const contract = new StellarSdk.Contract(CONTRACT_ID);

  await buildSignSubmit(
    publicKey,
    signTx,
    contract.call(
      "join_game",
      new StellarSdk.Address(gameId).toScVal(),
      new StellarSdk.Address(publicKey).toScVal(),
      StellarSdk.xdr.ScVal.scvBytes(Buffer.from(commitmentBytes)),
    ),
    "10000000",
    log
  );

  log("Joined game ✅");
}

// ── Submit Turn ────────────────────────────────────────────────────────

/**
 * Submit a turn on-chain.
 * Turn 1: just guess + Merkle proof (no ZK proof)
 * Turn 2+: ZK proof + new guess + Merkle proof
 * Turn 13: ZK proof only (verify-only, no new guess)
 */
export async function submitTurnOnChain(
  gameId: string,
  publicKey: string,
  signTx: SignTransaction,
  guessWordBytes: Uint8Array,
  pathElementsBytes: Uint8Array[],
  pathIndices: number[],
  publicInputsBytes: Uint8Array,
  proofBytes: Uint8Array,
  onStatus?: (msg: string) => void
): Promise<void> {
  const log = onStatus ?? console.log;
  log("Submitting turn on-chain…");

  const contract = new StellarSdk.Contract(CONTRACT_ID);

  // Build Merkle path elements
  const pathElementsScVal = StellarSdk.xdr.ScVal.scvVec(
    pathElementsBytes.map((el) =>
      StellarSdk.xdr.ScVal.scvBytes(Buffer.from(el))
    )
  );

  // Build path indices
  const pathIndicesScVal = StellarSdk.xdr.ScVal.scvVec(
    pathIndices.map((idx) =>
      StellarSdk.nativeToScVal(idx, { type: "u32" })
    )
  );

  const needsCpuCap = publicInputsBytes.length > 0; // turn 2+ has ZK proof

  await buildSignSubmit(
    publicKey,
    signTx,
    contract.call(
      "submit_turn",
      new StellarSdk.Address(gameId).toScVal(),
      new StellarSdk.Address(publicKey).toScVal(),
      StellarSdk.xdr.ScVal.scvBytes(Buffer.from(guessWordBytes)),
      pathElementsScVal,
      pathIndicesScVal,
      StellarSdk.xdr.ScVal.scvBytes(Buffer.from(publicInputsBytes)),
      StellarSdk.xdr.ScVal.scvBytes(Buffer.from(proofBytes))
    ),
    needsCpuCap ? "1000000000" : "10000000", // 100 XLM for ZK, 1 XLM otherwise
    log,
    needsCpuCap
  );

  log("Turn submitted ✅");
}

// ── Reveal Word ────────────────────────────────────────────────────────

/**
 * Winner reveals their word: ZK proof (guessing own word) + Merkle proof.
 */
export async function revealWordOnChain(
  gameId: string,
  publicKey: string,
  signTx: SignTransaction,
  revealWordBytes: Uint8Array,
  pathElementsBytes: Uint8Array[],
  pathIndices: number[],
  publicInputsBytes: Uint8Array,
  proofBytes: Uint8Array,
  onStatus?: (msg: string) => void
): Promise<void> {
  const log = onStatus ?? console.log;
  log("Revealing word on-chain…");

  const contract = new StellarSdk.Contract(CONTRACT_ID);

  const pathElementsScVal = StellarSdk.xdr.ScVal.scvVec(
    pathElementsBytes.map((el) =>
      StellarSdk.xdr.ScVal.scvBytes(Buffer.from(el))
    )
  );

  const pathIndicesScVal = StellarSdk.xdr.ScVal.scvVec(
    pathIndices.map((idx) =>
      StellarSdk.nativeToScVal(idx, { type: "u32" })
    )
  );

  await buildSignSubmit(
    publicKey,
    signTx,
    contract.call(
      "reveal_word",
      new StellarSdk.Address(gameId).toScVal(),
      new StellarSdk.Address(publicKey).toScVal(),
      StellarSdk.xdr.ScVal.scvBytes(Buffer.from(revealWordBytes)),
      pathElementsScVal,
      pathIndicesScVal,
      StellarSdk.xdr.ScVal.scvBytes(Buffer.from(publicInputsBytes)),
      StellarSdk.xdr.ScVal.scvBytes(Buffer.from(proofBytes))
    ),
    "1000000000", // 100 XLM max fee (ZK proof)
    log,
    true
  );

  log("Word revealed ✅");
}

// ── Reveal Word (Draw) ─────────────────────────────────────────────────

/**
 * In a draw, each player reveals their word: ZK proof (guessing own word) + Merkle proof.
 * Must reveal before being allowed to withdraw.
 */
export async function revealWordDrawOnChain(
  gameId: string,
  publicKey: string,
  signTx: SignTransaction,
  revealWordBytes: Uint8Array,
  pathElementsBytes: Uint8Array[],
  pathIndices: number[],
  publicInputsBytes: Uint8Array,
  proofBytes: Uint8Array,
  onStatus?: (msg: string) => void
): Promise<void> {
  const log = onStatus ?? console.log;
  log("Revealing word for draw on-chain…");

  const contract = new StellarSdk.Contract(CONTRACT_ID);

  const pathElementsScVal = StellarSdk.xdr.ScVal.scvVec(
    pathElementsBytes.map((el) =>
      StellarSdk.xdr.ScVal.scvBytes(Buffer.from(el))
    )
  );

  const pathIndicesScVal = StellarSdk.xdr.ScVal.scvVec(
    pathIndices.map((idx) =>
      StellarSdk.nativeToScVal(idx, { type: "u32" })
    )
  );

  await buildSignSubmit(
    publicKey,
    signTx,
    contract.call(
      "reveal_word_draw",
      new StellarSdk.Address(gameId).toScVal(),
      new StellarSdk.Address(publicKey).toScVal(),
      StellarSdk.xdr.ScVal.scvBytes(Buffer.from(revealWordBytes)),
      pathElementsScVal,
      pathIndicesScVal,
      StellarSdk.xdr.ScVal.scvBytes(Buffer.from(publicInputsBytes)),
      StellarSdk.xdr.ScVal.scvBytes(Buffer.from(proofBytes))
    ),
    "1000000000", // 100 XLM max fee (ZK proof)
    log,
    true
  );

  log("Word revealed for draw ✅");
}

// ── Claim Timeout ──────────────────────────────────────────────────────

/**
 * Claim a timeout win when the opponent doesn't play in time.
 */
export async function claimTimeoutOnChain(
  gameId: string,
  publicKey: string,
  signTx: SignTransaction,
  onStatus?: (msg: string) => void
): Promise<void> {
  const log = onStatus ?? console.log;
  log("Claiming timeout…");

  const contract = new StellarSdk.Contract(CONTRACT_ID);

  await buildSignSubmit(
    publicKey,
    signTx,
    contract.call(
      "claim_timeout",
      new StellarSdk.Address(gameId).toScVal(),
      new StellarSdk.Address(publicKey).toScVal()
    ),
    "10000000",
    log
  );

  log("Timeout claimed ✅");
}

// ── Withdraw ───────────────────────────────────────────────────────────

/**
 * Withdraw escrow after game ends.
 */
export async function withdrawEscrow(
  gameId: string,
  publicKey: string,
  signTx: SignTransaction,
  onStatus?: (msg: string) => void
): Promise<void> {
  const log = onStatus ?? console.log;
  log("Withdrawing escrow…");

  const contract = new StellarSdk.Contract(CONTRACT_ID);

  await buildSignSubmit(
    publicKey,
    signTx,
    contract.call(
      "withdraw",
      new StellarSdk.Address(gameId).toScVal(),
      new StellarSdk.Address(publicKey).toScVal()
    ),
    "10000000",
    log
  );

  log("Escrow withdrawn ✅");
}

