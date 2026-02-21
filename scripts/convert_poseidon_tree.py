#!/usr/bin/env python3
"""Convert Poseidon merkle tree from storage format to frontend-ready levels + metadata."""

import json
import os

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT = os.path.join(SCRIPT_DIR, "..")

input_path = os.path.join(REPO_ROOT, "js-scripts", "merkle-tree-poseidon.json")
levels_output = os.path.join(REPO_ROOT, "frontend", "public", "merkle-tree-poseidon-levels.json")
meta_output = os.path.join(REPO_ROOT, "frontend", "public", "merkle-tree-poseidon.json")

with open(input_path) as f:
    data = json.load(f)

total_leaves = data["totalLeaves"]
height = data["levels"]
zeros = data["zeros"]
storage = data["storage"]

# Build levels as arrays
levels = []
for lvl in range(height + 1):
    entries = {}
    for k, v in storage.items():
        parts = k.split("-")
        if int(parts[0]) == lvl:
            entries[int(parts[1])] = v
    if not entries:
        levels.append([])
        continue
    max_idx = max(entries.keys())
    level_arr = []
    for i in range(max_idx + 1):
        level_arr.append(entries.get(i, zeros[lvl]))
    levels.append(level_arr)

print(f"Root: {levels[height][0]}")
print(f"Levels generated: {len(levels)}")
for i, lvl in enumerate(levels):
    print(f"  Level {i}: {len(lvl)} entries")

# Save levels JSON
with open(levels_output, "w") as f:
    json.dump(levels, f)
print(f"Saved {levels_output}")

# Build word index from leaf level
word_index = {}
for i in range(total_leaves):
    leaf_hex = levels[0][i]
    leaf_val = int(leaf_hex, 16)
    chars = []
    for _ in range(5):
        chars.append(chr(leaf_val & 0xFF))
        leaf_val >>= 8
    chars.reverse()
    word = "".join(chars)
    word_index[word] = i

meta = {
    "root": levels[height][0],
    "totalLeaves": total_leaves,
    "height": height,
    "zeros": zeros,
    "wordIndex": word_index,
}
with open(meta_output, "w") as f:
    json.dump(meta, f)
print(f"Saved {meta_output} ({len(word_index)} words indexed)")
print(f"Sample words: {list(word_index.keys())[:5]}")
