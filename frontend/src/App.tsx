import { useEffect } from "react";
import { StatusBar } from "./components/StatusBar";
import { Lobby } from "./components/Lobby";
import { Header } from "./components/Header";
import { GameLoading } from "./components/GameLoading";
import { WaitingPhase } from "./components/WaitingPhase";
import { ActiveGame } from "./components/ActiveGame";
import { DrawPhase } from "./components/DrawPhase";
import { GameOverPanel } from "./components/GameOverPanel";
import { PHASE } from "./config";
import { useFreighter } from "./hooks/useFreighter";
import { useGame } from "./hooks/useGame";
import { useProver } from "./hooks/useProver";
import { useGamePolling } from "./hooks/useGamePolling";
import { useGameActions } from "./hooks/useGameActions";

function App() {
  const wallet = useFreighter();
  const gs = useGame();
  const proverReady = useProver(gs.addStatus);
  const { pollGameState } = useGamePolling(gs);
  const actions = useGameActions({ gs, wallet, proverReady, pollGameState });

  const {
    game,
    currentGuess,
    status,
    busy,
    gameOver, gameWon,
    withdrawing,
    letterStates,
    myTimeLeft, oppTimeLeft,
    isMyTurn,
    onChainPhase, chainTurn,
    winner, chainPolled,
    myDrawRevealed, oppDrawRevealed,
    oppRevealedWord,
    addStatus, resetGame,
    toastMessage, shakeRow, clearShake,
  } = gs;

  // Keyboard listener
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      actions.handleKey(e.key);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [actions.handleKey]);

  return (
    <div className="flex flex-col items-center min-h-dvh bg-background text-foreground">
      <Header wallet={wallet} addStatus={addStatus} proverReady={proverReady} />

      <main className="flex-1 flex flex-col items-center justify-center w-full max-w-2xl px-4 py-4">

      {/* Lobby */}
      {!game && wallet.address && (
        <div className="mb-6 flex flex-col items-center w-full animate-fade-in-up">
          <Lobby
            currentAddress={wallet.address}
            onJoinGame={(gameId, customWord) => actions.handleJoinGame(gameId, customWord)}
            onCreateGame={(escrow, word) => actions.handleCreateGame(escrow, word)}
          />
        </div>
      )}

      {/* Loading / expired */}
      {game && onChainPhase === PHASE.NONE && !gameOver && (
        <GameLoading chainPolled={chainPolled} onBackToLobby={resetGame} />
      )}

      {/* Waiting for P2 */}
      {game && onChainPhase === PHASE.WAITING && (
        <WaitingPhase game={game} />
      )}

      {/* Active / Reveal */}
      {game && (onChainPhase === PHASE.ACTIVE || onChainPhase === PHASE.REVEAL) && (
        <ActiveGame
          game={game}
          currentGuess={currentGuess}
          busy={busy}
          isMyTurn={isMyTurn}
          myTimeLeft={myTimeLeft}
          oppTimeLeft={oppTimeLeft}
          onChainPhase={onChainPhase}
          chainTurn={chainTurn}
          winner={winner}
          letterStates={letterStates}
          toastMessage={toastMessage}
          shakeRow={shakeRow}
          onClearShake={clearShake}
          onKey={actions.handleKey}
          onRevealWord={actions.handleRevealWord}
          onClaimTimeout={actions.handleClaimTimeout}
          onVerifyOnly={actions.handleVerifyOnly}
          onNewGame={resetGame}
        />
      )}

      {/* Draw */}
      {game && onChainPhase === PHASE.DRAW && !gameOver && (
        <DrawPhase
          game={game}
          busy={busy}
          myDrawRevealed={myDrawRevealed}
          oppDrawRevealed={oppDrawRevealed}
          oppRevealedWord={oppRevealedWord}
          withdrawing={withdrawing}
          onRevealWordDraw={actions.handleRevealWordDraw}
          onWithdraw={actions.handleWithdraw}
          onNewGame={resetGame}
        />
      )}

      {/* Game Over */}
      {gameOver && game && (
        <GameOverPanel
          game={game}
          gameWon={gameWon}
          winner={winner}
          oppRevealedWord={oppRevealedWord}
          withdrawing={withdrawing}
          onWithdraw={actions.handleWithdraw}
          onNewGame={resetGame}
        />
      )}

      <StatusBar messages={status} />
      </main>
    </div>
  );
}

export default App;
