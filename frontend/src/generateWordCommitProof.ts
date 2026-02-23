/**
 * Generate a word-commit ZK proof in the browser.
 *
 * The circuit (circuit-word-commit) proves:
 *   1. commitment_hash == Poseidon2(salt, l1, l2, l3, l4, l5)
 *   2. The word is a member of the Poseidon2 Merkle tree (root baked into circuit)
 *
 * Public inputs:  commitment_hash (field)
 * Private inputs: merkle_path[14], merkle_indices[14], letters[5], salt
 */

import { UltraHonkBackend } from "@aztec/bb.js";
// @ts-ignore
import { Noir } from "@noir-lang/noir_js";
import { type CompiledCircuit } from "@noir-lang/types";
import wcCircuitJson from "./circuit-word-commit/circuit.json";

export interface WordCommitProofArtifacts {
  /** Raw proof bytes */
  proof: Uint8Array;
  /** Encoded public inputs (commitment_hash = 1 × 32 bytes) */
  publicInputsBytes: Uint8Array;
}

// ── Cached backend ──
let _wcNoir: any = null;
let _wcBackend: any = null;
let _wcInitPromise: Promise<void> | null = null;

/**
 * Pre-initialize the word-commit Noir circuit + Barretenberg backend.
 */
export function preloadWordCommitProver(
  onStatus?: (msg: string) => void
): Promise<void> {
  if (_wcInitPromise) return _wcInitPromise;

  const log = onStatus ?? console.log;

  _wcInitPromise = (async () => {
    const t0 = performance.now();
    log("Pre-loading Word-Commit circuit…");

    _wcNoir = new Noir(wcCircuitJson as unknown as CompiledCircuit);
    _wcBackend = new UltraHonkBackend(
      (wcCircuitJson as any).bytecode
    );

    log(
      `Word-Commit prover ready ✅ (${((performance.now() - t0) / 1000).toFixed(1)}s)`
    );
  })();

  return _wcInitPromise;
}

// ── Public-input encoding (field → 32-byte BE) ──

function encodeField(value: any): Uint8Array {
  const field = new Uint8Array(32);
  let val = BigInt(value);
  for (let i = 31; i >= 0; i--) {
    field[i] = Number(val & 0xffn);
    val >>= 8n;
  }
  return field;
}

/**
 * Generate a word-commit proof.
 *
 * @param commitmentHash  Poseidon2 commitment hex (0x…)
 * @param salt            Salt as decimal string or bigint
 * @param letterCodes     5 ASCII codes
 * @param merklePath      14 field-element hex strings (siblings)
 * @param merkleIndices   14 direction indices (0 or 1)
 */
export async function generateWordCommitProof(
  commitmentHash: string,
  salt: string,
  letterCodes: number[],
  merklePath: string[],
  merkleIndices: number[],
  onStatus?: (msg: string) => void
): Promise<WordCommitProofArtifacts> {
  const log = onStatus ?? console.log;

  if (!_wcNoir || !_wcBackend) {
    await preloadWordCommitProver(log);
  }

  const inputs: Record<string, unknown> = {
    commitment_hash: commitmentHash,
    merkle_path: merklePath,
    merkle_indices: merkleIndices,
    first_letter: letterCodes[0].toString(),
    second_letter: letterCodes[1].toString(),
    third_letter: letterCodes[2].toString(),
    fourth_letter: letterCodes[3].toString(),
    fifth_letter: letterCodes[4].toString(),
    salt,
  };

  log("Generating word-commit witness…");
  const tw0 = performance.now();
  const { witness } = await _wcNoir.execute(inputs);
  log(
    `Witness generated in ${((performance.now() - tw0) / 1000).toFixed(1)}s ✅`
  );

  log("Generating word-commit proof…");
  await new Promise((r) => setTimeout(r, 50));
  const t0 = performance.now();
  const { proof } = await _wcBackend.generateProof(witness, {
    keccak: true,
  });
  log(
    `Word-commit proof generated in ${((performance.now() - t0) / 1000).toFixed(1)}s ✅`
  );

  // Encode public inputs: commitment_hash only (1 field × 32 bytes)
  // merkle_root is baked into the circuit as a constant
  const publicInputsBytes = new Uint8Array(32);
  publicInputsBytes.set(encodeField(commitmentHash), 0);

  const rawProof: Uint8Array = proof.proof ?? proof;

  log(
    `Word-commit proof: ${rawProof.length} bytes, public inputs: ${publicInputsBytes.length} bytes`
  );

  return {
    proof: rawProof,
    publicInputsBytes,
  };
}
