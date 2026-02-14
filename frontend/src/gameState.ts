import { Barretenberg, Fr } from "@aztec/bb.js";
import { CONTRACT_ID } from "./config";

// ── Word list ──────────────────────────────────────────────────────────────────

const WORD_LIST = [
    "apple", "brain", "chair", "dance", "eagle",
    "flame", "grape", "house", "juice", "kneel",
    "lemon", "mango", "night", "ocean", "piano",
    "queen", "river", "stone", "tiger", "uncle",
    "viola", "whale", "xenon", "youth", "zebra",
    "amber", "blaze", "crane", "dream", "earth",
    "frost", "glyph", "heart", "ivory", "joker",
    "knock", "lunar", "marsh", "noble", "orbit",
    "pearl", "quest", "robin", "solar", "trace",
    "unity", "vigor", "wrist", "pixel", "zonal",
];

// ── Types ──────────────────────────────────────────────────────────────────────

export interface GameState {
    word: string;
    letterCodes: number[];
    salt: string;
    commitmentHash: string;
    contractId: string;
    guesses: Array<{ word: string; results: number[]; verified: boolean }>;
    createdAt: number;
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

// ── Game creation ──────────────────────────────────────────────────────────────

/**
 * Create a new game: pick a random word, generate a random salt,
 * compute Poseidon2 commitment, and save to localStorage.
 */
export async function createGame(
    onStatus?: (msg: string) => void
): Promise<GameState> {
    const log = onStatus ?? console.log;

    // Pick random word
    const word = WORD_LIST[Math.floor(Math.random() * WORD_LIST.length)];
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
