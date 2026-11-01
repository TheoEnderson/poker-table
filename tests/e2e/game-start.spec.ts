import { test, expect } from '@playwright/test';
import { io, type Socket } from 'socket.io-client';
import { randomUUID } from 'node:crypto';
import type { Admission, ClientEvents, CommandInput, Reply, RoomState, ServerEvents } from '@poker-table/protocol';

test('the existing mobile screen accepts a started game and preserves locked seats after reload', async ({ page, request }) => {
  const created = await request.post('/api/rooms', { data: {
    hostName: 'Ana', config: { name: 'Mão inicial', maxPlayers: 6, startingChips: 1000, smallBlind: 10, bigBlind: 20 },
  } });
  const hostReply = await created.json() as Reply<Admission>;
  if (!hostReply.ok) throw new Error(hostReply.error.message);
  const host = hostReply.data;
  const joined = await request.post(`/api/rooms/${host.room.code}/join`, { data: { name: 'Bia', seat: 5 } });
  const guestReply = await joined.json() as Reply<Admission>;
  if (!guestReply.ok) throw new Error(guestReply.error.message);
  const guest = guestReply.data;
  await page.addInitScript(({ code, credentials }) => {
    localStorage.setItem(`poker-table.session.v1.${code}`, JSON.stringify(credentials));
  }, { code: host.room.code, credentials: guest.credentials });
  await page.goto(`/room/${host.room.code}`);
  await expect(page.getByText('Conectado · mesa sincronizada')).toBeVisible();
  const admin: Socket<ServerEvents, ClientEvents> = io('http://127.0.0.1:3100', {
    auth: { protocol: 1, credentials: host.credentials }, transports: ['websocket'], autoConnect: false,
  });
  try {
    await new Promise<void>((resolve, reject) => {
      admin.once('room:state', () => resolve()); admin.once('connect_error', reject); admin.connect();
    });
    const send = async (input: CommandInput) => {
      const state = await new Promise<RoomState>((resolve, reject) => admin.emit('room:sync', reply => reply.ok ? resolve(reply.data) : reject(Error(reply.error.message))));
      const result = await new Promise<Reply<RoomState>>(resolve => admin.emit('room:command', {
        ...input, commandId: randomUUID(), expectedRevision: state.revision,
      }, resolve));
      expect(result.ok).toBe(true);
    };
    await send({ type: 'select-seat', seat: 2 });
    await send({ type: 'start-game' });
    for (let attempt = 0; attempt < 2; attempt++) {
      if (attempt) await page.reload();
      await expect(page.getByLabel('Mesa de jogo ativa')).toBeVisible();
      // Expand secondary panel to verify preserved seat management
      await page.locator('details.table-secondary-panel summary').click();
      await expect(page.getByRole('button', { name: 'Posição 5, Bia, você, conectado', exact: true })).toBeDisabled();
      await expect(page.getByRole('button', { name: 'Posição 1, disponível', exact: true })).toBeDisabled();
      // Inactive control hidden when game started (Etapa 4B UX refinement)
      await expect(page.getByRole('button', { name: 'Liberar minha posição', exact: true })).not.toBeVisible();
      await expect(page.getByRole('button', { name: 'Sair definitivamente', exact: true })).toBeDisabled();
      await expect(page.getByRole('button', { name: 'Salvar nome', exact: true })).toBeEnabled();
      await expect(page.getByRole('alert')).toHaveCount(0);
    }
  } finally { admin.disconnect(); }
});
