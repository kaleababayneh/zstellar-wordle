import { Barretenberg, Fr } from "@aztec/bb.js";
import { CONTRACT_ID } from "./config";
import words from "an-array-of-english-words";




let WORDLE = words.filter((w) => 
    w.length === 5 && 
    !w.includes("'") && 
    !w.includes("-") && 
    !w.includes(" "));

export const WORD_LIST = WORDLE.map(w => w.toLowerCase());
console.log(WORD_LIST.length);

/** Check if a word is in the valid 5-letter word list */
export function isWordInList(word: string): boolean {
    return WORD_LIST.includes(word.toLowerCase());
}
// ── Types ──────────────────────────────────────────────────────────────────────

export interface GameState {
    word: string;
    letterCodes: number[];
    salt: string;
    commitmentHash: string;
    contractId: string;
    guesses: Array<{ word: string; results: number[]; verified: boolean }>;
    createdAt: number;
    deadline: number; // Unix timestamp (ms) when game expires
    escrowAmount: number; // Escrow in XLM (0 = no escrow)
    escrowWithdrawn: boolean;
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
async function poseidon2Commitment(
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

// ── localStorage helpers ───────────────────────────────────────────────────────

const STORAGE_KEY = "zkwordle_game";

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

export function saveGuess(
    guess: { word: string; results: number[]; verified: boolean }
): void {
    const state = loadGame();
    if (!state) return;
    state.guesses.push(guess);
    saveToStorage(state);
}

export function markLastVerified(verified: boolean): void {
    const state = loadGame();
    if (!state || state.guesses.length === 0) return;
    state.guesses[state.guesses.length - 1].verified = verified;
    saveToStorage(state);
}

export function setGameDeadline(deadline: number): void {
    const state = loadGame();
    if (!state) return;
    state.deadline = deadline;
    saveToStorage(state);
}

export function setGameEscrow(amount: number): void {
    const state = loadGame();
    if (!state) return;
    state.escrowAmount = amount;
    saveToStorage(state);
}

export function markEscrowWithdrawn(): void {
    const state = loadGame();
    if (!state) return;
    state.escrowWithdrawn = true;
    saveToStorage(state);
}

// ── Game creation ──────────────────────────────────────────────────────────────

/**
 * Create a new game: pick a random word, generate a random salt,
 * compute Poseidon2 commitment, and save to localStorage.
 */
export async function createGame(
    onStatus?: (msg: string) => void,
    customWord?: string
): Promise<GameState> {
    const log = onStatus ?? console.log;

    // Use custom word if provided, otherwise pick a random one
    const word = customWord ? customWord.toLowerCase() : WORD_LIST[Math.floor(Math.random() * WORD_LIST.length)];
    const letterCodes = word.split("").map((ch) => ch.charCodeAt(0));
    log(`New game created`);

    // Random salt (0–2^64)
    const saltBytes = crypto.getRandomValues(new Uint8Array(8));
    const salt = Array.from(saltBytes).reduce(
        (n, b) => (n << 8n) | BigInt(b),
        0n
    );
    log(`Salt generated`);

    // Compute Poseidon2 commitment
    log(`Computing commitment hash…`);
    const commitmentHash = await poseidon2Commitment(salt, letterCodes);
    log(`Commitment: ${commitmentHash.slice(0, 18)}…`);

    const state: GameState = {
        word,
        letterCodes,
        salt: salt.toString(),
        commitmentHash,
        contractId: CONTRACT_ID,
        guesses: [],
        createdAt: Date.now(),
        deadline: 0, // Will be set after on-chain create_game
        escrowAmount: 0, // Will be set if user deposits escrow
        escrowWithdrawn: false,
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
