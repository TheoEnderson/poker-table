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

      // Verifica selo de cartas virtuais na barra superior e ausência de controles manuais de street
      await expect(page.locator('.table-top-status-bar .table-status-meta [data-testid="virtual-deck-badge"]')).toHaveText('Cartas virtuais');
      await expect(page.locator('.table-center-content [data-testid="virtual-deck-badge"]')).toHaveCount(0);
      await expect(page.locator('.host-street-controls')).toHaveCount(0);

      // Preflop: cada jogador vê suas próprias 2 cartas viradas para cima no próprio assento (sem painel duplicado embaixo)
      await expect(page.getByTestId('my-hole-cards')).toHaveCount(0);
      await expect(page2.getByTestId('my-hole-cards')).toHaveCount(0);
      await expect(page.locator('.pod-self [data-testid="my-hole-card-0"]')).toHaveClass(/playing-card-front/);
      await expect(page.locator('.pod-self [data-testid="my-hole-card-1"]')).toHaveClass(/playing-card-front/);
      await expect(page2.locator('.pod-self [data-testid="my-hole-card-0"]')).toHaveClass(/playing-card-front/);
      await expect(page2.locator('.pod-self [data-testid="my-hole-card-1"]')).toHaveClass(/playing-card-front/);

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

      // Indicador ao vivo de combinação já exibe a força pré-flop (Par ou Carta Alta) no painel compacto
      await expect(page.getByTestId('my-virtual-hand-bar')).toBeVisible();
      await expect(page.getByTestId('my-hand-evaluation')).toHaveText(/^(Par|Carta Alta)$/);
      await expect(page2.getByTestId('my-hand-evaluation')).toHaveText(/^(Par|Carta Alta)$/);

      // Durante a mão ativa, apenas as 2 cartas do próprio jogador ficam visíveis na mesa; adversário exibe 2 versos
      await expect(page.locator('.seat-pod.pod-self .pod-hole-cards-virtual .playing-card-front')).toHaveCount(2);
      await expect(page.locator('.seat-pod:not(.pod-self) .pod-hole-cards-virtual .playing-card-front')).toHaveCount(0);
      await expect(page.locator('.seat-pod:not(.pod-self) .pod-hole-cards-virtual .playing-card-back')).toHaveCount(2);
      await expect(page2.locator('.seat-pod.pod-self .pod-hole-cards-virtual .playing-card-front')).toHaveCount(2);
      await expect(page2.locator('.seat-pod:not(.pod-self) .pod-hole-cards-virtual .playing-card-back')).toHaveCount(2);

      const assertSeatCardsAbovePodsAndClear = async () => {
        const topBar = await page.locator('.table-top-status-bar').boundingBox();
        const northPod = page.locator('.seat-pod.zone-north');
        const northCards = northPod.locator('.pod-hole-cards-virtual');
        const northPodBox = await northPod.boundingBox();
        const northCardsBox = await northCards.boundingBox();
        expect(topBar).not.toBeNull();
        expect(northPodBox).not.toBeNull();
        expect(northCardsBox).not.toBeNull();
        expect(northCardsBox!.y + northCardsBox!.height).toBeLessThanOrEqual(northPodBox!.y);
        expect(topBar!.y + topBar!.height).toBeLessThanOrEqual(northCardsBox!.y);

        const southWrapper = page.locator('.seat-pod-wrapper:has(.seat-pod.zone-south)');
        const southPod = southWrapper.locator('.seat-pod.zone-south');
        const southCards = southWrapper.locator('.pod-hole-cards-virtual');
        const southPodBox = await southPod.boundingBox();
        const southCardsBox = await southCards.boundingBox();
        expect(southPodBox).not.toBeNull();
        expect(southCardsBox).not.toBeNull();
        expect(southCardsBox!.y + southCardsBox!.height).toBeLessThanOrEqual(southPodBox!.y);

        const southBet = southWrapper.locator('.pod-bet-badge.zone-south');
        if ((await southBet.count()) > 0) {
          const southBetBox = await southBet.boundingBox();
          expect(southBetBox).not.toBeNull();
          expect(southBetBox!.y + southBetBox!.height).toBeLessThanOrEqual(southCardsBox!.y);
        }
      };

      // Mobile 390px: painel inferior compacto e cartas acima dos pods sem colisões
      await assertSeatCardsAbovePodsAndClear();
      const bodyBox390 = await page.locator('.my-status-body').boundingBox();
      const handBarBox390 = await page.getByTestId('my-virtual-hand-bar').boundingBox();
      expect(bodyBox390).not.toBeNull();
      expect(handBarBox390).not.toBeNull();
      expect(bodyBox390!.y + bodyBox390!.height).toBeLessThanOrEqual(handBarBox390!.y + 2);

      // Ocultar/Mostrar cartas pelo botão do painel E pelo toque direto nas cartas do próprio assento
      const toggleBtn = page.getByTestId('toggle-hole-cards');
      const seatCardsBtn = page.getByTestId('seat-self-hole-cards');
      await expect(toggleBtn).toHaveAttribute('aria-pressed', 'false');
      await expect(seatCardsBtn).toHaveAttribute('aria-pressed', 'false');

      await toggleBtn.click();
      await expect(toggleBtn).toHaveAttribute('aria-pressed', 'true');
      await expect(seatCardsBtn).toHaveAttribute('aria-pressed', 'true');
      await expect(page.getByTestId('my-hole-card-0')).toHaveClass(/playing-card-back/);
      await expect(page.getByTestId('my-hole-card-1')).toHaveClass(/playing-card-back/);
      await expect(page.getByTestId('my-hand-evaluation')).toHaveCount(0);
      await expect(page.getByTestId('my-hole-cards-hidden')).toBeVisible();

      // Tocar diretamente nas cartas do próprio assento revela novamente cartas e combinação
      await seatCardsBtn.click();
      await expect(toggleBtn).toHaveAttribute('aria-pressed', 'false');
      await expect(seatCardsBtn).toHaveAttribute('aria-pressed', 'false');
      await expect(page.getByTestId('my-hole-card-0')).toHaveClass(/playing-card-front/);
      await expect(page.getByTestId('my-hand-evaluation')).toBeVisible();

      // Desktop 1280x800: ActionDock em linha cheia horizontal e painel inferior compacto
      await page.setViewportSize({ width: 1280, height: 800 });
      const overflowDesktop = await page.evaluate(() => document.documentElement.scrollWidth);
      expect(overflowDesktop).toBeLessThanOrEqual(1280);
      await assertSeatCardsAbovePodsAndClear();

      const bodyBoxDesktop = await page.locator('.my-status-body').boundingBox();
      const handBarBoxDesktop = await page.getByTestId('my-virtual-hand-bar').boundingBox();
      expect(bodyBoxDesktop).not.toBeNull();
      expect(handBarBoxDesktop).not.toBeNull();
      expect(handBarBoxDesktop!.y).toBeGreaterThanOrEqual(bodyBoxDesktop!.y);

      const dockContentBox = await page.locator('.action-dock-active .action-dock-content').boundingBox();
      const actionButtons = page.locator('.action-dock-active .action-buttons-grid button');
      const actionBtnCount = await actionButtons.count();
      expect(actionBtnCount).toBeGreaterThanOrEqual(2);
      const firstBtnBox = await actionButtons.first().boundingBox();
      const lastBtnBox = await actionButtons.last().boundingBox();
      expect(dockContentBox).not.toBeNull();
      expect(firstBtnBox).not.toBeNull();
      expect(lastBtnBox).not.toBeNull();
      expect(Math.abs(lastBtnBox!.y - firstBtnBox!.y)).toBeLessThanOrEqual(2);
      expect(lastBtnBox!.x + lastBtnBox!.width).toBeGreaterThanOrEqual(dockContentBox!.x + dockContentBox!.width - 2);

      // Layout responsivo em 320px sem overflow horizontal e sem sobreposições
      await page.setViewportSize({ width: 320, height: 640 });
      const overflow320 = await page.evaluate(() => document.documentElement.scrollWidth);
      expect(overflow320).toBeLessThanOrEqual(320);
      await assertSeatCardsAbovePodsAndClear();

      // Avanço automático: Preflop -> Flop (3 cartas) com combinação ao vivo atualizada
      await expect(page.locator('[data-testid^="board-card-"]')).toHaveCount(0);
      await page.locator('.action-btn-call').click();
      await page2.locator('.action-btn-check').click();
      await expect(page.locator('[data-testid^="board-card-"]')).toHaveCount(3);
      await expect(page2.locator('[data-testid^="board-card-"]')).toHaveCount(3);
      await expect(page.getByTestId('my-hand-evaluation')).toBeVisible();
      await expect(page2.getByTestId('my-hand-evaluation')).toBeVisible();

      // Flop -> Turn (4 cartas)
      await page2.locator('.action-btn-check').click();
      await page.locator('.action-btn-check').click();
      await expect(page.locator('[data-testid^="board-card-"]')).toHaveCount(4);
      await expect(page2.locator('[data-testid^="board-card-"]')).toHaveCount(4);
      await expect(page.getByTestId('my-hand-evaluation')).toBeVisible();

      // Turn -> River (5 cartas)
      await page2.locator('.action-btn-check').click();
      await page.locator('.action-btn-check').click();
      await expect(page.locator('[data-testid^="board-card-"]')).toHaveCount(5);
      await expect(page2.locator('[data-testid^="board-card-"]')).toHaveCount(5);
      await expect(page.getByTestId('my-hand-evaluation')).toBeVisible();

      // River -> Showdown automático
      await page2.locator('.action-btn-check').click();
      await page.locator('.action-btn-check').click();

      await expect(page.locator('.settlement-banner')).toBeVisible();
      await expect(page2.locator('.settlement-banner')).toBeVisible();
      await expect(page.getByTestId('settlement-board')).toHaveCount(0);
      await expect(page.locator('[data-testid^="board-card-"]')).toHaveCount(5);

      // Showdown revela as cartas dos finalistas acima dos pods e classificação da mão sem controles manuais de vencedor
      await expect(page.locator('.seat-pod .pod-hole-cards-virtual .playing-card-front')).toHaveCount(4);
      await expect(page2.locator('.seat-pod .pod-hole-cards-virtual .playing-card-front')).toHaveCount(4);
      await assertSeatCardsAbovePodsAndClear();
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
