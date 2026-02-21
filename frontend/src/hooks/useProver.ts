import { useState, useEffect } from "react";

/**
 * Pre-loads the ZK prover WASM module on mount.
 */
export function useProver(addStatus: (msg: string) => void) {
  const [proverReady, setProverReady] = useState(false);

  useEffect(() => {
    import("../generateProof").then(({ preloadProver }) =>
      preloadProver((msg) => addStatus(msg))
        .then(() => setProverReady(true))
        .catch((err) => addStatus(`Prover init error: ${err.message}`))
    );
    // addStatus is stable (useCallback in useGame), safe to list
  }, [addStatus]);

  return proverReady;
}
