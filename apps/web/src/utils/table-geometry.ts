export interface SeatPosition {
  xPercent: number;
  yPercent: number;
  zone:
    | 'south'
    | 'south-west'
    | 'west'
    | 'north-west'
    | 'north'
    | 'north-east'
    | 'east'
    | 'south-east';
}

/**
 * Posicionamentos percentuais testáveis e compatíveis com todos os navegadores,
 * organizados no sentido horário a partir da posição relativa 0 (Sul / Jogador local).
 *
 * Cada entrada define as coordenadas (X, Y em %) para N jogadores (de 2 a 10),
 * garantindo espaçamento uniforme e ausência de sobreposições em viewports
 * a partir de 320px.
 */
const SEAT_LAYOUTS: Record<number, SeatPosition[]> = {
  // 2 Jogadores (Heads-up): Sul vs Norte
  2: [
    { xPercent: 50, yPercent: 92, zone: 'south' },
    { xPercent: 50, yPercent: 8, zone: 'north' },
  ],

  // 3 Jogadores: Sul, Noroeste, Nordeste
  3: [
    { xPercent: 50, yPercent: 92, zone: 'south' },
    { xPercent: 18, yPercent: 22, zone: 'north-west' },
    { xPercent: 82, yPercent: 22, zone: 'north-east' },
  ],

  // 4 Jogadores: Sul, Oeste, Norte, Leste
  4: [
    { xPercent: 50, yPercent: 92, zone: 'south' },
    { xPercent: 12, yPercent: 50, zone: 'west' },
    { xPercent: 50, yPercent: 8, zone: 'north' },
    { xPercent: 88, yPercent: 50, zone: 'east' },
  ],

  // 5 Jogadores: Sul, Sudoeste, Noroeste, Nordeste, Sudeste
  5: [
    { xPercent: 50, yPercent: 92, zone: 'south' },
    { xPercent: 14, yPercent: 64, zone: 'south-west' },
    { xPercent: 22, yPercent: 16, zone: 'north-west' },
    { xPercent: 78, yPercent: 16, zone: 'north-east' },
    { xPercent: 86, yPercent: 64, zone: 'south-east' },
  ],

  // 6 Jogadores (Mesa Short-Handed clássica)
  6: [
    { xPercent: 50, yPercent: 92, zone: 'south' },
    { xPercent: 12, yPercent: 70, zone: 'south-west' },
    { xPercent: 12, yPercent: 26, zone: 'north-west' },
    { xPercent: 50, yPercent: 8, zone: 'north' },
    { xPercent: 88, yPercent: 26, zone: 'north-east' },
    { xPercent: 88, yPercent: 70, zone: 'south-east' },
  ],

  // 7 Jogadores
  7: [
    { xPercent: 50, yPercent: 93, zone: 'south' },
    { xPercent: 15, yPercent: 74, zone: 'south-west' },
    { xPercent: 10, yPercent: 44, zone: 'west' },
    { xPercent: 25, yPercent: 12, zone: 'north-west' },
    { xPercent: 75, yPercent: 12, zone: 'north-east' },
    { xPercent: 90, yPercent: 44, zone: 'east' },
    { xPercent: 85, yPercent: 74, zone: 'south-east' },
  ],

  // 8 Jogadores
  8: [
    { xPercent: 50, yPercent: 93, zone: 'south' },
    { xPercent: 15, yPercent: 76, zone: 'south-west' },
    { xPercent: 10, yPercent: 48, zone: 'west' },
    { xPercent: 16, yPercent: 18, zone: 'north-west' },
    { xPercent: 50, yPercent: 7, zone: 'north' },
    { xPercent: 84, yPercent: 18, zone: 'north-east' },
    { xPercent: 90, yPercent: 48, zone: 'east' },
    { xPercent: 85, yPercent: 76, zone: 'south-east' },
  ],

  // 9 Jogadores
  9: [
    { xPercent: 50, yPercent: 93, zone: 'south' },
    { xPercent: 16, yPercent: 78, zone: 'south-west' },
    { xPercent: 10, yPercent: 54, zone: 'west' },
    { xPercent: 11, yPercent: 30, zone: 'north-west' },
    { xPercent: 30, yPercent: 10, zone: 'north' },
    { xPercent: 70, yPercent: 10, zone: 'north' },
    { xPercent: 89, yPercent: 30, zone: 'north-east' },
    { xPercent: 90, yPercent: 54, zone: 'east' },
    { xPercent: 84, yPercent: 78, zone: 'south-east' },
  ],

  // 10 Jogadores (Mesa Cheia / Full Ring)
  10: [
    { xPercent: 50, yPercent: 94, zone: 'south' },
    { xPercent: 16, yPercent: 80, zone: 'south-west' },
    { xPercent: 9, yPercent: 58, zone: 'west' },
    { xPercent: 9, yPercent: 36, zone: 'west' },
    { xPercent: 22, yPercent: 14, zone: 'north-west' },
    { xPercent: 50, yPercent: 6, zone: 'north' },
    { xPercent: 78, yPercent: 14, zone: 'north-east' },
    { xPercent: 91, yPercent: 36, zone: 'east' },
    { xPercent: 91, yPercent: 58, zone: 'east' },
    { xPercent: 84, yPercent: 80, zone: 'south-east' },
  ],
};

/**
 * Retorna a posição do assento calculada para a quantidade de jogadores e índice relativo.
 */
export function getSeatPosition(totalSeats: number, relativeIndex: number): SeatPosition {
  const clampedTotal = Math.max(2, Math.min(10, totalSeats));
  const layout = SEAT_LAYOUTS[clampedTotal] ?? SEAT_LAYOUTS[6];
  const safeIndex = ((relativeIndex % clampedTotal) + clampedTotal) % clampedTotal;
  return layout[safeIndex] ?? { xPercent: 50, yPercent: 50, zone: 'south' };
}

/**
 * Calcula o índice relativo de cada jogador para garantir que o próprio jogador
 * (isSelf) fique sempre ancorado no índice 0 (Sul).
 */
export function getRelativeSeatIndex(
  playerIndex: number,
  selfIndex: number,
  totalSeats: number,
): number {
  if (totalSeats <= 0) return 0;
  if (selfIndex < 0) return playerIndex % totalSeats; // Espectador: ordem natural
  return ((playerIndex - selfIndex) % totalSeats + totalSeats) % totalSeats;
}
