/**
 * Session Key Service
 * Generates and manages temporary keypairs for silent transaction signing.
 *
 * Flow:
 * 1. After create_game/join_game, call initSessionKey() to generate a keypair
 * 2. Call registerSessionKeyOnChain() with Freighter to register on-chain (1 popup)
 * 3. All subsequent game calls (submit_turn, reveal, etc.) use the session signer (0 popups)
 * 4. On tab close / game end, the session key is automatically discarded
 */

import {
    Keypair,
    TransactionBuilder,
    Operation,
} from "@stellar/stellar-sdk";
import * as StellarSdk from "@stellar/stellar-sdk";
import type { SignTransaction } from "../soroban";
import { RPC_URL, NETWORK_PASSPHRASE } from "../config";

const SESSION_KEY_STORAGE_PREFIX = "zwordle_session_";

export interface SessionKeyState {
    /** The session keypair's public key (G...) */
    publicKey: string;
    /** The game ID this session key is bound to */
    gameId: string;
    /** Whether the session key has been registered on-chain */
    registered: boolean;
}

class SessionKeyService {
    private keypair: Keypair | null = null;
    private gameId: string | null = null;
    private registered = false;

    /**
     * Initialize a new session key for a given game.
     * Generates a fresh Ed25519 keypair and stores it in sessionStorage.
     */
    initSessionKey(gameId: string): SessionKeyState {
        // Check if we already have a session key for this game
        const existing = this.loadFromStorage(gameId);
        if (existing) {
            this.keypair = Keypair.fromSecret(existing.secret);
            this.gameId = gameId;
            this.registered = existing.registered;
            return {
                publicKey: this.keypair.publicKey(),
                gameId,
                registered: this.registered,
            };
        }

        // Generate a new keypair
        this.keypair = Keypair.random();
        this.gameId = gameId;
        this.registered = false;

        // Save to sessionStorage (survives page reload, clears on tab close)
        this.saveToStorage(gameId, this.keypair.secret(), false);

        console.log(
            `[SessionKey] Generated new session key for game ${gameId.slice(0, 8)}…: ${this.keypair.publicKey().slice(0, 8)}…`
        );

        return {
            publicKey: this.keypair.publicKey(),
            gameId,
            registered: false,
        };
    }

    /**
     * Fund the session key account by sending XLM from the player's wallet.
     * Builds a createAccount operation, signed via Freighter (1 popup).
     * Must be called before the session key can sign transactions.
     */
    async fundFromWallet(
        playerPublicKey: string,
        signTx: SignTransaction,
        xlmAmount: string = "9"
    ): Promise<void> {
        if (!this.keypair) {
            throw new Error("Session key not initialized");
        }

        const sessionPubKey = this.keypair.publicKey();
        console.log(
            `[SessionKey] Funding session key ${sessionPubKey.slice(0, 8)}… with ${xlmAmount} XLM from ${playerPublicKey.slice(0, 8)}…`
        );

        const server = new StellarSdk.rpc.Server(RPC_URL);

        // Check if the session account already exists
        try {
            await server.getAccount(sessionPubKey);
            console.log(`[SessionKey] Account already exists, skipping funding.`);
            return;
        } catch {
            // Account doesn't exist — proceed with createAccount
        }

        // Load the player's account for sequence number
        const playerAccount = await server.getAccount(playerPublicKey);

        // Build createAccount transaction
        const tx = new TransactionBuilder(playerAccount, {
            fee: "10000000", // 1 XLM max fee
            networkPassphrase: NETWORK_PASSPHRASE,
        })
            .addOperation(
                Operation.createAccount({
                    destination: sessionPubKey,
                    startingBalance: xlmAmount,
                })
            )
            .setTimeout(300)
            .build();

        // Sign with the player's wallet (Freighter popup)
        const signedXdr = await signTx(tx.toXDR(), NETWORK_PASSPHRASE);

        // Submit
        const signedTx = TransactionBuilder.fromXDR(
            signedXdr,
            NETWORK_PASSPHRASE
        );
        const response = await server.sendTransaction(signedTx);

        // Poll for completion
        if (response.status === "PENDING") {
            let result = await server.getTransaction(response.hash);
            while (result.status === "NOT_FOUND") {
                await new Promise((r) => setTimeout(r, 1000));
                result = await server.getTransaction(response.hash);
            }
            if (result.status !== "SUCCESS") {
                throw new Error(`Funding transaction failed: ${result.status}`);
            }
        } else if (response.status === "ERROR") {
            throw new Error(`Funding submission failed: ${JSON.stringify(response)}`);
        }

        console.log(`[SessionKey] Session key funded with ${xlmAmount} XLM ✅`);
    }

    /**
     * Mark the session key as registered on-chain.
     */
    markRegistered(): void {
        this.registered = true;
        if (this.gameId && this.keypair) {
            this.saveToStorage(this.gameId, this.keypair.secret(), true);
        }
    }

    /**
     * Get the current session key state.
     */
    getState(): SessionKeyState | null {
        if (!this.keypair || !this.gameId) return null;
        return {
            publicKey: this.keypair.publicKey(),
            gameId: this.gameId,
            registered: this.registered,
        };
    }

    /**
     * Get the session key's public key.
     */
    getPublicKey(): string | null {
        return this.keypair?.publicKey() ?? null;
    }

    /**
     * Check if a session key is initialized and registered for the given game.
     */
    isReady(gameId: string): boolean {
        return (
            this.keypair !== null &&
            this.gameId === gameId &&
            this.registered
        );
    }

    /**
     * Get a sign function compatible with soroban.ts's SignTransaction type.
     * This signs transactions silently without any wallet popup.
     */
    getSignFunction(): SignTransaction {
        if (!this.keypair) {
            throw new Error("Session key not initialized");
        }

        const keypair = this.keypair;

        return async (xdr: string, networkPassphrase: string): Promise<string> => {
            const transaction = TransactionBuilder.fromXDR(xdr, networkPassphrase);
            transaction.sign(keypair);
            return transaction.toXDR();
        };
    }

    /**
     * Reclaim all XLM from the session key account back to the player's wallet.
     * Uses accountMerge which closes the session account and sends all remaining
     * XLM to the destination. Signed by the session key itself — no Freighter popup.
     */
    async reclaimFunds(playerPublicKey: string): Promise<void> {
        if (!this.keypair) {
            console.log("[SessionKey] No session key to reclaim from.");
            return;
        }

        const sessionPubKey = this.keypair.publicKey();
        console.log(
            `[SessionKey] Reclaiming funds from ${sessionPubKey.slice(0, 8)}… → ${playerPublicKey.slice(0, 8)}…`
        );

        const server = new StellarSdk.rpc.Server(RPC_URL);

        // Check if the session account exists
        let sessionAccount;
        try {
            sessionAccount = await server.getAccount(sessionPubKey);
        } catch {
            console.log("[SessionKey] Session account doesn't exist, nothing to reclaim.");
            return;
        }

        // Build accountMerge transaction — sends ALL XLM to the player
        const tx = new TransactionBuilder(sessionAccount, {
            fee: "100", // minimal fee
            networkPassphrase: NETWORK_PASSPHRASE,
        })
            .addOperation(
                Operation.accountMerge({
                    destination: playerPublicKey,
                })
            )
            .setTimeout(300)
            .build();

        // Sign with the session key (silent — no wallet popup!)
        tx.sign(this.keypair);

        // Submit
        const response = await server.sendTransaction(tx);

        if (response.status === "PENDING") {
            let result = await server.getTransaction(response.hash);
            while (result.status === "NOT_FOUND") {
                await new Promise((r) => setTimeout(r, 1000));
                result = await server.getTransaction(response.hash);
            }
            if (result.status !== "SUCCESS") {
                throw new Error(`Account merge failed: ${result.status}`);
            }
        } else if (response.status === "ERROR") {
            throw new Error(`Account merge submission failed: ${JSON.stringify(response)}`);
        }

        console.log(`[SessionKey] Funds reclaimed ✅`);
    }

    /**
     * Restore session key from storage for a specific game.
     * Call this when resuming a game after page reload.
     */
    restoreForGame(gameId: string): boolean {
        const existing = this.loadFromStorage(gameId);
        if (!existing) return false;

        this.keypair = Keypair.fromSecret(existing.secret);
        this.gameId = gameId;
        this.registered = existing.registered;

        console.log(
            `[SessionKey] Restored session key for game ${gameId.slice(0, 8)}…: ${this.keypair.publicKey().slice(0, 8)}… (registered: ${this.registered})`
        );

        return true;
    }

    /**
     * Clear the current session key.
     */
    clear(): void {
        if (this.gameId) {
            try {
                sessionStorage.removeItem(SESSION_KEY_STORAGE_PREFIX + this.gameId);
            } catch {
                // sessionStorage not available
            }
        }
        this.keypair = null;
        this.gameId = null;
        this.registered = false;
    }

    // ── Private storage helpers ──────────────────────────────────────────

    private saveToStorage(
        gameId: string,
        secret: string,
        registered: boolean
    ): void {
        try {
            sessionStorage.setItem(
                SESSION_KEY_STORAGE_PREFIX + gameId,
                JSON.stringify({ secret, registered })
            );
        } catch {
            // sessionStorage not available (SSR, etc.)
        }
    }

    private loadFromStorage(
        gameId: string
    ): { secret: string; registered: boolean } | null {
        try {
            const data = sessionStorage.getItem(
                SESSION_KEY_STORAGE_PREFIX + gameId
            );
            if (!data) return null;
            return JSON.parse(data);
        } catch {
            return null;
        }
    }
}

// Singleton instance
export const sessionKeyService = new SessionKeyService();
