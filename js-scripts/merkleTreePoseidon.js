import { createRequire } from 'module';
import { writeFileSync, readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { Barretenberg, Fr } from '@aztec/bb.js';

const require = createRequire(import.meta.url);
const words = require('an-array-of-english-words');



let WORDLE = words.filter((w) => 
    w.length === 5 && 
    !w.includes("'") && 
    !w.includes("-") && 
    !w.includes(" "));

WORDLE = WORDLE.map(w => w.toLowerCase());

const total_number = WORDLE.length; // returns 12653 log2 12653 = 13.63 -> 14 levels


// Optimized: reuse single Barretenberg instance
let globalBB = null;

async function getBarretenberg() {
  if (!globalBB) {
    globalBB = await Barretenberg.new();
  }
  return globalBB;
}

async function destroyBarretenberg() {
  if (globalBB) {
    await globalBB.destroy();
    globalBB = null;
  }
}

async function hashLeftRight(left, right) {
  const bb = await getBarretenberg();
  const frLeft = Fr.fromString(left);
  const frRight = Fr.fromString(right);
  const hash = await bb.poseidon2Hash([frLeft, frRight]);
  return hash.toString();
}

export class PoseidonTree {
  constructor(levels, zeros) {
    if (zeros.length < levels + 1) {
      throw new Error("Not enough zero values provided for the given tree height.");
    }
    this.levels = levels;
    this.hashLeftRight = hashLeftRight;
    this.storage = new Map();
    this.zeros = zeros;
    this.totalLeaves = 0;
  }

  async init(defaultLeaves = []) {
    if (defaultLeaves.length > 0) {
      this.totalLeaves = defaultLeaves.length;

      defaultLeaves.forEach((leaf, index) => {
        this.storage.set(PoseidonTree.indexToKey(0, index), leaf);
      });

      for (let level = 1; level <= this.levels; level++) {
        const numNodes = Math.ceil(this.totalLeaves / (2 ** level));
        for (let i = 0; i < numNodes; i++) {
          const left = this.storage.get(PoseidonTree.indexToKey(level - 1, 2 * i)) || this.zeros[level - 1];
          const right = this.storage.get(PoseidonTree.indexToKey(level - 1, 2 * i + 1)) || this.zeros[level - 1];
          const node = await this.hashLeftRight(left, right);
          this.storage.set(PoseidonTree.indexToKey(level, i), node);
        }
      }
    }
  }

  static indexToKey(level, index) {
    return `${level}-${index}`;
  }

  getIndex(leaf) {
    for (const [key, value] of this.storage.entries()) {
      if (value === leaf && key.startsWith('0-')) {
        return parseInt(key.split('-')[1]);
      }
    }
    return -1;
  }

  root() {
    return this.storage.get(PoseidonTree.indexToKey(this.levels, 0)) || this.zeros[this.levels];
  }

  proof(index) {
    const leaf = this.storage.get(PoseidonTree.indexToKey(0, index));
    if (!leaf) throw new Error("leaf not found");

    const pathElements = [];
    const pathIndices = [];

    this.traverse(index, (level, currentIndex, siblingIndex) => {
      const sibling = this.storage.get(PoseidonTree.indexToKey(level, siblingIndex)) || this.zeros[level];
      pathElements.push(sibling);
      pathIndices.push(currentIndex % 2);
    });

    return {
      root: this.root(),
      pathElements,
      pathIndices,
      leaf,
    };
  }

  async insert(leaf) {
    const index = this.totalLeaves;
    await this.update(index, leaf, true);
    this.totalLeaves++;
  }

  async update(index, newLeaf, isInsert = false) {
    if (!isInsert && index >= this.totalLeaves) {
      throw Error("Use insert method for new elements.");
    } else if (isInsert && index < this.totalLeaves) {
      throw Error("Use update method for existing elements.");
    }

    const keyValueToStore = [];
    let currentElement = newLeaf;

    await this.traverseAsync(index, async (level, currentIndex, siblingIndex) => {
      const sibling = this.storage.get(PoseidonTree.indexToKey(level, siblingIndex)) || this.zeros[level];
      const [left, right] = currentIndex % 2 === 0 ? [currentElement, sibling] : [sibling, currentElement];
      keyValueToStore.push({ key: PoseidonTree.indexToKey(level, currentIndex), value: currentElement });
      currentElement = await this.hashLeftRight(left, right);
    });

    keyValueToStore.push({ key: PoseidonTree.indexToKey(this.levels, 0), value: currentElement });
    keyValueToStore.forEach(({ key, value }) => this.storage.set(key, value));
  }

  traverse(index, fn) {
    let currentIndex = index;
    for (let level = 0; level < this.levels; level++) {
      const siblingIndex = currentIndex % 2 === 0 ? currentIndex + 1 : currentIndex - 1;
      fn(level, currentIndex, siblingIndex);
      currentIndex = Math.floor(currentIndex / 2);
    }
  }

  async traverseAsync(index, fn) {
    let currentIndex = index;
    for (let level = 0; level < this.levels; level++) {
      const siblingIndex = currentIndex % 2 === 0 ? currentIndex + 1 : currentIndex - 1;
      await fn(level, currentIndex, siblingIndex);
      currentIndex = Math.floor(currentIndex / 2);
    }
 }

  // Add method to serialize tree to JSON
  toJSON() {
    return {
      levels: this.levels,
      totalLeaves: this.totalLeaves,
      zeros: this.zeros,
      storage: Object.fromEntries(this.storage)
    };
  }

  // Add static method to create tree from JSON
  static fromJSON(jsonData) {
    const tree = new PoseidonTree(jsonData.levels, jsonData.zeros);
    tree.totalLeaves = jsonData.totalLeaves;
    tree.storage = new Map(Object.entries(jsonData.storage));
    return tree;
  }
}

const ZERO_VALUES = [
  "0x0d823319708ab99ec915efd4f7e03d11ca1790918e8f04cd14100aceca2aa9ff",
  "0x170a9598425eb05eb8dc06986c6afc717811e874326a79576c02d338bdf14f13",
  "0x273b1a40397b618dac2fc66ceb71399a3e1a60341e546e053cbfa5995e824caf",
  "0x16bf9b1fb2dfa9d88cfb1752d6937a1594d257c2053dff3cb971016bfcffe2a1",
  "0x1288271e1f93a29fa6e748b7468a77a9b8fc3db6b216ce5fc2601fc3e9bd6b36",
  "0x1d47548adec1068354d163be4ffa348ca89f079b039c9191378584abd79edeca",
  "0x0b98a89e6827ef697b8fb2e280a2342d61db1eb5efc229f5f4a77fb333b80bef",
  "0x231555e37e6b206f43fdcd4d660c47442d76aab1ef552aef6db45f3f9cf2e955",
  "0x03d0dc8c92e2844abcc5fdefe8cb67d93034de0862943990b09c6b8e3fa27a86",
  "0x1d51ac275f47f10e592b8e690fd3b28a76106893ac3e60cd7b2a3a443f4e8355",
  "0x16b671eb844a8e4e463e820e26560357edee4ecfdbf5d7b0a28799911505088d",
  "0x115ea0c2f132c5914d5bb737af6eed04115a3896f0d65e12e761ca560083da15",
  "0x139a5b42099806c76efb52da0ec1dde06a836bf6f87ef7ab4bac7d00637e28f0",
  "0x0804853482335a6533eb6a4ddfc215a08026db413d247a7695e807e38debea8e",
  "0x2f0b264ab5f5630b591af93d93ec2dfed28eef017b251e40905cdf7983689803",
];

// Optimized Merkle tree builder - level by level construction
export async function buildMerkleTreeFast(leavesStr, treeHeight = 14) {
  const bb = await getBarretenberg();
  
  // Convert leaves to Fr objects
  let level = leavesStr.map(s => Fr.fromString(s));
  
  // Store all levels for proof generation
  const levels = [level];
  
  for (let h = 0; h < treeHeight; h++) {
    const zero = Fr.fromString(ZERO_VALUES[h]);
    const nextLen = Math.ceil(level.length / 2);
    
    // Batch all node hashes for this level using Promise.all
    const nextLevel = await Promise.all(
      Array.from({ length: nextLen }, async (_, i) => {
        const left = level[2 * i] ?? zero;
        const right = level[2 * i + 1] ?? zero;
        // Reuse the same bb instance
        return await bb.poseidon2Hash([left, right]);
      })
    );
    
    levels.push(nextLevel);
    level = nextLevel;
  }
  
  const root = level[0] ?? Fr.fromString(ZERO_VALUES[treeHeight]);
  
  return {
    root: root.toString(),
    height: treeHeight,
    levels,
    totalLeaves: leavesStr.length
  };
}

// Generate a Merkle proof using precomputed levels
export function getProofFromLevels(levels, index) {
  const height = levels.length - 1;
  const pathElements = [];
  const pathIndices = [];
  
  let idx = index;
  for (let h = 0; h < height; h++) {
    const siblingIdx = idx ^ 1; // toggle last bit
    const sibling = levels[h][siblingIdx] ?? Fr.fromString(ZERO_VALUES[h]);
    pathElements.push(sibling.toString());
    pathIndices.push(idx & 1);
    idx >>= 1;
  }
  
  const root = levels[height][0]?.toString() ?? ZERO_VALUES[height];
  const leaf = levels[0][index]?.toString();
  if (!leaf) throw new Error("Leaf index out of range");
  
  return { root, pathElements, pathIndices, leaf };
}

// Backward compatibility function
export async function merkleTree(leaves) {
  return await buildMerkleTreeFast(leaves, 14);
}

export function englishWordToField(word) {
    let binaryString = "";
    for (let i = 0; i < word.length; i++) {
        binaryString += word.charCodeAt(i).toString(2).padStart(8, "0");
    }
    const wordBigInt = BigInt("0b" + binaryString);
    return new Fr(wordBigInt);
}

export function saveTreeToFile(tree, filename = 'merkle-tree.json') {
  const treePath = join(process.cwd(), filename);
  const treeData = tree.toJSON();
  writeFileSync(treePath, JSON.stringify(treeData, null, 2));
  console.log(`💾 Tree saved to ${treePath}`);
}

export function loadTreeFromFile(filename = 'merkle-tree.json') {
  const treePath = join(process.cwd(), filename);
  if (!existsSync(treePath)) {
    throw new Error(`Tree file ${treePath} does not exist`);
  }
  const treeData = JSON.parse(readFileSync(treePath, 'utf8'));
  const tree = PoseidonTree.fromJSON(treeData);
  //console.log(`📂 Tree loaded from ${treePath}`);
  return tree;
}


async function main() {
    console.log(`🌳 Creating Merkle tree with ${WORDLE.length} Wordle words...`);
    console.time('Tree Generation');
    
    try {
        // Convert words to field elements
        const allWords = WORDLE.map(word => englishWordToField(word).toString());
        
        // Build tree using fast method
        const treeData = await buildMerkleTreeFast(allWords, 14);
        
        console.timeEnd('Tree Generation');
        console.log(`✅ Merkle tree created with root: ${treeData.root}`);
        console.log(`📊 Total leaves: ${treeData.totalLeaves}`);
        
        // Create a PoseidonTree-compatible object for saving
        const tree = new PoseidonTree(14, ZERO_VALUES);
        tree.totalLeaves = treeData.totalLeaves;
        
        // Convert levels back to storage format for compatibility
        treeData.levels.forEach((level, levelIndex) => {
            level.forEach((node, nodeIndex) => {
                tree.storage.set(PoseidonTree.indexToKey(levelIndex, nodeIndex), node.toString());
            });
        });
        
        saveTreeToFile(tree, 'merkle-tree.json');
        
        // Test with a few words
        console.log('\n🔍 Testing proof generation...');
        const testWords = ["about", "house", "world"];
        
        for (const testWord of testWords) {
            const wordIndex = WORDLE.indexOf(testWord);
            if (wordIndex !== -1) {
                const proof = getProofFromLevels(treeData.levels, wordIndex);
                console.log(`✅ "${testWord}" found at index ${wordIndex}, proof generated`);
            } else {
                console.log(`❌ "${testWord}" not found in dictionary`);
            }
        }
        
    } finally {
        // Clean up Barretenberg instance
        await destroyBarretenberg();
    }
}

// main().catch((err) => {
//     console.error('Error creating tree:', err);
//     destroyBarretenberg().finally(() => process.exit(1));
// });
