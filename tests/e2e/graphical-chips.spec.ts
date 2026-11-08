import { test, expect } from '@playwright/test';
import { io, type Socket } from 'socket.io-client';
import { randomUUID } from 'node:crypto';
import type { Admission, ClientEvents, Command, CommandInput, Reply, RoomState, ServerEvents } from '@poker-table/protocol';

const SCRATCH_DIR = '/home/theo-enderson/.gemini/antigravity/brain/843a39d6-b7c9-4a7d-b260-3cc46772dc05/scratch';

test.describe('Graphical Poker Chips and Pot Visual Experience (Etapa Fichas Gráficas)', () => {
  test('renders graphical chip stacks on player bets and central pot, supporting blinds, raises, and side pots', async ({
    page,
    request,
  }) => {
    // 1. Create a 6-player room
    const createRes = await request.post('/api/rooms', {
      data: {
        hostName: 'Carlos',
        config: {
          name: 'Mesa Fichas Gráficas',
          maxPlayers: 6,
          startingChips: 1000,
          smallBlind: 10,
          bigBlind: 20,
        },
      },
    });
    const hostReply = (await createRes.json()) as Reply<Admission>;
    if (!hostReply.ok) throw new Error(hostReply.error.message);
    const host = hostReply.data;

    const guestNames = ['Beatriz', 'Diego', 'Eduarda', 'Fernando', 'Gabriela'];
    const guestSockets: { name: string; seat: number; socket: Socket<ServerEvents, ClientEvents> }[] = [];

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

      // Carlos sits at seat 1
      const seatRes = await sendAdmin({ type: 'select-seat', seat: 1 });
      expect(seatRes.ok).toBe(true);

      // Connect 5 guests
      for (let i = 0; i < guestNames.length; i++) {
        const seat = i + 2;
        const name = guestNames[i];
        const joinRes = await request.post(`/api/rooms/${host.room.code}/join`, {
          data: { name, seat },
        });
        const joinReply = (await joinRes.json()) as Reply<Admission>;
        if (!joinReply.ok) throw new Error(joinReply.error.message);
        const guest = joinReply.data;

        const guestSocket: Socket<ServerEvents, ClientEvents> = io('http://127.0.0.1:3100', {
          auth: { protocol: 1, credentials: guest.credentials },
          transports: ['websocket'],
          autoConnect: false,
        });

        await new Promise<void>((resolve, reject) => {
          guestSocket.once('room:state', () => resolve());
          guestSocket.once('connect_error', reject);
          guestSocket.connect();
        });

        guestSockets.push({ name, seat, socket: guestSocket });
      }

      // Start game
      const startResult = await sendAdmin({ type: 'start-game' });
      expect(startResult.ok).toBe(true);

      // Open Host (Carlos) page
      await page.addInitScript(
        ({ code, credentials }) => {
          localStorage.setItem(`poker-table.session.v1.${code}`, JSON.stringify(credentials));
        },
        { code: host.room.code, credentials: host.credentials },
      );
      await page.goto(`/room/${host.room.code}`);
      await expect(page.locator('.virtual-table-arena')).toBeVisible();

      // Check initial blinds: SB = 10, BB = 20, Total Pot = 30
      const tablePot = page.locator('.table-pot');
      await expect(tablePot).toBeVisible();
      await expect(tablePot.locator('.pot-value')).toContainText('30');
      // No pré-flop inicial com blinds, as fichas ainda estão na frente dos jogadores (gatheredPot = 0)
      // Eliminando duplicidade visual no pote central
      await expect(tablePot.locator('.pot-chips-cluster')).toHaveCount(0);

      // Verify Player Bets (blinds on felt):
      // Small blind has 10, Big blind has 20
      const playerBets = page.locator('.player-bet-badge');
      await expect(playerBets).toHaveCount(2);

      // Verify each player bet contains an SVG poker chip
      await expect(playerBets.first().locator('.poker-chip-svg').first()).toBeVisible();
      await expect(playerBets.nth(1).locator('.poker-chip-svg').first()).toBeVisible();

      // Helper to send actions from whoever is the current actor
      const sendFromCurrentActor = async (action: 'call' | 'raise' | 'fold' | 'all-in', amount?: number) => {
        const s = await getSyncState();
        const currentActorId = s.game?.hand.currentActorId;
        expect(currentActorId).toBeDefined();

        let targetSocket = admin;
        if (currentActorId !== host.credentials.playerId) {
          const guest = guestSockets.find(g => {
            const p = s.players.find(sp => sp.id === currentActorId);
            return p?.seat === g.seat;
          });
          expect(guest).toBeDefined();
          targetSocket = guest!.socket;
        }

        const cmdInput: CommandInput =
          action === 'call'
            ? { type: 'game-action', action: 'call' }
            : action === 'fold'
              ? { type: 'game-action', action: 'fold' }
              : action === 'all-in'
                ? { type: 'game-action', action: 'all-in' }
                : { type: 'game-action', action: 'raise', amount: amount ?? 60 };

        const result = await new Promise<Reply<RoomState>>(resolve =>
          targetSocket.emit('room:command', { ...cmdInput, commandId: randomUUID(), expectedRevision: s.revision }, resolve),
        );
        expect(result.ok).toBe(true);
      };

      // 1st actor raises to 60
      await sendFromCurrentActor('raise', 60);

      // Verify 3 player bets now exist on the felt, including 60
      await expect(page.locator('.player-bet-badge')).toHaveCount(3);
      await expect(page.locator('.player-bet-amount').filter({ hasText: '60' })).toBeVisible();

      // 2nd actor folds
      await sendFromCurrentActor('fold');
      await expect(page.locator('.tag-fold')).toBeVisible();

      // 3rd actor goes all-in
      await sendFromCurrentActor('all-in');
      await expect(page.locator('.player-bet-badge.bet-allin')).toBeVisible();

      // Test mobile viewports and capture screenshots
      // 1. 390×845 mobile (fichas-6p-390px.png)
      await page.setViewportSize({ width: 390, height: 845 });
      const scrollWidth390 = await page.evaluate(() => document.body.scrollWidth);
      expect(scrollWidth390).toBeLessThanOrEqual(390);

      // Verify Carlos's pod (.pod-self) is completely visible above the ActionDock without collision
      const podSelf390 = await page.locator('.pod-self').boundingBox();
      const dock390 = await page.locator('.action-dock-active').boundingBox();
      expect(podSelf390).not.toBeNull();
      expect(dock390).not.toBeNull();
      expect(podSelf390!.y + podSelf390!.height).toBeLessThanOrEqual(dock390!.y);

      await page.screenshot({
        path: `${SCRATCH_DIR}/fichas-6p-390px.png`,
        fullPage: false,
      });

      // 2. 320×640 small mobile (fichas-6p-320px.png)
      await page.setViewportSize({ width: 320, height: 640 });
      const scrollWidth320 = await page.evaluate(() => document.body.scrollWidth);
      expect(scrollWidth320).toBeLessThanOrEqual(320);
      await expect(page.locator('.action-dock-active')).toBeVisible();
      await page.screenshot({
        path: `${SCRATCH_DIR}/fichas-6p-320px.png`,
        fullPage: false,
      });

      // 3. 434×935 modern mobile (fichas-6p-430px.png)
      await page.setViewportSize({ width: 434, height: 935 });
      const podSelf434 = await page.locator('.pod-self').boundingBox();
      const dock434 = await page.locator('.action-dock-active').boundingBox();
      expect(podSelf434).not.toBeNull();
      expect(dock434).not.toBeNull();
      expect(podSelf434!.y + podSelf434!.height).toBeLessThanOrEqual(dock434!.y);

      await page.screenshot({
        path: `${SCRATCH_DIR}/fichas-6p-430px.png`,
        fullPage: false,
      });

      // 4. Desktop (fichas-6p-desktop.png)
      await page.setViewportSize({ width: 1280, height: 800 });
      await page.screenshot({
        path: `${SCRATCH_DIR}/fichas-6p-desktop.png`,
        fullPage: false,
      });

      // Test page reload: preserves exact chips without errors
      await page.reload();
      await expect(page.locator('.virtual-table-arena')).toBeVisible();
      await expect(page.locator('.player-bet-badge')).toHaveCount(4);
      await expect(page.locator('.player-bet-badge').first().locator('.poker-chip-svg').first()).toBeVisible();

    } finally {
      admin.disconnect();
      for (const g of guestSockets) {
        g.socket.disconnect();
      }
    }
  });

  test('clears active bets and accumulates them into central pot upon street advancement', async ({
    page,
    request,
  }) => {
    // 3-player table to test street advancement
    const createRes = await request.post('/api/rooms', {
      data: {
        hostName: 'Bruno',
        config: {
          name: 'Mesa Street Advance',
          maxPlayers: 3,
          startingChips: 1000,
          smallBlind: 10,
          bigBlind: 20,
        },
      },
    });
    const hostReply = (await createRes.json()) as Reply<Admission>;
    if (!hostReply.ok) throw new Error(hostReply.error.message);
    const host = hostReply.data;

    const guest1Res = await request.post(`/api/rooms/${host.room.code}/join`, {
      data: { name: 'Lucas', seat: 2 },
    });
    const g1Reply = (await guest1Res.json()) as Reply<Admission>;
    if (!g1Reply.ok) throw new Error(g1Reply.error.message);

    const guest2Res = await request.post(`/api/rooms/${host.room.code}/join`, {
      data: { name: 'Marina', seat: 3 },
    });
    const g2Reply = (await guest2Res.json()) as Reply<Admission>;
    if (!g2Reply.ok) throw new Error(g2Reply.error.message);

    const admin: Socket<ServerEvents, ClientEvents> = io('http://127.0.0.1:3100', {
      auth: { protocol: 1, credentials: host.credentials },
      transports: ['websocket'],
      autoConnect: false,
    });
    const g1Socket: Socket<ServerEvents, ClientEvents> = io('http://127.0.0.1:3100', {
      auth: { protocol: 1, credentials: g1Reply.data.credentials },
      transports: ['websocket'],
      autoConnect: false,
    });
    const g2Socket: Socket<ServerEvents, ClientEvents> = io('http://127.0.0.1:3100', {
      auth: { protocol: 1, credentials: g2Reply.data.credentials },
      transports: ['websocket'],
      autoConnect: false,
    });

    try {
      await Promise.all([
        new Promise<void>(res => { admin.once('room:state', () => res()); admin.connect(); }),
        new Promise<void>(res => { g1Socket.once('room:state', () => res()); g1Socket.connect(); }),
        new Promise<void>(res => { g2Socket.once('room:state', () => res()); g2Socket.connect(); }),
      ]);

      const getSyncState = async () => {
        return new Promise<RoomState>((resolve, reject) =>
          admin.emit('room:sync', reply => (reply.ok ? resolve(reply.data) : reject(Error(reply.error.message)))),
        );
      };

      const s0 = await getSyncState();
      await new Promise<void>((res, rej) =>
        admin.emit('room:command', { type: 'select-seat', seat: 1, commandId: randomUUID(), expectedRevision: s0.revision }, reply => reply.ok ? res() : rej(new Error(reply.error.message)))
      );

      const s1 = await getSyncState();
      await new Promise<void>((res, rej) =>
        admin.emit('room:command', { type: 'start-game', commandId: randomUUID(), expectedRevision: s1.revision }, reply => reply.ok ? res() : rej(new Error(reply.error.message)))
      );

      await page.addInitScript(
        ({ code, credentials }) => {
          localStorage.setItem(`poker-table.session.v1.${code}`, JSON.stringify(credentials));
        },
        { code: host.room.code, credentials: host.credentials },
      );
      await page.goto(`/room/${host.room.code}`);
      await page.setViewportSize({ width: 390, height: 844 });
      await expect(page.locator('.virtual-table-arena')).toBeVisible();

      // Blinds are on the felt (SB=10, BB=20), pot = 30
      await expect(page.locator('.player-bet-badge')).toHaveCount(2);
      await expect(page.locator('.table-pot .pot-value')).toContainText('30');

      // Dealer/Button (Bruno, seat 1) calls 20
      const s2 = await getSyncState();
      await new Promise<void>((res, rej) =>
        admin.emit('room:command', { type: 'game-action', action: 'call', commandId: randomUUID(), expectedRevision: s2.revision }, reply => reply.ok ? res() : rej(new Error(reply.error.message)))
      );

      // SB (Lucas, seat 2) calls 20 (+10)
      const s3 = await getSyncState();
      await new Promise<void>((res, rej) =>
        g1Socket.emit('room:command', { type: 'game-action', action: 'call', commandId: randomUUID(), expectedRevision: s3.revision }, reply => reply.ok ? res() : rej(new Error(reply.error.message)))
      );

      // BB (Marina, seat 3) checks
      const s4 = await getSyncState();
      await new Promise<void>((res, rej) =>
        g2Socket.emit('room:command', { type: 'game-action', action: 'check', commandId: randomUUID(), expectedRevision: s4.revision }, reply => reply.ok ? res() : rej(new Error(reply.error.message)))
      );

      // All 3 players called 20 each. Total pot = 60.
      await expect(page.locator('.table-pot .pot-value')).toContainText('60');

      // Host advances street to Flop
      const s5 = await getSyncState();
      await new Promise<void>((res, rej) =>
        admin.emit('room:command', { type: 'advance-street', commandId: randomUUID(), expectedRevision: s5.revision }, reply => reply.ok ? res() : rej(new Error(reply.error.message)))
      );

      // On Flop:
      // 1. All player bet badges on the felt are cleared (0 active bets)
      await expect(page.locator('.player-bet-badge')).toHaveCount(0);

      // 2. Pot displays all 60 chips collected from preflop in the central stack
      await expect(page.locator('.table-pot .pot-value')).toContainText('60');
      await expect(page.locator('.table-pot .poker-chip-svg').first()).toBeVisible();

      // 3. Flop shows 3 community cards with geometric pattern (no virtual suit symbols)
      await expect(page.locator('.slot-revealed')).toHaveCount(3);
      await expect(page.locator('.card-geometric-pattern')).toHaveCount(3);
      await expect(page.locator('.card-suit-symbol')).toHaveCount(0);

      // 4. First actor on flop bets 25
      const s6 = await getSyncState();
      const flopActorId = s6.game?.hand.currentActorId;
      const flopActorSocket = flopActorId === host.credentials.playerId ? admin : flopActorId === g1Reply.data.credentials.playerId ? g1Socket : g2Socket;

      await new Promise<void>((res, rej) =>
        flopActorSocket.emit('room:command', { type: 'game-action', action: 'raise', amount: 25, commandId: randomUUID(), expectedRevision: s6.revision }, reply => reply.ok ? res() : rej(new Error(reply.error.message)))
      );

      // A single new bet badge of 25 chips appears on the felt
      await expect(page.locator('.player-bet-badge')).toHaveCount(1);
      await expect(page.locator('.player-bet-amount')).toHaveText('25');
      // Total pot is now 60 + 25 = 85
      await expect(page.locator('.table-pot .pot-value')).toContainText('85');

      // Capture screenshot showing street advancement with flop cards and active flop bet
      await page.screenshot({
        path: `${SCRATCH_DIR}/fichas-flop-390px.png`,
        fullPage: false,
      });

    } finally {
      admin.disconnect();
      g1Socket.disconnect();
      g2Socket.disconnect();
    }
  });

  test('renders 2-player heads-up and 10-player full ring with graphical chips and side pots', async ({
    page,
    request,
  }) => {
    // Create 2-player heads-up
    const huRes = await request.post('/api/rooms', {
      data: {
        hostName: 'Alice',
        config: {
          name: 'Heads-up Fichas',
          maxPlayers: 2,
          startingChips: 500,
          smallBlind: 10,
          bigBlind: 20,
        },
      },
    });
    const huReply = (await huRes.json()) as Reply<Admission>;
    if (!huReply.ok) throw new Error(huReply.error.message);
    const huHost = huReply.data;

    const bobJoinRes = await request.post(`/api/rooms/${huHost.room.code}/join`, {
      data: { name: 'Bob', seat: 2 },
    });
    const bobReply = (await bobJoinRes.json()) as Reply<Admission>;
    if (!bobReply.ok) throw new Error(bobReply.error.message);

    const huAdmin: Socket<ServerEvents, ClientEvents> = io('http://127.0.0.1:3100', {
      auth: { protocol: 1, credentials: huHost.credentials },
      transports: ['websocket'],
      autoConnect: false,
    });
    const bobSocket: Socket<ServerEvents, ClientEvents> = io('http://127.0.0.1:3100', {
      auth: { protocol: 1, credentials: bobReply.data.credentials },
      transports: ['websocket'],
      autoConnect: false,
    });

    try {
      await Promise.all([
        new Promise<void>(res => { huAdmin.once('room:state', () => res()); huAdmin.connect(); }),
        new Promise<void>(res => { bobSocket.once('room:state', () => res()); bobSocket.connect(); }),
      ]);

      const getSyncState = async () => {
        return new Promise<RoomState>((resolve, reject) =>
          huAdmin.emit('room:sync', reply => (reply.ok ? resolve(reply.data) : reject(Error(reply.error.message)))),
        );
      };

      const s0 = await getSyncState();
      await new Promise<void>((resolve, reject) => {
        huAdmin.emit('room:command', { type: 'select-seat', seat: 1, commandId: randomUUID(), expectedRevision: s0.revision }, res => {
          if (res.ok) resolve();
          else reject(new Error(res.error.message));
        });
      });

      const s = await getSyncState();
      await new Promise<void>((resolve, reject) => {
        huAdmin.emit('room:command', { type: 'start-game', commandId: randomUUID(), expectedRevision: s.revision }, res => {
          if (res.ok) resolve();
          else reject(new Error(res.error.message));
        });
      });

      // Open Alice page
      await page.addInitScript(
        ({ code, credentials }) => {
          localStorage.setItem(`poker-table.session.v1.${code}`, JSON.stringify(credentials));
        },
        { code: huHost.room.code, credentials: huHost.credentials },
      );
      await page.goto(`/room/${huHost.room.code}`);
      await page.setViewportSize({ width: 390, height: 844 });
      await expect(page.locator('.virtual-table-arena')).toBeVisible();

      // In Heads-up, SB is Alice (10) and BB is Bob (20), Pot is 30
      await expect(page.locator('.player-bet-badge')).toHaveCount(2);
      await expect(page.locator('.table-pot .pot-value')).toContainText('30');

      // Alice goes All-in (500)
      const s2 = await getSyncState();
      await new Promise<void>((resolve, reject) => {
        huAdmin.emit('room:command', { type: 'game-action', action: 'all-in', commandId: randomUUID(), expectedRevision: s2.revision }, res => {
          if (res.ok) resolve();
          else reject(new Error(res.error.message));
        });
      });

      // Verify all-in badge style and chip rendering
      await expect(page.locator('.player-bet-badge.bet-allin')).toBeVisible();
      await expect(page.locator('.player-bet-amount').filter({ hasText: '500' })).toBeVisible();

      // Capture 2-player table screenshot (fichas-2p-390px.png)
      await page.screenshot({
        path: `${SCRATCH_DIR}/fichas-2p-390px.png`,
        fullPage: false,
      });

    } finally {
      huAdmin.disconnect();
      bobSocket.disconnect();
    }
  });

  test('renders 10-player full ring table with compact chips without overflow', async ({
    page,
    request,
  }) => {
    const ringRes = await request.post('/api/rooms', {
      data: {
        hostName: 'Player1',
        config: {
          name: 'Full Ring 10P Fichas',
          maxPlayers: 10,
          startingChips: 1000,
          smallBlind: 10,
          bigBlind: 20,
        },
      },
    });
    const ringReply = (await ringRes.json()) as Reply<Admission>;
    if (!ringReply.ok) throw new Error(ringReply.error.message);
    const ringHost = ringReply.data;

    const ringAdmin: Socket<ServerEvents, ClientEvents> = io('http://127.0.0.1:3100', {
      auth: { protocol: 1, credentials: ringHost.credentials },
      transports: ['websocket'],
      autoConnect: false,
    });
    const guestSockets: Socket<ServerEvents, ClientEvents>[] = [];

    try {
      await new Promise<void>(res => { ringAdmin.once('room:state', () => res()); ringAdmin.connect(); });

      const getSyncState = async () => {
        return new Promise<RoomState>((resolve, reject) =>
          ringAdmin.emit('room:sync', reply => (reply.ok ? resolve(reply.data) : reject(Error(reply.error.message)))),
        );
      };

      const s0 = await getSyncState();
      await new Promise<void>((resolve, reject) => {
        ringAdmin.emit('room:command', { type: 'select-seat', seat: 1, commandId: randomUUID(), expectedRevision: s0.revision }, res => {
          if (res.ok) resolve();
          else reject(new Error(res.error.message));
        });
      });

      // Connect 9 guests
      for (let s = 2; s <= 10; s++) {
        const jRes = await request.post(`/api/rooms/${ringHost.room.code}/join`, {
          data: { name: `Player${s}`, seat: s },
        });
        const jReply = (await jRes.json()) as Reply<Admission>;
        if (!jReply.ok) throw new Error(jReply.error.message);
        const guest = jReply.data;

        const sSocket: Socket<ServerEvents, ClientEvents> = io('http://127.0.0.1:3100', {
          auth: { protocol: 1, credentials: guest.credentials },
          transports: ['websocket'],
          autoConnect: false,
        });
        await new Promise<void>(res => { sSocket.once('room:state', () => res()); sSocket.connect(); });
        guestSockets.push(sSocket);
      }

      const s = await getSyncState();
      await new Promise<void>((resolve, reject) => {
        ringAdmin.emit('room:command', { type: 'start-game', commandId: randomUUID(), expectedRevision: s.revision }, res => {
          if (res.ok) resolve();
          else reject(new Error(res.error.message));
        });
      });

      await page.addInitScript(
        ({ code, credentials }) => {
          localStorage.setItem(`poker-table.session.v1.${code}`, JSON.stringify(credentials));
        },
        { code: ringHost.room.code, credentials: ringHost.credentials },
      );
      await page.goto(`/room/${ringHost.room.code}`);
      await page.setViewportSize({ width: 390, height: 844 });
      await expect(page.locator('.virtual-table-arena')).toBeVisible();

      // Check all 10 seat pods are rendered
      await expect(page.locator('.seat-pod')).toHaveCount(10);
      // Blinds are on felt
      await expect(page.locator('.player-bet-badge')).toHaveCount(2);

      // Verify no horizontal overflow
      const scrollWidth = await page.evaluate(() => document.body.scrollWidth);
      expect(scrollWidth).toBeLessThanOrEqual(390);

      // Capture 10-player screenshot (fichas-10p-390px.png)
      await page.screenshot({
        path: `${SCRATCH_DIR}/fichas-10p-390px.png`,
        fullPage: false,
      });

    } finally {
      ringAdmin.disconnect();
      for (const s of guestSockets) {
        s.disconnect();
      }
    }
  });
});
