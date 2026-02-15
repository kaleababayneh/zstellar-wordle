#![no_std]
use soroban_sdk::{
    contract, contracterror, contractimpl, symbol_short, Address, Bytes, BytesN, Env, Symbol, Vec,
};
use ultrahonk_soroban_verifier::{UltraHonkVerifier, PROOF_BYTES};

/// 5 minutes in ledger seconds
const GAME_DURATION_SECS: u64 = 300;

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
}

#[contractimpl]
impl UltraHonkVerifierContract {
    fn key_vk() -> Symbol {
        symbol_short!("vk")
    }

    fn key_merkle_root() -> Symbol {
        symbol_short!("mk_root")
    }

    fn key_game_deadline(player: &Address) -> (Symbol, Address) {
        (symbol_short!("gm_dead"), player.clone())
    }

    /// Initialize the on-chain VK and Merkle root at deploy time.
    pub fn __constructor(env: Env, vk_bytes: Bytes, merkle_root: BytesN<32>) -> Result<(), Error> {
        env.storage().instance().set(&Self::key_vk(), &vk_bytes);
        env.storage()
            .instance()
            .set(&Self::key_merkle_root(), &merkle_root);
        Ok(())
    }

    /// Start a new game for the caller. Records deadline = now + 5 min.
    /// Returns the deadline ledger timestamp (seconds).
    pub fn create_game(env: Env, player: Address) -> Result<u64, Error> {
        player.require_auth();
        let deadline = env.ledger().timestamp() + GAME_DURATION_SECS;
        let key = Self::key_game_deadline(&player);
        env.storage().temporary().set(&key, &deadline);
        // Extend TTL well beyond the game duration
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
        Ok(())
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

        // 5. Compare to stored Merkle root
        let stored_root: BytesN<32> = env
            .storage()
            .instance()
            .get(&Self::key_merkle_root())
            .ok_or(Error::MerkleRootNotSet)?;
        let stored_root_bytes = Bytes::from_array(env, &<[u8; 32]>::from(stored_root));

        if current_hash != stored_root_bytes {
            return Err(Error::InvalidMerkleProof);
        }

        Ok(())
    }
}
