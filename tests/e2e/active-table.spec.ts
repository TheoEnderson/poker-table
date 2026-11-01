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

      // Check ActionDock for spectator
      await expect(page.getByText('Acompanhando a partida como espectador.', { exact: true })).toBeVisible();

      // Check that there is no fictitious chips amount in my status
      await expect(page.locator('.my-stack-amount')).toHaveCount(0);
    } finally {
      admin.disconnect();
      p2Socket.disconnect();
    }
  });

  test('executes in-browser betting actions (raise with numeric input, check, call) at 390px', async ({ page, request }) => {
    await page.setViewportSize({ width: 390, height: 844 });

    // 1. Create room with Carlos (Host, seat 1) and Daniela (Guest, seat 2)
    const createRes = await request.post('/api/rooms', {
      data: {
        hostName: 'Carlos',
        config: { name: 'Mesa Apostas', maxPlayers: 4, startingChips: 1000, smallBlind: 10, bigBlind: 20 },
      },
    });
    const hostReply = (await createRes.json()) as Reply<Admission>;
    if (!hostReply.ok) throw new Error(hostReply.error.message);
    const host = hostReply.data;

    const joinRes = await request.post(`/api/rooms/${host.room.code}/join`, {
      data: { name: 'Daniela', seat: 2 },
    });
    const guestReply = (await joinRes.json()) as Reply<Admission>;
    if (!guestReply.ok) throw new Error(guestReply.error.message);
    const guest = guestReply.data;

    // Connect guest socket to receive state and send actions
    const guestSocket: Socket<ServerEvents, ClientEvents> = io('http://127.0.0.1:3100', {
      auth: { protocol: 1, credentials: guest.credentials },
      transports: ['websocket'],
      autoConnect: false,
    });

    // Host opens the room in browser
    await page.addInitScript(
      ({ code, credentials }) => {
        localStorage.setItem(`poker-table.session.v1.${code}`, JSON.stringify(credentials));
      },
      { code: host.room.code, credentials: host.credentials },
    );
    await page.goto(`/room/${host.room.code}`);
    await expect(page.getByText('Conectado · mesa sincronizada')).toBeVisible();

    try {
      await new Promise<void>((resolve, reject) => {
        guestSocket.once('room:state', () => resolve());
        guestSocket.once('connect_error', reject);
        guestSocket.connect();
      });

      // Host sits at seat 1 and clicks Iniciar partida in the UI
      await page.getByRole('button', { name: 'Posição 1, disponível' }).click();
      const startBtn = page.locator('.lobby-host-action button.lobby-start-btn');
      await expect(startBtn).toBeVisible();
      await startBtn.click();

      // Game started!
      await expect(page.getByLabel('Mesa de jogo ativa')).toBeVisible();
      await expect(page.getByText('PRÉ-FLOP', { exact: true })).toBeVisible();

      // In heads-up preflop, Carlos is SB/Dealer (posts 10) and is first to act!
      await expect(page.getByText('Sua vez', { exact: true })).toBeVisible();

      // Check that ActionDock is active
      const dock = page.locator('.action-dock-active');
      await expect(dock).toBeVisible();
      await expect(dock.locator('.action-btn-fold')).toBeVisible();
      await expect(dock.locator('.action-btn-call')).toContainText('Pagar 10');
      await expect(dock.locator('.action-btn-raise')).toBeVisible();
      await expect(dock.locator('.action-btn-allin')).toContainText('All-in (990)');

      // Carlos opens RaiseControl
      await dock.locator('.action-btn-raise').click();
      const raiseCtrl = page.locator('.raise-control');
      await expect(raiseCtrl).toBeVisible();
      await expect(raiseCtrl.locator('.raise-target-display strong')).toHaveText('40');

      // Carlos enters numeric value 60 via input
      const input = raiseCtrl.locator('.raise-input');
      await input.fill('60');
      await expect(raiseCtrl.locator('.raise-extra-display')).toContainText('+50');

      // Carlos confirms raise
      await raiseCtrl.locator('.raise-btn-confirm').click();

      // Pot should now be 80 (60 from Carlos + 20 from Daniela)
      await expect(page.locator('.pot-value')).toContainText('80');

      // Now it's Daniela's turn: Carlos sees waiting dock
      await expect(page.getByText('Aguardando Daniela agir…')).toBeVisible();

      // Daniela calls 40 via socket command
      const guestState = await new Promise<RoomState>((resolve, reject) =>
        guestSocket.emit('room:sync', reply => (reply.ok ? resolve(reply.data) : reject(Error(reply.error.message)))),
      );
      const callResult = await new Promise<Reply<RoomState>>(resolve =>
        guestSocket.emit(
          'room:command',
          { type: 'game-action', action: 'call', commandId: randomUUID(), expectedRevision: guestState.revision },
          resolve,
        ),
      );
      expect(callResult.ok).toBe(true);

      // Preflop completed: Pot is now 120 (60 + 60)
      await expect(page.locator('.pot-value')).toContainText('120');
      await expect(page.getByText('Apostas igualadas. Aguardando o anfitrião avançar a rodada.')).toBeVisible();
    } finally {
      guestSocket.disconnect();
    }
  });

  test('handles fold confirmation dialog and cancellation', async ({ page, request }) => {
    // Viewport 320px
    await page.setViewportSize({ width: 320, height: 740 });

    const createRes = await request.post('/api/rooms', {
      data: {
        hostName: 'Bruno',
        config: { name: 'Mesa Fold Test', maxPlayers: 4, startingChips: 500, smallBlind: 10, bigBlind: 20 },
      },
    });
    const hostReply = (await createRes.json()) as Reply<Admission>;
    if (!hostReply.ok) throw new Error(hostReply.error.message);
    const host = hostReply.data;

    const joinRes = await request.post(`/api/rooms/${host.room.code}/join`, {
      data: { name: 'Fernanda', seat: 2 },
    });
    const guestReply = (await joinRes.json()) as Reply<Admission>;
    if (!guestReply.ok) throw new Error(guestReply.error.message);

    const guestSocket: Socket<ServerEvents, ClientEvents> = io('http://127.0.0.1:3100', {
      auth: { protocol: 1, credentials: guestReply.data.credentials },
      transports: ['websocket'],
      autoConnect: false,
    });

    await page.addInitScript(
      ({ code, credentials }) => {
        localStorage.setItem(`poker-table.session.v1.${code}`, JSON.stringify(credentials));
      },
      { code: host.room.code, credentials: host.credentials },
    );
    await page.goto(`/room/${host.room.code}`);

    try {
      await new Promise<void>((resolve, reject) => {
        guestSocket.once('room:state', () => resolve());
        guestSocket.once('connect_error', reject);
        guestSocket.connect();
      });

      await page.getByRole('button', { name: 'Posição 1, disponível' }).click();
      await page.locator('.lobby-host-action button.lobby-start-btn').click();

      await expect(page.getByLabel('Mesa de jogo ativa')).toBeVisible();

      // Bruno is SB and first to act: clicks Desistir (Fold)
      await page.locator('.action-btn-fold').click();

      // Confirmation modal is visible
      const modal = page.locator('dialog[open]');
      await expect(modal).toBeVisible();
      await expect(modal.getByText('Confirmar desistência?')).toBeVisible();

      // Clicking Cancelar cancels fold
      await modal.getByRole('button', { name: 'Cancelar' }).click();
      await expect(modal).not.toBeVisible();
      await expect(page.locator('.action-dock-active')).toBeVisible();

      // Clicking Desistir (Fold) again and confirming
      await page.locator('.action-btn-fold').click();
      await modal.getByRole('button', { name: 'Desistir da mão' }).click();

      // Hand ends by fold!
      await expect(page.getByText('MÃO ENCERRADA', { exact: true })).toBeVisible();
    } finally {
      guestSocket.disconnect();
    }
  });

  test('requires explicit confirmation for all all-in paths (primary button, max raise, call) with correct chip amounts and zero change on cancel', async ({ page, browser, request }) => {
    await page.setViewportSize({ width: 390, height: 844 });

    // 1. Create room with Bruno (Host, seat 1, 500 chips) and Fernanda (Guest, seat 2, 500 chips)
    const createRes = await request.post('/api/rooms', {
      data: {
        hostName: 'Bruno',
        config: { name: 'Mesa All-in Audit', maxPlayers: 4, startingChips: 500, smallBlind: 10, bigBlind: 20 },
      },
    });
    const hostReply = (await createRes.json()) as Reply<Admission>;
    if (!hostReply.ok) throw new Error(hostReply.error.message);
    const host = hostReply.data;

    const joinRes = await request.post(`/api/rooms/${host.room.code}/join`, {
      data: { name: 'Fernanda', seat: 2 },
    });
    const guestReply = (await joinRes.json()) as Reply<Admission>;
    if (!guestReply.ok) throw new Error(guestReply.error.message);
    const guest = guestReply.data;

    // Connect Fernanda socket for state sync
    const guestSocket: Socket<ServerEvents, ClientEvents> = io('http://127.0.0.1:3100', {
      auth: { protocol: 1, credentials: guest.credentials },
      transports: ['websocket'],
      autoConnect: false,
    });

    await page.addInitScript(
      ({ code, credentials }) => {
        localStorage.setItem(`poker-table.session.v1.${code}`, JSON.stringify(credentials));
      },
      { code: host.room.code, credentials: host.credentials },
    );
    await page.goto(`/room/${host.room.code}`);

    const guestContext = await browser.newContext();

    try {
      await new Promise<void>((resolve, reject) => {
        guestSocket.once('room:state', () => resolve());
        guestSocket.once('connect_error', reject);
        guestSocket.connect();
      });

      // Host sits at seat 1 and starts game
      await page.getByRole('button', { name: 'Posição 1, disponível' }).click();
      await page.locator('.lobby-host-action button.lobby-start-btn').click();

      await expect(page.getByLabel('Mesa de jogo ativa')).toBeVisible();
      // Preflop heads-up: Bruno is SB/dealer (posts 10, has 490 chips left), first to act
      await expect(page.getByText('Sua vez', { exact: true })).toBeVisible();

      // --- PATH 1: All-in via max value of RaiseControl ---
      await page.locator('.action-btn-raise').click();
      const raiseCtrl = page.locator('.raise-control');
      await expect(raiseCtrl).toBeVisible();

      // Click preset All-in (500)
      await raiseCtrl.getByRole('button', { name: /All-in \(500\)/ }).click();
      await expect(raiseCtrl.locator('.raise-input')).toHaveValue('500');
      await expect(raiseCtrl.locator('.raise-extra-display')).toContainText('+490');

      // Click Confirm in RaiseControl -> should trigger confirmation dialog
      await raiseCtrl.locator('.raise-btn-confirm').click();

      // Verify All-in confirmation dialog
      const allInModal = page.locator('dialog[open]');
      await expect(allInModal).toBeVisible();
      await expect(allInModal.locator('h2')).toHaveText('Confirmar All-in?');
      await expect(allInModal.locator('p')).toHaveText(
        'Você apostará todas as suas 490 fichas restantes na mesa (aumento total de 500 fichas na rodada).',
      );

      // Cancel confirmation -> 0 financial change, modal closes, stays in raise control
      await allInModal.getByRole('button', { name: 'Cancelar' }).click();
      await expect(allInModal).not.toBeVisible();
      await expect(page.locator('.my-stack-amount')).toContainText('490');
      await expect(page.locator('.pot-value')).toContainText('30');

      // Close RaiseControl
      await raiseCtrl.locator('.raise-cancel-x').click();
      await expect(raiseCtrl).not.toBeVisible();

      // --- PATH 2: Primary All-in button ---
      const allInBtn = page.locator('.action-btn-allin');
      await expect(allInBtn).toHaveText('All-in (490)');
      await allInBtn.click();

      // Verify All-in confirmation dialog
      await expect(allInModal).toBeVisible();
      await expect(allInModal.locator('h2')).toHaveText('Confirmar All-in?');
      await expect(allInModal.locator('p')).toHaveText(
        'Você apostará todas as suas 490 fichas restantes na mesa.',
      );

      // Cancel confirmation -> 0 financial change
      await allInModal.getByRole('button', { name: 'Cancelar' }).click();
      await expect(allInModal).not.toBeVisible();
      await expect(page.locator('.my-stack-amount')).toContainText('490');
      await expect(page.locator('.pot-value')).toContainText('30');

      // Now confirm Bruno's All-in
      await allInBtn.click();
      await allInModal.getByRole('button', { name: 'Confirmar All-in' }).click();

      // Bruno is now all-in! Pot has 520 (500 Bruno + 20 Fernanda)
      await expect(page.locator('.pot-value')).toContainText('520');
      await expect(page.getByText('Você está em All-in. Aguardando o desfecho da mão.')).toBeVisible();

      // --- PATH 3: Call that puts player in All-in (Fernanda's perspective in isolated context) ---
      const page2 = await guestContext.newPage();
      await page2.setViewportSize({ width: 390, height: 844 });
      await page2.addInitScript(
        ({ code, credentials }) => {
          localStorage.setItem(`poker-table.session.v1.${code}`, JSON.stringify(credentials));
        },
        { code: host.room.code, credentials: guest.credentials },
      );
      await page2.goto(`/room/${host.room.code}`);

      // Fernanda is BB with 480 chips left facing a 500 total bet.
      // Her call amount is 480, which is her entire stack -> Call (All-in)
      await expect(page2.getByText('Sua vez', { exact: true })).toBeVisible();
      const callAllInBtn = page2.locator('.action-btn-call');
      await expect(callAllInBtn).toHaveText('Pagar 480 (All-in)');

      // Fernanda clicks Call -> must open confirmation dialog
      await callAllInBtn.click();

      const fernandaModal = page2.locator('dialog[open]');
      await expect(fernandaModal).toBeVisible();
      await expect(fernandaModal.locator('h2')).toHaveText('Confirmar All-in?');
      await expect(fernandaModal.locator('p')).toHaveText(
        'Você pagará com todas as suas 480 fichas restantes na mesa (All-in).',
      );

      // Cancel confirmation -> 0 financial change
      await fernandaModal.getByRole('button', { name: 'Cancelar' }).click();
      await expect(fernandaModal).not.toBeVisible();
      await expect(page2.locator('.my-stack-amount')).toContainText('480');
      await expect(page2.locator('.pot-value')).toContainText('520');

      // Now confirm Call All-in
      await callAllInBtn.click();
      await fernandaModal.getByRole('button', { name: 'Confirmar All-in' }).click();

      // Both players are all-in: hand proceeds to showdown with 1.000 pot
      await expect(page2.locator('.pot-value')).toContainText('1.000');
      await expect(page2.getByText('SHOWDOWN', { exact: true })).toBeVisible();
      await expect(page.getByText('SHOWDOWN', { exact: true })).toBeVisible();
    } finally {
      guestSocket.disconnect();
      await guestContext.close();
    }
  });

  test('validates numeric input strictly in raise control, maintains unique dialog IDs, and resets transient state on turn change', async ({ page, request }) => {
    await page.setViewportSize({ width: 390, height: 844 });

    const createRes = await request.post('/api/rooms', {
      data: {
        hostName: 'Carlos',
        config: { name: 'Mesa Strict Raise', maxPlayers: 4, startingChips: 1000, smallBlind: 10, bigBlind: 20 },
      },
    });
    const hostReply = (await createRes.json()) as Reply<Admission>;
    if (!hostReply.ok) throw new Error(hostReply.error.message);
    const host = hostReply.data;

    const joinRes = await request.post(`/api/rooms/${host.room.code}/join`, {
      data: { name: 'Daniela', seat: 2 },
    });
    const guestReply = (await joinRes.json()) as Reply<Admission>;
    if (!guestReply.ok) throw new Error(guestReply.error.message);
    const guest = guestReply.data;

    const guestSocket: Socket<ServerEvents, ClientEvents> = io('http://127.0.0.1:3100', {
      auth: { protocol: 1, credentials: guest.credentials },
      transports: ['websocket'],
      autoConnect: false,
    });

    await page.addInitScript(
      ({ code, credentials }) => {
        localStorage.setItem(`poker-table.session.v1.${code}`, JSON.stringify(credentials));
      },
      { code: host.room.code, credentials: host.credentials },
    );
    await page.goto(`/room/${host.room.code}`);

    try {
      await new Promise<void>((resolve, reject) => {
        guestSocket.once('room:state', () => resolve());
        guestSocket.once('connect_error', reject);
        guestSocket.connect();
      });

      await page.getByRole('button', { name: 'Posição 1, disponível' }).click();
      await page.locator('.lobby-host-action button.lobby-start-btn').click();

      await expect(page.getByLabel('Mesa de jogo ativa')).toBeVisible();
      await expect(page.getByText('Sua vez', { exact: true })).toBeVisible();

      // 1. Accessibility & ID Uniqueness: verify dialog title IDs are unique
      const dialogTitleIds = await page.evaluate(() => {
        const dialogs = Array.from(document.querySelectorAll('dialog'));
        return dialogs.map(d => ({
          ariaLabelledBy: d.getAttribute('aria-labelledby'),
          h2Id: d.querySelector('h2')?.id,
        }));
      });
      expect(dialogTitleIds.length).toBeGreaterThan(0);
      const seenIds = new Set<string>();
      for (const d of dialogTitleIds) {
        expect(d.ariaLabelledBy).toBeTruthy();
        expect(d.ariaLabelledBy).toBe(d.h2Id);
        expect(seenIds.has(d.ariaLabelledBy!)).toBe(false);
        seenIds.add(d.ariaLabelledBy!);
      }

      // 2. Strict Numeric Input Validation in RaiseControl
      await page.locator('.action-btn-raise').click();
      const raiseCtrl = page.locator('.raise-control');
      await expect(raiseCtrl).toBeVisible();

      const input = raiseCtrl.locator('.raise-input');
      const confirmBtn = raiseCtrl.locator('.raise-btn-confirm');
      const errorMsg = raiseCtrl.locator('#raise-error-msg');

      // Verify step="any" attribute is present
      await expect(input).toHaveAttribute('step', 'any');

      // Test fractional input rejection (e.g. "40.5")
      await input.fill('40.5');
      await expect(errorMsg).toHaveText('O valor deve ser um número inteiro, sem casas decimais.');
      await expect(confirmBtn).toBeDisabled();
      await expect(input).toHaveValue('40.5'); // Not silently modified

      // Test empty input rejection
      await input.fill('');
      await expect(errorMsg).toHaveText('Informe um valor para o aumento.');
      await expect(confirmBtn).toBeDisabled();

      // Test below minimum rejection
      await input.fill('25');
      await expect(errorMsg).toHaveText('O valor mínimo é 40.');
      await expect(confirmBtn).toBeDisabled();

      // Test above maximum rejection
      await input.fill('99999');
      await expect(errorMsg).toHaveText('O valor máximo disponível é 1.000.');
      await expect(confirmBtn).toBeDisabled();

      // Test valid input restores confirm button
      await input.fill('60');
      await expect(errorMsg).not.toBeVisible();
      await expect(confirmBtn).toBeEnabled();
      await expect(confirmBtn).toHaveText('Confirmar (60)');

      // 3. Transient State Reset when Turn is Lost
      // Close raise control and open fold confirmation dialog
      await raiseCtrl.locator('.raise-btn-cancel').click();
      await page.locator('.action-btn-fold').click();
      await expect(page.locator('dialog[open]')).toBeVisible();

      // Emit game-action call from Carlos's socket outside UI (or send command via admin)
      // Here, Carlos calls via guestSocket sync to get revision, then Carlos socket emits
      const carlosSocket: Socket<ServerEvents, ClientEvents> = io('http://127.0.0.1:3100', {
        auth: { protocol: 1, credentials: host.credentials },
        transports: ['websocket'],
        autoConnect: false,
      });

      await new Promise<void>((resolve, reject) => {
        carlosSocket.once('room:state', () => resolve());
        carlosSocket.once('connect_error', reject);
        carlosSocket.connect();
      });

      const carlosState = await new Promise<RoomState>((resolve, reject) =>
        carlosSocket.emit('room:sync', reply => (reply.ok ? resolve(reply.data) : reject(Error(reply.error.message)))),
      );
      const callRes = await new Promise<Reply<RoomState>>(resolve =>
        carlosSocket.emit(
          'room:command',
          { type: 'game-action', action: 'call', commandId: randomUUID(), expectedRevision: carlosState.revision },
          resolve,
        ),
      );
      expect(callRes.ok).toBe(true);
      carlosSocket.disconnect();

      // Turn passed to Daniela: Carlos's fold dialog must be automatically dismissed!
      await expect(page.locator('dialog[open]')).not.toBeVisible();
      await expect(page.getByText('Aguardando Daniela agir…')).toBeVisible();

      // Daniela checks preflop via socket
      const danielaState = await new Promise<RoomState>((resolve, reject) =>
        guestSocket.emit('room:sync', reply => (reply.ok ? resolve(reply.data) : reject(Error(reply.error.message)))),
      );
      const danielaCheck = await new Promise<Reply<RoomState>>(resolve =>
        guestSocket.emit(
          'room:command',
          { type: 'game-action', action: 'check', commandId: randomUUID(), expectedRevision: danielaState.revision },
          resolve,
        ),
      );
      expect(danielaCheck.ok).toBe(true);

      // Bets are equalized: Carlos sees waiting dock
      await expect(page.getByText('Apostas igualadas. Aguardando o anfitrião avançar a rodada.')).toBeVisible();

      // Host advances to Flop via socket command
      const hostSocket: Socket<ServerEvents, ClientEvents> = io('http://127.0.0.1:3100', {
        auth: { protocol: 1, credentials: host.credentials },
        transports: ['websocket'],
        autoConnect: false,
      });
      await new Promise<void>((resolve, reject) => {
        hostSocket.once('room:state', () => resolve());
        hostSocket.once('connect_error', reject);
        hostSocket.connect();
      });

      const hostState = await new Promise<RoomState>((resolve, reject) =>
        hostSocket.emit('room:sync', reply => (reply.ok ? resolve(reply.data) : reject(Error(reply.error.message)))),
      );
      const advRes = await new Promise<Reply<RoomState>>(resolve =>
        hostSocket.emit(
          'room:command',
          { type: 'advance-street', commandId: randomUUID(), expectedRevision: hostState.revision },
          resolve,
        ),
      );
      expect(advRes.ok).toBe(true);
      hostSocket.disconnect();

      // Now preflop is complete, we are on the Flop!
      // In heads-up postflop, Daniela (BB) acts first. Daniela checks on Flop
      await expect(page.getByText('FLOP', { exact: true })).toBeVisible();
      const danielaFlopState = await new Promise<RoomState>((resolve, reject) =>
        guestSocket.emit('room:sync', reply => (reply.ok ? resolve(reply.data) : reject(Error(reply.error.message)))),
      );
      const danielaFlopCheck = await new Promise<Reply<RoomState>>(resolve =>
        guestSocket.emit(
          'room:command',
          { type: 'game-action', action: 'check', commandId: randomUUID(), expectedRevision: danielaFlopState.revision },
          resolve,
        ),
      );
      expect(danielaFlopCheck.ok).toBe(true);

      // Now turn returns to Carlos on Flop!
      await expect(page.getByText('Sua vez', { exact: true })).toBeVisible();

      // Verify that Carlos's ActionDock reopened cleanly without any old dialog or stale raise control
      await expect(page.locator('dialog[open]')).not.toBeVisible();
      await expect(page.locator('.raise-control')).not.toBeVisible();
      await expect(page.locator('.action-dock-active')).toBeVisible();
      await expect(page.locator('.action-btn-check')).toBeVisible();
      await expect(page.locator('.action-btn-raise')).toBeVisible();
    } finally {
      guestSocket.disconnect();
    }
  });

  test('host advances streets progressively with physical card confirmations until showdown (Etapa 4C)', async ({ page, browser, request }) => {
    await page.setViewportSize({ width: 320, height: 740 });

    // 1. Create room
    const createRes = await request.post('/api/rooms', {
      data: {
        hostName: 'Bruno Host',
        config: { name: 'Mesa Streets', maxPlayers: 4, startingChips: 1000, smallBlind: 10, bigBlind: 20 },
      },
    });
    const hostReply = (await createRes.json()) as Reply<Admission>;
    if (!hostReply.ok) throw new Error(hostReply.error.message);
    const host = hostReply.data;

    // 2. Guest joins
    const joinRes = await request.post(`/api/rooms/${host.room.code}/join`, {
      data: { name: 'Fernanda Guest', seat: 2 },
    });
    const guestReply = (await joinRes.json()) as Reply<Admission>;
    if (!guestReply.ok) throw new Error(guestReply.error.message);
    const guest = guestReply.data;

    // 3. Host session in page 1
    await page.addInitScript(
      ({ code, credentials }) => {
        localStorage.setItem(`poker-table.session.v1.${code}`, JSON.stringify(credentials));
      },
      { code: host.room.code, credentials: host.credentials },
    );
    await page.goto(`/room/${host.room.code}`);

    // 4. Guest session in an isolated browser context
    const guestContext = await browser.newContext();
    const page2 = await guestContext.newPage();
    await page2.setViewportSize({ width: 390, height: 844 });
    await page2.addInitScript(
      ({ code, credentials }) => {
        localStorage.setItem(`poker-table.session.v1.${code}`, JSON.stringify(credentials));
      },
      { code: host.room.code, credentials: guest.credentials },
    );
    await page2.goto(`/room/${host.room.code}`);

    try {
      // Host sits at seat 1
      await page.getByRole('button', { name: 'Posição 1, disponível' }).click();

      // Verify host remains properly authenticated as host after guest joins
      const startBtn = page.locator('.lobby-host-action button.lobby-start-btn');
      await expect(startBtn).toBeVisible();

      // Reload host page to confirm session and host privileges persist across reloads
      await page.reload();
      await expect(page.locator('.lobby-host-action button.lobby-start-btn')).toBeVisible();

      // Host starts game
      await page.locator('.lobby-host-action button.lobby-start-btn').click();

      // Verify Active Table for both
      await expect(page.getByLabel('Mesa de jogo ativa')).toBeVisible();
      await expect(page2.getByLabel('Mesa de jogo ativa')).toBeVisible();

      // Host has host-pill indicator
      await expect(page.locator('.host-pill')).toBeVisible();

      // Reload host page during active game to confirm persistent authentication
      await page.reload();
      await expect(page.getByLabel('Mesa de jogo ativa')).toBeVisible();
      await expect(page.locator('.host-pill')).toBeVisible();
      await expect(page.getByText('Conectado · sincronizado')).toBeVisible();

      // Responsive check at 320px
      const scrollWidth = await page.evaluate(() => document.body.scrollWidth);
      expect(scrollWidth).toBeLessThanOrEqual(320);

      // During active betting (SB's turn): HostStreetControls is NOT present
      await expect(page.locator('.host-street-controls')).toHaveCount(0);
      await expect(page2.locator('.host-street-controls')).toHaveCount(0);

      // --- PREFLOP ---
      // Bruno (SB) calls 10 (Pagar 10)
      await page.locator('.action-btn-call').click();

      // Fernanda (BB) checks
      await expect(page2.getByText('Sua vez', { exact: true })).toBeVisible();
      await page2.locator('.action-btn-check').click();

      // Bets equalized!
      // Guest sees contextual wait message and NO admin controls
      await expect(page2.getByText('Aguardando o anfitrião iniciar o Flop.')).toBeVisible();
      await expect(page2.locator('.host-street-controls')).toHaveCount(0);

      // Host sees HostStreetControls!
      const hostControls = page.locator('.host-street-controls');
      await expect(hostControls).toBeVisible();
      const flopBtn = hostControls.locator('.host-advance-btn');
      await expect(flopBtn).toHaveText('Iniciar Flop ♠');

      // Verify touch target size
      const box = await flopBtn.boundingBox();
      expect(box?.height).toBeGreaterThanOrEqual(48);

      // Host clicks Iniciar Flop -> confirmation modal opens
      await flopBtn.click();
      const flopModal = page.locator('dialog[open]');
      await expect(flopModal).toBeVisible();
      await expect(flopModal.locator('h2')).toHaveText('Iniciar Flop?');
      await expect(flopModal.locator('p')).toHaveText(
        'Confirme que as três cartas do flop já foram colocadas na mesa.',
      );

      // Cancel confirmation -> modal closes, street is still preflop
      await flopModal.getByRole('button', { name: 'Cancelar' }).click();
      await expect(flopModal).not.toBeVisible();
      await expect(page.getByText('PRÉ-FLOP', { exact: true })).toBeVisible();

      // Confirm Flop
      await flopBtn.click();
      await flopModal.getByRole('button', { name: 'Confirmar Flop' }).click();

      // --- FLOP ---
      await expect(page.getByText('FLOP', { exact: true })).toBeVisible();
      await expect(page2.getByText('FLOP', { exact: true })).toBeVisible();
      await expect(page.locator('.host-street-controls')).toHaveCount(0);

      // Heads-up postflop: Fernanda (BB) acts first -> checks
      await expect(page2.getByText('Sua vez', { exact: true })).toBeVisible();
      await page2.locator('.action-btn-check').click();

      // Bruno (SB) acts -> checks
      await expect(page.getByText('Sua vez', { exact: true })).toBeVisible();
      await page.locator('.action-btn-check').click();

      // Flop bets equalized!
      await expect(page2.getByText('Aguardando o anfitrião iniciar o Turn.')).toBeVisible();
      await expect(hostControls).toBeVisible();
      const turnBtn = hostControls.locator('.host-advance-btn');
      await expect(turnBtn).toHaveText('Iniciar Turn ♠');

      // Host confirms Turn
      await turnBtn.click();
      const turnModal = page.locator('dialog[open]');
      await expect(turnModal.locator('h2')).toHaveText('Iniciar Turn?');
      await expect(turnModal.locator('p')).toHaveText(
        'Confirme que a carta do turn (quarta carta) já foi colocada na mesa.',
      );
      await turnModal.getByRole('button', { name: 'Confirmar Turn' }).click();

      // --- TURN ---
      await expect(page.getByText('TURN', { exact: true })).toBeVisible();
      await expect(page2.getByText('TURN', { exact: true })).toBeVisible();

      // Fernanda checks, Bruno checks
      await page2.locator('.action-btn-check').click();
      await page.locator('.action-btn-check').click();

      // Turn bets equalized!
      await expect(page2.getByText('Aguardando o anfitrião iniciar o River.')).toBeVisible();
      const riverBtn = hostControls.locator('.host-advance-btn');
      await expect(riverBtn).toHaveText('Iniciar River ♠');

      // Host confirms River
      await riverBtn.click();
      const riverModal = page.locator('dialog[open]');
      await expect(riverModal.locator('h2')).toHaveText('Iniciar River?');
      await expect(riverModal.locator('p')).toHaveText(
        'Confirme que a carta do river (quinta carta) já foi colocada na mesa.',
      );
      await riverModal.getByRole('button', { name: 'Confirmar River' }).click();

      // --- RIVER ---
      await expect(page.getByText('RIVER', { exact: true })).toBeVisible();
      await expect(page2.getByText('RIVER', { exact: true })).toBeVisible();

      // Fernanda checks, Bruno checks
      await page2.locator('.action-btn-check').click();
      await page.locator('.action-btn-check').click();

      // River bets equalized!
      await expect(page2.getByText('Rodada de apostas encerrada. Aguardando Showdown.')).toBeVisible();
      const showdownBtn = hostControls.locator('.host-advance-btn');
      await expect(showdownBtn).toHaveText('Ir para Showdown ♠');

      // River -> Showdown requires no community card confirmation: advances directly!
      await showdownBtn.click();

      // --- SHOWDOWN ---
      await expect(page.getByText('SHOWDOWN', { exact: true })).toBeVisible();
      await expect(page2.getByText('SHOWDOWN', { exact: true })).toBeVisible();

      // In showdown, street controls are no longer shown
      await expect(page.locator('.host-street-controls')).toHaveCount(0);
    } finally {
      await guestContext.close();
    }
  });

  test('survives hand-settled and next-hand state transitions without React Hook errors', async ({ page, browser, request }) => {
    // Collect console errors and unhandled exceptions
    const consoleErrors: string[] = [];
    const pageErrors: Error[] = [];
    page.on('console', msg => {
      if (msg.type() === 'error') {
        consoleErrors.push(msg.text());
      }
    });
    page.on('pageerror', err => {
      pageErrors.push(err);
    });

    // 1. Create room
    const createRes = await request.post('/api/rooms', {
      data: {
        hostName: 'Helena Host',
        config: { name: 'Mesa Lifecycle', maxPlayers: 4, startingChips: 1000, smallBlind: 10, bigBlind: 20 },
      },
    });
    const hostReply = (await createRes.json()) as Reply<Admission>;
    if (!hostReply.ok) throw new Error(hostReply.error.message);
    const host = hostReply.data;

    // 2. Guest joins
    const joinRes = await request.post(`/api/rooms/${host.room.code}/join`, {
      data: { name: 'Lucas Guest', seat: 2 },
    });
    const guestReply = (await joinRes.json()) as Reply<Admission>;
    if (!guestReply.ok) throw new Error(guestReply.error.message);
    const guest = guestReply.data;

    // Connect admin/host socket and guest socket for direct server-level commands
    const adminSocket: Socket<ServerEvents, ClientEvents> = io('http://127.0.0.1:3100', {
      auth: { protocol: 1, credentials: host.credentials },
      transports: ['websocket'],
      autoConnect: false,
    });
    const guestSocket: Socket<ServerEvents, ClientEvents> = io('http://127.0.0.1:3100', {
      auth: { protocol: 1, credentials: guest.credentials },
      transports: ['websocket'],
      autoConnect: false,
    });

    const guestContext = await browser.newContext();
    const guestPage = await guestContext.newPage();

    try {
      await Promise.all([
        new Promise<void>((resolve, reject) => {
          adminSocket.once('room:state', () => resolve());
          adminSocket.once('connect_error', reject);
          adminSocket.connect();
        }),
        new Promise<void>((resolve, reject) => {
          guestSocket.once('room:state', () => resolve());
          guestSocket.once('connect_error', reject);
          guestSocket.connect();
        }),
      ]);

      const send = async (socket: Socket<ServerEvents, ClientEvents>, input: CommandInput) => {
        const state = await new Promise<RoomState>((resolve, reject) =>
          socket.emit('room:sync', reply => (reply.ok ? resolve(reply.data) : reject(Error(reply.error.message)))),
        );
        const result = await new Promise<Reply<RoomState>>(resolve =>
          socket.emit('room:command', { ...input, commandId: randomUUID(), expectedRevision: state.revision }, resolve),
        );
        if (!result.ok) throw new Error(`Command failed: ${result.error.code} - ${result.error.message}`);
        expect(result.ok).toBe(true);
      };

      // Set host in page
      await page.addInitScript(
        ({ code, credentials }) => {
          localStorage.setItem(`poker-table.session.v1.${code}`, JSON.stringify(credentials));
        },
        { code: host.room.code, credentials: host.credentials },
      );
      await page.goto(`/room/${host.room.code}`);

      // Set guest in guestPage
      await guestPage.addInitScript(
        ({ code, credentials }) => {
          localStorage.setItem(`poker-table.session.v1.${code}`, JSON.stringify(credentials));
        },
        { code: host.room.code, credentials: guest.credentials },
      );
      await guestPage.goto(`/room/${host.room.code}`);

      // Sit host and wait for start button to become visible (ensures both seated players are connected)
      await send(adminSocket, { type: 'select-seat', seat: 1 });
      await expect(page.locator('.lobby-host-action button.lobby-start-btn')).toBeVisible();
      await send(adminSocket, { type: 'start-game' });

      // Verify active table on host page
      await expect(page.getByLabel('Mesa de jogo ativa')).toBeVisible();

      // Preflop: Host (SB) calls 20, Guest (BB) checks
      await send(adminSocket, { type: 'game-action', action: 'call' });
      await send(guestSocket, { type: 'game-action', action: 'check' });
      // Advance to flop
      await send(adminSocket, { type: 'advance-street' });
      // Flop: Guest acts first, then Host acts
      await send(guestSocket, { type: 'game-action', action: 'check' });
      await send(adminSocket, { type: 'game-action', action: 'check' });
      // Advance to turn
      await send(adminSocket, { type: 'advance-street' });
      // Turn: Guest acts first, then Host acts
      await send(guestSocket, { type: 'game-action', action: 'check' });
      await send(adminSocket, { type: 'game-action', action: 'check' });
      // Advance to river
      await send(adminSocket, { type: 'advance-street' });
      // River: Guest acts first, then Host acts
      await send(guestSocket, { type: 'game-action', action: 'check' });
      await send(adminSocket, { type: 'game-action', action: 'check' });
      // Advance to showdown
      await send(adminSocket, { type: 'advance-street' });

      // Verify SHOWDOWN on page
      await expect(page.getByText('SHOWDOWN', { exact: true })).toBeVisible();

      // 3. Execute a valid settlement by the server
      await send(adminSocket, { type: 'settle-hand', decisions: [{ potId: 'main', winners: [host.credentials.playerId] }] });

      // 4. Verify host UI continues rendering normally in hand-settled state
      await expect(page.getByText('MÃO LIQUIDADA', { exact: true })).toBeVisible();
      await expect(page.getByText('POTE DISTRIBUÍDO', { exact: true })).toBeVisible();
      await expect(page.getByLabel('Mesa de jogo ativa')).toBeVisible();

      // 5. Confirm NO React Hook errors or page errors occurred
      const hookErrors = consoleErrors.filter(err =>
        err.includes('Rendered fewer hooks than expected') ||
        err.includes('Rendered more hooks than expected') ||
        err.includes('Rules of Hooks') ||
        err.includes('hook'),
      );
      expect(hookErrors).toHaveLength(0);
      expect(pageErrors).toHaveLength(0);

      // 6. Start the next hand via server and confirm UI remains functional
      await send(adminSocket, { type: 'next-hand' });

      // Hand 2 is active!
      await expect(page.getByText('PRÉ-FLOP', { exact: true })).toBeVisible();
      await expect(page.getByLabel('Mesa de jogo ativa')).toBeVisible();
      await expect(page.getByText('MÃO LIQUIDADA')).toHaveCount(0);

      // Again check for no console errors after next-hand transition
      const postNextHandHookErrors = consoleErrors.filter(err =>
        err.includes('Rendered fewer hooks than expected') ||
        err.includes('Rendered more hooks than expected') ||
        err.includes('Rules of Hooks') ||
        err.includes('hook'),
      );
      expect(postNextHandHookErrors).toHaveLength(0);
      expect(pageErrors).toHaveLength(0);
    } finally {
      adminSocket.disconnect();
      guestSocket.disconnect();
      await guestContext.close();
    }
  });
});
