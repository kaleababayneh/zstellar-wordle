/**
 * Frontend Poseidon2 Merkle proof generation for word-commit validation.
 *
 * Loads precomputed Poseidon2 Merkle tree data from public/ directory
 * and generates proofs for individual words.
 *
 * Used by the word-commit circuit to prove dictionary membership
 * at game creation / join time.
 */

export interface PoseidonMerkleProof {
  pathElements: string[]; // 14 field-element hex strings
  pathIndices: number[];  // 14 values (0 or 1)
  root: string;           // Poseidon2 Merkle root
  leaf: string;           // Leaf field element
}

interface PoseidonTreeMetadata {
  root: string;
  totalLeaves: number;
  height: number;
  zeros: string[];
  wordIndex: Record<string, number>;
}

let _meta: PoseidonTreeMetadata | null = null;
let _levels: string[][] | null = null;
let _loading: Promise<void> | null = null;

/**
 * Load the Poseidon Merkle tree data (metadata + levels).
 * Fetches from public/ directory. Cached after first load.
 */
async function ensureLoaded(): Promise<void> {
  if (_meta && _levels) return;
  if (_loading) return _loading;

  _loading = (async () => {
    const [metaResp, levelsResp] = await Promise.all([
      fetch("/merkle-tree-poseidon.json"),
      fetch("/merkle-tree-poseidon-levels.json"),
    ]);

    if (!metaResp.ok) throw new Error("Failed to load Poseidon Merkle tree metadata");
    if (!levelsResp.ok) throw new Error("Failed to load Poseidon Merkle tree levels");

    _meta = (await metaResp.json()) as PoseidonTreeMetadata;
    _levels = (await levelsResp.json()) as string[][];
  })();

  return _loading;
}

/**
 * Check if a word exists in the Poseidon Merkle tree dictionary.
 */
export async function isPoseidonValidWord(word: string): Promise<boolean> {
  await ensureLoaded();
  return word.toLowerCase() in _meta!.wordIndex;
}

/**
 * Generate a Poseidon Merkle proof for a word.
 * Returns null if the word is not in the dictionary.
 */
export async function getPoseidonMerkleProof(
  word: string
): Promise<PoseidonMerkleProof | null> {
  await ensureLoaded();

  const index = _meta!.wordIndex[word.toLowerCase()];
  if (index === undefined) return null;

  const height = _meta!.height;
  const zeros = _meta!.zeros;
  const levels = _levels!;

  const pathElements: string[] = [];
  const pathIndices: number[] = [];

  let idx = index;
  for (let h = 0; h < height; h++) {
    const siblingIdx = idx ^ 1;
    const sibling = levels[h]?.[siblingIdx] ?? zeros[h];
    pathElements.push(sibling);
    pathIndices.push(idx & 1);
    idx >>= 1;
  }

  return {
    root: levels[height][0],
    pathElements,
    pathIndices,
    leaf: levels[0][index],
  };
}

/**
 * Get the Poseidon Merkle root.
 */
export async function getPoseidonRoot(): Promise<string> {
  await ensureLoaded();
  return _meta!.root;
}

/**
 * Convert a Poseidon Merkle proof to Uint8Array format for Soroban contract calls.
 * Each path element is a 32-byte big-endian field element.
 */
export function poseidonProofToBytes(proof: PoseidonMerkleProof): {
  pathElementsBytes: Uint8Array[];
  pathIndices: number[];
} {
  const pathElementsBytes = proof.pathElements.map((hex) => {
    const clean = hex.replace(/^0x/, "").padStart(64, "0");
    const bytes = new Uint8Array(32);
    for (let i = 0; i < 32; i++) {
      bytes[i] = parseInt(clean.substr(i * 2, 2), 16);
    }
    return bytes;
  });

  return { pathElementsBytes, pathIndices: proof.pathIndices };
}
