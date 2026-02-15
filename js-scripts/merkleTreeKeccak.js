/**
 * Keccak256 Merkle Tree for Wordle word validation.
 * 
 * Words are encoded as: word → BigInt (each char as 8-bit ASCII, concatenated) → 32-byte BE.
 * Tree height: 14 levels (~12,653 words, 2^14 = 16,384 capacity).
 */

import { createRequire } from 'module';
import { writeFileSync, readFileSync, existsSync } from 'fs';
import { join } from 'path';
import pkg from 'js-sha3';
const { keccak256 } = pkg;

const require = createRequire(import.meta.url);
const words = require('an-array-of-english-words');

// Filter to 5-letter lowercase words
const WORDLE = words
    .filter((w) => w.length === 5 && !w.includes("'") && !w.includes("-") && !w.includes(" "))
    .map((w) => w.toLowerCase());

const TREE_HEIGHT = 14;

// ── Helpers ────────────────────────────────────────────────────────────────────

/** Convert a word to a 32-byte hex string (same encoding as Solidity/contract). */
export function englishWordToHex(word) {
    let val = 0n;
    for (let i = 0; i < word.length; i++) {
        val = val * 256n + BigInt(word.charCodeAt(i));
    }
    return '0x' + val.toString(16).padStart(64, '0');
}

/** Keccak256 hash of two 32-byte values (left || right). */
function hashLeftRight(leftHex, rightHex) {
    // Strip 0x, concatenate, hash
    const l = leftHex.replace(/^0x/, '').padStart(64, '0');
    const r = rightHex.replace(/^0x/, '').padStart(64, '0');
    const combined = l + r; // 128 hex chars = 64 bytes
    const hash = keccak256(hexToBytes(combined));
    return '0x' + hash;
}

function hexToBytes(hex) {
    const bytes = new Uint8Array(hex.length / 2);
    for (let i = 0; i < hex.length; i += 2) {
        bytes[i / 2] = parseInt(hex.substr(i, 2), 16);
    }
    return bytes;
}

// ── Zero values (keccak256-based) ──────────────────────────────────────────────

/** Precompute zero values for empty subtrees. */
function computeZeroValues(height) {
    const zeros = ['0x' + '00'.repeat(32)]; // Zero leaf = 0x000...000
    for (let i = 0; i < height; i++) {
        zeros.push(hashLeftRight(zeros[i], zeros[i]));
    }
    return zeros;
}

// ── Tree builder ───────────────────────────────────────────────────────────────

export function buildMerkleTree(leavesHex, treeHeight = TREE_HEIGHT) {
    const zeros = computeZeroValues(treeHeight);

    // Store all levels for proof generation
    const levels = [leavesHex.slice()]; // Level 0 = leaves

    let currentLevel = leavesHex;
    for (let h = 0; h < treeHeight; h++) {
        const nextLen = Math.ceil(currentLevel.length / 2);
        const nextLevel = [];

        for (let i = 0; i < nextLen; i++) {
            const left = currentLevel[2 * i] ?? zeros[h];
            const right = currentLevel[2 * i + 1] ?? zeros[h];
            nextLevel.push(hashLeftRight(left, right));
        }

        levels.push(nextLevel);
        currentLevel = nextLevel;
    }

    const root = currentLevel[0] ?? zeros[treeHeight];

    return { root, levels, totalLeaves: leavesHex.length, zeros };
}

/** Generate a Merkle proof for a leaf at the given index. */
export function getProof(levels, index, zeros) {
    const height = levels.length - 1;
    const pathElements = [];
    const pathIndices = [];

    let idx = index;
    for (let h = 0; h < height; h++) {
        const siblingIdx = idx ^ 1; // toggle last bit
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

/** Verify a Merkle proof locally (for testing). */
export function verifyProof(leaf, pathElements, pathIndices, expectedRoot) {
    let currentHash = leaf;
    for (let i = 0; i < pathElements.length; i++) {
        if (pathIndices[i] === 0) {
            currentHash = hashLeftRight(currentHash, pathElements[i]);
        } else {
            currentHash = hashLeftRight(pathElements[i], currentHash);
        }
    }
    return currentHash === expectedRoot;
}

// ── Main ───────────────────────────────────────────────────────────────────────

async function main() {
    console.log(`🌳 Building keccak256 Merkle tree with ${WORDLE.length} words...`);
    console.time('Tree Generation');

    // Convert words to 32-byte hex leaves
    const leaves = WORDLE.map((word) => englishWordToHex(word));

    // Build tree
    const tree = buildMerkleTree(leaves, TREE_HEIGHT);

    console.timeEnd('Tree Generation');
    console.log(`✅ Merkle root: ${tree.root}`);
    console.log(`📊 Total leaves: ${tree.totalLeaves}`);

    // Save tree data (levels as hex arrays)
    const treeData = {
        root: tree.root,
        totalLeaves: tree.totalLeaves,
        height: TREE_HEIGHT,
        zeros: tree.zeros,
        // Save a word→index map for quick proof lookups
        wordIndex: Object.fromEntries(WORDLE.map((w, i) => [w, i])),
    };

    const treePath = join(process.cwd(), 'merkle-tree-keccak.json');
    writeFileSync(treePath, JSON.stringify(treeData, null, 2));
    console.log(`💾 Tree metadata saved to ${treePath}`);

    // Save levels separately (they can be large)
    const levelsPath = join(process.cwd(), 'merkle-tree-keccak-levels.json');
    const levelsData = tree.levels.map((level) => level.map(String));
    writeFileSync(levelsPath, JSON.stringify(levelsData));
    console.log(`💾 Tree levels saved to ${levelsPath}`);

    // Test with a few words
    console.log('\n🔍 Testing proof generation & verification...');
    const testWords = ['about', 'house', 'world', 'apple', 'hello'];

    for (const testWord of testWords) {
        const wordIndex = WORDLE.indexOf(testWord);
        if (wordIndex !== -1) {
            const proof = getProof(tree.levels, wordIndex, tree.zeros);
            const valid = verifyProof(proof.leaf, proof.pathElements, proof.pathIndices, tree.root);
            console.log(`  ${valid ? '✅' : '❌'} "${testWord}" at index ${wordIndex} — proof ${valid ? 'valid' : 'INVALID'}`);
        } else {
            console.log(`  ⚠️  "${testWord}" not in dictionary`);
        }
    }

    // Test with a non-existent word
    const fakeWord = 'zzzzz';
    const fakeLeaf = englishWordToHex(fakeWord);
    console.log(`  ℹ️  "${fakeWord}" leaf: ${fakeLeaf} (not in tree — should fail if proof attempted)`);
}

main().catch((err) => {
    console.error('Error:', err);
    process.exit(1);
});
