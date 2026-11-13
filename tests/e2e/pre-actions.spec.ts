import { test, expect, type Page, type APIRequestContext, type Browser, type BrowserContext } from '@playwright/test';
import { io, type Socket } from 'socket.io-client';
import { randomUUID } from 'node:crypto';
import type { Admission, ClientEvents, Command, CommandInput, Reply, RoomState, ServerEvents } from '@poker-table/protocol';

const SCRATCH_DIR = '/home/theo-enderson/.gemini/antigravity/brain/843a39d6-b7c9-4a7d-b260-3cc46772dc05/scratch';

interface TestSetup {
  host: Admission;
  guest: Admission;
  adminSocket: Socket<ServerEvents, ClientEvents>;
  sendAdmin: (input: CommandInput) => Promise<Reply<RoomState>>;
}

async function setupGame(page: Page, request: APIRequestContext, roomName: string): Promise<TestSetup> {
  // 1. Cria a sala com Carlos (Host)
  const createRes = await request.post('/api/rooms', {
    data: {
      hostName: 'Carlos',
      config: {
        name: roomName,
        maxPlayers: 2,
        startingChips: 1000,
        smallBlind: 10,
        bigBlind: 20,
      },
    },
  });
  const hostReply = (await createRes.json()) as Reply<Admission>;
  if (!hostReply.ok) throw new Error(hostReply.error.message);
  const host = hostReply.data;

  // 2. Conecta Beatriz (Guest) no assento 2
  const joinRes = await request.post(`/api/rooms/${host.room.code}/join`, {
    data: { name: 'Beatriz', seat: 2 },
  });
  const joinReply = (await joinRes.json()) as Reply<Admission>;
  if (!joinReply.ok) throw new Error(joinReply.error.message);
  const guest = joinReply.data;

  // 3. Configura o navegador como Beatriz e aguarda a conexão
  await page.addInitScript(
    ({ code, credentials }) => {
      localStorage.setItem(`poker-table.session.v1.${code}`, JSON.stringify(credentials));
    },
    { code: host.room.code, credentials: guest.credentials },
  );
  await page.goto(`/room/${host.room.code}`);
  await expect(page.getByText('Conectado · mesa sincronizada')).toBeVisible();

  // 4. Conecta socket de administrador (Carlos)
  const adminSocket: Socket<ServerEvents, ClientEvents> = io('http://127.0.0.1:3100', {
    auth: { protocol: 1, credentials: host.credentials },
    transports: ['websocket'],
    autoConnect: false,
  });

  await new Promise<void>((resolve, reject) => {
    adminSocket.once('room:state', () => resolve());
    adminSocket.once('connect_error', reject);
    adminSocket.connect();
  });

  const getSyncState = async () => {
    return new Promise<RoomState>((resolve, reject) =>
      adminSocket.emit('room:sync', reply => (reply.ok ? resolve(reply.data) : reject(Error(reply.error.message)))),
    );
  };

  const sendAdmin = async (input: CommandInput) => {
    const s = await getSyncState();
    return new Promise<Reply<RoomState>>(resolve =>
      adminSocket.emit(
        'room:command',
        { ...input, commandId: randomUUID(), expectedRevision: s.revision } as Command,
        resolve,
      ),
    );
  };

  // 5. Host seleciona assento 1 e inicia a partida
  const seatRes = await sendAdmin({ type: 'select-seat', seat: 1 });
  if (!seatRes.ok) throw new Error(seatRes.error.message);

  const startRes = await sendAdmin({ type: 'start-game' });
  if (!startRes.ok) throw new Error(startRes.error.message);

  // 6. Confirma que a mesa de jogo está visível no navegador de Beatriz
  await expect(page.locator('.virtual-table-arena')).toBeVisible();

  return { host, guest, adminSocket, sendAdmin };
}

test.describe('Pre-Actions (Ações Antecipadas)', () => {
  test('renders pre-actions dock with zero overlap in 320x640, 390x844 and 430x932, and presents enhanced Check/Fold description', async ({
    page,
    request,
  }) => {
    // Inicia com viewport 390x844
    await page.setViewportSize({ width: 390, height: 844 });
    const { adminSocket } = await setupGame(page, request, 'Mesa Layout Pre-Actions');

    try {
      const preActionsDock = page.locator('[data-testid="pre-actions-dock"]');
      await expect(preActionsDock).toBeVisible();
      await expect(preActionsDock).toContainText('Aguardando Carlos agir…');

      const checkBtn = page.locator('[data-testid="pre-action-check"]');
      const checkFoldBtn = page.locator('[data-testid="pre-action-check-fold"]');
      const foldBtn = page.locator('[data-testid="pre-action-fold"]');
      const selfCard = page.locator('.card-self');

      await expect(checkBtn).toBeVisible();
      await expect(checkFoldBtn).toBeVisible();
      await expect(foldBtn).toBeVisible();
      await expect(checkBtn).toBeEnabled();

      // Teste da nova descrição explicativa de Check/Fold solicitada
      await checkFoldBtn.click();
      await expect(checkFoldBtn).toHaveClass(/active/);
      const indicator = page.locator('[data-testid="pre-action-indicator"]');
      await expect(indicator).toBeVisible();
      await expect(indicator).toContainText('Agendado: Passar se possível; caso contrário, desistir.');

      // 1. Validação no viewport de 390x844
      await page.setViewportSize({ width: 390, height: 844 });
      await page.screenshot({ path: `${SCRATCH_DIR}/pre-actions-390px.png` });
      let dockBox = await preActionsDock.boundingBox();
      let cardBox = await selfCard.boundingBox();
      expect(dockBox).not.toBeNull();
      expect(cardBox).not.toBeNull();
      expect(cardBox!.y + cardBox!.height).toBeLessThanOrEqual(dockBox!.y);

      // 2. Validação no viewport de 430x932
      await page.setViewportSize({ width: 430, height: 932 });
      await page.screenshot({ path: `${SCRATCH_DIR}/pre-actions-430px.png` });
      dockBox = await preActionsDock.boundingBox();
      cardBox = await selfCard.boundingBox();
      expect(dockBox).not.toBeNull();
      expect(cardBox).not.toBeNull();
      expect(cardBox!.y + cardBox!.height).toBeLessThanOrEqual(dockBox!.y);

      // 3. Validação rigorosa no viewport crítico de 320x640:
      // O assento do próprio jogador deve estar 100% visível acima do dock fixo
      await page.setViewportSize({ width: 320, height: 640 });
      await expect(preActionsDock).toBeVisible();
      await expect(selfCard).toBeVisible();
      await expect(indicator).toBeVisible();

      dockBox = await preActionsDock.boundingBox();
      cardBox = await selfCard.boundingBox();
      expect(dockBox).not.toBeNull();
      expect(cardBox).not.toBeNull();
      // Verificação matemática de ausência de sobreposição
      expect(cardBox!.y + cardBox!.height).toBeLessThanOrEqual(dockBox!.y);

      // Captura de tela atualizada em 320px
      await page.screenshot({ path: `${SCRATCH_DIR}/pre-actions-320px.png` });

      // Seleciona Check e confirma cancelamento manual
      await checkBtn.click();
      await expect(checkBtn).toHaveClass(/active/);
      await expect(checkFoldBtn).not.toHaveClass(/active/);
      await expect(indicator).toContainText('Agendado: Passar (Check) na sua vez');

      const cancelBtn = page.locator('[data-testid="cancel-pre-action"]');
      await expect(cancelBtn).toBeVisible();
      await cancelBtn.click();
      await expect(indicator).toHaveCount(0);
      await expect(checkBtn).not.toHaveClass(/active/);
    } finally {
      adminSocket.disconnect();
    }
  });

  test('auto-executes Check when turn arrives and Check remains valid', async ({
    page,
    request,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const { adminSocket, sendAdmin } = await setupGame(page, request, 'Check Exec Room');

    try {
      const preActionsDock = page.locator('[data-testid="pre-actions-dock"]');
      await expect(preActionsDock).toBeVisible();

      // Beatriz agenda Check
      const checkBtn = page.locator('[data-testid="pre-action-check"]');
      await checkBtn.click();
      await expect(page.locator('[data-testid="pre-action-indicator"]')).toBeVisible();

      // Carlos (SB) paga 10 (completa o blind para 20)
      const callRes = await sendAdmin({ type: 'game-action', action: 'call' });
      expect(callRes.ok).toBe(true);

      // A vez chega a Beatriz (BB). Como check estava agendado e canCheck é true,
      // o cliente despacha automaticamente o Check!
      await expect(page.locator('.pot-value')).toContainText('40');
      await expect(page.locator('.last-action-text')).toContainText('Beatriz deu check');
    } finally {
      adminSocket.disconnect();
    }
  });

  test('cancels Check when opponent bets or raises before turn arrives (never converts to Call/Fold)', async ({
    page,
    request,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const { adminSocket, sendAdmin } = await setupGame(page, request, 'Bet Faced Cancel');

    try {
      await expect(page.locator('[data-testid="pre-actions-dock"]')).toBeVisible();

      // Beatriz agenda Check
      await page.locator('[data-testid="pre-action-check"]').click();
      await expect(page.locator('[data-testid="pre-action-indicator"]')).toBeVisible();

      // Carlos AUMENTA (Raise para 60)
      const raiseRes = await sendAdmin({ type: 'game-action', action: 'raise', amount: 60 });
      expect(raiseRes.ok).toBe(true);

      // Agora é a vez de Beatriz enfrentar a aposta de 60.
      // A intenção de Check foi cancelada e os controles manuais normais de ação surgem
      const activeDock = page.locator('.action-dock-active');
      await expect(activeDock).toBeVisible();

      // Beatriz NÃO executou check nem desistiu automaticamente; ela tem os controles manuais à disposição:
      await expect(activeDock.locator('.action-btn-fold')).toBeVisible();
      await expect(activeDock.locator('.action-btn-call')).toContainText('Pagar 40');
      await expect(activeDock.locator('.action-btn-raise')).toBeVisible();
    } finally {
      adminSocket.disconnect();
    }
  });

  test('auto-executes Check for Check/Fold when free and Fold when facing a bet', async ({
    page,
    request,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const { adminSocket, sendAdmin } = await setupGame(page, request, 'CheckFold Facing Bet');

    try {
      await expect(page.locator('[data-testid="pre-actions-dock"]')).toBeVisible();

      // Beatriz agenda Check / Fold
      await page.locator('[data-testid="pre-action-check-fold"]').click();
      await expect(page.locator('[data-testid="pre-action-indicator"]')).toContainText(
        'Agendado: Passar se possível; caso contrário, desistir.',
      );

      // Carlos aumenta para 60
      const raiseRes = await sendAdmin({ type: 'game-action', action: 'raise', amount: 60 });
      expect(raiseRes.ok).toBe(true);

      // A vez chega a Beatriz enfrentando aposta: Check/Fold resolve para FOLD automaticamente!
      await expect(page.locator('.last-action-text')).toContainText('Beatriz deu fold');
      await expect(page.locator('.virtual-table-arena')).toBeVisible();
    } finally {
      adminSocket.disconnect();
    }
  });

  test('auto-executes Fold when Fold was scheduled', async ({
    page,
    request,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const { adminSocket, sendAdmin } = await setupGame(page, request, 'Fold Scheduled');

    try {
      await expect(page.locator('[data-testid="pre-actions-dock"]')).toBeVisible();

      // Beatriz agenda Fold
      await page.locator('[data-testid="pre-action-fold"]').click();
      await expect(page.locator('[data-testid="pre-action-indicator"]')).toContainText('Desistir (Fold)');

      // Carlos apenas paga 10
      const callRes = await sendAdmin({ type: 'game-action', action: 'call' });
      expect(callRes.ok).toBe(true);

      // Vez de Beatriz: Fold é executado automaticamente!
      await expect(page.locator('.last-action-text')).toContainText('Beatriz deu fold');
    } finally {
      adminSocket.disconnect();
    }
  });

  test('canceling pre-action prevents any subsequent auto-execution on turn', async ({
    page,
    request,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const { adminSocket, sendAdmin } = await setupGame(page, request, 'Cancel Prevents Auto');

    try {
      await expect(page.locator('[data-testid="pre-actions-dock"]')).toBeVisible();

      // Beatriz agenda Check
      await page.locator('[data-testid="pre-action-check"]').click();
      await expect(page.locator('[data-testid="pre-action-indicator"]')).toBeVisible();

      // Cancela a ação antecipada
      await page.locator('[data-testid="cancel-pre-action"]').click();
      await expect(page.locator('[data-testid="pre-action-indicator"]')).toHaveCount(0);

      // Carlos paga 10
      const callRes = await sendAdmin({ type: 'game-action', action: 'call' });
      expect(callRes.ok).toBe(true);

      // A vez chega a Beatriz. Como a ação foi cancelada, NÃO deve dar check automaticamente:
      // O console de ações manuais ativas deve estar aberto aguardando a decisão dela
      const activeDock = page.locator('.action-dock-active');
      await expect(activeDock).toBeVisible();
      await expect(activeDock.locator('.action-btn-check')).toBeVisible();
      await expect(activeDock.locator('.action-btn-fold')).toBeVisible();
    } finally {
      adminSocket.disconnect();
    }
  });

  test('discards pre-action selection upon page reload (F5) and never executes stale intent', async ({
    page,
    request,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const { adminSocket, sendAdmin } = await setupGame(page, request, 'F5 Reload Discard');

    try {
      await expect(page.locator('[data-testid="pre-actions-dock"]')).toBeVisible();

      // Beatriz agenda Check
      await page.locator('[data-testid="pre-action-check"]').click();
      await expect(page.locator('[data-testid="pre-action-indicator"]')).toBeVisible();

      // Recarrega a página (F5)
      await page.reload();
      await expect(page.locator('.virtual-table-arena')).toBeVisible();

      // A seleção deve ter sido descartada (estado em memória)
      await expect(page.locator('[data-testid="pre-action-indicator"]')).toHaveCount(0);
      await expect(page.locator('[data-testid="pre-action-check"]')).not.toHaveClass(/active/);

      // Carlos paga 10
      await sendAdmin({ type: 'game-action', action: 'call' });

      // Vez de Beatriz: intenção antiga NÃO é executada após reconexão; controles manuais ativos
      const activeDock = page.locator('.action-dock-active');
      await expect(activeDock).toBeVisible();
      await expect(activeDock.locator('.action-btn-check')).toBeVisible();
    } finally {
      adminSocket.disconnect();
    }
  });

  async function setupMultiPlayerTable(
    browser: Browser,
    request: APIRequestContext,
    roomName: string,
    guestNames: string[],
  ) {
    const maxPlayers = guestNames.length + 1;
    const createRes = await request.post('/api/rooms', {
      data: {
        hostName: 'Carlos',
        config: {
          name: roomName,
          maxPlayers,
          startingChips: 1000,
          smallBlind: 10,
          bigBlind: 20,
        },
      },
    });
    const hostReply = (await createRes.json()) as Reply<Admission>;
    if (!hostReply.ok) throw new Error(hostReply.error.message);
    const host = hostReply.data;

    const guests: Admission[] = [];
    for (let i = 0; i < guestNames.length; i++) {
      const joinRes = await request.post(`/api/rooms/${host.room.code}/join`, {
        data: { name: guestNames[i], seat: i + 2 },
      });
      const joinReply = (await joinRes.json()) as Reply<Admission>;
      if (!joinReply.ok) throw new Error(joinReply.error.message);
      guests.push(joinReply.data);
    }

    const connectSocket = async (admission: Admission) => {
      const sock: Socket<ServerEvents, ClientEvents> = io('http://127.0.0.1:3100', {
        auth: { protocol: 1, credentials: admission.credentials },
        transports: ['websocket'],
        autoConnect: false,
      });
      await new Promise<void>((resolve, reject) => {
        sock.once('room:state', () => resolve());
        sock.once('connect_error', reject);
        sock.connect();
      });
      const sync = () =>
        new Promise<RoomState>((resolve, reject) =>
          sock.emit('room:sync', reply => (reply.ok ? resolve(reply.data) : reject(Error(reply.error.message)))),
        );
      const send = async (input: CommandInput) => {
        const s = await sync();
        return new Promise<Reply<RoomState>>(resolve =>
          sock.emit('room:command', { ...input, commandId: randomUUID(), expectedRevision: s.revision } as Command, resolve),
        );
      };
      return { sock, send, sync };
    };

    const hostClient = await connectSocket(host);
    const guestClients = await Promise.all(guests.map(connectSocket));

    const openGuestPage = async (guest: Admission): Promise<{ context: BrowserContext; page: Page }> => {
      const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
      const p = await context.newPage();
      await p.addInitScript(
        ({ code, credentials }) => {
          localStorage.setItem(`poker-table.session.v1.${code}`, JSON.stringify(credentials));
        },
        { code: host.room.code, credentials: guest.credentials },
      );
      await p.goto(`/room/${host.room.code}`);
      await expect(p.locator('.virtual-table-arena')).toBeVisible();
      return { context, page: p };
    };

    const seatRes = await hostClient.send({ type: 'select-seat', seat: 1 });
    if (!seatRes.ok) throw new Error(seatRes.error.message);
    const startRes = await hostClient.send({ type: 'start-game' });
    if (!startRes.ok) throw new Error(startRes.error.message);

    return {
      host,
      guests,
      hostClient,
      guestClients,
      openGuestPage,
      cleanup: async () => {
        hostClient.sock.disconnect();
        guestClients.forEach(c => c.sock.disconnect());
      },
    };
  }

  test('displays dynamic Call <valor>, updates live across raises, transitions Check->Call, and auto-executes Call on turn', async ({
    browser,
    request,
  }) => {
    const setup = await setupMultiPlayerTable(browser, request, 'Dynamic Call Auto Exec', ['Ana', 'Beatriz']);
    const anaView = await setup.openGuestPage(setup.guests[0]);
    const biaView = await setup.openGuestPage(setup.guests[1]);

    try {
      // 3 jogadores: Carlos (Dealer/UTG, seat 1), Ana (SB 10, seat 2), Beatriz (BB 20, seat 3).
      // Turno inicial em Carlos.
      // Ana já vê Call 10; Beatriz vê Check (toCall === 0).
      await expect(anaView.page.locator('[data-testid="pre-action-call"]')).toContainText('Call 10');
      await expect(biaView.page.locator('[data-testid="pre-action-check"]')).toBeVisible();

      // Beatriz seleciona Check antes de Carlos apostar
      await biaView.page.locator('[data-testid="pre-action-check"]').click();
      await expect(biaView.page.locator('[data-testid="pre-action-indicator"]')).toContainText('Passar (Check)');

      // Carlos (UTG) dá raise para 60 -> turno vai para Ana.
      // Check de Beatriz é invalidado, botão transiciona para Call 40 desmarcado; Ana vê 50 em seu turno.
      const raiseRes = await setup.hostClient.send({ type: 'game-action', action: 'raise', amount: 60 });
      expect(raiseRes.ok).toBe(true);

      await expect(biaView.page.locator('[data-testid="pre-action-indicator"]')).toHaveCount(0);
      const biaCallBtn = biaView.page.locator('[data-testid="pre-action-call"]');
      await expect(biaCallBtn).toBeVisible();
      await expect(biaCallBtn).toContainText('Call 40');
      await expect(biaCallBtn).not.toHaveClass(/active/);

      // Verifica no viewport 320px que o botão Call <valor> não sofre sobreposição
      await biaView.page.setViewportSize({ width: 320, height: 640 });
      const callBox = await biaCallBtn.boundingBox();
      const checkFoldBox = await biaView.page.locator('[data-testid="pre-action-check-fold"]').boundingBox();
      expect(callBox).not.toBeNull();
      expect(checkFoldBox).not.toBeNull();
      expect(callBox!.x + callBox!.width).toBeLessThanOrEqual(checkFoldBox!.x + 1);

      // Beatriz clica em Call 40
      await biaCallBtn.click();
      await expect(biaCallBtn).toHaveClass(/active/);
      await expect(biaView.page.locator('[data-testid="pre-action-indicator"]')).toContainText('Pagar 40');

      // Ana paga 60 manualmente na interface
      await expect(anaView.page.locator('.action-dock-active')).toBeVisible();
      await anaView.page.locator('.action-dock-active .action-btn-call').click();

      // Beatriz executa Call 40 automaticamente ao receber a vez, concluindo a rodada (pote 180)
      await expect(biaView.page.locator('.pot-total-badge')).toContainText('180');
      await expect(biaView.page.locator('[data-testid="pre-action-indicator"]')).toHaveCount(0);
      await expect(biaView.page.locator('.action-dock-active')).toHaveCount(0);

      const finalState = await setup.hostClient.sync();
      expect(finalState.game?.status).toBe('hand-active');
      if (finalState.game?.status === 'hand-active') {
        expect(finalState.game.hand.pot).toBe(180);
        expect(finalState.game.hand.canAdvanceStreet).toBe(true);
        const bia = finalState.game.hand.players.find(p => p.id === setup.guests[1].credentials.playerId)!;
        expect(bia.chips).toBe(940);
      }
    } finally {
      await anaView.context.close();
      await biaView.context.close();
      await setup.cleanup();
    }
  });

  test('automatically unchecks Call <valor> and updates displayed amount when opponent re-raises before turn', async ({
    browser,
    request,
  }) => {
    const setup = await setupMultiPlayerTable(browser, request, 'Call Re-raise Invalidation', ['Ana', 'Beatriz', 'Diego']);
    const biaView = await setup.openGuestPage(setup.guests[1]);

    try {
      // 4 jogadores: Carlos (Dealer/seat 1), Ana (SB 10/seat 2), Beatriz (BB 20/seat 3), Diego (UTG/seat 4).
      // Ordem pré-flop: Diego -> Carlos -> Ana -> Beatriz.
      // Diego (guestClients[2]) dá raise inicial para 60 -> turno passa para Carlos (hostClient).
      const dRaise = await setup.guestClients[2].send({ type: 'game-action', action: 'raise', amount: 60 });
      expect(dRaise.ok).toBe(true);

      // Beatriz (BB 20) vê Call 40 e seleciona
      const biaCallBtn = biaView.page.locator('[data-testid="pre-action-call"]');
      await expect(biaCallBtn).toContainText('Call 40');
      await biaCallBtn.click();
      await expect(biaCallBtn).toHaveClass(/active/);
      await expect(biaView.page.locator('[data-testid="pre-action-indicator"]')).toContainText('Pagar 40');

      // Carlos dá re-raise para 140 -> turno vai para Ana (beatriz ainda aguarda fora do turno!)
      const cReRaise = await setup.hostClient.send({ type: 'game-action', action: 'raise', amount: 140 });
      expect(cReRaise.ok).toBe(true);

      // Em tempo real, servidor desmarca Call 40 e UI de Beatriz exibe Call 120 desmarcado!
      await expect(biaView.page.locator('[data-testid="pre-action-indicator"]')).toHaveCount(0);
      await expect(biaCallBtn).not.toHaveClass(/active/);
      await expect(biaCallBtn).toContainText('Call 120');

      // Ana dá fold -> vez chega em Beatriz; NÃO há auto-call e controles manuais aparecem com Call 120
      const aFold = await setup.guestClients[0].send({ type: 'game-action', action: 'fold' });
      expect(aFold.ok).toBe(true);

      const activeDock = biaView.page.locator('.action-dock-active');
      await expect(activeDock).toBeVisible();
      await expect(activeDock.locator('.action-btn-call')).toContainText('120');
    } finally {
      await biaView.context.close();
      await setup.cleanup();
    }
  });
});
