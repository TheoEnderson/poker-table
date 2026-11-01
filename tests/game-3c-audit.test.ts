import { expect, it } from 'vitest';
import { startHandFlow } from '@poker-table/engine';
import { decodeGame } from '../apps/server/src/persistence/hand.js';
import { useLanGame } from './support/lan-game.js';

const g = useLanGame();

it.each([2, 3])(
  'rejects an invalid initial dealer in persistence v%s',
  async version => {
    await g.setup(3);

    const room = g.state();

    const players = room.players
      .filter(p => p.seat !== null)
      .map(p => ({
        id: p.id,
        seat: p.seat!,
        chips: room.config.startingChips,
      }));

    // Estado estruturalmente válido produzido pelo motor,
    // mas com dealer incorreto para a primeira mão.
    const forged = startHandFlow({
      players,
      blinds: {
        smallBlind: room.config.smallBlind,
        bigBlind: room.config.bigBlind,
      },
      dealerSeat: 2,
    });

    const record = version === 2
      ? {
          version: 2,
          status: 'hand-active',
          hand: forged,
        }
      : {
          version: 3,
          status: 'hand-active',
          hand: forged,
          handNumber: 1,
          tableBudget: 3000,
        };

    expect(() =>
      decodeGame(
        JSON.stringify(record),
        room.config,
        room.players,
      ),
    ).toThrowError();
  },
);
