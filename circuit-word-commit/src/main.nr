use poseidon::poseidon2::Poseidon2;

fn main(
    // -- Public inputs --
    // Poseidon2 commitment to the word: hash(salt, l1, l2, l3, l4, l5)
    commitment_hash: pub Field,
    // Poseidon2 Merkle root of the word list
    merkle_root: pub Field,

    // -- Private inputs --
    // Merkle proof (14 levels for ~12,653 words, 2^14 = 16,384 capacity)
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
    //    leaf = l1*256^4 + l2*256^3 + l3*256^2 + l4*256 + l5
    //    This matches the encoding used to build the Poseidon2 Merkle tree.
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

    // Verify the computed root matches the public Merkle root
    assert(current_hash == merkle_root);
}


#[test]
fn test_word_commit() {
    // Word: "apple" -> a=97, p=112, p=112, l=108, e=101
    let salt = Field::from(0);
    let first_letter = Field::from(97);
    let second_letter = Field::from(112);
    let third_letter = Field::from(112);
    let fourth_letter = Field::from(108);
    let fifth_letter = Field::from(101);

    // Compute commitment
    let commitment_hash = Poseidon2::hash(
        [salt, first_letter, second_letter, third_letter, fourth_letter, fifth_letter], 6
    );

    // Compute leaf
    let leaf = first_letter * 256 * 256 * 256 * 256
             + second_letter * 256 * 256 * 256
             + third_letter * 256 * 256
             + fourth_letter * 256
             + fifth_letter;

    let zero = Field::from(0);
    let merkle_path = [zero; 14];
    let merkle_indices = [0; 14];

    // Compute expected root by hashing up 14 levels
    let mut expected_root = leaf;
    for _i in 0..14 {
        expected_root = Poseidon2::hash([expected_root, zero], 2);
    }

    main(
        commitment_hash,
        expected_root,
        merkle_path,
        merkle_indices,
        first_letter,
        second_letter,
        third_letter,
        fourth_letter,
        fifth_letter,
        salt,
    );
}