/**
 * Frontend Merkle proof generation for word validation.
 * 
 * Loads precomputed keccak256 Merkle tree data from public/ directory
 * and generates proofs for individual words.
 */

export interface MerkleProof {
    pathElements: string[]; // 14 hex strings (32 bytes each)
    pathIndices: number[];  // 14 values (0 or 1)
    root: string;
    leaf: string;
}

interface TreeMetadata {
    root: string;
    totalLeaves: number;
    height: number;
    zeros: string[];
    wordIndex: Record<string, number>;
}

let _metadata: TreeMetadata | null = null;
let _levels: string[][] | null = null;
let _loading: Promise<void> | null = null;

/**
 * Load the Merkle tree data (metadata + levels). 
 * Fetches from public/ directory. Cached after first load.
 */
async function ensureLoaded(): Promise<void> {
    if (_metadata && _levels) return;
    if (_loading) return _loading;

    _loading = (async () => {
        const [metaResp, levelsResp] = await Promise.all([
            fetch("/merkle-tree-keccak.json"),
            fetch("/merkle-tree-keccak-levels.json"),
        ]);

        if (!metaResp.ok) throw new Error("Failed to load Merkle tree metadata");
        if (!levelsResp.ok) throw new Error("Failed to load Merkle tree levels");

        _metadata = (await metaResp.json()) as TreeMetadata;
        _levels = (await levelsResp.json()) as string[][];
    })();

    return _loading;
}

/**
 * Check if a word exists in the Merkle tree dictionary.
 */
export async function isValidWord(word: string): Promise<boolean> {
    await ensureLoaded();
    return word.toLowerCase() in _metadata!.wordIndex;
}

/**
 * Generate a Merkle proof for a word.
 * Returns null if the word is not in the dictionary.
 */
export async function getMerkleProof(word: string): Promise<MerkleProof | null> {
    await ensureLoaded();

    const index = _metadata!.wordIndex[word.toLowerCase()];
    if (index === undefined) return null;

    const height = _metadata!.height;
    const zeros = _metadata!.zeros;
    const levels = _levels!;

    const pathElements: string[] = [];
    const pathIndices: number[] = [];

    let idx = index;
    for (let h = 0; h < height; h++) {
        const siblingIdx = idx ^ 1;
        const sibling = levels[h][siblingIdx] ?? zeros[h];
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
 * Convert a Merkle proof to Uint8Array format for Soroban contract calls.
 * Each path element is a 32-byte array (from hex).
 */
export function proofToBytes(proof: MerkleProof): {
    pathElementsBytes: Uint8Array[];
    pathIndices: number[];
    guessWordBytes: Uint8Array;
} {
    const pathElementsBytes = proof.pathElements.map((hex) => {
        const clean = hex.replace(/^0x/, "").padStart(64, "0");
        const bytes = new Uint8Array(32);
        for (let i = 0; i < 32; i++) {
            bytes[i] = parseInt(clean.substr(i * 2, 2), 16);
        }
        return bytes;
    });

    // Extract the word bytes from the leaf (last 5 bytes of 32-byte BE)
    const leafClean = proof.leaf.replace(/^0x/, "").padStart(64, "0");
    const guessWordBytes = new Uint8Array(5);
    for (let i = 0; i < 5; i++) {
        guessWordBytes[i] = parseInt(leafClean.substr((27 + i) * 2, 2), 16);
    }

    return { pathElementsBytes, pathIndices: proof.pathIndices, guessWordBytes };
}
