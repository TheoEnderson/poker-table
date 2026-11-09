/**
 * Utilitário para sincronização temporal e contagem regressiva determinística de blinds.
 *
 * Elimina a dependência do relógio de parede (Date.now()) do dispositivo móvel do cliente,
 * utilizando referências monotônicas (performance.now()) ancoradas na contagem autoritativa
 * de segundos restantes (secondsRemainingInLevel) enviada pelo servidor.
 */

export interface ClockSyncState {
  baseRemaining: number;
  syncPerfTime: number;
}

/**
 * Inicializa a referência de sincronização com o tempo restante do servidor
 * e a marca monotônica atual do cliente.
 */
export function initClockSync(
  secondsRemaining: number,
  currentPerfTime: number = typeof performance !== 'undefined' ? performance.now() : Date.now(),
): ClockSyncState {
  return {
    baseRemaining: Math.max(0, Math.floor(secondsRemaining)),
    syncPerfTime: currentPerfTime,
  };
}

/**
 * Calcula os segundos restantes a partir do tempo decorrido desde a última sincronização.
 * Opera de forma puramente monotônica, imune a relógios de celular adiantados ou atrasados.
 */
export function computeSynchronizedRemaining(
  sync: ClockSyncState,
  currentPerfTime: number = typeof performance !== 'undefined' ? performance.now() : Date.now(),
): number {
  const elapsedSec = (currentPerfTime - sync.syncPerfTime) / 1000;
  return Math.max(0, Math.ceil(sync.baseRemaining - elapsedSec));
}

/**
 * Formata segundos inteiros em formato MM:SS.
 */
export function formatCountdownTime(totalSeconds: number): string {
  const safeSecs = Math.max(0, Math.floor(totalSeconds));
  const m = Math.floor(safeSecs / 60);
  const s = safeSecs % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}
