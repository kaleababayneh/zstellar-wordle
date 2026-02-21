/**
 * Generate a Prover.toml for circuit-word-commit using the real Poseidon Merkle tree.
 *
 * Usage:
 *   node generateProverToml.js [word] [salt]
 *   e.g.  node generateProverToml.js apple 42
 *
 * Defaults: word = "apple", salt = 0
 */

import { writeFileSync, readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { Barretenberg, Fr } from '@aztec/bb.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Load the pre-built Poseidon Merkle tree ────────────────────────────────────
const treeJsonPath = join(__dirname, 'merkle-tree-poseidon.json');
const treeData = JSON.parse(readFileSync(treeJsonPath, 'utf8'));

// The tree stores nodes keyed as "level-index" in its storage map.
const storage = treeData.storage;   // { "0-0": "0x...", "0-1": ..., "1-0": ... }
const zeros   = treeData.zeros;     // zero values per level
const LEVELS  = treeData.levels;    // 14

// ── Helpers ────────────────────────────────────────────────────────────────────

function englishWordToField(word) {
  let val = 0n;
  for (let i = 0; i < word.length; i++) {
    val = val * 256n + BigInt(word.charCodeAt(i));
  }
  return '0x' + val.toString(16).padStart(64, '0');
}

function findLeafIndex(leafHex) {
  // Normalise: compare BigInt values to avoid leading-zero issues
  const target = BigInt(leafHex);
  for (const [key, value] of Object.entries(storage)) {
    if (!key.startsWith('0-')) continue;
    if (BigInt(value) === target) {
      return parseInt(key.split('-')[1], 10);
    }
  }
  return -1;
}

function getNode(level, index) {
  return storage[`${level}-${index}`] ?? zeros[level];
}

function merkleProof(index) {
  const pathElements = [];
  const pathIndices  = [];
  let idx = index;
  for (let level = 0; level < LEVELS; level++) {
    const siblingIdx = idx ^ 1; // toggle last bit
    pathElements.push(getNode(level, siblingIdx));
    pathIndices.push(idx & 1);
    idx >>= 1;
  }
  const root = getNode(LEVELS, 0);
  return { pathElements, pathIndices, root };
}

// ── Main ───────────────────────────────────────────────────────────────────────

async function main() {
  const word = (process.argv[2] || 'apple').toLowerCase();
  const saltBigInt = BigInt(process.argv[3] || '0');

  if (word.length !== 5) {
    console.error(`Word must be exactly 5 letters, got "${word}"`);
    process.exit(1);
  }

  console.log(`Word: "${word}", salt: ${saltBigInt}`);

  // 1. Compute leaf field
  const leafHex = englishWordToField(word);
  console.log(`Leaf (field): ${leafHex}`);

  // 2. Find the leaf in the tree
  const index = findLeafIndex(leafHex);
  if (index < 0) {
    console.error(`"${word}" not found in the Poseidon Merkle tree.`);
    process.exit(1);
  }
  console.log(`Leaf index: ${index}`);

  // 3. Generate Merkle proof
  const { pathElements, pathIndices, root } = merkleProof(index);
  console.log(`Merkle root: ${root}`);

  // 4. Compute Poseidon2 commitment  hash(salt, l1, l2, l3, l4, l5)
  const bb = await Barretenberg.new();
  const codes = [...word].map(c => c.charCodeAt(0));
  const inputs = [new Fr(saltBigInt), ...codes.map(c => new Fr(BigInt(c)))];
  const commitHash = await bb.poseidon2Hash(inputs);
  const commitmentHex = commitHash.toString();
  await bb.destroy();

  console.log(`Commitment: ${commitmentHex}`);

  // 5. Build Prover.toml
  const lines = [];
  lines.push(`commitment_hash = "${commitmentHex}"`);
  lines.push(`merkle_root = "${root}"`);
  lines.push('');
  lines.push(`merkle_path = [${pathElements.map(e => `"${e}"`).join(', ')}]`);
  lines.push(`merkle_indices = [${pathIndices.join(', ')}]`);
  lines.push('');
  lines.push(`first_letter = "${codes[0]}"`);
  lines.push(`second_letter = "${codes[1]}"`);
  lines.push(`third_letter = "${codes[2]}"`);
  lines.push(`fourth_letter = "${codes[3]}"`);
  lines.push(`fifth_letter = "${codes[4]}"`);
  lines.push(`salt = "${saltBigInt}"`);
  lines.push('');

  const toml = lines.join('\n');
  const outPath = join(__dirname, '..', 'circuit-word-commit', 'Prover.toml');
  writeFileSync(outPath, toml);
  console.log(`\n✅ Wrote ${outPath}`);
  console.log('\nProver.toml contents:\n');
  console.log(toml);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
