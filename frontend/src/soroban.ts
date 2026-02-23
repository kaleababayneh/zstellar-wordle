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
    fee: "10",
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
    } catch {
      // Fallback: try reading as raw string/bytes
      try {
        const raw = winnerVal.value();
        if (raw && typeof raw === "string" && raw.length > 0) {
          winner = raw;
        }
      } catch { /* empty */ }
    }
  }

  let escrowAmount = 0;
  if (escrowVal) {
    try {
      // i128 ScVal cannot be converted with Number(val.value()) — use scValToBigInt
      escrowAmount = Number(StellarSdk.scValToBigInt(escrowVal));
    } catch {
      try {
        escrowAmount = Number(escrowVal.value());
      } catch { /* empty */ }
    }
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
 * game_id is a unique identifier generated by the frontend.
 */
export async function createGameOnChain(
  gameId: string,
  publicKey: string,
  signTx: SignTransaction,
  commitmentBytes: Uint8Array,
  escrowXlm: number,
  wcPublicInputsBytes: Uint8Array,
  wcProofBytes: Uint8Array,
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
      new StellarSdk.Address(gameId).toScVal(),
      new StellarSdk.Address(publicKey).toScVal(),
      StellarSdk.xdr.ScVal.scvBytes(Buffer.from(commitmentBytes)),
      new StellarSdk.Address(NATIVE_TOKEN_ID).toScVal(),
      StellarSdk.nativeToScVal(escrowStroops, { type: "i128" }),
      StellarSdk.xdr.ScVal.scvBytes(Buffer.from(wcPublicInputsBytes)),
      StellarSdk.xdr.ScVal.scvBytes(Buffer.from(wcProofBytes))
    ),
    "10000000", // 1 XLM max fee
    log,
    true
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
  wcPublicInputsBytes: Uint8Array,
  wcProofBytes: Uint8Array,
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
      StellarSdk.xdr.ScVal.scvBytes(Buffer.from(wcPublicInputsBytes)),
      StellarSdk.xdr.ScVal.scvBytes(Buffer.from(wcProofBytes))
    ),
    "10000000", // 1 XLM max fee
    log,
    true
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
    "10000000", // 1 XLM max fee
    log,
    needsCpuCap
  );

  log("Turn submitted ✅");
}

// ── Reveal Word ────────────────────────────────────────────────────────

/**
 * Winner reveals their word: ZK proof (guessing own word).
 * Dictionary membership already proven at creation time.
 */
export async function revealWordOnChain(
  gameId: string,
  publicKey: string,
  signTx: SignTransaction,
  revealWordBytes: Uint8Array,
  publicInputsBytes: Uint8Array,
  proofBytes: Uint8Array,
  onStatus?: (msg: string) => void
): Promise<void> {
  const log = onStatus ?? console.log;
  log("Revealing word on-chain…");

  const contract = new StellarSdk.Contract(CONTRACT_ID);

  await buildSignSubmit(
    publicKey,
    signTx,
    contract.call(
      "reveal_word",
      new StellarSdk.Address(gameId).toScVal(),
      new StellarSdk.Address(publicKey).toScVal(),
      StellarSdk.xdr.ScVal.scvBytes(Buffer.from(revealWordBytes)),
      StellarSdk.xdr.ScVal.scvBytes(Buffer.from(publicInputsBytes)),
      StellarSdk.xdr.ScVal.scvBytes(Buffer.from(proofBytes))
    ),
    "10000000", // 1 XLM max fee
    log,
    true
  );

  log("Word revealed ✅");
}

// ── Reveal Word (Draw) ─────────────────────────────────────────────────

/**
 * In a draw, each player reveals their word: ZK proof (guessing own word).
 * Dictionary membership already proven at creation time.
 * Must reveal before being allowed to withdraw.
 */
export async function revealWordDrawOnChain(
  gameId: string,
  publicKey: string,
  signTx: SignTransaction,
  revealWordBytes: Uint8Array,
  publicInputsBytes: Uint8Array,
  proofBytes: Uint8Array,
  onStatus?: (msg: string) => void
): Promise<void> {
  const log = onStatus ?? console.log;
  log("Revealing word for draw on-chain…");

  const contract = new StellarSdk.Contract(CONTRACT_ID);

  await buildSignSubmit(
    publicKey,
    signTx,
    contract.call(
      "reveal_word_draw",
      new StellarSdk.Address(gameId).toScVal(),
      new StellarSdk.Address(publicKey).toScVal(),
      StellarSdk.xdr.ScVal.scvBytes(Buffer.from(revealWordBytes)),
      StellarSdk.xdr.ScVal.scvBytes(Buffer.from(publicInputsBytes)),
      StellarSdk.xdr.ScVal.scvBytes(Buffer.from(proofBytes))
    ),
    "10000000", // 1 XLM max fee
    log,
    true
  );

  log("Word revealed for draw ✅");
}

// ── Resign ─────────────────────────────────────────────────────────────

/**
 * Resign the current game. The opponent wins immediately.
 */
export async function resignOnChain(
  gameId: string,
  publicKey: string,
  signTx: SignTransaction,
  onStatus?: (msg: string) => void
): Promise<void> {
  const log = onStatus ?? console.log;
  log("Resigning…");

  const contract = new StellarSdk.Contract(CONTRACT_ID);

  await buildSignSubmit(
    publicKey,
    signTx,
    contract.call(
      "resign",
      new StellarSdk.Address(gameId).toScVal(),
      new StellarSdk.Address(publicKey).toScVal()
    ),
    "10000000", // 1 XLM max fee
    log
  );

  log("Resigned ✅");
}

// ── Claim Timeout ──────────────────────────────────────────────────────

/**
 * Claim a timeout win + reveal word in a single transaction.
 */
export async function claimTimeoutOnChain(
  gameId: string,
  publicKey: string,
  signTx: SignTransaction,
  revealWordBytes: Uint8Array,
  publicInputsBytes: Uint8Array,
  proofBytes: Uint8Array,
  onStatus?: (msg: string) => void
): Promise<void> {
  const log = onStatus ?? console.log;
  log("Claiming timeout + revealing word…");

  const contract = new StellarSdk.Contract(CONTRACT_ID);

  await buildSignSubmit(
    publicKey,
    signTx,
    contract.call(
      "claim_timeout",
      new StellarSdk.Address(gameId).toScVal(),
      new StellarSdk.Address(publicKey).toScVal(),
      StellarSdk.xdr.ScVal.scvBytes(Buffer.from(revealWordBytes)),
      StellarSdk.xdr.ScVal.scvBytes(Buffer.from(publicInputsBytes)),
      StellarSdk.xdr.ScVal.scvBytes(Buffer.from(proofBytes))
    ),
    "10000000", // 1 XLM max fee
    log,
    true
  );

  log("Timeout claimed + word revealed ✅");
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
    "10000000", // 1 XLM max fee
    log
  );

  log("Escrow withdrawn ✅");
}

// ── Session Key Registration ──────────────────────────────────────────

/**
 * Register a session key on-chain for a specific game.
 * The session key self-registers (no Freighter popup needed).
 * Must be called AFTER the session key account is funded.
 */
export async function registerSessionKeyOnChain(
  gameId: string,
  playerPublicKey: string,
  sessionKeyPublicKey: string,
  sessionSignTx: SignTransaction,
  onStatus?: (msg: string) => void
): Promise<void> {
  const log = onStatus ?? console.log;
  log("Registering session key on-chain…");

  const contract = new StellarSdk.Contract(CONTRACT_ID);

  // Session key is the transaction source AND signer (silent — no wallet popup)
  await buildSignSubmit(
    sessionKeyPublicKey,
    sessionSignTx,
    contract.call(
      "register_session_key",
      new StellarSdk.Address(gameId).toScVal(),
      new StellarSdk.Address(playerPublicKey).toScVal(),
      new StellarSdk.Address(sessionKeyPublicKey).toScVal()
    ),
    "10000000", // 1 XLM max fee
    log
  );

  log("Session key registered ✅ (no more popups for gameplay!)");
}

// ── Lobby: Fetch open games ──────────────────────────────────────────────


export interface OpenGame {
  gameId: string;
  creator: string;
  escrowXlm: number;
  ledger: number;
  createdAt: string;
}

/**
 * Fetch recently created games that are still in WAITING phase.
 * Uses Soroban RPC getEvents to find "created" events from the contract.
 */
export async function fetchOpenGames(): Promise<OpenGame[]> {
  const server = getServer();

  let latestLedgerInfo;
  try {
    latestLedgerInfo = await server.getLatestLedger();
  } catch {
    return [];
  }

  // Look back ~24 hours (~17280 ledgers at 5s/ledger)
  const startLedger = Math.max(1, latestLedgerInfo.sequence - 17000);
  const topicFilter = StellarSdk.xdr.ScVal.scvSymbol("created").toXDR("base64");

  let response: StellarSdk.rpc.Api.GetEventsResponse;
  try {
    response = await server.getEvents({
      startLedger,
      filters: [
        {
          type: "contract",
          contractIds: [CONTRACT_ID],
          topics: [[topicFilter]],
        },
      ],
      limit: 100,
    });
  } catch {
    return [];
  }

  if (!response || !response.events || response.events.length === 0) return [];

  // Extract game IDs from event data: (game_id, player1) tuple
  const candidates = new Map<string, { creator: string; ledger: number; createdAt: string }>();
  for (const evt of response.events) {
    try {
      const dataScVal = typeof evt.value === "string"
        ? StellarSdk.xdr.ScVal.fromXDR(evt.value, "base64")
        : evt.value;
      // New format: ScVec([game_id_address, player1_address])
      const vec = dataScVal.vec();
      if (vec && vec.length >= 2) {
        const gameId = StellarSdk.Address.fromScVal(vec[0]).toString();
        const creator = StellarSdk.Address.fromScVal(vec[1]).toString();
        const existing = candidates.get(gameId);
        if (!existing || evt.ledger > existing.ledger) {
          candidates.set(gameId, {
            creator,
            ledger: evt.ledger,
            createdAt: evt.ledgerClosedAt || "",
          });
        }
      } else {
        // Fallback: old format where data is a single Address (game_id = player1)
        const gameId = StellarSdk.Address.fromScVal(dataScVal).toString();
        const existing = candidates.get(gameId);
        if (!existing || evt.ledger > existing.ledger) {
          candidates.set(gameId, {
            creator: gameId,
            ledger: evt.ledger,
            createdAt: evt.ledgerClosedAt || "",
          });
        }
      }
    } catch {
      continue;
    }
  }

  if (candidates.size === 0) return [];

  // Check which games are still in WAITING phase & get escrow amounts
  const gameIds = Array.from(candidates.keys());
  const checks = await Promise.all(
    gameIds.map(async (id) => {
      try {
        const scVal = new StellarSdk.Address(id).toScVal();
        const [phaseVal, escrowVal] = await Promise.all([
          queryContract("get_game_phase", [scVal]),
          queryContract("get_escrow_amount", [scVal]),
        ]);
        const phase = phaseVal ? (phaseVal.value() as number) : 255;
        const escrow = escrowVal ? Number(escrowVal.value()) : 0;
        return { phase, escrow };
      } catch {
        return { phase: 255, escrow: 0 };
      }
    })
  );

  const openGames: OpenGame[] = [];
  for (let i = 0; i < gameIds.length; i++) {
    if (checks[i].phase === 0) {
      // PHASE_WAITING = 0
      const meta = candidates.get(gameIds[i])!;
      openGames.push({
        gameId: gameIds[i],
        creator: meta.creator,
        escrowXlm: checks[i].escrow / STROOPS_PER_XLM,
        ledger: meta.ledger,
        createdAt: meta.createdAt,
      });
    }
  }

  return openGames;
}

// ── Game Registry Queries ──────────────────────────────────────────────

/**
 * Get total number of games ever created (from persistent storage).
 */
export async function getGameCount(): Promise<number> {
  const val = await queryContract("get_game_count", []);
  return val ? (val.value() as number) : 0;
}

/**
 * Get the game_id at a specific index in the registry.
 */
export async function getGameIdAt(index: number): Promise<string> {
  const val = await queryContract("get_game_id_at", [
    StellarSdk.nativeToScVal(index, { type: "u32" }),
  ]);
  if (!val) return "";
  try {
    return StellarSdk.Address.fromScVal(val).toString();
  } catch {
    return "";
  }
}

/**
 * Get the creator (player1) of a game.
 */
export async function getGameCreator(gameId: string): Promise<string> {
  const val = await queryContract("get_game_creator", [
    new StellarSdk.Address(gameId).toScVal(),
  ]);
  if (!val) return "";
  try {
    return StellarSdk.Address.fromScVal(val).toString();
  } catch {
    return "";
  }
}

/**
 * Fetch detailed info for a list of game IDs.
 */
export interface GameSummary {
  gameId: string;
  creator: string;
  phase: number;
  escrowXlm: number;
  turn: number;
}

export async function fetchGameSummaries(gameIds: string[]): Promise<GameSummary[]> {
  const summaries = await Promise.all(
    gameIds.map(async (id) => {
      try {
        const scVal = new StellarSdk.Address(id).toScVal();
        const [phaseVal, escrowVal, turnVal, creatorVal] = await Promise.all([
          queryContract("get_game_phase", [scVal]),
          queryContract("get_escrow_amount", [scVal]),
          queryContract("get_game_turn", [scVal]),
          queryContract("get_game_creator", [scVal]),
        ]);
        const phase = phaseVal ? (phaseVal.value() as number) : 255;
        const escrow = escrowVal ? Number(escrowVal.value()) : 0;
        const turn = turnVal ? (turnVal.value() as number) : 0;
        let creator = "";
        if (creatorVal) {
          try { creator = StellarSdk.Address.fromScVal(creatorVal).toString(); } catch { }
        }
        return {
          gameId: id,
          creator,
          phase,
          escrowXlm: escrow / STROOPS_PER_XLM,
          turn,
        };
      } catch {
        return { gameId: id, creator: "", phase: 255, escrowXlm: 0, turn: 0 };
      }
    })
  );
  return summaries;
}