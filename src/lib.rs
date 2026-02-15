#![no_std]
use soroban_sdk::{
    contract, contracterror, contractimpl, symbol_short, token, Address, Bytes, BytesN, Env,
    Symbol, Vec,
};
use ultrahonk_soroban_verifier::{UltraHonkVerifier, PROOF_BYTES};

/// 5 minutes in ledger seconds
const GAME_DURATION_SECS: u64 = 300;

/// Keccak256 Merkle root of the 5-letter word dictionary (12 653 words, depth 14).
const MERKLE_ROOT: [u8; 32] = [
    0xca, 0x51, 0x82, 0xba, 0xc9, 0xd0, 0xec, 0x16,
    0xa6, 0x6d, 0x0c, 0x25, 0x21, 0x48, 0x07, 0xa6,
    0xe3, 0x62, 0x7b, 0xa8, 0x9e, 0x19, 0xd1, 0xc6,
    0xae, 0x11, 0xce, 0xe1, 0x6e, 0xc4, 0x20, 0xc3,
];

/// Contract
#[contract]
pub struct UltraHonkVerifierContract;

#[contracterror]
#[repr(u32)]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
pub enum Error {
    VkParseError = 1,
    ProofParseError = 2,
    VerificationFailed = 3,
    VkNotSet = 4,
    InvalidGuessLength = 5,
    InvalidCharacter = 6,
    InvalidMerkleProof = 7,
    MerkleRootNotSet = 8,
    GuessWordMismatch = 9,
    GameExpired = 10,
    NoActiveGame = 11,
    GameNotWon = 12,
    NoEscrow = 13,
}

#[contractimpl]
impl UltraHonkVerifierContract {
    fn key_vk() -> Symbol {
        symbol_short!("vk")
    }

    fn key_game_deadline(player: &Address) -> (Symbol, Address) {
        (symbol_short!("gm_dead"), player.clone())
    }

    fn key_escrow_token(player: &Address) -> (Symbol, Address) {
        (symbol_short!("es_token"), player.clone())
    }

    fn key_escrow_amount(player: &Address) -> (Symbol, Address) {
        (symbol_short!("es_amt"), player.clone())
    }

    fn key_game_won(player: &Address) -> (Symbol, Address) {
        (symbol_short!("gm_won"), player.clone())
    }

    /// Initialize the on-chain VK at deploy time.
    pub fn __constructor(env: Env, vk_bytes: Bytes) -> Result<(), Error> {
        env.storage().instance().set(&Self::key_vk(), &vk_bytes);
        Ok(())
    }

    /// Start a new game for the caller. Records deadline = now + 5 min.
    /// If `amount > 0`, transfers tokens from the player to the contract as escrow.
    /// Returns the deadline ledger timestamp (seconds).
    pub fn create_game(
        env: Env,
        player: Address,
        token_addr: Address,
        amount: i128,
    ) -> Result<u64, Error> {
        player.require_auth();

        // Clear any previous win state
        let won_key = Self::key_game_won(&player);
        env.storage().temporary().remove(&won_key);

        // Transfer escrow from player to contract if amount > 0
        if amount > 0 {
            let token_client = token::TokenClient::new(&env, &token_addr);
            token_client.transfer(&player, &env.current_contract_address(), &amount);

            let tk = Self::key_escrow_token(&player);
            env.storage().temporary().set(&tk, &token_addr);
            env.storage().temporary().extend_ttl(&tk, 500, 500);

            let ak = Self::key_escrow_amount(&player);
            env.storage().temporary().set(&ak, &amount);
            env.storage().temporary().extend_ttl(&ak, 500, 500);
        }

        let deadline = env.ledger().timestamp() + GAME_DURATION_SECS;
        let key = Self::key_game_deadline(&player);
        env.storage().temporary().set(&key, &deadline);
        env.storage().temporary().extend_ttl(&key, 500, 500);
        Ok(deadline)
    }

    /// Query the game deadline for a player. Returns 0 if no active game.
    pub fn get_game_deadline(env: Env, player: Address) -> u64 {
        let key = Self::key_game_deadline(&player);
        env.storage().temporary().get(&key).unwrap_or(0)
    }

    /// Verify an UltraHonk proof using the stored VK.
    pub fn verify_proof(env: Env, public_inputs: Bytes, proof_bytes: Bytes) -> Result<(), Error> {
        Self::do_verify_proof(&env, &public_inputs, &proof_bytes)
    }

    /// Verify that a guessed word is in the dictionary via Merkle proof.
    pub fn verify_guess(
        env: Env,
        guess_word: Bytes,
        path_elements: Vec<BytesN<32>>,
        path_indices: Vec<u32>,
    ) -> Result<(), Error> {
        Self::do_verify_guess(&env, &guess_word, &path_elements, &path_indices)
    }

    /// Combined: verify the guess is a valid word AND verify the ZK proof — single transaction.
    /// Enforces the 5-minute game timer.
    pub fn verify_guess_and_proof(
        env: Env,
        player: Address,
        guess_word: Bytes,
        path_elements: Vec<BytesN<32>>,
        path_indices: Vec<u32>,
        public_inputs: Bytes,
        proof_bytes: Bytes,
    ) -> Result<(), Error> {
        player.require_auth();

        // 0. Timer enforcement — check the game is still active
        let key = Self::key_game_deadline(&player);
        let deadline: u64 = env
            .storage()
            .temporary()
            .get(&key)
            .ok_or(Error::NoActiveGame)?;
        if env.ledger().timestamp() > deadline {
            return Err(Error::GameExpired);
        }

        // 1. Merkle proof — is this a valid English word?
        Self::do_verify_guess(&env, &guess_word, &path_elements, &path_indices)?;

        // 2. Cross-check: Merkle word must match the guess letters in public_inputs.
        //    Public inputs layout: [commitment(32B), letter1(32B), letter2(32B), ..., letter5(32B), results...]
        //    Each letter field is 32-byte BE, with the ASCII code in the last byte (index 31).
        for i in 0u32..5 {
            let field_offset = 32 + i * 32; // skip commitment hash, then i-th letter field
            let letter_byte = public_inputs.get(field_offset + 31).unwrap_or(0);
            let word_byte = guess_word.get(i).unwrap();
            if letter_byte != word_byte {
                return Err(Error::GuessWordMismatch);
            }
        }

        // 3. ZK proof — is the wordle result correct?
        Self::do_verify_proof(&env, &public_inputs, &proof_bytes)?;

        // 4. Win detection — check if all 5 result fields are 2 (correct).
        //    Results start at offset 192 (after commitment + 5 letters).
        //    Each result is a 32-byte BE field; the value is in the last byte.
        let mut all_correct = true;
        for i in 0u32..5 {
            let offset = 192 + i * 32 + 31;
            if public_inputs.get(offset).unwrap_or(0) != 2 {
                all_correct = false;
                break;
            }
        }
        if all_correct {
            let won_key = Self::key_game_won(&player);
            env.storage().temporary().set(&won_key, &true);
            env.storage().temporary().extend_ttl(&won_key, 500, 500);
        }

        Ok(())
    }

    /// Withdraw escrowed tokens after winning the game.
    pub fn withdraw(env: Env, player: Address) -> Result<i128, Error> {
        player.require_auth();

        let won_key = Self::key_game_won(&player);
        let won: bool = env.storage().temporary().get(&won_key).unwrap_or(false);
        if !won {
            return Err(Error::GameNotWon);
        }

        let tk = Self::key_escrow_token(&player);
        let token_addr: Address = env
            .storage()
            .temporary()
            .get(&tk)
            .ok_or(Error::NoEscrow)?;

        let ak = Self::key_escrow_amount(&player);
        let amount: i128 = env
            .storage()
            .temporary()
            .get(&ak)
            .ok_or(Error::NoEscrow)?;

        // Transfer tokens back to the player
        let token_client = token::TokenClient::new(&env, &token_addr);
        token_client.transfer(&env.current_contract_address(), &player, &amount);

        // Clean up storage
        env.storage().temporary().remove(&tk);
        env.storage().temporary().remove(&ak);
        env.storage().temporary().remove(&won_key);

        Ok(amount)
    }

    // ── Private helpers ──────────────────────────────────────────────────

    fn do_verify_proof(env: &Env, public_inputs: &Bytes, proof_bytes: &Bytes) -> Result<(), Error> {
        if proof_bytes.len() as usize != PROOF_BYTES {
            return Err(Error::ProofParseError);
        }

        let vk_bytes: Bytes = env
            .storage()
            .instance()
            .get(&Self::key_vk())
            .ok_or(Error::VkNotSet)?;
        let verifier =
            UltraHonkVerifier::new(env, &vk_bytes).map_err(|_| Error::VkParseError)?;

        verifier
            .verify(proof_bytes, public_inputs)
            .map_err(|_| Error::VerificationFailed)?;
        Ok(())
    }

    fn do_verify_guess(
        env: &Env,
        guess_word: &Bytes,
        path_elements: &Vec<BytesN<32>>,
        path_indices: &Vec<u32>,
    ) -> Result<(), Error> {
        // 1. Validate word length
        if guess_word.len() != 5 {
            return Err(Error::InvalidGuessLength);
        }

        // 2. Validate each character is lowercase ASCII (a-z)
        let mut word_bytes = [0u8; 5];
        for i in 0..5 {
            let b = guess_word.get(i as u32).unwrap();
            if b < 0x61 || b > 0x7A {
                return Err(Error::InvalidCharacter);
            }
            word_bytes[i] = b;
        }

        // 3. Convert word to field element (big-endian, 32-byte padded)
        //    word_as_field = word[0]*256^4 + word[1]*256^3 + ... + word[4]
        let mut leaf = [0u8; 32];
        for i in 0..5 {
            leaf[27 + i] = word_bytes[i]; // Last 5 bytes of 32-byte array
        }

        // 4. Walk the Merkle path (14 keccak256 hashes — very cheap as host calls)
        let depth = path_elements.len();
        let mut current_hash = Bytes::from_array(env, &leaf);

        for i in 0..depth {
            let sibling_arr: [u8; 32] = path_elements.get(i).unwrap().into();
            let sibling = Bytes::from_array(env, &sibling_arr);
            let idx = path_indices.get(i).unwrap();

            let mut preimage = Bytes::new(env);
            if idx == 0 {
                preimage.append(&current_hash);
                preimage.append(&sibling);
            } else {
                preimage.append(&sibling);
                preimage.append(&current_hash);
            }

            let hash_result = env.crypto().keccak256(&preimage);
            current_hash = Bytes::from_array(env, &hash_result.to_array());
        }

        // 5. Compare to hardcoded Merkle root
        let stored_root_bytes = Bytes::from_array(env, &MERKLE_ROOT);

        if current_hash != stored_root_bytes {
            return Err(Error::InvalidMerkleProof);
        }

        Ok(())
    }
}
