import { useState, useEffect, useCallback } from "react";
import {
  isConnected,
  requestAccess,
  getAddress,
  getNetwork,
  signTransaction,
} from "@stellar/freighter-api";

export interface FreighterState {
  /** Whether Freighter extension is installed */
  installed: boolean;
  /** Connected wallet public key (G…) */
  address: string | null;
  /** Current network name reported by Freighter */
  network: string | null;
  /** Whether we're currently connecting */
  connecting: boolean;
  /** Connect (request access) */
  connect: () => Promise<void>;
  /** Disconnect (clear local state) */
  disconnect: () => void;
  /** Sign a transaction XDR, returns signed XDR */
  sign: (xdr: string, networkPassphrase: string) => Promise<string>;
}

export function useFreighter(): FreighterState {
  const [installed, setInstalled] = useState(false);
  const [address, setAddress] = useState<string | null>(null);
  const [network, setNetwork] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);

  // Check if Freighter is installed and already connected on mount
  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const connResult = await isConnected();
        if (cancelled) return;

        if (connResult.isConnected) {
          setInstalled(true);

          // Try to get existing address (user already authorized)
          try {
            const addrResult = await getAddress();
            if (!cancelled && addrResult.address) {
              setAddress(addrResult.address);
            }
          } catch {
            // Not yet authorized — that's fine
          }

          try {
            const netResult = await getNetwork();
            if (!cancelled && netResult.network) {
              setNetwork(netResult.network);
            }
          } catch {
            // Ignore
          }
        }
      } catch {
        // Freighter not installed
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const connect = useCallback(async () => {
    setConnecting(true);
    try {
      const connResult = await isConnected();
      if (!connResult.isConnected) {
        throw new Error(
          "Freighter extension not found. Please install it from https://freighter.app"
        );
      }
      setInstalled(true);

      // Request access — opens Freighter popup
      const accessResult = await requestAccess();
      if (accessResult.error) {
        throw new Error(accessResult.error);
      }

      // Get address
      const addrResult = await getAddress();
      if (addrResult.address) {
        setAddress(addrResult.address);
      } else {
        throw new Error("Could not get wallet address from Freighter");
      }

      // Get network
      try {
        const netResult = await getNetwork();
        if (netResult.network) {
          setNetwork(netResult.network);
        }
      } catch {
        // Non-critical
      }
    } finally {
      setConnecting(false);
    }
  }, []);

  const disconnect = useCallback(() => {
    setAddress(null);
    setNetwork(null);
  }, []);

  const sign = useCallback(
    async (xdr: string, networkPassphrase: string): Promise<string> => {
      if (!address) {
        throw new Error("Wallet not connected");
      }

      const result = await signTransaction(xdr, {
        networkPassphrase,
        address,
      });

      if (result.error) {
        throw new Error(result.error);
      }

      return result.signedTxXdr;
    },
    [address]
  );

  return {
    installed,
    address,
    network,
    connecting,
    connect,
    disconnect,
    sign,
  };
}
