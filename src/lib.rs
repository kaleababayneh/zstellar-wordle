#![no_std]
use soroban_sdk::{
    contract, contracterror, contractimpl, symbol_short, token, Address, Bytes, BytesN, Env,
    Symbol, Vec,
};
use ultrahonk_soroban_verifier::{UltraHonkVerifier, PROOF_BYTES};

/// 5 minutes per turn in ledger seconds
const TURN_DURATION_SECS: u64 = 300;

/// Maximum turns: 6 guesses per player = 12 turns + 1 final verification = 13
const MAX_TURNS: u32 = 13;

/// Keccak256 Merkle root of the 5-letter word dictionary (12 653 words, depth 14).
const MERKLE_ROOT: [u8; 32] = [
    0xca, 0x51, 0x82, 0xba, 0xc9, 0xd0, 0xec, 0x16,
    0xa6, 0x6d, 0x0c, 0x25, 0x21, 0x48, 0x07, 0xa6,
    0xe3, 0x62, 0x7b, 0xa8, 0x9e, 0x19, 0xd1, 0xc6,
    0xae, 0x11, 0xce, 0xe1, 0x6e, 0xc4, 0x20, 0xc3,
];

/// Game phases
const PHASE_WAITING: u32 = 0;  // Waiting for player 2
const PHASE_ACTIVE: u32 = 1;   // Game in progress
const PHASE_REVEAL: u32 = 2;   // Winner must reveal their word
const PHASE_FINALIZED: u32 = 3; // Winner confirmed, ready for withdrawal
const PHASE_DRAW: u32 = 4;      // Max turns reached, no winner

/// Contract
#[contract]
pub struct TwoPlayerWordleContract;

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
    GuessWordMismatch = 8,
    GameExpired = 9,
    NoActiveGame = 10,
    GameAlreadyExists = 11,
    WrongPlayer = 12,
    WrongPhase = 13,
    NotYourTurn = 14,
    EscrowMismatch = 15,
    AlreadyWithdrawn = 16,
    NotWinner = 17,
    InvalidReveal = 18,
}

#[contractimpl]
impl TwoPlayerWordleContract {
    // Storage keys (game_id = player1's address)
    fn key_vk() -> Symbol {
        symbol_short!("vk")
    }

    fn key_game_phase(game_id: &Address) -> (Symbol, Address) {
        (symbol_short!("gm_phase"), game_id.clone())
    }

    fn key_game_p1(game_id: &Address) -> (Symbol, Address) {
        (symbol_short!("gm_p1"), game_id.clone())
    }

    fn key_game_p2(game_id: &Address) -> (Symbol, Address) {
        (symbol_short!("gm_p2"), game_id.clone())
    }

    fn key_game_c1(game_id: &Address) -> (Symbol, Address) {
        (symbol_short!("gm_c1"), game_id.clone())
    }

    fn key_game_c2(game_id: &Address) -> (Symbol, Address) {
        (symbol_short!("gm_c2"), game_id.clone())
    }

    fn key_game_turn(game_id: &Address) -> (Symbol, Address) {
        (symbol_short!("gm_turn"), game_id.clone())
    }

    fn key_game_deadline(game_id: &Address) -> (Symbol, Address) {
        (symbol_short!("gm_dead"), game_id.clone())
    }

    fn key_game_guess(game_id: &Address) -> (Symbol, Address) {
        (symbol_short!("gm_guess"), game_id.clone())
    }

    fn key_game_results(game_id: &Address) -> (Symbol, Address) {
        (symbol_short!("gm_res"), game_id.clone())
    }

    fn key_game_winner(game_id: &Address) -> (Symbol, Address) {
        (symbol_short!("gm_win"), game_id.clone())
    }

    fn key_escrow_token(game_id: &Address) -> (Symbol, Address) {
        (symbol_short!("es_token"), game_id.clone())
    }

    fn key_escrow_amount(game_id: &Address) -> (Symbol, Address) {
        (symbol_short!("es_amt"), game_id.clone())
    }

    fn key_p1_withdrawn(game_id: &Address) -> (Symbol, Address) {
        (symbol_short!("p1_wd"), game_id.clone())
    }

    fn key_p2_withdrawn(game_id: &Address) -> (Symbol, Address) {
        (symbol_short!("p2_wd"), game_id.clone())
    }

    fn key_p1_time(game_id: &Address) -> (Symbol, Address) {
        (symbol_short!("p1_time"), game_id.clone())
    }

    fn key_p2_time(game_id: &Address) -> (Symbol, Address) {
        (symbol_short!("p2_time"), game_id.clone())
    }

    /// Initialize the on-chain VK at deploy time.
    pub fn __constructor(env: Env, vk_bytes: Bytes) -> Result<(), Error> {
        env.storage().instance().set(&Self::key_vk(), &vk_bytes);
        Ok(())
    }

    /// Player 1 creates a new game with their commitment and escrow.
    /// game_id = player1's address
    pub fn create_game(
        env: Env,
        player1: Address,
        commitment1: BytesN<32>,
        token_addr: Address,
        amount: i128,
    ) -> Result<(), Error> {
        player1.require_auth();

        // Check if game already exists
        let phase_key = Self::key_game_phase(&player1);
        if env.storage().temporary().has(&phase_key) {
            return Err(Error::GameAlreadyExists);
        }

        // Transfer escrow from player1 to contract
        if amount > 0 {
            let token_client = token::TokenClient::new(&env, &token_addr);
            token_client.transfer(&player1, &env.current_contract_address(), &amount);
        }

        // Store game state
        env.storage().temporary().set(&phase_key, &PHASE_WAITING);
        env.storage().temporary().extend_ttl(&phase_key, 5000, 5000);

        let p1_key = Self::key_game_p1(&player1);
        env.storage().temporary().set(&p1_key, &player1);
        env.storage().temporary().extend_ttl(&p1_key, 5000, 5000);

        let c1_key = Self::key_game_c1(&player1);
        env.storage().temporary().set(&c1_key, &commitment1);
        env.storage().temporary().extend_ttl(&c1_key, 5000, 5000);

        let token_key = Self::key_escrow_token(&player1);
        env.storage().temporary().set(&token_key, &token_addr);
        env.storage().temporary().extend_ttl(&token_key, 5000, 5000);

        let amt_key = Self::key_escrow_amount(&player1);
        env.storage().temporary().set(&amt_key, &amount);
        env.storage().temporary().extend_ttl(&amt_key, 5000, 5000);

        Ok(())
    }

    /// Player 2 joins an existing game with matching escrow.
    pub fn join_game(
        env: Env,
        game_id: Address,
        player2: Address,
        commitment2: BytesN<32>,
    ) -> Result<(), Error> {
        player2.require_auth();

        // Check game exists and is waiting for player 2
        let phase_key = Self::key_game_phase(&game_id);
        let phase: u32 = env
            .storage()
            .temporary()
            .get(&phase_key)
            .ok_or(Error::NoActiveGame)?;
        if phase != PHASE_WAITING {
            return Err(Error::WrongPhase);
        }

        // Transfer escrow from player2 to contract (match player1's amount)
        let amt_key = Self::key_escrow_amount(&game_id);
        let amount: i128 = env.storage().temporary().get(&amt_key).unwrap_or(0);
        if amount > 0 {
            let token_key = Self::key_escrow_token(&game_id);
            let token_addr: Address = env
                .storage()
                .temporary()
                .get(&token_key)
                .ok_or(Error::NoActiveGame)?;
            let token_client = token::TokenClient::new(&env, &token_addr);
            token_client.transfer(&player2, &env.current_contract_address(), &amount);
        }

        // Store player2 and their commitment
        let p2_key = Self::key_game_p2(&game_id);
        env.storage().temporary().set(&p2_key, &player2);
        env.storage().temporary().extend_ttl(&p2_key, 5000, 5000);

        let c2_key = Self::key_game_c2(&game_id);
        env.storage().temporary().set(&c2_key, &commitment2);
        env.storage().temporary().extend_ttl(&c2_key, 5000, 5000);

        // Initialize game: phase = active, turn = 1
        env.storage().temporary().set(&phase_key, &PHASE_ACTIVE);

        let turn_key = Self::key_game_turn(&game_id);
        env.storage().temporary().set(&turn_key, &1u32);
        env.storage().temporary().extend_ttl(&turn_key, 5000, 5000);

        // Initialize chess clock: both players get 300 seconds
        let p1_time_key = Self::key_p1_time(&game_id);
        env.storage().temporary().set(&p1_time_key, &TURN_DURATION_SECS);
        env.storage().temporary().extend_ttl(&p1_time_key, 5000, 5000);

        let p2_time_key = Self::key_p2_time(&game_id);
        env.storage().temporary().set(&p2_time_key, &TURN_DURATION_SECS);
        env.storage().temporary().extend_ttl(&p2_time_key, 5000, 5000);

        // Set deadline for player1's first turn
        let deadline = env.ledger().timestamp() + TURN_DURATION_SECS;
        let dead_key = Self::key_game_deadline(&game_id);
        env.storage().temporary().set(&dead_key, &deadline);
        env.storage().temporary().extend_ttl(&dead_key, 5000, 5000);

        Ok(())
    }

    /// Submit a turn: verify opponent's previous guess (if turn > 1) and make your own guess.
    /// Turn 1: P1 just submits their guess (no ZK proof needed)
    /// Turn 2+: Current player provides ZK proof of opponent's previous guess + submits new guess
    /// Turn 13: P1 verify-only (no new guess)
    pub fn submit_turn(
        env: Env,
        game_id: Address,
        caller: Address,
        my_guess_word: Bytes,          // empty on turn 13
        path_elements: Vec<BytesN<32>>, // Merkle proof for my_guess_word
        path_indices: Vec<u32>,
        public_inputs: Bytes,           // empty on turn 1
        proof_bytes: Bytes,             // empty on turn 1
    ) -> Result<(), Error> {
        caller.require_auth();

        // Check game phase
        let phase_key = Self::key_game_phase(&game_id);
        let phase: u32 = env
            .storage()
            .temporary()
            .get(&phase_key)
            .ok_or(Error::NoActiveGame)?;
        if phase != PHASE_ACTIVE {
            return Err(Error::WrongPhase);
        }

        // Check deadline hasn't passed
        let dead_key = Self::key_game_deadline(&game_id);
        let deadline: u64 = env
            .storage()
            .temporary()
            .get(&dead_key)
            .ok_or(Error::NoActiveGame)?;
        if env.ledger().timestamp() > deadline {
            return Err(Error::GameExpired);
        }

        // Get current turn
        let turn_key = Self::key_game_turn(&game_id);
        let turn: u32 = env
            .storage()
            .temporary()
            .get(&turn_key)
            .ok_or(Error::NoActiveGame)?;

        // Get players
        let p1_key = Self::key_game_p1(&game_id);
        let player1: Address = env
            .storage()
            .temporary()
            .get(&p1_key)
            .ok_or(Error::NoActiveGame)?;
        let p2_key = Self::key_game_p2(&game_id);
        let player2: Address = env
            .storage()
            .temporary()
            .get(&p2_key)
            .ok_or(Error::NoActiveGame)?;

        // Determine whose turn it is (odd = p1, even = p2)
        let expected_player = if turn % 2 == 1 { &player1 } else { &player2 };
        if &caller != expected_player {
            return Err(Error::NotYourTurn);
        }

        let opponent = if &caller == &player1 {
            &player2
        } else {
            &player1
        };

        // Turn 1: P1 just submits their guess
        if turn == 1 {
            // Validate guess word via Merkle proof
            Self::do_verify_guess(&env, &my_guess_word, &path_elements, &path_indices)?;

            // Store the guess
            let guess_key = Self::key_game_guess(&game_id);
            env.storage().temporary().set(&guess_key, &my_guess_word);
            env.storage().temporary().extend_ttl(&guess_key, 5000, 5000);

            // Advance turn
            env.storage().temporary().set(&turn_key, &2u32);

            // Update chess clock: P1's time remains, set deadline for P2
            let p1_time_key = Self::key_p1_time(&game_id);
            let p1_remaining = TURN_DURATION_SECS - (env.ledger().timestamp() - (deadline - TURN_DURATION_SECS));
            env.storage().temporary().set(&p1_time_key, &p1_remaining);

            let p2_time_key = Self::key_p2_time(&game_id);
            let p2_remaining: u64 = env.storage().temporary().get(&p2_time_key).unwrap_or(TURN_DURATION_SECS);
            let new_deadline = env.ledger().timestamp() + p2_remaining;
            env.storage().temporary().set(&dead_key, &new_deadline);

            return Ok(());
        }

        // Turn 2+: Verify opponent's previous guess with ZK proof
        // Get CALLER's stored commitment (the proof proves knowledge of the caller's word)
        let my_commitment: BytesN<32> = if &caller == &player1 {
            let c1_key = Self::key_game_c1(&game_id);
            env.storage()
                .temporary()
                .get(&c1_key)
                .ok_or(Error::NoActiveGame)?
        } else {
            let c2_key = Self::key_game_c2(&game_id);
            env.storage()
                .temporary()
                .get(&c2_key)
                .ok_or(Error::NoActiveGame)?
        };

        // Get opponent's previous guess
        let guess_key = Self::key_game_guess(&game_id);
        let opponent_guess: Bytes = env
            .storage()
            .temporary()
            .get(&guess_key)
            .ok_or(Error::NoActiveGame)?;

        // Extract commitment from public_inputs (first 32 bytes)
        let mut commitment_from_proof = [0u8; 32];
        for i in 0..32usize {
            commitment_from_proof[i] = public_inputs.get(i as u32).unwrap_or(0);
        }

        // Verify commitment matches
        let commitment_from_proof_bytes = BytesN::from_array(&env, &commitment_from_proof);
        if my_commitment != commitment_from_proof_bytes {
            return Err(Error::GuessWordMismatch);
        }

        // Verify guess letters match what's in public_inputs
        for i in 0u32..5 {
            let field_offset = 32 + i * 32;
            let letter_byte = public_inputs.get(field_offset + 31).unwrap_or(0);
            let guess_byte = opponent_guess.get(i).unwrap();
            if letter_byte != guess_byte {
                return Err(Error::GuessWordMismatch);
            }
        }

        // Verify ZK proof
        Self::do_verify_proof(&env, &public_inputs, &proof_bytes)?;

        // Extract results (5 values starting at offset 192)
        let mut all_correct = true;
        let mut results = Bytes::new(&env);
        for i in 0u32..5 {
            let offset = 192 + i * 32 + 31;
            let result = public_inputs.get(offset).unwrap_or(0);
            results.push_back(result);
            if result != 2 {
                all_correct = false;
            }
        }

        // Store results for opponent to read
        let res_key = Self::key_game_results(&game_id);
        env.storage().temporary().set(&res_key, &results);
        env.storage().temporary().extend_ttl(&res_key, 5000, 5000);

        // Check if opponent won (guessed correctly)
        if all_correct {
            // Opponent wins! Move to reveal phase
            env.storage().temporary().set(&phase_key, &PHASE_REVEAL);
            let win_key = Self::key_game_winner(&game_id);
            env.storage().temporary().set(&win_key, opponent);
            env.storage().temporary().extend_ttl(&win_key, 5000, 5000);

            // Set reveal deadline
            let reveal_deadline = env.ledger().timestamp() + TURN_DURATION_SECS;
            env.storage().temporary().set(&dead_key, &reveal_deadline);
            return Ok(());
        }

        // Turn 13 (verify-only): no new guess, check for draw
        if turn == MAX_TURNS {
            // All turns exhausted, no winner → draw
            env.storage().temporary().set(&phase_key, &PHASE_DRAW);
            return Ok(());
        }

        // Continue playing: validate and store my new guess
        Self::do_verify_guess(&env, &my_guess_word, &path_elements, &path_indices)?;
        env.storage().temporary().set(&guess_key, &my_guess_word);

        // Advance turn
        env.storage().temporary().set(&turn_key, &(turn + 1));

        // Update chess clock
        let my_time_key = if &caller == &player1 {
            Self::key_p1_time(&game_id)
        } else {
            Self::key_p2_time(&game_id)
        };
        let opponent_time_key = if opponent == &player1 {
            Self::key_p1_time(&game_id)
        } else {
            Self::key_p2_time(&game_id)
        };

        let my_remaining = deadline.saturating_sub(env.ledger().timestamp());
        env.storage().temporary().set(&my_time_key, &my_remaining);

        let opponent_remaining: u64 = env
            .storage()
            .temporary()
            .get(&opponent_time_key)
            .unwrap_or(TURN_DURATION_SECS);
        let new_deadline = env.ledger().timestamp() + opponent_remaining;
        env.storage().temporary().set(&dead_key, &new_deadline);

        Ok(())
    }

    /// Winner reveals their word: proves it matches commitment via ZK proof + proves it's in dictionary via Merkle.
    /// The ZK proof is the winner "guessing their own word" — all results must be 2.
    pub fn reveal_word(
        env: Env,
        game_id: Address,
        caller: Address,
        reveal_word: Bytes,
        path_elements: Vec<BytesN<32>>,
        path_indices: Vec<u32>,
        public_inputs: Bytes,
        proof_bytes: Bytes,
    ) -> Result<(), Error> {
        caller.require_auth();

        // Check game is in reveal phase
        let phase_key = Self::key_game_phase(&game_id);
        let phase: u32 = env
            .storage()
            .temporary()
            .get(&phase_key)
            .ok_or(Error::NoActiveGame)?;
        if phase != PHASE_REVEAL {
            return Err(Error::WrongPhase);
        }

        // Check reveal deadline
        let dead_key = Self::key_game_deadline(&game_id);
        let deadline: u64 = env
            .storage()
            .temporary()
            .get(&dead_key)
            .ok_or(Error::NoActiveGame)?;
        if env.ledger().timestamp() > deadline {
            return Err(Error::GameExpired);
        }

        // Caller must be the winner
        let win_key = Self::key_game_winner(&game_id);
        let winner: Address = env
            .storage()
            .temporary()
            .get(&win_key)
            .ok_or(Error::NoActiveGame)?;
        if caller != winner {
            return Err(Error::NotWinner);
        }

        // Get the winner's stored commitment
        let p1_key = Self::key_game_p1(&game_id);
        let player1: Address = env
            .storage()
            .temporary()
            .get(&p1_key)
            .ok_or(Error::NoActiveGame)?;

        let winner_commitment: BytesN<32> = if caller == player1 {
            let c1_key = Self::key_game_c1(&game_id);
            env.storage()
                .temporary()
                .get(&c1_key)
                .ok_or(Error::NoActiveGame)?
        } else {
            let c2_key = Self::key_game_c2(&game_id);
            env.storage()
                .temporary()
                .get(&c2_key)
                .ok_or(Error::NoActiveGame)?
        };

        // Extract commitment from public_inputs and verify it matches stored
        let mut commitment_from_proof = [0u8; 32];
        for i in 0..32usize {
            commitment_from_proof[i] = public_inputs.get(i as u32).unwrap_or(0);
        }
        let commitment_from_proof_bytes = BytesN::from_array(&env, &commitment_from_proof);
        if winner_commitment != commitment_from_proof_bytes {
            return Err(Error::InvalidReveal);
        }

        // Verify the revealed word letters match public_inputs
        if reveal_word.len() != 5 {
            return Err(Error::InvalidGuessLength);
        }
        for i in 0u32..5 {
            let field_offset = 32 + i * 32;
            let letter_byte = public_inputs.get(field_offset + 31).unwrap_or(0);
            let word_byte = reveal_word.get(i).unwrap();
            if letter_byte != word_byte {
                return Err(Error::InvalidReveal);
            }
        }

        // All results must be 2 (player guessed their own word correctly)
        for i in 0u32..5 {
            let offset = 192 + i * 32 + 31;
            if public_inputs.get(offset).unwrap_or(0) != 2 {
                return Err(Error::InvalidReveal);
            }
        }

        // Verify ZK proof
        Self::do_verify_proof(&env, &public_inputs, &proof_bytes)?;

        // Verify Merkle proof: is the word in the dictionary?
        let merkle_result =
            Self::do_verify_guess(&env, &reveal_word, &path_elements, &path_indices);

        if merkle_result.is_ok() {
            // Word is valid — winner confirmed, finalize
            env.storage().temporary().set(&phase_key, &PHASE_FINALIZED);
        } else {
            // Word NOT in dictionary — winner cheated!
            // Swap winner to the other player
            let p2_key = Self::key_game_p2(&game_id);
            let player2: Address = env
                .storage()
                .temporary()
                .get(&p2_key)
                .ok_or(Error::NoActiveGame)?;
            let new_winner = if caller == player1 {
                player2
            } else {
                player1
            };
            env.storage().temporary().set(&win_key, &new_winner);
            env.storage().temporary().set(&phase_key, &PHASE_FINALIZED);
        }

        Ok(())
    }

    /// Claim timeout: if the opponent didn't play in time, you win.
    pub fn claim_timeout(
        env: Env,
        game_id: Address,
        caller: Address,
    ) -> Result<(), Error> {
        caller.require_auth();

        let phase_key = Self::key_game_phase(&game_id);
        let phase: u32 = env
            .storage()
            .temporary()
            .get(&phase_key)
            .ok_or(Error::NoActiveGame)?;

        // Must be in active or reveal phase
        if phase != PHASE_ACTIVE && phase != PHASE_REVEAL {
            return Err(Error::WrongPhase);
        }

        // Check deadline has actually passed
        let dead_key = Self::key_game_deadline(&game_id);
        let deadline: u64 = env
            .storage()
            .temporary()
            .get(&dead_key)
            .ok_or(Error::NoActiveGame)?;
        if env.ledger().timestamp() <= deadline {
            return Err(Error::WrongPhase); // too early to claim timeout
        }

        // Get players
        let p1_key = Self::key_game_p1(&game_id);
        let player1: Address = env
            .storage()
            .temporary()
            .get(&p1_key)
            .ok_or(Error::NoActiveGame)?;
        let p2_key = Self::key_game_p2(&game_id);
        let player2: Address = env
            .storage()
            .temporary()
            .get(&p2_key)
            .ok_or(Error::NoActiveGame)?;

        if phase == PHASE_ACTIVE {
            // In active phase, the person whose turn it is timed out
            let turn_key = Self::key_game_turn(&game_id);
            let turn: u32 = env
                .storage()
                .temporary()
                .get(&turn_key)
                .ok_or(Error::NoActiveGame)?;
            let timed_out_player = if turn % 2 == 1 { &player1 } else { &player2 };

            // Caller must be the opponent of the timed-out player
            if &caller == timed_out_player {
                return Err(Error::WrongPlayer);
            }
        } else {
            // In reveal phase, the winner timed out on their reveal
            let win_key = Self::key_game_winner(&game_id);
            let current_winner: Address = env
                .storage()
                .temporary()
                .get(&win_key)
                .ok_or(Error::NoActiveGame)?;

            // Caller must be the non-winner (the one claiming timeout)
            if caller == current_winner {
                return Err(Error::WrongPlayer);
            }
        }

        // Caller wins by timeout
        let win_key = Self::key_game_winner(&game_id);
        env.storage().temporary().set(&win_key, &caller);
        env.storage().temporary().extend_ttl(&win_key, 5000, 5000);
        env.storage().temporary().set(&phase_key, &PHASE_FINALIZED);

        Ok(())
    }

    /// Withdraw escrow after game ends.
    /// In finalized phase: winner gets the full pot (2x escrow).
    /// In draw phase: each player gets their own escrow back.
    pub fn withdraw(
        env: Env,
        game_id: Address,
        caller: Address,
    ) -> Result<i128, Error> {
        caller.require_auth();

        let phase_key = Self::key_game_phase(&game_id);
        let phase: u32 = env
            .storage()
            .temporary()
            .get(&phase_key)
            .ok_or(Error::NoActiveGame)?;

        if phase != PHASE_FINALIZED && phase != PHASE_DRAW {
            return Err(Error::WrongPhase);
        }

        // Check the caller is a player
        let p1_key = Self::key_game_p1(&game_id);
        let player1: Address = env
            .storage()
            .temporary()
            .get(&p1_key)
            .ok_or(Error::NoActiveGame)?;
        let p2_key = Self::key_game_p2(&game_id);
        let player2: Address = env
            .storage()
            .temporary()
            .get(&p2_key)
            .ok_or(Error::NoActiveGame)?;

        let is_p1 = caller == player1;
        let is_p2 = caller == player2;
        if !is_p1 && !is_p2 {
            return Err(Error::WrongPlayer);
        }

        // Check if already withdrawn
        let wd_key = if is_p1 {
            Self::key_p1_withdrawn(&game_id)
        } else {
            Self::key_p2_withdrawn(&game_id)
        };
        let already_withdrawn: bool = env.storage().temporary().get(&wd_key).unwrap_or(false);
        if already_withdrawn {
            return Err(Error::AlreadyWithdrawn);
        }

        let amt_key = Self::key_escrow_amount(&game_id);
        let escrow_per_player: i128 = env.storage().temporary().get(&amt_key).unwrap_or(0);

        let token_key = Self::key_escrow_token(&game_id);
        let token_addr: Address = env
            .storage()
            .temporary()
            .get(&token_key)
            .ok_or(Error::NoActiveGame)?;

        let payout: i128;

        if phase == PHASE_FINALIZED {
            // Only winner can withdraw, gets full pot
            let win_key = Self::key_game_winner(&game_id);
            let winner: Address = env
                .storage()
                .temporary()
                .get(&win_key)
                .ok_or(Error::NoActiveGame)?;
            if caller != winner {
                return Err(Error::NotWinner);
            }
            payout = escrow_per_player * 2;
        } else {
            // Draw: each player gets their own escrow back
            payout = escrow_per_player;
        }

        if payout > 0 {
            let token_client = token::TokenClient::new(&env, &token_addr);
            token_client.transfer(&env.current_contract_address(), &caller, &payout);
        }

        // Mark as withdrawn
        env.storage().temporary().set(&wd_key, &true);
        env.storage().temporary().extend_ttl(&wd_key, 5000, 5000);

        Ok(payout)
    }

    // ── Query functions ──────────────────────────────────────────────────

    pub fn get_game_phase(env: Env, game_id: Address) -> u32 {
        let key = Self::key_game_phase(&game_id);
        env.storage().temporary().get(&key).unwrap_or(255)
    }

    pub fn get_game_turn(env: Env, game_id: Address) -> u32 {
        let key = Self::key_game_turn(&game_id);
        env.storage().temporary().get(&key).unwrap_or(0)
    }

    pub fn get_game_deadline(env: Env, game_id: Address) -> u64 {
        let key = Self::key_game_deadline(&game_id);
        env.storage().temporary().get(&key).unwrap_or(0)
    }

    pub fn get_last_guess(env: Env, game_id: Address) -> Bytes {
        let key = Self::key_game_guess(&game_id);
        env.storage().temporary().get(&key).unwrap_or(Bytes::new(&env))
    }

    pub fn get_last_results(env: Env, game_id: Address) -> Bytes {
        let key = Self::key_game_results(&game_id);
        env.storage().temporary().get(&key).unwrap_or(Bytes::new(&env))
    }

    pub fn get_player1(env: Env, game_id: Address) -> Address {
        let key = Self::key_game_p1(&game_id);
        env.storage().temporary().get(&key).unwrap_or(game_id)
    }

    pub fn get_player2(env: Env, game_id: Address) -> Address {
        let key = Self::key_game_p2(&game_id);
        env.storage().temporary().get(&key).unwrap_or(game_id)
    }

    pub fn get_winner(env: Env, game_id: Address) -> Address {
        let key = Self::key_game_winner(&game_id);
        env.storage().temporary().get(&key).unwrap_or(game_id)
    }

    pub fn get_escrow_amount(env: Env, game_id: Address) -> i128 {
        let key = Self::key_escrow_amount(&game_id);
        env.storage().temporary().get(&key).unwrap_or(0)
    }

    pub fn get_p1_time(env: Env, game_id: Address) -> u64 {
        let key = Self::key_p1_time(&game_id);
        env.storage().temporary().get(&key).unwrap_or(0)
    }

    pub fn get_p2_time(env: Env, game_id: Address) -> u64 {
        let key = Self::key_p2_time(&game_id);
        env.storage().temporary().get(&key).unwrap_or(0)
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
        if guess_word.len() != 5 {
            return Err(Error::InvalidGuessLength);
        }

        let mut word_bytes = [0u8; 5];
        for i in 0..5 {
            let b = guess_word.get(i as u32).unwrap();
            if b < 0x61 || b > 0x7A {
                return Err(Error::InvalidCharacter);
            }
            word_bytes[i] = b;
        }

        let mut leaf = [0u8; 32];
        for i in 0..5 {
            leaf[27 + i] = word_bytes[i];
        }

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

        let stored_root_bytes = Bytes::from_array(env, &MERKLE_ROOT);
        if current_hash != stored_root_bytes {
            return Err(Error::InvalidMerkleProof);
        }

        Ok(())
    }
}
