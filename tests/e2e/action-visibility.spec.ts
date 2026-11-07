import { test, expect } from '@playwright/test';

test.describe('Action Visibility & Player Turn Indicators (Etapa UX)', () => {
  test('synchronizes action tags, turn banners, narrative and history across multiple players and survives reload', async ({ page, browser }) => {
    // 1. Host creates room
    await page.goto('/create');
    await page.getByPlaceholder('Poker de sábado').fill('Mesa Visibilidade');
    await page.getByPlaceholder('Como devemos chamar você?').fill('Alice');
    await page.getByRole('button', { name: 'Criar mesa' }).click();

    await expect(page.locator('.table-heading h1')).toHaveText('Mesa Visibilidade');
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
      await expect(page2.locator('.table-heading h1')).toHaveText('Mesa Visibilidade');

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

      // In Heads-up preflop: Alice is SB/Dealer (posts 10) and is first to act. Bob is BB (posts 20).
      // Check Alice's view:
      // Alice's card (#1) must show 'SUA VEZ' (.tag-turn-self)
      const aliceCardOnAlice = page.locator('.player-card').filter({ hasText: 'Alice' });
      await expect(aliceCardOnAlice.locator('.tag-turn-self')).toHaveText('SUA VEZ');

      // Bob's card (#2) on Alice's view must show 'BB 20' and NEVER 'SUA VEZ'
      const bobCardOnAlice = page.locator('.player-card').filter({ hasText: 'Bob' });
      await expect(bobCardOnAlice.locator('.tag-blind')).toHaveText('BB 20');
      await expect(bobCardOnAlice.locator('.tag-turn-self')).toHaveCount(0);

      // Check Bob's view:
      // Alice's card (#1) on Bob's view must show 'AGINDO...' (.tag-turn) and NEVER 'SUA VEZ'
      const aliceCardOnBob = page2.locator('.player-card').filter({ hasText: 'Alice' });
      await expect(aliceCardOnBob.locator('.action-tag.tag-turn')).toHaveText('AGINDO...');
      await expect(aliceCardOnBob.locator('.tag-turn-self')).toHaveCount(0);

      // Bob's card (#2) on Bob's view must show 'BB 20'
      const bobCardOnBob = page2.locator('.player-card').filter({ hasText: 'Bob' });
      await expect(bobCardOnBob.locator('.tag-blind')).toHaveText('BB 20');

      // Pot summary turn banner:
      await expect(page.locator('.turn-banner-self')).toContainText('É a sua vez de agir!');
      await expect(page2.locator('.turn-banner')).toContainText('Vez de Alice (Assento #1)');

      // MyStatusPanel:
      await expect(page.locator('.my-status-panel .state-turn-self')).toHaveText('Sua vez');
      await expect(page2.locator('.my-status-panel .state-waiting')).toContainText('Aguardando Alice');

      // 4. Alice opens RaiseControl and raises to 60 (+50)
      const dock = page.locator('.action-dock-active');
      await dock.locator('.action-btn-raise').click();
      const raiseCtrl = page.locator('.raise-control');
      await expect(raiseCtrl).toBeVisible();
      await raiseCtrl.locator('.raise-input').fill('60');
      await raiseCtrl.locator('.raise-btn-confirm').click();

      // Now it's Bob's turn!
      // In Bob's view:
      // Bob's card shows 'SUA VEZ'
      await expect(bobCardOnBob.locator('.tag-turn-self')).toHaveText('SUA VEZ');
      // Alice's card shows 'RAISE para 60' (+50)
      await expect(aliceCardOnBob.locator('.tag-raise')).toContainText('RAISE para 60');
      await expect(aliceCardOnBob.locator('.tag-raise')).toContainText('+50');

      // Bob's turn banner and MyStatusPanel:
      await expect(page2.locator('.turn-banner-self')).toContainText('É a sua vez de agir!');
      await expect(page2.locator('.my-status-panel .state-turn-self')).toHaveText('Sua vez');
      await expect(page2.locator('.my-call-needed-tag')).toHaveText('Para igualar: 40');

      // Last action bar shows narrative on both screens:
      await expect(page.locator('.last-action-bar')).toContainText('Alice aumentou para 60 (+50)');
      await expect(page2.locator('.last-action-bar')).toContainText('Alice aumentou para 60 (+50)');

      // 5. Expandable History:
      const historyDetails = page2.locator('.hand-history-details');
      await expect(historyDetails).toBeVisible();
      await historyDetails.locator('.hand-history-summary').click();
      await expect(historyDetails.locator('.history-action-item')).toHaveCount(3);
      await expect(historyDetails).toContainText('Alice aumentou para 60 (+50)');

      // 6. Page reload test: Bob reloads the page
      await page2.reload();
      await expect(page2.locator('.active-table')).toBeVisible();

      const bobCardOnBobAfterReload = page2.locator('.player-card').filter({ hasText: 'Bob' });
      const aliceCardOnBobAfterReload = page2.locator('.player-card').filter({ hasText: 'Alice' });

      // Verifies state restoration after reload
      await expect(bobCardOnBobAfterReload.locator('.tag-turn-self')).toHaveText('SUA VEZ');
      await expect(aliceCardOnBobAfterReload.locator('.tag-raise')).toContainText('RAISE para 60');
      await expect(page2.locator('.my-call-needed-tag')).toHaveText('Para igualar: 40');
      await expect(page2.locator('.last-action-bar')).toContainText('Alice aumentou para 60 (+50)');

      // 7. Bob calls (+40)
      await page2.locator('.action-btn-call').click();

      // Street is complete!
      // In Alice's view, Bob's card shows 'CALL +40'
      await expect(bobCardOnAlice.locator('.tag-call')).toHaveText('CALL +40');
      await expect(page.locator('.last-action-bar')).toContainText('Bob pagou 40');

      // 8. Advance to Flop
      await page.locator('.host-street-controls .host-advance-btn').click();
      await page.locator('dialog[open]').getByRole('button', { name: 'Confirmar Flop' }).click();
      await expect(page.getByText('FLOP', { exact: true })).toBeVisible();
      await expect(page2.getByText('FLOP', { exact: true })).toBeVisible();

      // On Flop: Post-flop actions reset!
      // Bob is first to act post-flop (seat 2, out of position).
      // Bob's card on Bob's view shows 'SUA VEZ'.
      await expect(bobCardOnBobAfterReload.locator('.tag-turn-self')).toHaveText('SUA VEZ');
      // Alice's card on Bob's view shows 'NA MÃO' (NOT the preflop raise!)
      await expect(aliceCardOnBobAfterReload.locator('.tag-active')).toHaveText('NA MÃO');
      await expect(aliceCardOnBobAfterReload.locator('.tag-raise')).toHaveCount(0);

      // Hand history on both shows 'Pré-flop' group with 4 actions:
      await expect(page.locator('.history-group-title')).toContainText('Pré-flop');
    } finally {
      await guestContext.close();
    }
  });

  test('handles fold and all-in states with no horizontal overflow at 320px viewport', async ({ page, browser }) => {
    await page.setViewportSize({ width: 320, height: 600 });

    // Host creates room
    await page.goto('/create');
    await page.getByPlaceholder('Poker de sábado').fill('Mesa Compacta');
    await page.getByPlaceholder('Como devemos chamar você?').fill('Carlos');
    await page.getByRole('button', { name: 'Criar mesa' }).click();

    await expect(page.locator('.table-heading h1')).toHaveText('Mesa Compacta');
    const roomUrl = page.url();
    const codeMatch = roomUrl.match(/\/room\/([A-Z0-9]+)/);
    expect(codeMatch).not.toBeNull();
    const roomCode = codeMatch![1];

    await page.locator('.seat.empty').first().click();
    await expect(page.locator('.seat.mine')).toBeVisible();

    // Guest connects with 320px viewport
    const guestContext = await browser.newContext({ viewport: { width: 320, height: 600 } });
    const page2 = await guestContext.newPage();
    try {
      await page2.goto(`/join/${roomCode}`);
      await page2.getByLabel('Seu nome', { exact: true }).fill('Daniela');
      await page2.getByRole('button', { name: 'Entrar na mesa' }).click();

      await page2.locator('.seat.empty').first().click();
      await expect(page2.locator('.seat.mine')).toBeVisible();

      // Host starts game
      await page.locator('.lobby-start-btn').click();
      await expect(page.locator('.active-table')).toBeVisible();
      await expect(page2.locator('.active-table')).toBeVisible();

      // Check horizontal overflow on mobile 320px
      const bodyWidthHost = await page.evaluate(() => document.body.scrollWidth);
      expect(bodyWidthHost).toBeLessThanOrEqual(320);

      const bodyWidthGuest = await page2.evaluate(() => document.body.scrollWidth);
      expect(bodyWidthGuest).toBeLessThanOrEqual(320);

      // Carlos (SB) folds
      await page.locator('.action-btn-fold').click();
      await page.locator('dialog[open]').getByRole('button', { name: 'Desistir da mão' }).click();

      // Carlos card shows FOLD
      const carlosCardOnGuest = page2.locator('.player-card').filter({ hasText: 'Carlos' });
      await expect(carlosCardOnGuest.locator('.tag-fold')).toHaveText('FOLD');
      await expect(page2.locator('.last-action-bar')).toContainText('Carlos deu fold');

      // Hand ended by fold
      await expect(page2.getByText('MÃO ENCERRADA', { exact: true })).toBeVisible();

      // Expand history on 320px and verify overflow
      const details = page2.locator('.hand-history-details');
      await details.locator('.hand-history-summary').click();
      const openBodyWidth = await page2.evaluate(() => document.body.scrollWidth);
      expect(openBodyWidth).toBeLessThanOrEqual(320);
    } finally {
      await guestContext.close();
    }
  });
});
