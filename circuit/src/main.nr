use poseidon::poseidon2::Poseidon2;

fn main(
    // hash of all letters with salt
    commitment_hashes: pub Field,
    // public inputs
    first_letter_guess: pub Field,
    second_letter_guess: pub Field,
    third_letter_guess: pub Field,
    fourth_letter_guess: pub Field,
    fifth_letter_guess: pub Field,
    // calculated final result
    calculated_result: pub [u8; 5],
    // private inputs
    first_letter: Field,
    second_letter: Field,
    third_letter: Field,
    fourth_letter: Field,
    fifth_letter: Field,
    salt: Field,
    )
     {


    assert(commitment_hashes == Poseidon2::hash([salt, first_letter, second_letter, third_letter, fourth_letter, fifth_letter], 6));



    let mut correct_letters = [first_letter, second_letter, third_letter, fourth_letter, fifth_letter];
    let guess_letters = [first_letter_guess, second_letter_guess, third_letter_guess, fourth_letter_guess, fifth_letter_guess];
    let mut result_array = [0; 5];

    for i in 0..5 {
        if guess_letters[i] == correct_letters[i] {
            result_array[i] = 2; // Correct letter
        } else {
            let mut found = false;
            for j in 0..5 {
                if correct_letters[j] == guess_letters[i] {
                    found = true;
                }
            }
            if found {
                result_array[i] = 1; // Wrong position
            } else {
                result_array[i] = 0; // Incorrect letter
            }
        }
    }

    assert(calculated_result == result_array);
}




#[test]
fn test_main() {
    println("test");
    let salt = Field::from(0);

    let first_letter: Field = Field::from(97);  // a
    let second_letter: Field = Field::from(112); // p
    let third_letter: Field = Field::from(112);  // p
    let fourth_letter: Field = Field::from(108); // l
    let fifth_letter: Field = Field::from(101);  // e

    // Single Poseidon2 hash of all letters with salt
    let commitment_hashes: Field = Poseidon2::hash(
        [salt, first_letter, second_letter, third_letter, fourth_letter, fifth_letter], 6,
    );

    let first_letter_guess: Field = Field::from(97);  // a
    let second_letter_guess: Field = Field::from(112); // p
    let third_letter_guess: Field = Field::from(112);  // p
    let fourth_letter_guess: Field = Field::from(97);  // a
    let fifth_letter_guess: Field = Field::from(111);  // o

    let result: [u8; 5] = [2, 2, 2, 1, 0];

    main(
        commitment_hashes,
        first_letter_guess,
        second_letter_guess,
        third_letter_guess,
        fourth_letter_guess,
        fifth_letter_guess,
        result,
        first_letter,
        second_letter,
        third_letter,
        fourth_letter,
        fifth_letter,
        salt,
    );
}