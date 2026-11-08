import { test, expect } from '@playwright/test';

test.describe('Participant Management by Host in Lobby (Gerenciamento de participantes)', () => {
  test('allows host to remove a connected guest, freeing seat and updating both browsers in real time', async ({
    page,
    browser,
  }) => {
    // 1. Host (Alice) creates room
    await page.goto('/create');
    await page.getByPlaceholder('Poker de sábado').fill('Mesa Gestao');
    await page.getByPlaceholder('Como devemos chamar você?').fill('Alice');
    await page.getByRole('button', { name: 'Criar mesa' }).click();

    await expect(page.locator('.table-heading h1')).toHaveText('Mesa Gestao');
    const roomUrl = page.url();
    const roomCode = roomUrl.match(/\/room\/([A-Z0-9]+)/)![1];

    // Host sits at seat 1
    await page.locator('.seat.empty').first().click();
    await expect(page.locator('.seat.mine')).toBeVisible();

    // 2. Guest (Bob) connects in separate browser context
    const guestContext = await browser.newContext();
    const page2 = await guestContext.newPage();

    try {
      await page2.goto(`/join/${roomCode}`);
      await page2.getByLabel('Seu nome', { exact: true }).fill('Bob');
      await page2.getByRole('button', { name: 'Entrar na mesa' }).click();

      // Bob sits at seat 2
      await page2.locator('.seat.empty').first().click();
      await expect(page2.locator('.seat.mine')).toBeVisible();

      // 3. Verify Host sees HostParticipantsManager panel
      const hostPanel = page.locator('.host-participants-panel');
      await expect(hostPanel).toBeVisible();
      await expect(hostPanel.locator('h2')).toContainText('Participantes');
      await expect(hostPanel.locator('.count-badge')).toContainText('2');

      // Alice has no remove button for self
      const aliceItem = hostPanel.locator('.host-participant-item').filter({ hasText: 'Alice' });
      await expect(aliceItem.locator('.remove-participant-btn')).toHaveCount(0);
      await expect(aliceItem.locator('.host-protected-label')).toContainText('Você');

      // Bob has remove button, seat #2, and online status
      const bobItem = hostPanel.locator('.host-participant-item').filter({ hasText: 'Bob' });
      await expect(bobItem.locator('.participant-seat')).toContainText('Assento #2');
      await expect(bobItem.locator('.participant-status')).toContainText('Conectado');
      const removeBtn = bobItem.locator('.remove-participant-btn');
      await expect(removeBtn).toBeVisible();

      // 4. Verify Guest (Bob) does NOT see HostParticipantsManager panel
      await expect(page2.locator('.host-participants-panel')).toHaveCount(0);

      // 5. Host clicks Remove -> tests cancellation first
      await removeBtn.click();
      const confirmDialog = page.locator('dialog[open]');
      await expect(confirmDialog).toBeVisible();
      await expect(confirmDialog.locator('h2')).toContainText('Remover Bob?');
      await expect(confirmDialog.locator('p')).toContainText(
        'Remover Bob da sala? O assento será liberado e o jogador precisará entrar novamente para participar.',
      );

      // Cancel
      await confirmDialog.getByRole('button', { name: 'Cancelar' }).click();
      await expect(page.locator('dialog[open]')).toHaveCount(0);
      expect(await page.locator('.seat.occupied').count()).toBe(2);

      // Re-open and confirm removal
      await removeBtn.click();
      await expect(page.locator('dialog[open]')).toBeVisible();
      await page.locator('dialog[open]').getByRole('button', { name: 'Remover jogador' }).click();

      // 6. Host verification: Bob is removed, seat 2 is empty, count drops to 1
      await expect(hostPanel.locator('.host-participant-item').filter({ hasText: 'Bob' })).toHaveCount(0);
      await expect(hostPanel.locator('.count-badge')).toContainText('1');
      await expect(page.locator('.seat[data-seat="2"]')).toHaveClass(/empty/);

      // 7. Bob's verification: Immediately shows session ended screen
      await expect(page2.locator('.session-ended-page')).toBeVisible();
      await expect(page2.locator('.session-ended-page h1')).toContainText('Sessão encerrada');
      await expect(page2.locator('.error')).toContainText('Você foi removido da sala pelo anfitrião.');

      // 8. Another guest (Charlie) can now take the freed seat 2
      const charlieContext = await browser.newContext();
      const page3 = await charlieContext.newPage();
      try {
        await page3.goto(`/join/${roomCode}`);
        await page3.getByLabel('Seu nome', { exact: true }).fill('Charlie');
        await page3.getByRole('button', { name: 'Entrar na mesa' }).click();

        // Charlie sits at seat 2
        await page3.locator('.seat[data-seat="2"]').click();
        await expect(page3.locator('.seat.mine')).toContainText('Charlie');

        // Alice sees Charlie at seat 2
        await expect(hostPanel.locator('.host-participant-item').filter({ hasText: 'Charlie' })).toBeVisible();
      } finally {
        await charlieContext.close();
      }

      // 9. Bob can re-enter legitimately through the join flow
      await page2.getByRole('link', { name: 'Entrar novamente na mesa' }).click();
      await expect(page2).toHaveURL(new RegExp(`/join/${roomCode}`));
      await page2.getByLabel('Seu nome', { exact: true }).fill('Bob Retorna');
      await page2.getByRole('button', { name: 'Entrar na mesa' }).click();

      // Bob Retorna can now choose seat 3
      await page2.locator('.seat[data-seat="3"]').click();
      await expect(page2.locator('.seat.mine')).toContainText('Bob Retorna');
    } finally {
      await guestContext.close();
    }
  });

  test('allows host to remove a disconnected guest, unblocking the game start', async ({
    page,
    browser,
  }) => {
    // 1. Host creates room
    await page.goto('/create');
    await page.getByPlaceholder('Poker de sábado').fill('Mesa Desconexao');
    await page.getByPlaceholder('Como devemos chamar você?').fill('Helena');
    await page.getByRole('button', { name: 'Criar mesa' }).click();
    await expect(page.locator('.table-heading h1')).toHaveText('Mesa Desconexao');

    const roomUrl = page.url();
    const roomCode = roomUrl.match(/\/room\/([A-Z0-9]+)/)![1];

    // Helena sits at seat 1
    await page.locator('.seat.empty').first().click();

    // 2. Guests Bob and Carlos join
    const guestContext1 = await browser.newContext();
    const guestContext2 = await browser.newContext();
    const pageBob = await guestContext1.newPage();
    const pageCarlos = await guestContext2.newPage();

    try {
      await pageBob.goto(`/join/${roomCode}`);
      await pageBob.getByLabel('Seu nome', { exact: true }).fill('Bob');
      await pageBob.getByRole('button', { name: 'Entrar na mesa' }).click();
      await pageBob.locator('.seat.empty').first().click(); // seat 2

      await pageCarlos.goto(`/join/${roomCode}`);
      await pageCarlos.getByLabel('Seu nome', { exact: true }).fill('Carlos');
      await pageCarlos.getByRole('button', { name: 'Entrar na mesa' }).click();
      await pageCarlos.locator('.seat.empty').first().click(); // seat 3

      // 3. Bob closes browser / disconnects
      await guestContext1.close();

      // Helena sees Bob as disconnected with visual highlight
      const hostPanel = page.locator('.host-participants-panel');
      const bobItem = hostPanel.locator('.host-participant-item').filter({ hasText: 'Bob' });
      await expect(bobItem).toHaveClass(/participant-disconnected/);
      await expect(bobItem.locator('.participant-status')).toContainText('Desconectado');

      // Helena's start button is blocked because Bob is disconnected
      await expect(page.locator('.lobby-start-hint')).toContainText(
        'Aguardando todos os participantes sentados se conectarem.',
      );
      await expect(page.locator('.lobby-start-btn')).toHaveCount(0);

      // 4. Helena removes disconnected Bob
      await bobItem.locator('.remove-participant-btn').click();
      await page.locator('dialog[open]').getByRole('button', { name: 'Remover jogador' }).click();

      // 5. Verification: Bob is removed, seat 2 is freed, and start button is now enabled for Helena and Carlos!
      await expect(hostPanel.locator('.host-participant-item').filter({ hasText: 'Bob' })).toHaveCount(0);
      await expect(page.locator('.seat[data-seat="2"]')).toHaveClass(/empty/);

      // Game can now start with Helena and Carlos!
      const startBtn = page.locator('.lobby-start-btn');
      await expect(startBtn).toBeVisible();
      await startBtn.click();

      // Hand 1 starts successfully
      await expect(page.locator('.active-table')).toBeVisible();
      await expect(pageCarlos.locator('.active-table')).toBeVisible();
    } finally {
      await guestContext2.close();
    }
  });
});
