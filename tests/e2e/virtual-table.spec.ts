import { test, expect } from '@playwright/test';
import { io, type Socket } from 'socket.io-client';
import { randomUUID } from 'node:crypto';
import type {
  Admission,
  ClientEvents,
  CommandInput,
  Reply,
  RoomState,
  ServerEvents,
} from '@poker-table/protocol';

const SCRATCH_DIR = '/home/theo-enderson/.gemini/antigravity/brain/843a39d6-b7c9-4a7d-b260-3cc46772dc05/scratch';

test.describe('Virtual Poker Table Visual Experience (Etapa Mesa Virtual)', () => {
  test('renders 2-player heads-up table across viewports and street progressions (mesa-2p-390px.png)', async ({
    page,
    browser,
  }) => {
    // 1. Host creates room
    await page.goto('/create');
    await page.getByPlaceholder('Poker de sábado').fill('Mesa Heads-Up');
    await page.getByPlaceholder('Como devemos chamar você?').fill('Helena');
    await page.getByRole('button', { name: 'Criar mesa' }).click();

    await expect(page.locator('.table-heading h1')).toHaveText('Mesa Heads-Up');
    const roomUrl = page.url();
    const codeMatch = roomUrl.match(/\/room\/([A-Z0-9]+)/);
    expect(codeMatch).not.toBeNull();
    const roomCode = codeMatch![1];

    // Host sits at seat 1
    await page.locator('.seat.empty').first().click();
    await expect(page.locator('.seat.mine')).toBeVisible();

    // 2. Guest connects in second context
    const guestContext = await browser.newContext();
    const page2 = await guestContext.newPage();
    try {
      await page2.goto(`/join/${roomCode}`);
      await page2.getByLabel('Seu nome', { exact: true }).fill('Rafael');
      await page2.getByRole('button', { name: 'Entrar na mesa' }).click();

      // Rafael sits at seat 2
      await page2.locator('.seat.empty').first().click();
      await expect(page2.locator('.seat.mine')).toBeVisible();

      // 3. Host starts game
      const startBtn = page.locator('.lobby-start-btn');
      await expect(startBtn).toBeVisible();
      await startBtn.click();

      // Both see active table
      await expect(page.locator('.active-table')).toBeVisible();
      await expect(page2.locator('.active-table')).toBeVisible();

      // 4. Verify 3-Tier Virtual Table elements
      await expect(page.locator('.virtual-table-container')).toBeVisible();
      await expect(page.locator('.table-top-status-bar')).toBeVisible();
      await expect(page.locator('.virtual-table-arena')).toBeVisible();
      await expect(page.locator('.table-felt-container')).toBeVisible();
      await expect(page.locator('.table-center-content')).toBeVisible();
      await expect(page.locator('.table-pot')).toBeVisible();
      await expect(page.locator('.community-cards-container')).toBeVisible();

      // Top status bar verifies blinds and turn banner
      await expect(page.locator('.blinds-badge')).toContainText('10 / 20');
      await expect(page.locator('.turn-banner-self')).toContainText('É a sua vez de agir!');

      // Central Pot verifies pot value
      await expect(page.locator('.pot-value')).toContainText('30');

      // Community cards on Preflop: 5 empty slots, 0 revealed
      await expect(page.locator('.community-card-slot')).toHaveCount(5);
      await expect(page.locator('.slot-hidden')).toHaveCount(5);
      await expect(page.locator('.community-cards-caption')).toContainText('Pré-flop · Cartas na mesa física');

      // Egocentric positioning:
      // Helena (self on page) is South (zone-south, pod-self)
      const helenaPodOnHelena = page.locator('.seat-pod').filter({ hasText: 'Helena' });
      await expect(helenaPodOnHelena).toHaveClass(/zone-south/);
      await expect(helenaPodOnHelena).toHaveClass(/pod-self/);
      await expect(helenaPodOnHelena).toHaveClass(/pod-turn-self/);
      await expect(helenaPodOnHelena.locator('.tag-turn-self')).toHaveText('SUA VEZ');

      // Rafael (opponent on page) is North (zone-north)
      const rafaelPodOnHelena = page.locator('.seat-pod').filter({ hasText: 'Rafael' });
      await expect(rafaelPodOnHelena).toHaveClass(/zone-north/);
      await expect(rafaelPodOnHelena.locator('.tag-blind')).toHaveText('BB 20');

      // Hole cards: 2 symbolic hole cards visible on active players
      await expect(helenaPodOnHelena.locator('.pod-hole-cards .symbolic-hole-card')).toHaveCount(2);
      await expect(rafaelPodOnHelena.locator('.pod-hole-cards .symbolic-hole-card')).toHaveCount(2);

      // Verify no overlap: Top status bar is strictly above North pod
      const topBarRect = await page.locator('.table-top-status-bar').boundingBox();
      const northPodRect = await rafaelPodOnHelena.boundingBox();
      expect(topBarRect).not.toBeNull();
      expect(northPodRect).not.toBeNull();
      expect(topBarRect!.y + topBarRect!.height).toBeLessThanOrEqual(northPodRect!.y);

      // Set viewport to 390px and capture required screenshot mesa-2p-390px.png
      await page.setViewportSize({ width: 390, height: 844 });
      await expect(page.locator('.virtual-table-container')).toBeVisible();
      const scrollWidth390 = await page.evaluate(() => document.body.scrollWidth);
      expect(scrollWidth390).toBeLessThanOrEqual(390);

      await page.screenshot({
        path: `${SCRATCH_DIR}/mesa-2p-390px.png`,
        fullPage: false,
      });

      // 5. Street progression: Preflop -> Flop
      await page.locator('.action-btn-call').click();
      await page2.locator('.action-btn-check').click();

      // Host advances to Flop
      await page.locator('.host-street-controls .host-advance-btn').click();
      await page.locator('dialog[open]').getByRole('button', { name: 'Confirmar Flop' }).click();

      await expect(page.locator('.community-card-slot.slot-revealed')).toHaveCount(3);
      await expect(page.locator('.community-card-slot.slot-hidden')).toHaveCount(2);
      await expect(page.locator('.community-cards-caption')).toContainText('Flop · 3 cartas na mesa física');

      // Advance Flop -> Turn
      await page2.locator('.action-btn-check').click();
      await page.locator('.action-btn-check').click();

      await page.locator('.host-street-controls .host-advance-btn').click();
      await page.locator('dialog[open]').getByRole('button', { name: 'Confirmar Turn' }).click();

      await expect(page.locator('.community-card-slot.slot-revealed')).toHaveCount(4);
      await expect(page.locator('.community-card-slot.slot-hidden')).toHaveCount(1);
      await expect(page.locator('.community-cards-caption')).toContainText('Turn · 4 cartas na mesa física');

      // Advance Turn -> River
      await page2.locator('.action-btn-check').click();
      await page.locator('.action-btn-check').click();

      await page.locator('.host-street-controls .host-advance-btn').click();
      await page.locator('dialog[open]').getByRole('button', { name: 'Confirmar River' }).click();

      await expect(page.locator('.community-card-slot.slot-revealed')).toHaveCount(5);
      await expect(page.locator('.community-card-slot.slot-hidden')).toHaveCount(0);
      await expect(page.locator('.community-cards-caption')).toContainText('River · 5 cartas na mesa física');
    } finally {
      await guestContext.close();
    }
  });

  test('renders 6-player table with turn actor, fold, all-in, bets on felt and community cards (mesa-6p-390px.png, mesa-6p-320px.png, mesa-6p-desktop.png)', async ({
    page,
    request,
  }) => {
    // 1. Create room with 6 players
    const createRes = await request.post('/api/rooms', {
      data: {
        hostName: 'Carlos',
        config: {
          name: 'Mesa Sexteto',
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

      const sendAdmin = async (input: CommandInput) => {
        const state = await new Promise<RoomState>((resolve, reject) =>
          admin.emit('room:sync', reply => (reply.ok ? resolve(reply.data) : reject(Error(reply.error.message)))),
        );
        const result = await new Promise<Reply<RoomState>>(resolve =>
          admin.emit('room:command', { ...input, commandId: randomUUID(), expectedRevision: state.revision }, resolve),
        );
        expect(result.ok).toBe(true);
      };

      // Carlos sits at seat 1
      await sendAdmin({ type: 'select-seat', seat: 1 });

      // Connect 5 guests
      for (let i = 0; i < guestNames.length; i++) {
        const name = guestNames[i];
        const seat = i + 2;
        const guestRes = await request.post(`/api/rooms/${host.room.code}/join`, {
          data: { name, seat },
        });
        const guestReply = (await guestRes.json()) as Reply<Admission>;
        if (!guestReply.ok) throw new Error(guestReply.error.message);
        const guest = guestReply.data;

        const gSocket: Socket<ServerEvents, ClientEvents> = io('http://127.0.0.1:3100', {
          auth: { protocol: 1, credentials: guest.credentials },
          transports: ['websocket'],
          autoConnect: false,
        });

        await new Promise<void>((resolve, reject) => {
          gSocket.once('room:state', () => resolve());
          gSocket.once('connect_error', reject);
          gSocket.connect();
        });
        guestSockets.push({ name, seat, socket: gSocket });
      }

      // Start game
      await sendAdmin({ type: 'start-game' });

      // Navigate page as host (Carlos, seat 1)
      await page.addInitScript(
        ({ code, credentials }) => {
          localStorage.setItem(`poker-table.session.v1.${code}`, JSON.stringify(credentials));
        },
        { code: host.room.code, credentials: host.credentials },
      );
      await page.goto(`/room/${host.room.code}`);
      await expect(page.locator('.active-table')).toBeVisible();

      // Ensure all 6 pods are rendered
      const pods = page.locator('.seat-pod');
      await expect(pods).toHaveCount(6);

      // Now create diverse poker actions: Fold, Raise, All-in
      // Helper to send command from the right socket
      const getSyncState = async () => {
        return new Promise<RoomState>((resolve, reject) =>
          admin.emit('room:sync', reply => (reply.ok ? resolve(reply.data) : reject(Error(reply.error.message)))),
        );
      };

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

      // 2nd actor folds
      await sendFromCurrentActor('fold');

      // 3rd actor goes all-in
      await sendFromCurrentActor('all-in');

      // Wait for UI to reflect actions and verify untruncated action tags
      const raiseTag = page.locator('.tag-raise');
      await expect(raiseTag).toBeVisible();
      await expect(raiseTag).toHaveText('RAISE 60');
      const isRaiseTruncated = await raiseTag.evaluate((el: HTMLElement) => el.scrollWidth > el.clientWidth);
      expect(isRaiseTruncated).toBe(false);

      await expect(page.locator('.tag-fold')).toBeVisible();
      await expect(page.locator('.tag-allin')).toBeVisible();
      await expect(page.locator('.pod-bet-badge').first()).toBeVisible();

      // Verify ActionDock accessibility in mobile viewports (Carlos is the actor)
      // 1. In 390px viewport:
      await page.setViewportSize({ width: 390, height: 844 });
      const actionDockActive = page.locator('.action-dock-active');
      await expect(actionDockActive).toBeVisible();
      const dockBox390 = await actionDockActive.boundingBox();
      expect(dockBox390).not.toBeNull();
      expect(dockBox390!.y + dockBox390!.height).toBeLessThanOrEqual(844);
      expect(dockBox390!.y).toBeGreaterThanOrEqual(0);

      // 2. In 320px viewport:
      await page.setViewportSize({ width: 320, height: 640 });
      const dockBox320 = await actionDockActive.boundingBox();
      expect(dockBox320).not.toBeNull();
      expect(dockBox320!.y + dockBox320!.height).toBeLessThanOrEqual(640);
      expect(dockBox320!.y).toBeGreaterThanOrEqual(0);

      // Validate collision-free layout between all 6 pods
      const boxes = [];
      for (let i = 0; i < 6; i++) {
        const box = await pods.nth(i).boundingBox();
        expect(box).not.toBeNull();
        boxes.push(box!);
      }
      for (let i = 0; i < 6; i++) {
        for (let j = i + 1; j < 6; j++) {
          const b1 = boxes[i];
          const b2 = boxes[j];
          const intersects = !(
            b1.x + b1.width <= b2.x ||
            b2.x + b2.width <= b1.x ||
            b1.y + b1.height <= b2.y ||
            b2.y + b2.height <= b1.y
          );
          expect(intersects).toBe(false);
        }
      }

      // Validate center content (pot & community cards) does not collide with pods
      const centerBox = await page.locator('.table-center-content').boundingBox();
      expect(centerBox).not.toBeNull();
      for (let i = 0; i < 6; i++) {
        const podBox = boxes[i];
        const centerIntersects = !(
          podBox.x + podBox.width <= centerBox!.x ||
          centerBox!.x + centerBox!.width <= podBox.x ||
          podBox.y + podBox.height <= centerBox!.y ||
          centerBox!.y + centerBox!.height <= podBox.y
        );
        expect(centerIntersects).toBe(false);
      }

      // Validate Top status bar does not collide with North pods
      const topBarBox = await page.locator('.table-top-status-bar').boundingBox();
      expect(topBarBox).not.toBeNull();
      const northPod = page.locator('.seat-pod.zone-north');
      const northBox = await northPod.boundingBox();
      if (northBox) {
        expect(topBarBox!.y + topBarBox!.height).toBeLessThanOrEqual(northBox.y);
      }

      // Capture 1: Standard mobile 390px (mesa-6p-390px.png)
      await page.setViewportSize({ width: 390, height: 844 });
      const scrollWidth390 = await page.evaluate(() => document.body.scrollWidth);
      expect(scrollWidth390).toBeLessThanOrEqual(390);
      await page.screenshot({
        path: `${SCRATCH_DIR}/mesa-6p-390px.png`,
        fullPage: false,
      });

      // Capture 2: Ultra-compact mobile 320px (mesa-6p-320px.png)
      await page.setViewportSize({ width: 320, height: 640 });
      const scrollWidth320 = await page.evaluate(() => document.body.scrollWidth);
      expect(scrollWidth320).toBeLessThanOrEqual(320);
      await page.screenshot({
        path: `${SCRATCH_DIR}/mesa-6p-320px.png`,
        fullPage: false,
      });

      // Capture 3: Desktop 1280px (mesa-6p-desktop.png)
      await page.setViewportSize({ width: 1280, height: 800 });
      const scrollWidthDesktop = await page.evaluate(() => document.body.scrollWidth);
      expect(scrollWidthDesktop).toBeLessThanOrEqual(1280);
      await page.screenshot({
        path: `${SCRATCH_DIR}/mesa-6p-desktop.png`,
        fullPage: false,
      });
    } finally {
      admin.disconnect();
      for (const g of guestSockets) g.socket.disconnect();
    }
  });

  test('renders 10-player full ring table without collisions at 390px (mesa-10p-390px.png)', async ({
    page,
    request,
  }) => {
    const createRes = await request.post('/api/rooms', {
      data: {
        hostName: 'Host10',
        config: {
          name: 'Mesa 10 Players',
          maxPlayers: 10,
          startingChips: 1000,
          smallBlind: 10,
          bigBlind: 20,
        },
      },
    });
    const hostReply = (await createRes.json()) as Reply<Admission>;
    if (!hostReply.ok) throw new Error(hostReply.error.message);
    const host = hostReply.data;

    const guestSockets: Socket<ServerEvents, ClientEvents>[] = [];

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

      const sendAdmin = async (input: CommandInput) => {
        const state = await new Promise<RoomState>((resolve, reject) =>
          admin.emit('room:sync', reply => (reply.ok ? resolve(reply.data) : reject(Error(reply.error.message)))),
        );
        const result = await new Promise<Reply<RoomState>>(resolve =>
          admin.emit('room:command', { ...input, commandId: randomUUID(), expectedRevision: state.revision }, resolve),
        );
        expect(result.ok).toBe(true);
      };

      // Host sits at seat 1
      await sendAdmin({ type: 'select-seat', seat: 1 });

      // 9 other players join
      for (let s = 2; s <= 10; s++) {
        const guestRes = await request.post(`/api/rooms/${host.room.code}/join`, {
          data: { name: `P${s}`, seat: s },
        });
        const guestReply = (await guestRes.json()) as Reply<Admission>;
        if (!guestReply.ok) throw new Error(guestReply.error.message);
        const guest = guestReply.data;

        const gSocket: Socket<ServerEvents, ClientEvents> = io('http://127.0.0.1:3100', {
          auth: { protocol: 1, credentials: guest.credentials },
          transports: ['websocket'],
          autoConnect: false,
        });

        await new Promise<void>((resolve, reject) => {
          gSocket.once('room:state', () => resolve());
          gSocket.once('connect_error', reject);
          gSocket.connect();
        });
        guestSockets.push(gSocket);
      }

      // Start game
      await sendAdmin({ type: 'start-game' });

      // Navigate page as host
      await page.addInitScript(
        ({ code, credentials }) => {
          localStorage.setItem(`poker-table.session.v1.${code}`, JSON.stringify(credentials));
        },
        { code: host.room.code, credentials: host.credentials },
      );
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto(`/room/${host.room.code}`);
      await expect(page.locator('.active-table')).toBeVisible();

      // Verify dense class is applied
      await expect(page.locator('.virtual-table-arena')).toHaveClass(/seats-dense/);

      // Verify all 10 pods rendered
      const pods = page.locator('.seat-pod');
      await expect(pods).toHaveCount(10);

      // Verify host is South
      const hostPod = pods.filter({ hasText: 'Host10' });
      await expect(hostPod).toHaveClass(/zone-south/);
      await expect(hostPod).toHaveClass(/pod-self/);

      // Verify no pairwise collisions between any of the 10 pods
      const boxes = [];
      for (let i = 0; i < 10; i++) {
        const box = await pods.nth(i).boundingBox();
        expect(box).not.toBeNull();
        boxes.push(box!);
      }
      for (let i = 0; i < 10; i++) {
        for (let j = i + 1; j < 10; j++) {
          const b1 = boxes[i];
          const b2 = boxes[j];
          const intersects = !(
            b1.x + b1.width <= b2.x ||
            b2.x + b2.width <= b1.x ||
            b1.y + b1.height <= b2.y ||
            b2.y + b2.height <= b1.y
          );
          expect(intersects).toBe(false);
        }
      }

      // Verify no horizontal scrolling
      const scrollWidth = await page.evaluate(() => document.body.scrollWidth);
      expect(scrollWidth).toBeLessThanOrEqual(390);

      // Capture screenshot mesa-10p-390px.png
      await page.screenshot({
        path: `${SCRATCH_DIR}/mesa-10p-390px.png`,
        fullPage: false,
      });
    } finally {
      admin.disconnect();
      for (const s of guestSockets) s.disconnect();
    }
  });
});
