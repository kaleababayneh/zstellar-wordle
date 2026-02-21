const meta = require('../frontend/public/merkle-tree-poseidon.json');
const levels = require('../frontend/public/merkle-tree-poseidon-levels.json');

const word = 'apple';
const index = meta.wordIndex[word];
if (index === undefined) { console.error('word not found'); process.exit(1); }

const height = meta.height;
const zeros = meta.zeros;

const pathElements = [];
const pathIndices = [];

let idx = index;
for (let h = 0; h < height; h++) {
  const siblingIdx = idx ^ 1;
  const sibling = levels[h] && levels[h][siblingIdx] !== undefined ? levels[h][siblingIdx] : zeros[h];
  pathElements.push(sibling);
  pathIndices.push(idx & 1);
  idx >>= 1;
}

function fieldTo32BytesHex(fe) {
  let hex = fe.startsWith('0x') ? fe.slice(2) : fe;
  return hex.padStart(64, '0');
}

console.log('Root:', meta.root);
console.log('Word:', word, 'Index:', index);
console.log('Height:', height);

// Build the stellar CLI invocation command
const contractId = 'CDQWTVIGYRRRJJVGNPLRYMMEIL4CK37PHSJ42Q3DQ4U7MKEUP6R3H4YH';
const guessHex = Buffer.from(word, 'ascii').toString('hex');

let cmd = `stellar contract invoke \\
  --id ${contractId} \\
  --network testnet \\
  --source alice-testnet \\
  --send yes \\
  -- \\
  verify_guess \\
  --guess_word ${guessHex}`;

for (const pe of pathElements) {
  cmd += ` \\\n  --path_elements ${fieldTo32BytesHex(pe)}`;
}

for (const pi of pathIndices) {
  cmd += ` \\\n  --path_indices ${pi}`;
}

console.log('\n=== Invoke command ===\n');
console.log(cmd);
