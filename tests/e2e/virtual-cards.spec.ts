import { test, expect } from '@playwright/test';

test.describe('Modo de Cartas Virtuais E2E', () => {
  test('cria mesa virtual, protege cartas fechadas, avança streets automaticamente e revela showdown em telas móveis', async ({
    page,
    browser,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/create');

    await page.getByPlaceholder('Poker de sábado').fill('Mesa Virtual E2E');
    await page.getByPlaceholder('Como devemos chamar você?').fill('Alice');
    await page.getByLabel('Modo de cartas').selectOption('virtual');
    await page.getByRole('button', { name: 'Criar mesa' }).click();

    await expect(page.locator('.table-heading h1')).toHaveText('Mesa Virtual E2E');
    await expect(page.locator('.table-panel .table-stats')).toContainText('Virtuais');

    const codeMatch = page.url().match(/\/room\/([A-Z0-9]+)/);
    expect(codeMatch).not.toBeNull();
    const roomCode = codeMatch![1]!;

    // Alice (host) senta no assento 1
    await page.locator('.seat.empty').first().click();
    await expect(page.locator('.seat.mine')).toBeVisible();

    const guestContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page2 = await guestContext.newPage();

    try {
      await page2.goto(`/join/${roomCode}`);
      await page2.getByLabel('Seu nome', { exact: true }).fill('Bruno');
      await page2.getByRole('button', { name: 'Entrar na mesa' }).click();

      // Bruno senta no assento 2
      await page2.locator('.seat.empty').first().click();
      await expect(page2.locator('.seat.mine')).toBeVisible();

      // Host inicia a partida
      await page.locator('.lobby-start-btn').click();
      await expect(page.locator('.active-table')).toBeVisible();
      await expect(page2.locator('.active-table')).toBeVisible();

      // Verifica selo de cartas virtuais e ausência de controles manuais de street
      await expect(page.getByTestId('virtual-deck-badge')).toHaveText('Cartas virtuais');
      await expect(page.locator('.host-street-controls')).toHaveCount(0);

      // Preflop: cada jogador vê apenas suas próprias 2 cartas fechadas
      await expect(page.getByTestId('my-hole-card-0')).toHaveClass(/playing-card-front/);
      await expect(page.getByTestId('my-hole-card-1')).toHaveClass(/playing-card-front/);
      await expect(page2.getByTestId('my-hole-card-0')).toHaveClass(/playing-card-front/);
      await expect(page2.getByTestId('my-hole-card-1')).toHaveClass(/playing-card-front/);

      const aliceCardsText = [
        await page.getByTestId('my-hole-card-0').getAttribute('aria-label'),
        await page.getByTestId('my-hole-card-1').getAttribute('aria-label'),
      ];
      const brunoCardsText = [
        await page2.getByTestId('my-hole-card-0').getAttribute('aria-label'),
        await page2.getByTestId('my-hole-card-1').getAttribute('aria-label'),
      ];
      expect(aliceCardsText[0]).toBeTruthy();
      expect(brunoCardsText[0]).toBeTruthy();

      // Durante a mão ativa, os assentos na mesa exibem versos de cartas e nenhuma carta frontal exposta
      await expect(page.locator('.seat-pod .pod-hole-cards-virtual .playing-card-front')).toHaveCount(0);
      await expect(page2.locator('.seat-pod .pod-hole-cards-virtual .playing-card-front')).toHaveCount(0);
      await expect(page.locator('.seat-pod .pod-hole-cards-virtual .playing-card-back')).toHaveCount(4);

      // Botão Ocultar/Mostrar cartas funciona com aria-pressed e alvo acessível
      const toggleBtn = page.getByTestId('toggle-hole-cards');
      await expect(toggleBtn).toHaveAttribute('aria-pressed', 'false');
      await toggleBtn.click();
      await expect(toggleBtn).toHaveAttribute('aria-pressed', 'true');
      await expect(page.getByTestId('my-hole-card-0')).toHaveClass(/playing-card-back/);
      await expect(page.getByTestId('my-hole-card-1')).toHaveClass(/playing-card-back/);
      await toggleBtn.click();
      await expect(toggleBtn).toHaveAttribute('aria-pressed', 'false');
      await expect(page.getByTestId('my-hole-card-0')).toHaveClass(/playing-card-front/);

      // Layout responsivo em 320px sem overflow horizontal
      await page.setViewportSize({ width: 320, height: 640 });
      const overflow320 = await page.evaluate(() => document.documentElement.scrollWidth);
      expect(overflow320).toBeLessThanOrEqual(320);

      // Avanço automático: Preflop -> Flop (3 cartas)
      await expect(page.locator('[data-testid^="board-card-"]')).toHaveCount(0);
      await page.locator('.action-btn-call').click();
      await page2.locator('.action-btn-check').click();
      await expect(page.locator('[data-testid^="board-card-"]')).toHaveCount(3);
      await expect(page2.locator('[data-testid^="board-card-"]')).toHaveCount(3);

      // Flop -> Turn (4 cartas)
      await page2.locator('.action-btn-check').click();
      await page.locator('.action-btn-check').click();
      await expect(page.locator('[data-testid^="board-card-"]')).toHaveCount(4);
      await expect(page2.locator('[data-testid^="board-card-"]')).toHaveCount(4);

      // Turn -> River (5 cartas)
      await page2.locator('.action-btn-check').click();
      await page.locator('.action-btn-check').click();
      await expect(page.locator('[data-testid^="board-card-"]')).toHaveCount(5);
      await expect(page2.locator('[data-testid^="board-card-"]')).toHaveCount(5);

      // River -> Showdown automático
      await page2.locator('.action-btn-check').click();
      await page.locator('.action-btn-check').click();

      await expect(page.locator('.settlement-banner')).toBeVisible();
      await expect(page2.locator('.settlement-banner')).toBeVisible();
      await expect(page.getByTestId('settlement-board')).toBeVisible();

      // Showdown revela as cartas dos finalistas e classificação da mão sem controles manuais de vencedor
      await expect(page.locator('.seat-pod .pod-hole-cards-virtual .playing-card-front')).toHaveCount(4);
      await expect(page2.locator('.seat-pod .pod-hole-cards-virtual .playing-card-front')).toHaveCount(4);
      await expect(page.getByTestId('my-hand-evaluation')).toBeVisible();
      await expect(page2.getByTestId('my-hand-evaluation')).toBeVisible();
      await expect(page.locator('.settle-showdown-btn')).toHaveCount(0);

      // Ainda sem overflow horizontal em 320px no showdown
      const showdownOverflow320 = await page.evaluate(() => document.documentElement.scrollWidth);
      expect(showdownOverflow320).toBeLessThanOrEqual(320);

      // Host pode iniciar a próxima mão diretamente (distribui novas cartas, zera o board)
      await page.locator('.next-hand-btn').click();
      await expect(page.locator('[data-testid^="board-card-"]')).toHaveCount(0);
      await expect(page.getByTestId('my-hole-card-0')).toHaveClass(/playing-card-front/);
      await expect(page.locator('.settlement-banner')).toHaveCount(0);
    } finally {
      await guestContext.close();
    }
  });
});
