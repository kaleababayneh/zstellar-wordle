#![no_std]
use soroban_sdk::{
    contract, contracterror, contractevent, contractimpl, symbol_short, token, Address, Bytes,
    BytesN, Env, IntoVal, String, Symbol, U256, Val, Vec,
};
use ultrahonk_soroban_verifier::{UltraHonkVerifier, PROOF_BYTES};

/// 5 minutes per turn in ledger seconds
const TURN_DURATION_SECS: u64 = 300;

/// Maximum turns: 6 guesses per player = 12 turns + 1 final verification = 13
const MAX_TURNS: u32 = 13;

/// Poseidon2 Merkle root of the 5-letter word dictionary (12 653 words, depth 14).
const MERKLE_ROOT: [u8; 32] = [
    0x0a, 0xe4, 0xb8, 0x21, 0xbc, 0xbf, 0xcc, 0x5f,
    0x6a, 0x3b, 0x71, 0x1a, 0x48, 0xce, 0xb8, 0xa8,
    0x6b, 0xaa, 0xd9, 0x69, 0xd6, 0x4f, 0xb9, 0x0c,
    0xfd, 0x2e, 0x2b, 0x36, 0x70, 0xe3, 0x7d, 0xc7,
];

/// Game phases
const PHASE_WAITING: u32 = 0;  // Waiting for player 2
const PHASE_ACTIVE: u32 = 1;   // Game in progress
const PHASE_REVEAL: u32 = 2;   // Winner must reveal their word
const PHASE_FINALIZED: u32 = 3; // Winner confirmed, ready for withdrawal
const PHASE_DRAW: u32 = 4;      // Max turns reached, no winner

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct GameCreated {
    #[topic]
    pub game_id: Address,
    pub player1: Address,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct GameJoined {
    #[topic]
    pub game_id: Address,
    pub player2: Address,
}

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
    AlreadyWithdrawn = 16,
    NotWinner = 17,
    InvalidReveal = 18,
    InvalidSessionKey = 19,
}

#[contractimpl]
impl TwoPlayerWordleContract {
    // Storage keys (game_id = player1's address)
    fn key_vk() -> Symbol {
        symbol_short!("vk")
    }

    fn key_wc_vk() -> Symbol {
        symbol_short!("wc_vk")
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

    fn key_p1_revealed(game_id: &Address) -> (Symbol, Address) {
        (symbol_short!("p1_rev"), game_id.clone())
    }

    fn key_p2_revealed(game_id: &Address) -> (Symbol, Address) {
        (symbol_short!("p2_rev"), game_id.clone())
    }

    fn key_p1_word(game_id: &Address) -> (Symbol, Address) {
        (symbol_short!("p1_word"), game_id.clone())
    }

    fn key_p2_word(game_id: &Address) -> (Symbol, Address) {
        (symbol_short!("p2_word"), game_id.clone())
    }

    // ── Persistent game registry keys ────────────────────────────────────

    fn key_game_count() -> Symbol {
        symbol_short!("gm_cnt")
    }

    fn key_game_at(index: u32) -> (Symbol, u32) {
        (symbol_short!("gm_at"), index)
    }

    fn key_game_creator(game_id: &Address) -> (Symbol, Address) {
        (symbol_short!("gm_crea"), game_id.clone())
    }

    fn key_session_id(game_id: &Address) -> (Symbol, Address) {
        (symbol_short!("gm_sid"), game_id.clone())
    }

    // ── Session key storage ───────────────────────────────────────────────
    // Maps (game_id, player) → session_key_address
    // Maps session_key_address → (game_id, player) for reverse lookup

    fn key_session_key(game_id: &Address, player: &Address) -> (Symbol, Address, Address) {
        (symbol_short!("sk"), game_id.clone(), player.clone())
    }

    fn key_session_reverse(session_key: &Address) -> (Symbol, Address) {
        (symbol_short!("sk_rev"), session_key.clone())
    }

    // ── Session key auth helper ───────────────────────────────────────────

    /// Simplified resolve_caller when we don't have player addresses yet.
    /// Requires auth from the caller and resolves session key if applicable.
    fn resolve_caller_simple(
        env: &Env,
        game_id: &Address,
        caller: &Address,
    ) -> Address {
        caller.require_auth();

        // Check if caller is a registered session key (reverse lookup)
        let rev_key = Self::key_session_reverse(caller);
        let lookup: Option<(Address, Address)> = env.storage().temporary().get(&rev_key);
        if let Some((stored_game_id, actual_player)) = lookup {
            if stored_game_id == *game_id {
                return actual_player;
            }
        }

        // Caller is the actual player
        caller.clone()
    }

    // ── Game Hub integration ─────────────────────────────────────────────

    fn game_hub_address(env: &Env) -> Address {
        Address::from_string(&String::from_str(
            env,
            "CB4VZAT2U3UC6XFK3N23SKRF2NDCMP3QHJYMCHHFMZO7MRQO6DQ2EMYG",
        ))
    }

    fn call_start_game(
        env: &Env,
        game_id: &Address,
        player1: &Address,
        player2: &Address,
    ) {
        let game_hub = Self::game_hub_address(env);
        let sid_key = Self::key_session_id(game_id);
        let session_id: u32 = env.storage().temporary().get(&sid_key).unwrap_or(0);

        let mut args: Vec<Val> = Vec::new(env);
        args.push_back(env.current_contract_address().into_val(env));
        args.push_back(session_id.into_val(env));
        args.push_back(player1.into_val(env));
        args.push_back(player2.into_val(env));
        args.push_back(0i128.into_val(env));
        args.push_back(0i128.into_val(env));
        env.invoke_contract::<()>(&game_hub, &Symbol::new(env, "start_game"), args);
    }

    fn call_end_game(env: &Env, game_id: &Address, player1_won: bool) {
        let game_hub = Self::game_hub_address(env);
        let sid_key = Self::key_session_id(game_id);
        let session_id: u32 = env.storage().temporary().get(&sid_key).unwrap_or(0);

        let mut args: Vec<Val> = Vec::new(env);
        args.push_back(session_id.into_val(env));
        args.push_back(player1_won.into_val(env));
        env.invoke_contract::<()>(&game_hub, &Symbol::new(env, "end_game"), args);
    }

    /// Initialize the on-chain VKs at deploy time.
    /// `vk_bytes` – verification key for the guess-result circuit.
    /// `wc_vk_bytes` – verification key for the word-commit circuit.
    pub fn __constructor(env: Env, vk_bytes: Bytes, wc_vk_bytes: Bytes) -> Result<(), Error> {
        env.storage().instance().set(&Self::key_vk(), &vk_bytes);
        env.storage().instance().set(&Self::key_wc_vk(), &wc_vk_bytes);
        Ok(())
    }

    /// Player 1 creates a new game with their commitment and escrow.
    /// A word-commit ZK proof must be provided to prove the committed word
    /// is in the dictionary.
    /// game_id is a unique identifier (e.g. a randomly generated address).
    pub fn create_game(
        env: Env,
        game_id: Address,
        player1: Address,
        commitment1: BytesN<32>,
        token_addr: Address,
        amount: i128,
        wc_public_inputs: Bytes,
        wc_proof_bytes: Bytes,
    ) -> Result<(), Error> {
        player1.require_auth();

        // Verify word-commit proof: proves the committed word is in the dictionary
        Self::do_verify_word_commit(&env, &commitment1, &wc_public_inputs, &wc_proof_bytes)?;

        // Check if game already exists
        let phase_key = Self::key_game_phase(&game_id);
        if env.storage().temporary().has(&phase_key) {
            return Err(Error::GameAlreadyExists);
        }

        // Transfer escrow from player1 to contract
        if amount > 0 {
            let token_client = token::TokenClient::new(&env, &token_addr);
            token_client.transfer(&player1, &env.current_contract_address(), &amount);
        }

        // Store game state (keyed by game_id, not player1)
        env.storage().temporary().set(&phase_key, &PHASE_WAITING);
        env.storage().temporary().extend_ttl(&phase_key, 5000, 5000);

        let p1_key = Self::key_game_p1(&game_id);
        env.storage().temporary().set(&p1_key, &player1);
        env.storage().temporary().extend_ttl(&p1_key, 5000, 5000);

        let c1_key = Self::key_game_c1(&game_id);
        env.storage().temporary().set(&c1_key, &commitment1);
        env.storage().temporary().extend_ttl(&c1_key, 5000, 5000);

        let token_key = Self::key_escrow_token(&game_id);
        env.storage().temporary().set(&token_key, &token_addr);
        env.storage().temporary().extend_ttl(&token_key, 5000, 5000);

        let amt_key = Self::key_escrow_amount(&game_id);
        env.storage().temporary().set(&amt_key, &amount);
        env.storage().temporary().extend_ttl(&amt_key, 5000, 5000);

        // Add to persistent game registry
        let count_key = Self::key_game_count();
        let count: u32 = env.storage().persistent().get(&count_key).unwrap_or(0);
        let at_key = Self::key_game_at(count);
        env.storage().persistent().set(&at_key, &game_id);
        env.storage().persistent().extend_ttl(&at_key, 20000, 20000);
        let creator_key = Self::key_game_creator(&game_id);
        env.storage().persistent().set(&creator_key, &player1);
        env.storage().persistent().extend_ttl(&creator_key, 20000, 20000);
        env.storage().persistent().set(&count_key, &(count + 1));
        env.storage().persistent().extend_ttl(&count_key, 20000, 20000);

        // Store session_id for game hub integration (count = index before increment)
        let sid_key = Self::key_session_id(&game_id);
        env.storage().temporary().set(&sid_key, &count);
        env.storage().temporary().extend_ttl(&sid_key, 5000, 5000);

        // Emit event so the lobby can discover open games
        GameCreated {
            game_id: game_id.clone(),
            player1: player1.clone(),
        }
        .publish(&env);

        Ok(())
    }

    /// Register a session key for a specific game.
    /// The session key self-registers after the player funds it.
    /// Security: session keys cannot steal funds — withdraw always sends to the
    /// actual player address. The player proves intent by funding the session key.
    pub fn register_session_key(
        env: Env,
        game_id: Address,
        player: Address,
        session_key: Address,
    ) -> Result<(), Error> {
        // Session key signs this transaction itself (no wallet popup needed)
        session_key.require_auth();

        // Verify the player is actually in this game
        let p1_key = Self::key_game_p1(&game_id);
        let p2_key = Self::key_game_p2(&game_id);

        let is_p1 = env
            .storage()
            .temporary()
            .get::<_, Address>(&p1_key)
            .map(|p| p == player)
            .unwrap_or(false);
        let is_p2 = env
            .storage()
            .temporary()
            .get::<_, Address>(&p2_key)
            .map(|p| p == player)
            .unwrap_or(false);

        // For create_game, only p1 is stored. For join_game, both are stored.
        // Allow registration if player is p1 (even before p2 joins) or p2.
        if !is_p1 && !is_p2 {
            return Err(Error::WrongPlayer);
        }

        // Store forward mapping: (game_id, player) → session_key
        let sk_key = Self::key_session_key(&game_id, &player);
        env.storage().temporary().set(&sk_key, &session_key);
        env.storage().temporary().extend_ttl(&sk_key, 5000, 5000);

        // Store reverse mapping: session_key → (game_id, player)
        let rev_key = Self::key_session_reverse(&session_key);
        env.storage()
            .temporary()
            .set(&rev_key, &(game_id.clone(), player.clone()));
        env.storage().temporary().extend_ttl(&rev_key, 5000, 5000);

        Ok(())
    }

    /// Query the registered session key for a player in a game.
    pub fn get_session_key(env: Env, game_id: Address, player: Address) -> Address {
        let sk_key = Self::key_session_key(&game_id, &player);
        env.storage()
            .temporary()
            .get(&sk_key)
            .unwrap_or(player)
    }

    /// Player 2 joins an existing game with matching escrow.
    /// A word-commit ZK proof must be provided to prove the committed word
    /// is in the dictionary.
    pub fn join_game(
        env: Env,
        game_id: Address,
        player2: Address,
        commitment2: BytesN<32>,
        wc_public_inputs: Bytes,
        wc_proof_bytes: Bytes,
    ) -> Result<(), Error> {
        player2.require_auth();

        // Verify word-commit proof: proves the committed word is in the dictionary
        Self::do_verify_word_commit(&env, &commitment2, &wc_public_inputs, &wc_proof_bytes)?;

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

        // Notify game hub that game has started
        let p1_for_hub: Address = env
            .storage()
            .temporary()
            .get(&Self::key_game_p1(&game_id))
            .ok_or(Error::NoActiveGame)?;
        Self::call_start_game(&env, &game_id, &p1_for_hub, &player2);

        // Emit event so lobby can remove this game
        GameJoined {
            game_id: game_id.clone(),
            player2: player2.clone(),
        }
        .publish(&env);

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
        // Resolve caller: may be player directly or their session key
        let actual_caller = Self::resolve_caller_simple(&env, &game_id, &caller);

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
        if &actual_caller != expected_player {
            return Err(Error::NotYourTurn);
        }

        let opponent = if &actual_caller == &player1 {
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
        let my_commitment: BytesN<32> = if &actual_caller == &player1 {
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

        // Verify commitment matches
        let commitment_from_pi = Self::extract_commitment_from_pi(&env, &public_inputs);
        if my_commitment != commitment_from_pi {
            return Err(Error::GuessWordMismatch);
        }

        // Verify guess letters match what's in public_inputs
        if !Self::pi_letters_match(&public_inputs, &opponent_guess) {
            return Err(Error::GuessWordMismatch);
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

            return Ok(());
        }

        // Turn 13 (verify-only): no new guess, check for draw
        if turn == MAX_TURNS {
            // All turns exhausted, no winner → draw
            // Both players must reveal their words before withdrawing
            env.storage().temporary().set(&phase_key, &PHASE_DRAW);

            // Reset revealed flags
            let p1_rev_key = Self::key_p1_revealed(&game_id);
            env.storage().temporary().set(&p1_rev_key, &false);
            env.storage().temporary().extend_ttl(&p1_rev_key, 5000, 5000);
            let p2_rev_key = Self::key_p2_revealed(&game_id);
            env.storage().temporary().set(&p2_rev_key, &false);
            env.storage().temporary().extend_ttl(&p2_rev_key, 5000, 5000);

            // Notify game hub of draw (no winner)
            Self::call_end_game(&env, &game_id, false);

            return Ok(());
        }

        // Continue playing: validate and store my new guess
        Self::do_verify_guess(&env, &my_guess_word, &path_elements, &path_indices)?;
        env.storage().temporary().set(&guess_key, &my_guess_word);

        // Advance turn
        env.storage().temporary().set(&turn_key, &(turn + 1));

        // Update chess clock
        let my_time_key = if &actual_caller == &player1 {
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

    /// Winner reveals their word: proves it matches commitment via ZK proof.
    /// The ZK proof is the winner "guessing their own word" — all results must be 2.
    /// Dictionary membership was already verified at game creation via word-commit proof.
    pub fn reveal_word(
        env: Env,
        game_id: Address,
        caller: Address,
        reveal_word: Bytes,
        public_inputs: Bytes,
        proof_bytes: Bytes,
    ) -> Result<(), Error> {
        // Resolve caller: may be player directly or their session key
        let actual_caller = Self::resolve_caller_simple(&env, &game_id, &caller);

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

        // Caller must be the winner
        let win_key = Self::key_game_winner(&game_id);
        let winner: Address = env
            .storage()
            .temporary()
            .get(&win_key)
            .ok_or(Error::NoActiveGame)?;
        if actual_caller != winner {
            return Err(Error::NotWinner);
        }

        // Get the winner's stored commitment
        let p1_key = Self::key_game_p1(&game_id);
        let player1: Address = env
            .storage()
            .temporary()
            .get(&p1_key)
            .ok_or(Error::NoActiveGame)?;

        let winner_commitment: BytesN<32> = if actual_caller == player1 {
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

        // Verify reveal: commitment + letters + results + ZK proof
        Self::do_verify_reveal(&env, &winner_commitment, &reveal_word, &public_inputs, &proof_bytes)?;

        // Store revealed word so opponent can see it
        let word_key = if actual_caller == player1 {
            Self::key_p1_word(&game_id)
        } else {
            Self::key_p2_word(&game_id)
        };
        env.storage().temporary().set(&word_key, &reveal_word);
        env.storage().temporary().extend_ttl(&word_key, 5000, 5000);

        // Finalize the game.
        env.storage().temporary().set(&phase_key, &PHASE_FINALIZED);

        // Notify game hub that game ended
        let player1_won = actual_caller == player1;
        Self::call_end_game(&env, &game_id, player1_won);

        Ok(())
    }

    /// In a draw, each player reveals their word to prove it matches their commitment.
    /// Dictionary membership was already verified at game creation via word-commit proof.
    pub fn reveal_word_draw(
        env: Env,
        game_id: Address,
        caller: Address,
        reveal_word: Bytes,
        public_inputs: Bytes,
        proof_bytes: Bytes,
    ) -> Result<(), Error> {
        // Resolve caller: may be player directly or their session key
        let actual_caller = Self::resolve_caller_simple(&env, &game_id, &caller);

        // Check game is in draw phase
        let phase_key = Self::key_game_phase(&game_id);
        let phase: u32 = env
            .storage()
            .temporary()
            .get(&phase_key)
            .ok_or(Error::NoActiveGame)?;
        if phase != PHASE_DRAW {
            return Err(Error::WrongPhase);
        }

        // Caller must be p1 or p2
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

        let is_p1 = actual_caller == player1;
        let is_p2 = actual_caller == player2;
        if !is_p1 && !is_p2 {
            return Err(Error::WrongPlayer);
        }

        // Check not already revealed
        let rev_key = if is_p1 {
            Self::key_p1_revealed(&game_id)
        } else {
            Self::key_p2_revealed(&game_id)
        };
        let already_revealed: bool = env.storage().temporary().get(&rev_key).unwrap_or(false);
        if already_revealed {
            return Err(Error::AlreadyWithdrawn); // reuse error: already done
        }

        // Get caller's stored commitment
        let my_commitment: BytesN<32> = if is_p1 {
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

        // Verify reveal: commitment + letters + results + ZK proof
        Self::do_verify_reveal(&env, &my_commitment, &reveal_word, &public_inputs, &proof_bytes)?;

        // Mark as revealed and store the word.
        env.storage().temporary().set(&rev_key, &true);
        env.storage().temporary().extend_ttl(&rev_key, 5000, 5000);

        let word_key = if is_p1 {
            Self::key_p1_word(&game_id)
        } else {
            Self::key_p2_word(&game_id)
        };
        env.storage().temporary().set(&word_key, &reveal_word);
        env.storage().temporary().extend_ttl(&word_key, 5000, 5000);

        Ok(())
    }

    /// Resign: forfeit the game immediately. Opponent wins.
    pub fn resign(
        env: Env,
        game_id: Address,
        caller: Address,
    ) -> Result<(), Error> {
        // Resolve caller: may be player directly or their session key
        let actual_caller = Self::resolve_caller_simple(&env, &game_id, &caller);

        let phase_key = Self::key_game_phase(&game_id);
        let phase: u32 = env
            .storage()
            .temporary()
            .get(&phase_key)
            .ok_or(Error::NoActiveGame)?;

        if phase != PHASE_ACTIVE {
            return Err(Error::WrongPhase);
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

        // Caller must be one of the players
        let caller_is_p1 = actual_caller == player1;
        let opponent = if caller_is_p1 {
            player2
        } else if actual_caller == player2 {
            player1
        } else {
            return Err(Error::WrongPlayer);
        };

        // Opponent wins by resignation
        let win_key = Self::key_game_winner(&game_id);
        env.storage().temporary().set(&win_key, &opponent);
        env.storage().temporary().extend_ttl(&win_key, 5000, 5000);
        env.storage().temporary().set(&phase_key, &PHASE_FINALIZED);

        // Notify game hub (if caller resigned, they didn't win)
        Self::call_end_game(&env, &game_id, !caller_is_p1);

        Ok(())
    }

    /// Claim timeout: if the opponent didn't play in time, you win.
    /// Bundles timeout claim + word reveal into a single transaction.
    pub fn claim_timeout(
        env: Env,
        game_id: Address,
        caller: Address,
        reveal_word: Bytes,
        public_inputs: Bytes,
        proof_bytes: Bytes,
    ) -> Result<(), Error> {
        // Resolve caller: may be player directly or their session key
        let actual_caller = Self::resolve_caller_simple(&env, &game_id, &caller);

        let phase_key = Self::key_game_phase(&game_id);
        let phase: u32 = env
            .storage()
            .temporary()
            .get(&phase_key)
            .ok_or(Error::NoActiveGame)?;

        // Timeout only applies during active play
        if phase != PHASE_ACTIVE {
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

        // The person whose turn it is timed out
        let turn_key = Self::key_game_turn(&game_id);
        let turn: u32 = env
            .storage()
            .temporary()
            .get(&turn_key)
            .ok_or(Error::NoActiveGame)?;
        let timed_out_player = if turn % 2 == 1 { &player1 } else { &player2 };

        // Caller must be the opponent of the timed-out player
        if &actual_caller == timed_out_player {
            return Err(Error::WrongPlayer);
        }

        // Get caller's commitment and verify the reveal proof
        let caller_commitment: BytesN<32> = if actual_caller == player1 {
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

        // Verify reveal: commitment + letters + all-correct results + ZK proof
        Self::do_verify_reveal(&env, &caller_commitment, &reveal_word, &public_inputs, &proof_bytes)?;

        // Store revealed word
        let word_key = if actual_caller == player1 {
            Self::key_p1_word(&game_id)
        } else {
            Self::key_p2_word(&game_id)
        };
        env.storage().temporary().set(&word_key, &reveal_word);
        env.storage().temporary().extend_ttl(&word_key, 5000, 5000);

        // Set winner and finalize
        let win_key = Self::key_game_winner(&game_id);
        env.storage().temporary().set(&win_key, &actual_caller);
        env.storage().temporary().extend_ttl(&win_key, 5000, 5000);
        env.storage().temporary().set(&phase_key, &PHASE_FINALIZED);

        // Notify game hub
        let player1_won = actual_caller == player1;
        Self::call_end_game(&env, &game_id, player1_won);

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
        // Resolve caller: may be player directly or their session key
        let actual_caller = Self::resolve_caller_simple(&env, &game_id, &caller);

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

        let is_p1 = actual_caller == player1;
        let is_p2 = actual_caller == player2;
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
            if actual_caller != winner {
                return Err(Error::NotWinner);
            }
            payout = escrow_per_player * 2;
        } else {
            // Draw: player must have revealed their word to withdraw
            let rev_key = if is_p1 {
                Self::key_p1_revealed(&game_id)
            } else {
                Self::key_p2_revealed(&game_id)
            };
            let revealed: bool = env.storage().temporary().get(&rev_key).unwrap_or(false);
            if !revealed {
                return Err(Error::InvalidReveal);
            }
            payout = escrow_per_player;
        }

        if payout > 0 {
            let token_client = token::TokenClient::new(&env, &token_addr);
            // Always send funds to the actual player address, not the session key
            token_client.transfer(&env.current_contract_address(), &actual_caller, &payout);
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

    pub fn get_p1_revealed(env: Env, game_id: Address) -> bool {
        let key = Self::key_p1_revealed(&game_id);
        env.storage().temporary().get(&key).unwrap_or(false)
    }

    pub fn get_p2_revealed(env: Env, game_id: Address) -> bool {
        let key = Self::key_p2_revealed(&game_id);
        env.storage().temporary().get(&key).unwrap_or(false)
    }

    pub fn get_p1_word(env: Env, game_id: Address) -> Bytes {
        let key = Self::key_p1_word(&game_id);
        env.storage().temporary().get(&key).unwrap_or(Bytes::new(&env))
    }

    pub fn get_p2_word(env: Env, game_id: Address) -> Bytes {
        let key = Self::key_p2_word(&game_id);
        env.storage().temporary().get(&key).unwrap_or(Bytes::new(&env))
    }

    // ── Game registry queries (persistent storage) ───────────────────────

    pub fn get_game_count(env: Env) -> u32 {
        env.storage().persistent().get(&Self::key_game_count()).unwrap_or(0)
    }

    pub fn get_game_id_at(env: Env, index: u32) -> Address {
        let key = Self::key_game_at(index);
        env.storage().persistent().get(&key).unwrap_or(env.current_contract_address())
    }

    pub fn get_game_creator(env: Env, game_id: Address) -> Address {
        let key = Self::key_game_creator(&game_id);
        env.storage().persistent().get(&key).unwrap_or(game_id)
    }

    /// Standalone Merkle proof check (Poseidon2).
    pub fn verify_guess(
        env: Env,
        guess_word: Bytes,
        path_elements: Vec<BytesN<32>>,
        path_indices: Vec<u32>,
    ) -> Result<(), Error> {
        Self::do_verify_guess(&env, &guess_word, &path_elements, &path_indices)
    }

    // ── Private helpers ──────────────────────────────────────────────────

    /// Extract the 32-byte commitment from public inputs (bytes 0..31).
    fn extract_commitment_from_pi(env: &Env, public_inputs: &Bytes) -> BytesN<32> {
        let mut buf = [0u8; 32];
        for i in 0..32usize {
            buf[i] = public_inputs.get(i as u32).unwrap_or(0);
        }
        BytesN::from_array(env, &buf)
    }

    /// Check that the 5 letter fields in public_inputs match the given word.
    /// Letters sit at offsets `32 + i*32 + 31` for i in 0..5.
    fn pi_letters_match(public_inputs: &Bytes, word: &Bytes) -> bool {
        for i in 0u32..5 {
            let field_offset = 32 + i * 32;
            if public_inputs.get(field_offset + 31).unwrap_or(0) != word.get(i).unwrap() {
                return false;
            }
        }
        true
    }

    /// Common reveal verification: commitment + letters + all-correct results + ZK proof.
    fn do_verify_reveal(
        env: &Env,
        commitment: &BytesN<32>,
        reveal_word: &Bytes,
        public_inputs: &Bytes,
        proof_bytes: &Bytes,
    ) -> Result<(), Error> {
        let commitment_from_pi = Self::extract_commitment_from_pi(env, public_inputs);
        if *commitment != commitment_from_pi {
            return Err(Error::InvalidReveal);
        }

        if reveal_word.len() != 5 {
            return Err(Error::InvalidGuessLength);
        }

        if !Self::pi_letters_match(public_inputs, reveal_word) {
            return Err(Error::InvalidReveal);
        }

        // All results must be 2 (player guessed their own word correctly)
        for i in 0u32..5 {
            let offset = 192 + i * 32 + 31;
            if public_inputs.get(offset).unwrap_or(0) != 2 {
                return Err(Error::InvalidReveal);
            }
        }

        Self::do_verify_proof(env, public_inputs, proof_bytes)?;
        Ok(())
    }

    /// Verify a word-commit ZK proof.
    /// The circuit proves: (1) commitment = Poseidon2(salt, l1..l5),
    ///                      (2) the word is in the Poseidon2 Merkle tree.
    /// Public inputs layout: [commitment_hash (32 bytes), merkle_root (32 bytes)]
    fn do_verify_word_commit(
        env: &Env,
        commitment: &BytesN<32>,
        public_inputs: &Bytes,
        proof_bytes: &Bytes,
    ) -> Result<(), Error> {
        if proof_bytes.len() as usize != PROOF_BYTES {
            return Err(Error::ProofParseError);
        }

        // Extract commitment from public inputs and verify it matches
        let commitment_from_pi = Self::extract_commitment_from_pi(env, public_inputs);
        if *commitment != commitment_from_pi {
            return Err(Error::GuessWordMismatch);
        }

        let wc_vk_bytes: Bytes = env
            .storage()
            .instance()
            .get(&Self::key_wc_vk())
            .ok_or(Error::VkNotSet)?;
        let verifier =
            UltraHonkVerifier::new(env, &wc_vk_bytes).map_err(|_| Error::VkParseError)?;

        verifier
            .verify(proof_bytes, public_inputs)
            .map_err(|_| Error::VerificationFailed)?;
        Ok(())
    }

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

        // Compute leaf as a field element: l1*256^4 + l2*256^3 + l3*256^2 + l4*256 + l5
        // This matches the Noir circuit and JS Poseidon Merkle tree leaf encoding
        let leaf_value: u128 = (word_bytes[0] as u128) * 256u128.pow(4)
            + (word_bytes[1] as u128) * 256u128.pow(3)
            + (word_bytes[2] as u128) * 256u128.pow(2)
            + (word_bytes[3] as u128) * 256
            + (word_bytes[4] as u128);

        let mut current_hash = U256::from_u128(env, leaf_value);

        let field = Symbol::new(env, "BN254");
        let depth = path_elements.len();

        for i in 0..depth {
            let sibling_bytes: Bytes = path_elements.get(i).unwrap().into();
            let sibling = U256::from_be_bytes(env, &sibling_bytes);
            let idx = path_indices.get(i).unwrap();

            let mut inputs = Vec::new(env);
            if idx == 0 {
                inputs.push_back(current_hash);
                inputs.push_back(sibling);
            } else {
                inputs.push_back(sibling);
                inputs.push_back(current_hash);
            }

            current_hash = env.crypto().poseidon2_hash(&inputs, field.clone());
        }

        let stored_root_bytes: Bytes = BytesN::from_array(env, &MERKLE_ROOT).into();
        let stored_root = U256::from_be_bytes(env, &stored_root_bytes);
        if current_hash != stored_root {
            return Err(Error::InvalidMerkleProof);
        }

        Ok(())
    }
}
