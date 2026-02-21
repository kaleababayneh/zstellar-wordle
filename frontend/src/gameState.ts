import { Barretenberg, Fr } from "@aztec/bb.js";
import { CONTRACT_ID } from "./config";
import words from "an-array-of-english-words";

let WORDLE = words.filter((w) =>
    w.length === 5 &&
    !w.includes("'") &&
    !w.includes("-") &&
    !w.includes(" "));

export const WORD_LIST = WORDLE.map(w => w.toLowerCase());

/** Check if a word is in the valid 5-letter word list */
export function isWordInList(word: string): boolean {
    return WORD_LIST.includes(word.toLowerCase());
}

// ── Types ──────────────────────────────────────────────────────────────────────

export interface GuessEntry {
    word: string;
    results: number[];
    verified: boolean;
}

/**
 * Two-player game state stored in localStorage.
 * Each player stores their OWN view of the game.
 */
export interface GameState {
    // My identity
    gameId: string;            // Player 1's address (game identifier)
    myRole: "p1" | "p2";      // Which player am I?
    myAddress: string;

    // My secret word
    word: string;
    letterCodes: number[];
    salt: string;
    commitmentHash: string;

    // Opponent info
    opponentAddress: string;

    // My guesses (against opponent's word) — results filled in when opponent verifies
    myGuesses: GuessEntry[];

    // Opponent's guesses (against my word) — results computed locally when I verify
    opponentGuesses: GuessEntry[];

    // Game tracking
    contractId: string;
    createdAt: number;
    escrowAmount: number;
    escrowWithdrawn: boolean;
    drawRevealed: boolean;  // Whether I have revealed my word in a draw

    // On-chain state (updated via polling)
    onChainPhase: number;
    onChainTurn: number;
    onChainDeadline: number;   // ledger timestamp (seconds)
    myTimeRemaining: number;   // seconds remaining on my clock
    opponentTimeRemaining: number;
}

// ── Poseidon2 via Barretenberg WASM ────────────────────────────────────────────

let _bb: Barretenberg | null = null;

async function getBb(): Promise<Barretenberg> {
    if (!_bb) {
        _bb = await Barretenberg.new({ threads: 1 });
    }
    return _bb;
}

/**
 * Compute Poseidon2::hash([salt, l1, l2, l3, l4, l5]) — same as the Noir circuit.
 */
export async function poseidon2Commitment(
    salt: bigint,
    letterCodes: number[]
): Promise<string> {
    const bb = await getBb();
    const inputs = [
        new Fr(salt),
        ...letterCodes.map((c) => new Fr(BigInt(c))),
    ];
    const hash: Fr = await bb.poseidon2Hash(inputs);
    return hash.toString(); // "0x..."
}

/**
 * Convert a commitment hash hex string to a 32-byte Uint8Array (big-endian).
 */
export function commitmentToBytes(commitmentHash: string): Uint8Array {
    const hex = commitmentHash.replace(/^0x/, "").padStart(64, "0");
    const bytes = new Uint8Array(32);
    for (let i = 0; i < 32; i++) {
        bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
    }
    return bytes;
}

// ── localStorage helpers ───────────────────────────────────────────────────────

const STORAGE_KEY = "zkwordle_2p_game";

function saveToStorage(state: GameState): void {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

export function loadGame(): GameState | null {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return null;
        return JSON.parse(raw) as GameState;
    } catch {
        return null;
    }
}

export function clearGame(): void {
    localStorage.removeItem(STORAGE_KEY);
}

// ── My Games tracking (persistent list of game IDs I've created/joined) ────────

const MY_GAMES_KEY = "zkwordle_my_games";

export interface MyGameEntry {
    gameId: string;
    role: "p1" | "p2";
    createdAt: number;
}

export function getMyGameEntries(): MyGameEntry[] {
    try {
        const raw = localStorage.getItem(MY_GAMES_KEY);
        if (!raw) return [];
        return JSON.parse(raw);
    } catch {
        return [];
    }
}

export function addMyGameEntry(entry: MyGameEntry): void {
    const list = getMyGameEntries();
    if (!list.find((e) => e.gameId === entry.gameId)) {
        list.push(entry);
        localStorage.setItem(MY_GAMES_KEY, JSON.stringify(list));
    }
}

export function removeMyGameEntry(gameId: string): void {
    const list = getMyGameEntries().filter((e) => e.gameId !== gameId);
    localStorage.setItem(MY_GAMES_KEY, JSON.stringify(list));
}

export function saveGame(state: GameState): void {
    saveToStorage(state);
}

export function addMyGuess(guess: GuessEntry): void {
    const state = loadGame();
    if (!state) return;
    state.myGuesses.push(guess);
    saveToStorage(state);
}

export function updateMyGuessResults(guessIndex: number, results: number[]): void {
    const state = loadGame();
    if (!state) return;
    if (guessIndex < state.myGuesses.length) {
        state.myGuesses[guessIndex].results = results;
        state.myGuesses[guessIndex].verified = true;
    }
    saveToStorage(state);
}

export function addOpponentGuess(guess: GuessEntry, expectedCount?: number): void {
    const state = loadGame();
    if (!state) return;
    // Guard: if expectedCount is provided, only add if we haven't reached it yet
    if (expectedCount !== undefined && state.opponentGuesses.length >= expectedCount) return;
    state.opponentGuesses.push(guess);
    saveToStorage(state);
}

export function updateOnChainState(
    phase: number,
    turn: number,
    deadline: number,
    myTime: number,
    oppTime: number
): void {
    const state = loadGame();
    if (!state) return;
    state.onChainPhase = phase;
    state.onChainTurn = turn;
    state.onChainDeadline = deadline;
    state.myTimeRemaining = myTime;
    state.opponentTimeRemaining = oppTime;
    saveToStorage(state);
}

export function markEscrowWithdrawn(): void {
    const state = loadGame();
    if (!state) return;
    state.escrowWithdrawn = true;
    saveToStorage(state);
}

export function markDrawRevealed(): void {
    const state = loadGame();
    if (!state) return;
    state.drawRevealed = true;
    saveToStorage(state);
}

// ── Game creation ──────────────────────────────────────────────────────────────

/**
 * Create local game state for Player 1 or Player 2.
 * Picks a word, generates salt, computes Poseidon2 commitment.
 */
export async function createGameState(
    role: "p1" | "p2",
    myAddress: string,
    gameId: string,
    opponentAddress: string,
    escrowAmount: number,
    onStatus?: (msg: string) => void,
    customWord?: string,
): Promise<GameState> {
    const log = onStatus ?? console.log;

    const word = customWord ? customWord.toLowerCase() : WORD_LIST[Math.floor(Math.random() * WORD_LIST.length)];
    const letterCodes = word.split("").map((ch) => ch.charCodeAt(0));
    log(`Secret word chosen`);

    // Random salt (0–2^64)
    const saltBytes = crypto.getRandomValues(new Uint8Array(8));
    const salt = Array.from(saltBytes).reduce(
        (n, b) => (n << 8n) | BigInt(b),
        0n
    );
    log(`Salt generated`);

    log(`Computing commitment hash…`);
    const commitmentHash = await poseidon2Commitment(salt, letterCodes);
    log(`Commitment: ${commitmentHash.slice(0, 18)}…`);

    const state: GameState = {
        gameId,
        myRole: role,
        myAddress,
        word,
        letterCodes,
        salt: salt.toString(),
        commitmentHash,
        opponentAddress,
        myGuesses: [],
        opponentGuesses: [],
        contractId: CONTRACT_ID,
        createdAt: Date.now(),
        escrowAmount,
        escrowWithdrawn: false,
        drawRevealed: false,
        onChainPhase: role === "p1" ? 0 : 1,
        onChainTurn: role === "p1" ? 0 : 1,
        onChainDeadline: 0,
        myTimeRemaining: 300,
        opponentTimeRemaining: 300,
    };

    saveToStorage(state);
    return state;
}

/**
 * Get the game secret in the format expected by generateProof.
 */
export function getGameSecret(state: GameState) {
    return {
        word: state.word,
        letterCodes: state.letterCodes,
        salt: state.salt,
        commitmentHash: state.commitmentHash,
    };
}
