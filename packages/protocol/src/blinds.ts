import { z } from 'zod';

const chips = z.number().int().min(1).max(1_000_000);

export const blindLevelSchema = z.strictObject({
  smallBlind: chips,
  bigBlind: chips,
  duration: z.number().int().positive().max(1000).optional(),
}).refine(l => l.bigBlind >= l.smallBlind, {
  message: 'O big blind deve ser igual ou maior que o small blind.',
  path: ['bigBlind'],
});

export const blindsStructureSchema = z.discriminatedUnion('type', [
  z.strictObject({
    type: z.literal('fixed'),
  }),
  z.strictObject({
    type: z.literal('hands'),
    handsPerLevel: z.number().int().positive().max(1000),
    levels: z.array(blindLevelSchema).min(1).max(20),
  }),
  z.strictObject({
    type: z.literal('time'),
    minutesPerLevel: z.number().int().positive().max(120),
    levels: z.array(blindLevelSchema).min(1).max(20),
  }),
]);

export type BlindLevel = z.infer<typeof blindLevelSchema>;
export type BlindsStructure = z.infer<typeof blindsStructureSchema>;

export const blindsTrackerSchema = z.strictObject({
  levelIndex: z.number().int().nonnegative(),
  handsInCurrentLevel: z.number().int().positive(),
  levelStartedAt: z.string().datetime(),
  lastSavedAt: z.string().datetime().optional(),
});
export type BlindsTracker = z.infer<typeof blindsTrackerSchema>;

export const blindsProgressionStateSchema = z.strictObject({
  type: z.enum(['fixed', 'hands', 'time']),
  currentLevelIndex: z.number().int().nonnegative(),
  totalLevels: z.number().int().positive().optional(),
  currentSmallBlind: chips,
  currentBigBlind: chips,
  nextLevel: z.strictObject({
    levelIndex: z.number().int().positive(),
    smallBlind: chips,
    bigBlind: chips,
  }).nullable(),
  handsInCurrentLevel: z.number().int().nonnegative().optional(),
  handsRemainingInLevel: z.number().int().nonnegative().optional(),
  levelStartedAt: z.string().datetime().optional(),
  levelExpiresAt: z.string().datetime().optional(),
  secondsRemainingInLevel: z.number().int().nonnegative().optional(),
  isNextLevelPending: z.boolean(),
});
export type BlindsProgressionState = z.infer<typeof blindsProgressionStateSchema>;

/**
 * Cria a lista padrão de níveis com base no Small Blind e Big Blind iniciais.
 */
export function getDefaultBlindLevels(sb: number, bb: number): BlindLevel[] {
  const mults = [
    [1, 1],
    [2, 2],
    [3, 3],
    [5, 5],
    [10, 10],
  ];
  return mults.map(([sbM, bbM]) => ({
    smallBlind: Math.min(1_000_000, sb * sbM),
    bigBlind: Math.min(1_000_000, bb * bbM),
  }));
}

/**
 * Retorna a duração (em minutos ou mãos) de um nível.
 */
export function getBlindLevelDuration(
  structure: BlindsStructure,
  levelIndex: number,
): number {
  if (structure.type === 'fixed') return 0;
  const level = structure.levels[levelIndex];
  if (structure.type === 'hands') {
    return level?.duration ?? structure.handsPerLevel;
  }
  return level?.duration ?? structure.minutesPerLevel;
}

/**
 * Calcula a projeção pública do estado de blinds para envio aos clientes.
 */
export function computeBlindsState(
  structure: BlindsStructure | undefined,
  tracker: BlindsTracker | undefined,
  currentHandBlinds?: { smallBlind: number; bigBlind: number },
  nowMs = Date.now(),
): BlindsProgressionState {
  if (!structure || structure.type === 'fixed') {
    return {
      type: 'fixed',
      currentLevelIndex: 0,
      currentSmallBlind: currentHandBlinds?.smallBlind ?? 10,
      currentBigBlind: currentHandBlinds?.bigBlind ?? 20,
      nextLevel: null,
      isNextLevelPending: false,
    };
  }

  const levels = structure.levels;
  const idx = Math.min(levels.length - 1, Math.max(0, tracker?.levelIndex ?? 0));
  const currentLevel = levels[idx];
  const hasNext = idx < levels.length - 1;
  const nextLevel = hasNext
    ? {
        levelIndex: idx + 1,
        smallBlind: levels[idx + 1].smallBlind,
        bigBlind: levels[idx + 1].bigBlind,
      }
    : null;

  if (structure.type === 'hands') {
    const duration = currentLevel.duration ?? structure.handsPerLevel;
    const handsInCurrent = tracker?.handsInCurrentLevel ?? 1;
    const handsRemaining = hasNext ? Math.max(0, duration - handsInCurrent) : 0;
    const isNextLevelPending = hasNext && handsInCurrent >= duration;

    return {
      type: 'hands',
      currentLevelIndex: idx,
      totalLevels: levels.length,
      currentSmallBlind: currentHandBlinds?.smallBlind ?? currentLevel.smallBlind,
      currentBigBlind: currentHandBlinds?.bigBlind ?? currentLevel.bigBlind,
      nextLevel,
      handsInCurrentLevel: handsInCurrent,
      handsRemainingInLevel: handsRemaining,
      isNextLevelPending,
    };
  }

  // structure.type === 'time'
  const durationMin = currentLevel.duration ?? structure.minutesPerLevel;
  const durationSec = durationMin * 60;
  const startedAtMs = tracker ? new Date(tracker.levelStartedAt).getTime() : nowMs;
  const expiresAtMs = startedAtMs + durationSec * 1000;
  const remainingSec = Math.max(0, Math.ceil((expiresAtMs - nowMs) / 1000));
  const isNextLevelPending = hasNext && nowMs >= expiresAtMs;

  return {
    type: 'time',
    currentLevelIndex: idx,
    totalLevels: levels.length,
    currentSmallBlind: currentHandBlinds?.smallBlind ?? currentLevel.smallBlind,
    currentBigBlind: currentHandBlinds?.bigBlind ?? currentLevel.bigBlind,
    nextLevel,
    levelStartedAt: new Date(startedAtMs).toISOString(),
    levelExpiresAt: new Date(expiresAtMs).toISOString(),
    secondsRemainingInLevel: remainingSec,
    isNextLevelPending,
  };
}

/**
 * Aplica a política explícita de tolerância e pausa para o tempo em que o servidor ficou offline.
 * Se o downtime entre lastSavedAt e serverBootMs ultrapassar 60 segundos, o excesso é pausado
 * e somado ao levelStartedAt para que os jogadores não percam tempo de torneio durante interrupções.
 */
export function adjustTrackerForServerDowntime(
  tracker: BlindsTracker,
  serverBootMs: number,
): BlindsTracker {
  if (!tracker.lastSavedAt) return tracker;
  const lastSavedMs = new Date(tracker.lastSavedAt).getTime();
  if (serverBootMs <= lastSavedMs) return tracker;

  const downtimeMs = serverBootMs - lastSavedMs;
  if (downtimeMs <= 60_000) {
    return {
      ...tracker,
      lastSavedAt: new Date(serverBootMs).toISOString(),
    };
  }

  const pausedMs = downtimeMs - 60_000;
  const adjustedStartedAt = new Date(new Date(tracker.levelStartedAt).getTime() + pausedMs).toISOString();

  return {
    ...tracker,
    levelStartedAt: adjustedStartedAt,
    lastSavedAt: new Date(serverBootMs).toISOString(),
  };
}

/**
 * Calcula o avanço de nível quando o anfitrião dispara next-hand.
 * Retorna o novo tracker atualizado e a configuração de blinds que será aplicada na nova mão.
 */
export function advanceBlindsOnNextHand(
  structure: BlindsStructure | undefined,
  currentTracker: BlindsTracker | undefined,
  baseBlinds: { smallBlind: number; bigBlind: number },
  nowMs = Date.now(),
): {
  tracker: BlindsTracker | undefined;
  blinds: { smallBlind: number; bigBlind: number };
} {
  if (!structure || structure.type === 'fixed') {
    return {
      tracker: undefined,
      blinds: baseBlinds,
    };
  }

  const levels = structure.levels;
  const currentIdx = Math.min(levels.length - 1, Math.max(0, currentTracker?.levelIndex ?? 0));

  if (structure.type === 'hands') {
    const duration = levels[currentIdx].duration ?? structure.handsPerLevel;
    const handsInCurrent = currentTracker?.handsInCurrentLevel ?? 1;

    if (currentIdx < levels.length - 1 && handsInCurrent >= duration) {
      // Avança de nível
      const nextIdx = currentIdx + 1;
      const nextLevel = levels[nextIdx];
      return {
        tracker: {
          levelIndex: nextIdx,
          handsInCurrentLevel: 1,
          levelStartedAt: new Date(nowMs).toISOString(),
          lastSavedAt: new Date(nowMs).toISOString(),
        },
        blinds: {
          smallBlind: nextLevel.smallBlind,
          bigBlind: nextLevel.bigBlind,
        },
      };
    }

    // Permanece no mesmo nível
    return {
      tracker: {
        levelIndex: currentIdx,
        handsInCurrentLevel: handsInCurrent + 1,
        levelStartedAt: currentTracker?.levelStartedAt ?? new Date(nowMs).toISOString(),
        lastSavedAt: new Date(nowMs).toISOString(),
      },
      blinds: {
        smallBlind: levels[currentIdx].smallBlind,
        bigBlind: levels[currentIdx].bigBlind,
      },
    };
  }

  // structure.type === 'time'
  let startedAtMs = currentTracker ? new Date(currentTracker.levelStartedAt).getTime() : nowMs;

  let idx = currentIdx;
  while (idx < levels.length - 1) {
    const levelDurationMs = ((levels[idx].duration ?? structure.minutesPerLevel) * 60) * 1000;
    if (nowMs >= startedAtMs + levelDurationMs) {
      startedAtMs += levelDurationMs;
      idx++;
    } else {
      break;
    }
  }

  const isLevelChanged = idx !== currentIdx;
  return {
    tracker: {
      levelIndex: idx,
      handsInCurrentLevel: isLevelChanged ? 1 : (currentTracker?.handsInCurrentLevel ?? 0) + 1,
      levelStartedAt: isLevelChanged ? new Date(nowMs).toISOString() : new Date(startedAtMs).toISOString(),
      lastSavedAt: new Date(nowMs).toISOString(),
    },
    blinds: {
      smallBlind: levels[idx].smallBlind,
      bigBlind: levels[idx].bigBlind,
    },
  };
}
