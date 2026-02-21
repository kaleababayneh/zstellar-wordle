import { UltraHonkBackend } from "@aztec/bb.js";
// @ts-ignore – Noir JS doesn't ship perfect types
import { Noir } from "@noir-lang/noir_js";
import { type CompiledCircuit } from "@noir-lang/types";
import circuitJson from "./circuit/circuit.json";
import { wordToAsciiCodes, calculateWordleResults } from "./gameLogic";

export interface ProofArtifacts {
  /** Raw proof bytes (456 * 32 = 14592 bytes) */
  proof: Uint8Array;
  /** Encoded public inputs as concatenated 32-byte BE fields */
  publicInputsBytes: Uint8Array;
  /** Proof blob (header || publicInputs || proof) — for reference contract */
  proofBlob: Uint8Array;
  /** VK bytes — for reference contract that accepts VK per-call */
  vkBytes: Uint8Array;
  proofId: string;
  publicInputs: string[];
  results: number[];
}

// ── Cached backend — init once, reuse across guesses ──
let _noir: any = null;
let _backend: any = null;
let _initPromise: Promise<void> | null = null;

/**
 * Pre-initialize the Noir circuit + Barretenberg backend.
 * Call this early (e.g. on page load) so WASM is ready when the user guesses.
 */
export function preloadProver(onStatus?: (msg: string) => void): Promise<void> {
  if (_initPromise) return _initPromise;

  const log = onStatus ?? console.log;

  _initPromise = (async () => {
    const t0 = performance.now();
    log("Pre-loading Noir + Barretenberg WASM…");

    _noir = new Noir(circuitJson as unknown as CompiledCircuit);
    log(`Noir initialized in ${((performance.now() - t0) / 1000).toFixed(1)}s`);

    const t1 = performance.now();
    _backend = new UltraHonkBackend((circuitJson as any).bytecode);
    log(`Backend initialized in ${((performance.now() - t1) / 1000).toFixed(1)}s`);

    log(`Prover ready ✅ (total ${((performance.now() - t0) / 1000).toFixed(1)}s)`);
  })();

  return _initPromise;
}

// ── Public input encoding (matches NoirService from reference) ──

function encodeField(value: any): Uint8Array {
  const field = new Uint8Array(32);
  let val = BigInt(value);
  for (let i = 31; i >= 0; i--) {
    field[i] = Number(val & 0xffn);
    val = val >> 8n;
  }
  return field;
}

function encodePublicInputs(inputs: Record<string, unknown>): Uint8Array {
  const circuit = circuitJson as any;
  const publicParams = circuit.abi.parameters.filter(
    (p: any) => p.visibility === "public"
  );

  const fields: Uint8Array[] = [];
  for (const p of publicParams) {
    const inputValue = inputs[p.name];

    if (p.type.kind === "array") {
      const arr = inputValue as any[];
      for (const el of arr) {
        fields.push(encodeField(el));
      }
    } else {
      // field or integer
      fields.push(encodeField(inputValue));
    }
  }

  const out = new Uint8Array(fields.length * 32);
  fields.forEach((f, i) => out.set(f, i * 32));
  return out;
}

function buildProofBlob(
  publicInputsBytes: Uint8Array,
  proofBytes: Uint8Array
): { proofBlob: Uint8Array; proofId: string } {
  const proofFieldCount = proofBytes.length / 32;
  const publicInputFieldCount = publicInputsBytes.length / 32;
  const totalFields = proofFieldCount + publicInputFieldCount;

  // header: 4 bytes big-endian u32 of total field count
  const header = new Uint8Array(4);
  new DataView(header.buffer).setUint32(0, totalFields, false);

  // Concatenate: header || publicInputs || proof
  const proofBlob = new Uint8Array(
    header.length + publicInputsBytes.length + proofBytes.length
  );
  proofBlob.set(header, 0);
  proofBlob.set(publicInputsBytes, header.length);
  proofBlob.set(proofBytes, header.length + publicInputsBytes.length);

  // proofId = first 32 hex chars of SHA-like fingerprint from proofBlob
  const proofId = Array.from(proofBlob.slice(0, 16))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  return { proofBlob, proofId };
}

/**
 * Load the verification key for this circuit.
 * Expects /circuit_vk.json in the public directory (raw VK bytes as JSON array).
 */
async function loadVk(): Promise<Uint8Array> {
  const resp = await fetch("/circuit_vk.json");
  if (!resp.ok) {
    throw new Error(`Failed to load VK: ${resp.status} ${resp.statusText}`);
  }
  const buf = await resp.arrayBuffer();
  return new Uint8Array(buf);
}

/**
 * Generate an UltraHonk proof in the browser.
 * Returns proof blob + VK ready for on-chain verification.
 */
export async function generateProof(
  guess: string,
  gameSecret: { word: string; letterCodes: number[]; salt: string; commitmentHash: string },
  onStatus?: (msg: string) => void
): Promise<ProofArtifacts> {
  const log = onStatus ?? console.log;

  // Ensure backend is ready (instant if preloaded, otherwise init now)
  if (!_noir || !_backend) {
    await preloadProver(log);
  }

  const { word, letterCodes, salt, commitmentHash } = gameSecret;

  // Calculate wordle results locally
  const results = calculateWordleResults(guess, word);
  log(
    `Result: ${results
      .map((r) => (r === 2 ? "🟩" : r === 1 ? "🟨" : "⬛"))
      .join("")}`
  );

  // Build circuit inputs
  const guessCodes = wordToAsciiCodes(guess);
  const inputs: Record<string, unknown> = {
    commitment_hashes: commitmentHash,
    first_letter_guess: guessCodes[0],
    second_letter_guess: guessCodes[1],
    third_letter_guess: guessCodes[2],
    fourth_letter_guess: guessCodes[3],
    fifth_letter_guess: guessCodes[4],
    calculated_result: results,
    first_letter: letterCodes[0].toString(),
    second_letter: letterCodes[1].toString(),
    third_letter: letterCodes[2].toString(),
    fourth_letter: letterCodes[3].toString(),
    fifth_letter: letterCodes[4].toString(),
    salt,
  };

  log("Generating witness…");
  const tw0 = performance.now();
  const { witness } = await _noir.execute(inputs);
  log(
    `Witness generated in ${((performance.now() - tw0) / 1000).toFixed(1)}s ✅`
  );

  log("Generating proof…");
  await new Promise((r) => setTimeout(r, 50));

  const t0 = performance.now();
  const { proof, publicInputs } = await _backend.generateProof(witness, {
    keccak: true,
  });
  const elapsed = ((performance.now() - t0) / 1000).toFixed(1);
  log(`Proof generated in ${elapsed}s ✅`);

  // Build public inputs from circuit ABI (proper 32-byte BE encoding)
  const publicInputsBytes = encodePublicInputs(inputs);
  log(
    `Public inputs: ${publicInputsBytes.length} bytes (${publicInputsBytes.length / 32} fields)`
  );

  // Build proof blob: header || publicInputs || proof
  const { proofBlob, proofId } = buildProofBlob(publicInputsBytes, proof.proof ?? proof);
  log(`Proof blob: ${proofBlob.length} bytes, ID: ${proofId.slice(0, 16)}…`);

  // Load verification key
  log("Loading verification key…");
  const vkBytes = await loadVk();
  log(`VK loaded: ${vkBytes.length} bytes ✅`);

  const rawProof = proof.proof ?? proof;
  const publicInputsStrings = publicInputs.map((x: any) => x.toString());

  return {
    proof: rawProof,
    publicInputsBytes,
    proofBlob,
    vkBytes,
    proofId,
    publicInputs: publicInputsStrings,
    results,
  };
}
