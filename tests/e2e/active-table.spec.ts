import { test, expect } from '@playwright/test';
import { io, type Socket } from 'socket.io-client';
import { randomUUID } from 'node:crypto';
import type { Admission, ClientEvents, CommandInput, Reply, RoomState, ServerEvents } from '@poker-table/protocol';

test.describe('Active Mobile Table Interface (Etapa 4A)', () => {
  test('renders mobile table layout with pot, street, player cards and personal panel at 320px', async ({ page, request }) => {
    // 1. Mobile viewport at minimal supported 320px
    await page.setViewportSize({ width: 320, height: 740 });

    // 2. Create room via HTTP API
    const createRes = await request.post('/api/rooms', {
      data: {
        hostName: 'Carlos',
        config: { name: 'Mesa Mobile', maxPlayers: 4, startingChips: 1000, smallBlind: 10, bigBlind: 20 },
      },
    });
    const hostReply = (await createRes.json()) as Reply<Admission>;
    if (!hostReply.ok) throw new Error(hostReply.error.message);
    const host = hostReply.data;

    // 3. Guest joins
    const joinRes = await request.post(`/api/rooms/${host.room.code}/join`, {
      data: { name: 'Daniela', seat: 2 },
    });
    const guestReply = (await joinRes.json()) as Reply<Admission>;
    if (!guestReply.ok) throw new Error(guestReply.error.message);
    const guest = guestReply.data;

    // 4. Set guest session in localStorage and visit room
    await page.addInitScript(
      ({ code, credentials }) => {
        localStorage.setItem(`poker-table.session.v1.${code}`, JSON.stringify(credentials));
      },
      { code: host.room.code, credentials: guest.credentials },
    );
    await page.goto(`/room/${host.room.code}`);
    await expect(page.getByText('Conectado · mesa sincronizada')).toBeVisible();

    // 5. Connect admin socket to start the game
    const admin: Socket<ServerEvents, ClientEvents> = io('http://127.0.0.1:3100', {
      auth: { protocol: 1, credentials: host.credentials },
      transports: ['websocket'],
      autoConnect: false,
    });

    try {
      await new Promise<void>((resolve, reject) => {
        admin.once('room:state', () => resolve());
        admin.once('connect_error', reject);
        admin.connect();
      });

      const send = async (input: CommandInput) => {
        const state = await new Promise<RoomState>((resolve, reject) =>
          admin.emit('room:sync', reply => (reply.ok ? resolve(reply.data) : reject(Error(reply.error.message)))),
        );
        const result = await new Promise<Reply<RoomState>>(resolve =>
          admin.emit('room:command', { ...input, commandId: randomUUID(), expectedRevision: state.revision }, resolve),
        );
        expect(result.ok).toBe(true);
      };

      // Host sits at seat 1 and starts game
      await send({ type: 'select-seat', seat: 1 });
      await send({ type: 'start-game' });

      // 6. Verify Active Table elements
      await expect(page.getByLabel('Mesa de jogo ativa')).toBeVisible();
      await expect(page.getByText('PRÉ-FLOP', { exact: true })).toBeVisible();
      await expect(page.getByText('POTE TOTAL', { exact: true })).toBeVisible();
      // Pot starts at 30 (10 SB + 20 BB)
      await expect(page.locator('.pot-value')).toContainText('30');
      await expect(page.locator('.blinds-badge')).toContainText('10 / 20');

      // 7. Verify Seat Strip and Player Cards
      await expect(page.getByLabel('Jogadores na mesa')).toBeVisible();
      await expect(page.locator('.player-card')).toHaveCount(2);

      // Verify Dealer and Blind badges
      await expect(page.locator('.badge-dealer')).toBeVisible();
      await expect(page.locator('.badge-blind')).toHaveCount(2); // SB and BB
      await expect(page.locator('.badge-self')).toBeVisible(); // "Você" badge on guest's card

      // 8. Verify Personal Status Panel
      await expect(page.getByLabel('Seu painel pessoal')).toBeVisible();
      await expect(page.getByText('SEU STACK', { exact: true })).toBeVisible();
      await expect(page.getByText('Assento #2', { exact: true })).toBeVisible();
      // Daniela is BB (posts 20), so stack is 980
      await expect(page.locator('.my-stack-amount')).toContainText('980');

      // 9. Verify Future Action Dock (informative state)
      await expect(page.getByLabel('Painel de ações')).toBeVisible();

      // 10. Verify no horizontal page overflow at 320px
      const scrollWidth = await page.evaluate(() => document.body.scrollWidth);
      expect(scrollWidth).toBeLessThanOrEqual(320);

      // 11. Advance game: Carlos (SB/Dealer in heads-up) folds -> hand ends
      await send({ type: 'game-action', action: 'fold' });
      await expect(page.getByText('MÃO ENCERRADA', { exact: true })).toBeVisible();

      // 12. Host settles hand
      await send({ type: 'settle-hand', decisions: [] });
      await expect(page.getByText('MÃO LIQUIDADA', { exact: true })).toBeVisible();
      await expect(page.getByText('POTE DISTRIBUÍDO', { exact: true })).toBeVisible();
      await expect(page.getByLabel('Resumo dos prêmios')).toBeVisible();
      await expect(page.getByText('Resultado da Mão', { exact: true })).toBeVisible();
      // Daniela won the pot of 30, stack is now 1010
      await expect(page.locator('.my-stack-amount')).toContainText('1.010');
    } finally {
      admin.disconnect();
    }
  });

  test('lobby displays prominent start button above seat map and blocked hints when players are missing or disconnected', async ({ page, request }) => {
    // 1. Create room as Host
    const createRes = await request.post('/api/rooms', {
      data: {
        hostName: 'Bruno Host',
        config: { name: 'Mesa Lobby Test', maxPlayers: 4, startingChips: 500, smallBlind: 5, bigBlind: 10 },
      },
    });
    const hostReply = (await createRes.json()) as Reply<Admission>;
    if (!hostReply.ok) throw new Error(hostReply.error.message);
    const host = hostReply.data;

    // Set host in localStorage and goto room
    await page.addInitScript(
      ({ code, credentials }) => {
        localStorage.setItem(`poker-table.session.v1.${code}`, JSON.stringify(credentials));
      },
      { code: host.room.code, credentials: host.credentials },
    );
    await page.goto(`/room/${host.room.code}`);
    await expect(page.getByText('Conectado · mesa sincronizada')).toBeVisible();

    // Host has no seat yet: seatedCount = 0 < 2 -> hint
    await expect(page.getByText('Aguardando pelo menos 2 participantes sentados para iniciar.')).toBeVisible();

    // Host sits at seat 1: seatedCount = 1 < 2 -> still hint
    await page.getByRole('button', { name: 'Posição 1, disponível' }).click();
    await expect(page.getByText('Aguardando pelo menos 2 participantes sentados para iniciar.')).toBeVisible();

    // Guest joins via socket and sits at seat 2
    const guestRes = await request.post(`/api/rooms/${host.room.code}/join`, {
      data: { name: 'Mariana', seat: 2 },
    });
    const guestReply = (await guestRes.json()) as Reply<Admission>;
    if (!guestReply.ok) throw new Error(guestReply.error.message);
    const guest = guestReply.data;

    const guestSocket: Socket<ServerEvents, ClientEvents> = io('http://127.0.0.1:3100', {
      auth: { protocol: 1, credentials: guest.credentials },
      transports: ['websocket'],
      autoConnect: false,
    });

    try {
      await new Promise<void>((resolve, reject) => {
        guestSocket.once('room:state', () => resolve());
        guestSocket.once('connect_error', reject);
        guestSocket.connect();
      });

      // Now 2 players are seated and both connected!
      // Start button should appear prominently in .lobby-host-action above SeatMap
      const startBtn = page.locator('.lobby-host-action button.lobby-start-btn');
      await expect(startBtn).toBeVisible();
      await expect(startBtn).toHaveText('Iniciar partida ♠');

      // Verify there is NO duplicate start button in aside
      await expect(page.locator('aside button:has-text("Iniciar partida")')).toHaveCount(0);

      // Now disconnect guest socket
      guestSocket.disconnect();

      // Host should see blocked hint: "Aguardando todos os participantes sentados se conectarem."
      await expect(page.getByText('Aguardando todos os participantes sentados se conectarem.')).toBeVisible();
      await expect(startBtn).not.toBeVisible();
    } finally {
      guestSocket.disconnect();
    }
  });

  test('spectator view shows spectator mode and status message without fictitious chips', async ({ page, request }) => {
    // 1. Create room
    const createRes = await request.post('/api/rooms', {
      data: {
        hostName: 'Helena Host',
        config: { name: 'Mesa Espectador', maxPlayers: 6, startingChips: 1000, smallBlind: 10, bigBlind: 20 },
      },
    });
    const hostReply = (await createRes.json()) as Reply<Admission>;
    if (!hostReply.ok) throw new Error(hostReply.error.message);
    const host = hostReply.data;

    // 2. Player 2 joins with seat
    const p2Res = await request.post(`/api/rooms/${host.room.code}/join`, {
      data: { name: 'Lucas', seat: 2 },
    });
    const p2Reply = (await p2Res.json()) as Reply<Admission>;
    if (!p2Reply.ok) throw new Error(p2Reply.error.message);

    const p2Socket: Socket<ServerEvents, ClientEvents> = io('http://127.0.0.1:3100', {
      auth: { protocol: 1, credentials: p2Reply.data.credentials },
      transports: ['websocket'],
      autoConnect: false,
    });

    // 3. Player 3 joins WITHOUT seat (spectator)
    const specRes = await request.post(`/api/rooms/${host.room.code}/join`, {
      data: { name: 'Paula Espectadora' },
    });
    const specReply = (await specRes.json()) as Reply<Admission>;
    if (!specReply.ok) throw new Error(specReply.error.message);
    const spectator = specReply.data;

    // Connect admin to sit host and start game
    const admin: Socket<ServerEvents, ClientEvents> = io('http://127.0.0.1:3100', {
      auth: { protocol: 1, credentials: host.credentials },
      transports: ['websocket'],
      autoConnect: false,
    });

    try {
      await Promise.all([
        new Promise<void>((resolve, reject) => {
          admin.once('room:state', () => resolve());
          admin.once('connect_error', reject);
          admin.connect();
        }),
        new Promise<void>((resolve, reject) => {
          p2Socket.once('room:state', () => resolve());
          p2Socket.once('connect_error', reject);
          p2Socket.connect();
        }),
      ]);

      const send = async (input: CommandInput) => {
        const state = await new Promise<RoomState>((resolve, reject) =>
          admin.emit('room:sync', reply => (reply.ok ? resolve(reply.data) : reject(Error(reply.error.message)))),
        );
        const result = await new Promise<Reply<RoomState>>(resolve =>
          admin.emit('room:command', { ...input, commandId: randomUUID(), expectedRevision: state.revision }, resolve),
        );
        if (!result.ok) throw new Error(`Command failed: ${result.error.code} - ${result.error.message}`);
        expect(result.ok).toBe(true);
      };

      await send({ type: 'select-seat', seat: 1 });
      await send({ type: 'start-game' });

      // Paula (spectator) opens the room
      await page.addInitScript(
        ({ code, credentials }) => {
          localStorage.setItem(`poker-table.session.v1.${code}`, JSON.stringify(credentials));
        },
        { code: host.room.code, credentials: spectator.credentials },
      );
      await page.goto(`/room/${host.room.code}`);
      await expect(page.getByText('Conectado · sincronizado')).toBeVisible();

      // Verify Spectator view elements
      await expect(page.getByLabel('Mesa de jogo ativa')).toBeVisible();
      await expect(page.getByText('MODO ESPECTADOR', { exact: true })).toBeVisible();
      await expect(page.getByText('Sem assento', { exact: true })).toBeVisible();
      await expect(page.getByText('Você está acompanhando a partida como espectador.', { exact: true })).toBeVisible();
      await expect(page.getByText('Apenas observando', { exact: true })).toBeVisible();

      // Check FutureActionDock for spectator
      await expect(page.getByText('Acompanhando a partida como espectador.', { exact: true })).toBeVisible();

      // Check that there is no fictitious chips amount in my status
      await expect(page.locator('.my-stack-amount')).toHaveCount(0);
    } finally {
      admin.disconnect();
      p2Socket.disconnect();
    }
  });
});

