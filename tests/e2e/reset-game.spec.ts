import { test, expect } from '@playwright/test';

test.describe('Game Reset / New Game (Reiniciar Partida)', () => {
  test('allows host to reset game after a settled hand, restoring starting chips across all devices', async ({
    page,
    browser,
  }) => {
    // 1. Host creates room
    await page.goto('/create');
    await page.getByPlaceholder('Poker de sábado').fill('Mesa Reset Test');
    await page.getByPlaceholder('Como devemos chamar você?').fill('Alice');
    await page.getByRole('button', { name: 'Criar mesa' }).click();

    await expect(page.locator('.table-heading h1')).toHaveText('Mesa Reset Test');
    const roomUrl = page.url();
    const codeMatch = roomUrl.match(/\/room\/([A-Z0-9]+)/);
    expect(codeMatch).not.toBeNull();
    const roomCode = codeMatch![1];

    // Host sits at seat 1
    await page.locator('.seat.empty').first().click();
    await expect(page.locator('.seat.mine')).toBeVisible();

    // 2. Guest connects in separate context
    const guestContext = await browser.newContext();
    const page2 = await guestContext.newPage();

    try {
      await page2.goto(`/join/${roomCode}`);
      await page2.getByLabel('Seu nome', { exact: true }).fill('Bob');
      await page2.getByRole('button', { name: 'Entrar na mesa' }).click();
      await expect(page2.locator('.table-heading h1')).toHaveText('Mesa Reset Test');

      // Bob sits at seat 2
      await page2.locator('.seat.empty').first().click();
      await expect(page2.locator('.seat.mine')).toBeVisible();

      // 3. Host starts game
      const startBtn = page.locator('.lobby-start-btn');
      await expect(startBtn).toBeVisible();
      await startBtn.click();

      // Both see active table
      await expect(page.locator('.active-table')).toBeVisible();
      await expect(page2.locator('.active-table')).toBeVisible();

      // In Heads-up preflop: Alice is SB/Dealer (posts 10), Bob is BB (posts 20)
      // Alice is first to act preflop. Alice folds.
      await page.locator('.action-btn-fold').click();
      const foldDialog = page.locator('dialog[open]');
      await expect(foldDialog).toBeVisible();
      await foldDialog.getByRole('button', { name: 'Desistir da mão' }).click();

      // Alice (host) sees fold settlement card
      const foldCard = page.locator('.host-settlement-controls.host-fold-settlement');
      await expect(foldCard).toBeVisible();
      const settleBtn = foldCard.locator('.settle-fold-btn');
      await expect(settleBtn).toBeVisible();
      await settleBtn.click();

      const confirmDialog = page.locator('dialog[open]');
      await expect(confirmDialog).toBeVisible();
      await confirmDialog.getByRole('button', { name: 'Confirmar Distribuição' }).click();

      // Hand is settled! Both players see settlement banner
      await expect(page.locator('.settlement-banner')).toBeVisible();
      await expect(page2.locator('.settlement-banner')).toBeVisible();

      // Host sees HostSettlementControls with both Next Hand and Reset Game
      const nextHandBtn = page.locator('.next-hand-btn');
      const resetBtn = page.locator('.reset-game-btn');
      await expect(nextHandBtn).toBeVisible();
      await expect(resetBtn).toBeVisible();
      await expect(resetBtn).toContainText('Nova Partida / Reiniciar Fichas');

      // Guest must NOT see host controls
      await expect(page2.locator('.host-settlement-controls')).toHaveCount(0);

      // 4. Host clicks Reset Game
      await resetBtn.click();

      // Confirm dialog opens
      const resetDialog = page.locator('dialog[open]');
      await expect(resetDialog).toBeVisible();
      await expect(resetDialog.locator('h2')).toContainText('Iniciar Nova Partida e Reiniciar Fichas?');
      await expect(resetDialog.locator('p')).toContainText('1.000');

      // Test cancel button first
      await resetDialog.getByRole('button', { name: 'Cancelar' }).click();
      await expect(page.locator('dialog[open]')).toHaveCount(0);
      await expect(page.locator('.settlement-banner')).toBeVisible();

      // Re-open and confirm
      await resetBtn.click();
      await expect(page.locator('dialog[open]')).toBeVisible();
      await page.locator('dialog[open]').getByRole('button', { name: 'Reiniciar Fichas' }).click();

      // Table transitions to Lobby preparation state, restoring starting chips and seats
      await expect(page.locator('.lobby-start-btn')).toBeVisible();
      await expect(page2.locator('.table-stats')).toBeVisible();

      // Host starts new game Hand 1
      await page.locator('.lobby-start-btn').click();

      // 5. Verification: Both Alice and Bob immediately receive the new active game
      await expect(page.locator('.active-table')).toBeVisible();
      await expect(page2.locator('.active-table')).toBeVisible();

      // Settlement banner is gone
      await expect(page.locator('.settlement-banner')).toHaveCount(0);
      await expect(page2.locator('.settlement-banner')).toHaveCount(0);

      // Street is Preflop
      await expect(page.locator('.street-badge')).toContainText('PRÉ-FLOP');
      await expect(page2.locator('.street-badge')).toContainText('PRÉ-FLOP');

      // Pot is 30 (SB 10 + BB 20)
      await expect(page.locator('.pot-value')).toContainText('30');
      await expect(page2.locator('.pot-value')).toContainText('30');

      // Alice (Host, seat 1, dealer/SB) has 990 chips (1000 - 10 SB)
      const alicePod = page.locator('.seat-pod').filter({ hasText: 'Alice' });
      await expect(alicePod.locator('.card-stack .chip-amount')).toContainText('990');

      // Bob (Guest, seat 2, BB) has 980 chips (1000 - 20 BB)
      const bobPod = page.locator('.seat-pod').filter({ hasText: 'Bob' });
      await expect(bobPod.locator('.card-stack .chip-amount')).toContainText('980');

      // Neither player has residual FOLD tag
      await expect(alicePod.locator('.action-tag.tag-fold')).toHaveCount(0);
      await expect(bobPod.locator('.action-tag.tag-fold')).toHaveCount(0);

      // Hand is playable: Alice can act in Hand 1 of the new game
      await expect(page.locator('.action-dock-active')).toBeVisible();
    } finally {
      await guestContext.close();
    }
  });

  test('restores eliminated player after game-complete when host resets game', async ({
    page,
    browser,
  }) => {
    // 1. Host creates room
    await page.goto('/create');
    await page.getByPlaceholder('Poker de sábado').fill('Mesa Torneio');
    await page.getByPlaceholder('Como devemos chamar você?').fill('Helena');
    await page.getByRole('button', { name: 'Criar mesa' }).click();
    await expect(page).toHaveURL(/\/room\/[A-Z0-9]+/);

    const roomUrl = page.url();
    const roomCode = roomUrl.match(/\/room\/([A-Z0-9]+)/)![1];

    // Helena sits at seat 1
    await page.locator('.seat.empty').first().click();

    // 2. Guest connects
    const guestContext = await browser.newContext();
    const page2 = await guestContext.newPage();

    try {
      await page2.goto(`/join/${roomCode}`);
      await page2.getByLabel('Seu nome', { exact: true }).fill('Rafael');
      await page2.getByRole('button', { name: 'Entrar na mesa' }).click();

      // Rafael sits at seat 2
      await page2.locator('.seat.empty').first().click();

      // 3. Host starts game
      await page.locator('.lobby-start-btn').click();
      await expect(page.locator('.active-table')).toBeVisible();
      await expect(page2.locator('.active-table')).toBeVisible();

      // Preflop: Helena goes All-in (1000), Rafael calls All-in (1000)
      await page.locator('.action-btn-allin').click();
      const helenaAllInDialog = page.locator('dialog[open]');
      await expect(helenaAllInDialog).toBeVisible();
      await helenaAllInDialog.getByRole('button', { name: 'Confirmar All-in' }).click();

      // Rafael pays all-in
      await expect(page2.locator('.action-btn-call')).toBeVisible();
      await page2.locator('.action-btn-call').click();
      const rafaelAllInDialog = page2.locator('dialog[open]');
      await expect(rafaelAllInDialog).toBeVisible();
      await rafaelAllInDialog.getByRole('button', { name: 'Confirmar All-in' }).click();

      // Both are all-in: hand enters showdown!
      await expect(page.locator('.host-showdown-panel')).toBeVisible();

      // Helena awards pot to herself (Helena)
      const helenaCandidate = page.locator('.candidate-winner-btn').filter({ hasText: 'Helena' });
      await helenaCandidate.click();
      await expect(helenaCandidate).toHaveClass(/candidate-selected/);

      // Confirm showdown settlement
      await page.locator('.settle-showdown-btn').click();
      await page.locator('dialog[open]').getByRole('button', { name: 'Confirmar Liquidação' }).click();

      // Game is COMPLETE!
      await expect(page.locator('.settlement-banner')).toContainText('Fim de Partida');
      await expect(page.locator('.winner-announcement')).toContainText('Helena venceu a partida!');
      await expect(page2.locator('.winner-announcement')).toContainText('Helena venceu a partida!');

      // Rafael is eliminated (0 chips)
      await expect(page2.locator('.my-seat-badge')).toContainText('Eliminado');

      // Helena sees game-complete host panel
      const completePanel = page.locator('.host-game-complete-panel');
      await expect(completePanel).toBeVisible();
      const resetBtn = completePanel.locator('.reset-game-btn');
      await expect(resetBtn).toBeVisible();
      await expect(resetBtn).toContainText('Nova Partida / Reiniciar Fichas');

      // 4. Helena resets the game
      await resetBtn.click();
      await expect(page.locator('dialog[open]')).toBeVisible();
      await page.locator('dialog[open]').getByRole('button', { name: 'Reiniciar Fichas' }).click();

      // Table transitions to Lobby with Rafael restored in seat 2
      await expect(page.locator('.lobby-start-btn')).toBeVisible();
      await expect(page2.locator('.table-stats')).toBeVisible();

      // Helena starts new game Hand 1
      await page.locator('.lobby-start-btn').click();

      // 5. Verification: Both players see fresh game with full chips
      await expect(page.locator('.active-table')).toBeVisible();
      await expect(page2.locator('.active-table')).toBeVisible();

      // Rafael is NO LONGER eliminated!
      await expect(page2.locator('.my-seat-badge')).not.toContainText('Eliminado');
      await expect(page2.locator('.my-stack-display')).toContainText('980'); // 1000 - 20 BB

      // Helena has 990 chips (1000 - 10 SB)
      await expect(page.locator('.my-stack-display')).toContainText('990');

      // No game-over or settlement banners visible
      await expect(page.locator('.winner-announcement')).toHaveCount(0);
      await expect(page2.locator('.winner-announcement')).toHaveCount(0);
    } finally {
      await guestContext.close();
    }
  });
});
