import { test, expect, type BrowserContext, type Page } from '@playwright/test';

async function createRoom(page: Page, maxPlayers = '10') {
  await page.goto('/');
  await page.getByRole('link', { name: 'Criar mesa' }).click();
  await page.getByLabel('Nome da mesa').fill('Mesa de sábado');
  await page.getByLabel('Seu nome', { exact: true }).fill('Ana');
  await page.getByLabel('Máximo de participantes').selectOption(maxPlayers);
  await page.getByRole('button', { name: 'Criar mesa', exact: true }).click();
  await expect(page).toHaveURL(/\/room\/[A-Z2-9]{6}$/);
  await expect(page.getByText('Conectado · mesa sincronizada')).toBeVisible();
  return page.url().split('/').at(-1)!;
}
async function noExternal(context: BrowserContext) {
  const external: string[] = [];
  await context.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.hostname !== '127.0.0.1') { external.push(url.origin); await route.abort(); }
    else await route.continue();
  });
  context.on('page', p => p.on('websocket', ws => { if (new URL(ws.url()).hostname !== '127.0.0.1') external.push(ws.url()); }));
  return external;
}

test('two browsers create, join, synchronize, rename and recover a seat without external resources', async ({ browser, context, page }) => {
  const external = await noExternal(context);
  // Exercise HTTP LAN fallback: randomUUID is normally absent outside localhost.
  await context.addInitScript(() => Object.defineProperty(crypto, 'randomUUID', { value: undefined }));
  const code = await createRoom(page);
  await page.getByRole('button', { name: 'Posição 1, disponível', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Posição 1, Ana, você, conectado', exact: true })).toBeVisible();
  const guest = await browser.newContext({ baseURL: 'http://127.0.0.1:3100', viewport: { width: 320, height: 740 } });
  const guestExternal = await noExternal(guest), other = await guest.newPage();
  try {
    await other.goto(`/join/${code}`);
    await other.getByLabel('Seu nome', { exact: true }).fill('Bia');
    await expect(other.getByLabel('Posição', { exact: true })).toBeVisible();
    await other.getByLabel('Posição', { exact: true }).selectOption('2');
    await other.getByRole('button', { name: 'Entrar na mesa', exact: true }).click();
    await expect(other.getByText('Conectado · mesa sincronizada')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Posição 2, Bia, conectado', exact: true })).toBeVisible();
    await expect(other.getByRole('button', { name: 'Posição 1, Ana, conectado', exact: true })).toBeDisabled();
    await other.getByLabel('Seu nome', { exact: true }).fill('Beatriz');
    await other.getByRole('button', { name: 'Salvar nome' }).click();
    await expect(page.getByRole('button', { name: 'Posição 2, Beatriz, conectado', exact: true })).toBeVisible();
    await other.reload();
    await expect(other.getByRole('button', { name: 'Posição 2, Beatriz, você, conectado', exact: true })).toBeVisible();
    await guest.setOffline(true);
    await expect(other.getByText('Reconectando… seu lugar está reservado.')).toBeVisible({ timeout: 25000 });
    await guest.setOffline(false);
    await expect(other.getByText('Conectado · mesa sincronizada')).toBeVisible({ timeout: 10000 });
    await expect(other.getByRole('button', { name: 'Posição 2, Beatriz, você, conectado', exact: true })).toBeVisible();
    await expect(page.getByAltText(`QR Code para entrar na mesa ${code}`)).toBeVisible();
    const link = await page.getByLabel('Link de convite', { exact: true }).inputValue();
    expect(link).toMatch(new RegExp(`^http://(?:\\d{1,3}\\.){3}\\d{1,3}:3100/join/${code}$`));
    expect(link).not.toContain('127.0.0.1');
    await expect(other.locator('body')).toHaveJSProperty('scrollWidth', 320);
    await other.getByRole('button', { name: 'Sair definitivamente', exact: true }).click();
    await expect(other.getByRole('dialog')).toBeVisible();
    await other.getByRole('button', { name: 'Confirmar', exact: true }).click();
    await expect(other).toHaveURL('/');
    await expect(page.getByRole('button', { name: 'Posição 2, disponível', exact: true })).toBeVisible();
    expect([...external, ...guestExternal]).toEqual([]);
  } finally { await guest.close(); }
});

test('small-screen form validation, persisted host session and accessible confirmation', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 740 });
  await page.goto('/create');
  await page.getByLabel('Nome da mesa').fill('Mesa pequena');
  await page.getByLabel('Seu nome', { exact: true }).fill('Host');
  await page.getByLabel('Small blind').fill('50');
  await page.getByRole('button', { name: 'Criar mesa', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('big blind');
  await page.getByLabel('Big blind').fill('100');
  await page.getByRole('button', { name: 'Criar mesa', exact: true }).click();
  await expect(page.getByText('Conectado · mesa sincronizada')).toBeVisible();
  await page.reload();
  await expect(page.getByText('Conectado · mesa sincronizada')).toBeVisible();
  await page.getByRole('button', { name: 'Encerrar mesa', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Cancelar', exact: true })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await page.getByRole('button', { name: 'Encerrar mesa', exact: true }).click();
  await page.getByRole('button', { name: 'Confirmar', exact: true }).click();
  await expect(page).toHaveURL('/');
});
