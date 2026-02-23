use poseidon::poseidon2::Poseidon2;

// Poseidon2 Merkle root of the 12,653 five-letter word list (depth 14).
global MERKLE_ROOT: Field = 0x0ae4b821bcbfcc5f6a3b711a48ceb8a86baad969d64fb90cfd2e2b3670e37dc7;

fn main(
    // hash of all letters with salt
    commitment_hash: pub Field,
    //  Private inputs 
    // Merkle proof for the committed word
    merkle_path: [Field; 14],
    merkle_indices: [u8; 14],
    // Word letters 
    first_letter: Field,
    second_letter: Field,
    third_letter: Field,
    fourth_letter: Field,
    fifth_letter: Field,
    // Salt 
    salt: Field,
) {
    // Verify commitment
    let computed_commitment = Poseidon2::hash(
        [salt, first_letter, second_letter, third_letter, fourth_letter, fifth_letter], 6
    );
    assert(computed_commitment == commitment_hash);

    // 2. Compute the leaf: encode word as a single field element
    // leaf = l1*256^4 + l2*256^3 + l3*256^2 + l4*256 + l5
    let leaf = first_letter * 256 * 256 * 256 * 256
             + second_letter * 256 * 256 * 256
             + third_letter * 256 * 256
             + fourth_letter * 256
             + fifth_letter;

    // 3. Walk the Merkle path from leaf to root using Poseidon2
    let mut current_hash = leaf;
    for i in 0..14 {
        let (left, right) = if merkle_indices[i] == 1 {
            (merkle_path[i], current_hash)
        } else {
            (current_hash, merkle_path[i])
        };
        current_hash = Poseidon2::hash([left, right], 2);
    }

    // Verify the computed root matches the baked-in Merkle root
    assert(current_hash == MERKLE_ROOT);
}

