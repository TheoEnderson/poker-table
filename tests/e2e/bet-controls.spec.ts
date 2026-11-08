import { test, expect } from '@playwright/test';
import { io, type Socket } from 'socket.io-client';
import { randomUUID } from 'node:crypto';
import type { Admission, ClientEvents, Command, CommandInput, Reply, RoomState, ServerEvents } from '@poker-table/protocol';

const SCRATCH_DIR = '/home/theo-enderson/.gemini/antigravity/brain/843a39d6-b7c9-4a7d-b260-3cc46772dc05/scratch';

test.describe('Bet Controls & Mobile Ergonomics (Etapa Controles de Apostas)', () => {
  test('synchronizes slider, presets, stepper and numeric input with fluid feedback and responsive mobile layout', async ({
    page,
    request,
  }) => {
    // 1. Create room
    const createRes = await request.post('/api/rooms', {
      data: {
        hostName: 'Carlos',
        config: {
          name: 'Mesa Controles',
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

    // Connect guest (Beatriz)
    const joinRes = await request.post(`/api/rooms/${host.room.code}/join`, {
      data: { name: 'Beatriz', seat: 2 },
    });
    const joinReply = (await joinRes.json()) as Reply<Admission>;
    if (!joinReply.ok) throw new Error(joinReply.error.message);
    const guest = joinReply.data;

    const admin: Socket<ServerEvents, ClientEvents> = io('http://127.0.0.1:3100', {
      auth: { protocol: 1, credentials: host.credentials },
      transports: ['websocket'],
      autoConnect: false,
    });

    const guestSocket: Socket<ServerEvents, ClientEvents> = io('http://127.0.0.1:3100', {
      auth: { protocol: 1, credentials: guest.credentials },
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
          guestSocket.once('room:state', () => resolve());
          guestSocket.once('connect_error', reject);
          guestSocket.connect();
        }),
      ]);

      const getSyncState = async () => {
        return new Promise<RoomState>((resolve, reject) =>
          admin.emit('room:sync', reply => (reply.ok ? resolve(reply.data) : reject(Error(reply.error.message)))),
        );
      };

      const sendAdmin = async (
        input: { type: 'select-seat'; seat: number } | { type: 'start-game' },
      ) => {
        const s = await getSyncState();
        return new Promise<Reply<RoomState>>(resolve =>
          admin.emit(
            'room:command',
            { ...input, commandId: randomUUID(), expectedRevision: s.revision } as Command,
            resolve,
          ),
        );
      };

      // Host sits at seat 1
      await sendAdmin({ type: 'select-seat', seat: 1 });
      // Start game
      await sendAdmin({ type: 'start-game' });

      // Viewport 390x844 (iPhone 12/13/14)
      await page.setViewportSize({ width: 390, height: 844 });
      await page.addInitScript(
        ({ code, credentials }) => {
          localStorage.setItem(`poker-table.session.v1.${code}`, JSON.stringify(credentials));
        },
        { code: host.room.code, credentials: host.credentials },
      );
      await page.goto(`/room/${host.room.code}`);
      await expect(page.locator('.virtual-table-arena')).toBeVisible();

      // In Heads-up, Carlos is SB/Dealer (posts 10), Beatriz is BB (posts 20).
      // Pot is 30. It's Carlos' turn to act.
      const actionDock = page.locator('.action-dock');
      await expect(actionDock).toBeVisible();

      // Check contextual buttons on dock:
      // Carlos has 990 chips left, facing BB 20 (callAmount = 10).
      // Distinct actions:
      // - Fold
      // - Call (Pagar 10)
      // - Raise (Aumentar (Raise))
      // - All-in (All-in (1.000))
      await expect(actionDock.locator('.action-btn-fold')).toBeVisible();
      await expect(actionDock.locator('.action-btn-call')).toContainText('Pagar 10');
      await expect(actionDock.locator('.action-btn-raise')).toContainText('Aumentar (Raise)');
      await expect(actionDock.locator('.action-btn-allin')).toContainText('All-in (990)');

      // Save screenshot of the main contextual dock
      await page.screenshot({ path: `${SCRATCH_DIR}/controles-dock-390px.png` });

      // Click "Aumentar (Raise)" to open RaiseControl
      await actionDock.locator('.action-btn-raise').click();
      const raiseControl = page.locator('.raise-control');
      await expect(raiseControl).toBeVisible();
      await expect(raiseControl.locator('.raise-title')).toHaveText('Definir Aumento (Raise)');

      // Verify Presets are present and calculated accurately:
      // Preflop: SB committed 10, BB 20. Pot = 30. toCall = 10, potAfterCall = 40.
      // - MÍN.: 40
      // - ½ POTE: 20 + Math.round(40 * 0.5) = 40
      // - POTE: 20 + 40 = 60
      // - MÁX.: 1000
      const presets = raiseControl.locator('.preset-btn');
      await expect(presets).toHaveCount(4);
      await expect(presets.nth(0)).toContainText('MÍN.');
      await expect(presets.nth(0)).toContainText('40');
      await expect(presets.nth(1)).toContainText('½ POTE');
      await expect(presets.nth(1)).toContainText('40');
      await expect(presets.nth(2)).toContainText('POTE');
      await expect(presets.nth(2)).toContainText('60');
      await expect(presets.nth(3)).toContainText('MÁX.');
      await expect(presets.nth(3)).toContainText('1.000');

      // Feedback display initially shows min raise (40):
      // Total na street: 40, extra from stack: (+30 do seu stack)
      await expect(raiseControl.locator('.raise-target-display strong')).toHaveText('40');
      await expect(raiseControl.locator('.raise-extra-display')).toContainText('+30 do seu stack');
      await expect(raiseControl.locator('.raise-allin-badge')).toHaveCount(0);

      // Verify Slider attributes
      const slider = raiseControl.locator('.raise-slider');
      await expect(slider).toHaveAttribute('min', '40');
      await expect(slider).toHaveAttribute('max', '1000');
      await expect(slider).toHaveValue('40');

      // Click "POTE" (60)
      await presets.nth(2).click();
      await expect(raiseControl.locator('.raise-target-display strong')).toHaveText('60');
      await expect(raiseControl.locator('.raise-extra-display')).toContainText('+50 do seu stack');
      await expect(raiseControl.locator('.raise-input')).toHaveValue('60');
      await expect(slider).toHaveValue('60');
      await expect(presets.nth(2)).toHaveClass(/active/);

      // Click "MÁX." (1000)
      await presets.nth(3).click();
      await expect(raiseControl.locator('.raise-target-display strong')).toHaveText('1.000');
      await expect(raiseControl.locator('.raise-extra-display')).toContainText('+990 do seu stack');
      await expect(raiseControl.locator('.raise-allin-badge')).toBeVisible();
      await expect(raiseControl.locator('.raise-input')).toHaveValue('1000');
      await expect(slider).toHaveValue('1000');

      // Use Stepper buttons: click '-' (step is 20), then '+'
      const minusBtn = raiseControl.locator('.stepper-btn').first();
      const plusBtn = raiseControl.locator('.stepper-btn').nth(1);
      await minusBtn.click();
      await expect(raiseControl.locator('.raise-input')).toHaveValue('980');
      await expect(raiseControl.locator('.raise-target-display strong')).toHaveText('980');
      await expect(slider).toHaveValue('980');

      await plusBtn.click();
      await expect(raiseControl.locator('.raise-input')).toHaveValue('1000');
      await minusBtn.click();

      // Type directly into input: 120
      const input = raiseControl.locator('.raise-input');
      await input.fill('120');
      await expect(raiseControl.locator('.raise-target-display strong')).toHaveText('120');
      await expect(raiseControl.locator('.raise-extra-display')).toContainText('+110 do seu stack');
      await expect(slider).toHaveValue('120');

      // Validation test: type invalid negative or string
      await input.fill('25'); // below minRaiseAmount of 40
      await expect(raiseControl.locator('.raise-error')).toContainText('O valor mínimo é 40');
      await expect(raiseControl.locator('.raise-btn-confirm')).toBeDisabled();

      await input.fill('1500'); // above maxRaiseAmount of 1000
      await expect(raiseControl.locator('.raise-error')).toContainText('O valor máximo disponível é 1.000');
      await expect(raiseControl.locator('.raise-btn-confirm')).toBeDisabled();

      // Reset to valid 60 (Pot raise)
      await input.fill('60');
      await expect(raiseControl.locator('.raise-error')).toHaveCount(0);
      await expect(raiseControl.locator('.raise-btn-confirm')).toBeEnabled();

      // Save screenshot at 390px
      await page.screenshot({ path: `${SCRATCH_DIR}/controles-slider-390px.png` });

      // Test small smartphone viewport: 320x640 (e.g. compact Android)
      await page.setViewportSize({ width: 320, height: 640 });
      await page.waitForTimeout(100);

      // Verify no horizontal overflow
      const bodyWidth = await page.evaluate(() => document.body.scrollWidth);
      const windowWidth = await page.evaluate(() => window.innerWidth);
      expect(bodyWidth).toBeLessThanOrEqual(windowWidth);

      // Save screenshot at 320px
      await page.screenshot({ path: `${SCRATCH_DIR}/controles-slider-320px.png` });

      // Confirm the raise of 60
      await raiseControl.locator('.raise-btn-confirm').click();

      // Raise control closes and bet is committed
      await expect(raiseControl).toHaveCount(0);
      // Carlos now shows a bet of 60 on the table
      const carlosBet = page.locator('.player-bet-badge').filter({ hasText: '60' });
      await expect(carlosBet).toBeVisible();
    } finally {
      admin.disconnect();
      guestSocket.disconnect();
    }
  });

  test('eliminates redundant All-in button when Call consumes entire stack (Call em All-in)', async ({
    page,
    request,
  }) => {
    // Create a 2-player game where player Beatriz has a small stack that can only call in all-in
    const createRes = await request.post('/api/rooms', {
      data: {
        hostName: 'Carlos',
        config: {
          name: 'Mesa Short Stack',
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

    const joinRes = await request.post(`/api/rooms/${host.room.code}/join`, {
      data: { name: 'Beatriz', seat: 2 },
    });
    const joinReply = (await joinRes.json()) as Reply<Admission>;
    if (!joinReply.ok) throw new Error(joinReply.error.message);
    const guest = joinReply.data;

    const admin: Socket<ServerEvents, ClientEvents> = io('http://127.0.0.1:3100', {
      auth: { protocol: 1, credentials: host.credentials },
      transports: ['websocket'],
      autoConnect: false,
    });

    const guestSocket: Socket<ServerEvents, ClientEvents> = io('http://127.0.0.1:3100', {
      auth: { protocol: 1, credentials: guest.credentials },
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
          guestSocket.once('room:state', () => resolve());
          guestSocket.once('connect_error', reject);
          guestSocket.connect();
        }),
      ]);

      const getSyncState = async () => {
        return new Promise<RoomState>((resolve, reject) =>
          admin.emit('room:sync', reply => (reply.ok ? resolve(reply.data) : reject(Error(reply.error.message)))),
        );
      };

      const sendCommand = async (
        socket: Socket<ServerEvents, ClientEvents>,
        input: CommandInput,
      ) => {
        const s = await getSyncState();
        return new Promise<Reply<RoomState>>(resolve =>
          socket.emit(
            'room:command',
            { ...input, commandId: randomUUID(), expectedRevision: s.revision } as Command,
            resolve,
          ),
        );
      };

      await sendCommand(admin, { type: 'select-seat', seat: 1 });
      await sendCommand(admin, { type: 'start-game' });

      // Carlos (SB 10) goes All-in for 1000!
      const raiseRes = await sendCommand(admin, { type: 'game-action', action: 'all-in' });
      expect(raiseRes.ok).toBe(true);

      // Now it's Beatriz's turn. Beatriz has 980 chips left (already posted BB 20).
      // Total bet is 1000. Calling requires 980, which is her entire stack!
      // Therefore, Beatriz's Call is an All-in!
      await page.setViewportSize({ width: 390, height: 844 });
      await page.addInitScript(
        ({ code, credentials }) => {
          localStorage.setItem(`poker-table.session.v1.${code}`, JSON.stringify(credentials));
        },
        { code: host.room.code, credentials: guest.credentials },
      );
      await page.goto(`/room/${host.room.code}`);
      await expect(page.locator('.virtual-table-arena')).toBeVisible();

      const actionDock = page.locator('.action-dock');
      await expect(actionDock).toBeVisible();

      // Verify buttons:
      // 1. Fold
      await expect(actionDock.locator('.action-btn-fold')).toBeVisible();
      // 2. Call em All-in
      const callBtn = actionDock.locator('.action-btn-call');
      await expect(callBtn).toBeVisible();
      await expect(callBtn).toContainText('Pagar 980 (All-in)');
      // 3. Raise is NOT visible (cannot raise an all-in that covers stack)
      await expect(actionDock.locator('.action-btn-raise')).toHaveCount(0);
      // 4. Redundant All-in button is ELIMINATED!
      await expect(actionDock.locator('.action-btn-allin')).toHaveCount(0);

      // Clicking Call opens the All-in confirmation dialog
      await callBtn.click();
      const confirmDialog = page.locator('dialog[open]');
      await expect(confirmDialog).toBeVisible();
      await expect(confirmDialog.locator('h2')).toContainText('Confirmar All-in?');
      await expect(confirmDialog.locator('p')).toContainText('Você pagará com todas as suas 980 fichas restantes na mesa (All-in).');

      // Confirm All-in
      await confirmDialog.getByRole('button', { name: 'Confirmar All-in' }).click();
      await expect(confirmDialog).toHaveCount(0);

      // Both are all-in, street advances to showdown
      const sAfter = await getSyncState();
      expect(sAfter.game?.hand.status).toBe('showdown');
    } finally {
      admin.disconnect();
      guestSocket.disconnect();
    }
  });

  test('survives page reload during active turn and preserves selection state', async ({
    page,
    request,
  }) => {
    const createRes = await request.post('/api/rooms', {
      data: {
        hostName: 'Carlos',
        config: {
          name: 'Mesa Resiliência',
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

    const joinRes = await request.post(`/api/rooms/${host.room.code}/join`, {
      data: { name: 'Beatriz', seat: 2 },
    });
    const joinReply = (await joinRes.json()) as Reply<Admission>;
    if (!joinReply.ok) throw new Error(joinReply.error.message);
    const guest = joinReply.data;

    const admin: Socket<ServerEvents, ClientEvents> = io('http://127.0.0.1:3100', {
      auth: { protocol: 1, credentials: host.credentials },
      transports: ['websocket'],
      autoConnect: false,
    });

    const guestSocket: Socket<ServerEvents, ClientEvents> = io('http://127.0.0.1:3100', {
      auth: { protocol: 1, credentials: guest.credentials },
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
          guestSocket.once('room:state', () => resolve());
          guestSocket.once('connect_error', reject);
          guestSocket.connect();
        }),
      ]);

      const getSyncState = async () => {
        return new Promise<RoomState>((resolve, reject) =>
          admin.emit('room:sync', reply => (reply.ok ? resolve(reply.data) : reject(Error(reply.error.message)))),
        );
      };

      const sendAdmin = async (
        input: { type: 'select-seat'; seat: number } | { type: 'start-game' },
      ) => {
        const s = await getSyncState();
        return new Promise<Reply<RoomState>>(resolve =>
          admin.emit(
            'room:command',
            { ...input, commandId: randomUUID(), expectedRevision: s.revision } as Command,
            resolve,
          ),
        );
      };

      await sendAdmin({ type: 'select-seat', seat: 1 });
      await sendAdmin({ type: 'start-game' });

      await page.setViewportSize({ width: 390, height: 844 });
      await page.addInitScript(
        ({ code, credentials }) => {
          localStorage.setItem(`poker-table.session.v1.${code}`, JSON.stringify(credentials));
        },
        { code: host.room.code, credentials: host.credentials },
      );
      await page.goto(`/room/${host.room.code}`);
      await expect(page.locator('.virtual-table-arena')).toBeVisible();

      // Open raise control
      await page.locator('.action-btn-raise').click();
      await expect(page.locator('.raise-control')).toBeVisible();

      // Reload page
      await page.reload();
      await expect(page.locator('.virtual-table-arena')).toBeVisible();

      // Turn is still Carlos' turn, dock is intact
      await expect(page.locator('.action-btn-raise')).toBeVisible();
      await expect(page.locator('.action-btn-call')).toContainText('Pagar 10');
    } finally {
      admin.disconnect();
      guestSocket.disconnect();
    }
  });

  test('handles exact partial all-in call when player has 60 chips and faces 100 bet', async ({
    page,
    request,
  }) => {
    // 1. Create 2-player game
    const createRes = await request.post('/api/rooms', {
      data: {
        hostName: 'Carlos',
        config: {
          name: 'Mesa Parcial 60 vs 100',
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

    const joinRes = await request.post(`/api/rooms/${host.room.code}/join`, {
      data: { name: 'Beatriz', seat: 2 },
    });
    const joinReply = (await joinRes.json()) as Reply<Admission>;
    if (!joinReply.ok) throw new Error(joinReply.error.message);
    const guest = joinReply.data;

    const admin: Socket<ServerEvents, ClientEvents> = io('http://127.0.0.1:3100', {
      auth: { protocol: 1, credentials: host.credentials },
      transports: ['websocket'],
      autoConnect: false,
    });

    const guestSocket: Socket<ServerEvents, ClientEvents> = io('http://127.0.0.1:3100', {
      auth: { protocol: 1, credentials: guest.credentials },
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
          guestSocket.once('room:state', () => resolve());
          guestSocket.once('connect_error', reject);
          guestSocket.connect();
        }),
      ]);

      const getSyncState = async () => {
        return new Promise<RoomState>((resolve, reject) =>
          admin.emit('room:sync', reply => (reply.ok ? resolve(reply.data) : reject(Error(reply.error.message)))),
        );
      };

      const sendCommand = async (
        socket: Socket<ServerEvents, ClientEvents>,
        input: CommandInput,
      ) => {
        const s = await getSyncState();
        return new Promise<Reply<RoomState>>(resolve =>
          socket.emit(
            'room:command',
            { ...input, commandId: randomUUID(), expectedRevision: s.revision } as Command,
            resolve,
          ),
        );
      };

      await sendCommand(admin, { type: 'select-seat', seat: 1 });
      await sendCommand(admin, { type: 'start-game' });

      // Hand 1: Carlos raises to 920, Beatriz calls 920
      await sendCommand(admin, { type: 'game-action', action: 'raise', amount: 920 });
      await sendCommand(guestSocket, { type: 'game-action', action: 'call' });

      // Flop: Beatriz checks, Carlos checks, then advance
      await sendCommand(admin, { type: 'advance-street' });
      await sendCommand(guestSocket, { type: 'game-action', action: 'check' });
      await sendCommand(admin, { type: 'game-action', action: 'check' });

      // Turn: Beatriz checks, Carlos checks, then advance
      await sendCommand(admin, { type: 'advance-street' });
      await sendCommand(guestSocket, { type: 'game-action', action: 'check' });
      await sendCommand(admin, { type: 'game-action', action: 'check' });

      // River: Beatriz checks, Carlos checks, then advance
      await sendCommand(admin, { type: 'advance-street' });
      await sendCommand(guestSocket, { type: 'game-action', action: 'check' });
      await sendCommand(admin, { type: 'game-action', action: 'check' });

      // Advance to Showdown
      await sendCommand(admin, { type: 'advance-street' });

      // Settle Hand 1: Carlos wins the pot
      await sendCommand(admin, {
        type: 'settle-hand',
        decisions: [{ potId: 'main', winners: [host.credentials.playerId] }],
      });

      // Start Hand 2: Beatriz has 80 chips remaining!
      await sendCommand(admin, { type: 'next-hand' });

      // In Hand 2:
      // Dealer rotates: Beatriz is SB (posts 10, chips left: 70, committed: 10)
      // Carlos is BB (posts 20, committed: 20)
      // Beatriz calls 10 (now committed 20, chips left: 60!)
      await sendCommand(guestSocket, { type: 'game-action', action: 'call' });
      // Carlos checks (committed 20)
      await sendCommand(admin, { type: 'game-action', action: 'check' });

      // Round complete -> Advance to Flop!
      await sendCommand(admin, { type: 'advance-street' });

      // On Flop:
      // Current street is flop.
      // Carlos is first to act (BB postflop). Carlos bets 100!
      await sendCommand(admin, { type: 'game-action', action: 'raise', amount: 100 });

      // Now action is on Beatriz!
      // Beatriz has committed 0 on the flop, current bet is 100.
      // Beatriz has EXACTLY 60 chips remaining!
      await page.setViewportSize({ width: 390, height: 844 });
      await page.addInitScript(
        ({ code, credentials }) => {
          localStorage.setItem(`poker-table.session.v1.${code}`, JSON.stringify(credentials));
        },
        { code: host.room.code, credentials: guest.credentials },
      );
      await page.goto(`/room/${host.room.code}`);
      await expect(page.locator('.virtual-table-arena')).toBeVisible();

      const actionDock = page.locator('.action-dock');
      await expect(actionDock).toBeVisible();

      // 1. O botão apresenta o valor de 60, e não 100
      const callBtn = actionDock.locator('.action-btn-call');
      await expect(callBtn).toBeVisible();
      await expect(callBtn).toHaveText('Pagar 60 (All-in)');
      // Não apresenta 100
      await expect(callBtn).not.toContainText('100');

      // 2. Não aparece outro botão financeiramente redundante
      await expect(actionDock.locator('.action-btn-allin')).toHaveCount(0);
      await expect(actionDock.locator('.action-btn-raise')).toHaveCount(0);
      await expect(actionDock.locator('.action-btn-fold')).toBeVisible();

      // 3. A confirmação explica corretamente o All-in parcial
      await callBtn.click();
      const confirmDialog = page.locator('dialog[open]');
      await expect(confirmDialog).toBeVisible();
      await expect(confirmDialog.locator('h2')).toHaveText('Confirmar All-in?');
      await expect(confirmDialog.locator('p')).toHaveText(
        'Você pagará com todas as suas 60 fichas restantes na mesa (All-in parcial insuficiente para cobrir o total da aposta).',
      );

      // 4. O servidor recebe uma ação legal e resultado financeiro permanece correto
      await confirmDialog.getByRole('button', { name: 'Confirmar All-in' }).click();
      await expect(confirmDialog).toHaveCount(0);

      const sAfter = await getSyncState();
      const beatrizHand = sAfter.game?.hand.players.find(p => p.id === guest.credentials.playerId);
      expect(beatrizHand?.chips).toBe(0);
      expect(beatrizHand?.roundCommitted).toBe(60);
      expect(beatrizHand?.isAllIn).toBe(true);
    } finally {
      admin.disconnect();
      guestSocket.disconnect();
    }
  });
});
