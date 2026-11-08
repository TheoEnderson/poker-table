import { test, expect } from '@playwright/test';

test.describe('Late Entry into Active Games (Entrada tardia de jogadores)', () => {
  test('allows late newcomer to join active hand, displays "Aguardando a próxima mão", and admits them to the next hand', async ({
    page,
    browser,
  }) => {
    // 1. Host (Alice) cria a sala
    await page.goto('/create');
    await page.getByPlaceholder('Poker de sábado').fill('Mesa Entrada Tardia');
    await page.getByPlaceholder('Como devemos chamar você?').fill('Alice');
    await page.getByRole('button', { name: 'Criar mesa' }).click();

    await expect(page.locator('.table-heading h1')).toHaveText('Mesa Entrada Tardia');
    const roomUrl = page.url();
    const roomCode = roomUrl.match(/\/room\/([A-Z0-9]+)/)![1];

    // Alice senta no assento 1
    await page.locator('.seat.empty').first().click();
    await expect(page.locator('.seat.mine')).toBeVisible();

    // 2. Convidado 1 (Bob) entra e senta no assento 2
    const bobContext = await browser.newContext();
    const pageBob = await bobContext.newPage();

    const charlieContext = await browser.newContext();
    const pageCharlie = await charlieContext.newPage();

    try {
      await pageBob.goto(`/join/${roomCode}`);
      await pageBob.getByLabel('Seu nome', { exact: true }).fill('Bob');
      await pageBob.getByRole('button', { name: 'Entrar na mesa' }).click();

      await pageBob.locator('.seat.empty').first().click();
      await expect(pageBob.locator('.seat.mine')).toBeVisible();

      // 3. Alice inicia a partida (Hand 1 com 2 jogadores)
      const startBtn = page.locator('.lobby-start-btn');
      await expect(startBtn).toBeVisible();
      await startBtn.click();

      // Alice e Bob estão na mesa ativa
      await expect(page.locator('.active-table')).toBeVisible();
      await expect(pageBob.locator('.active-table')).toBeVisible();

      // 4. Convidado 2 (Charlie) chega tardiamente com a partida em andamento
      await pageCharlie.goto(`/join/${roomCode}`);
      await expect(pageCharlie.locator('.room-preview')).toContainText('Mesa Entrada Tardia');
      await pageCharlie.getByLabel('Seu nome', { exact: true }).fill('Charlie');
      // Escolhe assento 3
      await pageCharlie.locator('select[name="seat"]').selectOption('3');
      await pageCharlie.getByRole('button', { name: 'Entrar na mesa' }).click();

      // Charlie entra na mesa ativa
      await expect(pageCharlie.locator('.active-table')).toBeVisible();

      // 5. Verificação da tela de Charlie (Recém-chegado aguardando próxima mão)
      // MyStatusPanel de Charlie exibe "Aguardando a próxima mão"
      const charlieStatusPanel = pageCharlie.locator('.my-status-panel');
      await expect(charlieStatusPanel).toBeVisible();
      await expect(charlieStatusPanel.locator('.my-status-title')).toContainText('AGUARDANDO A PRÓXIMA MÃO');
      await expect(charlieStatusPanel.locator('.my-seat-badge')).toContainText('Assento #3 · Aguardando');
      await expect(charlieStatusPanel.locator('[data-testid="waiting-next-hand"]')).toHaveText('Aguardando a próxima mão');

      // ActionDock de Charlie não possui botões de aposta nem slider
      await expect(pageCharlie.locator('.raise-control')).toHaveCount(0);
      await expect(pageCharlie.locator('.action-btn-fold')).toHaveCount(0);
      await expect(pageCharlie.locator('.action-btn-call')).toHaveCount(0);
      await expect(pageCharlie.locator('.action-btn-check')).toHaveCount(0);
      await expect(pageCharlie.locator('.pre-actions-dock')).toHaveCount(0);
      await expect(pageCharlie.locator('.future-action-dock')).toContainText('Aguardando a próxima mão para entrar na partida.');

      // Feltro virtual na visão de Charlie: seu assento (#3) está ancorado no Sul com badge Você e tag AGUARDANDO
      const charliePodOnCharlie = pageCharlie.locator('.seat-pod').filter({ hasText: 'Charlie' });
      await expect(charliePodOnCharlie).toBeVisible();
      await expect(charliePodOnCharlie).toHaveClass(/zone-south/);
      await expect(charliePodOnCharlie).toHaveClass(/pod-self/);
      await expect(charliePodOnCharlie.locator('.action-tag.tag-waiting')).toHaveText('AGUARDANDO');
      // Charlie não possui cartas de mão simbólicas
      await expect(charliePodOnCharlie.locator('.pod-hole-cards')).toHaveCount(0);

      // 6. Verificação na tela de Alice e Bob: Charlie é visível no assento 3 com AGUARDANDO
      const charliePodOnAlice = page.locator('.seat-pod').filter({ hasText: 'Charlie' });
      await expect(charliePodOnAlice).toBeVisible();
      await expect(charliePodOnAlice.locator('.action-tag.tag-waiting')).toHaveText('AGUARDANDO');

      // 7. A partida em andamento (Hand 1) continua sem interferência
      // Alice é a dealer / SB na Hand 1 e sua vez de agir está ativa
      await expect(page.locator('.turn-banner-self')).toBeVisible();

      // Alice desiste da mão (Fold)
      const foldBtn = page.locator('.action-btn-fold');
      await expect(foldBtn).toBeVisible();
      await foldBtn.click();

      // Diálogo de confirmação de Fold
      const foldDialog = page.locator('dialog[open]');
      await expect(foldDialog).toBeVisible();
      await foldDialog.getByRole('button', { name: 'Desistir da mão' }).click();

      // Hand 1 encerra por Fold -> Bob vence o pote
      const foldCard = page.locator('.host-settlement-controls.host-fold-settlement');
      await expect(foldCard).toBeVisible();
      const settleFoldBtn = foldCard.locator('.settle-fold-btn');
      await expect(settleFoldBtn).toBeVisible();
      await settleFoldBtn.click();

      const confirmDialog = page.locator('dialog[open]');
      await expect(confirmDialog).toBeVisible();
      await confirmDialog.getByRole('button', { name: 'Confirmar Distribuição' }).click();

      // Hand 1 fica liquidada (hand-settled). Alice vê o botão de Próxima Mão
      const nextHandBtn = page.locator('.next-hand-btn');
      await expect(nextHandBtn).toBeVisible();

      // 8. Alice clica em "Iniciar Próxima Mão"
      await nextHandBtn.click();

      // 9. Hand 2 é iniciada e agora Charlie está participando ativamente!
      // Na tela de Charlie: o indicador de espera desapareceu e seu status pessoal é atualizado
      await expect(pageCharlie.locator('[data-testid="waiting-next-hand"]')).toHaveCount(0);
      await expect(pageCharlie.locator('.my-status-panel .my-status-title')).toHaveText('SEU STACK');

      // Charlie agora tem cartas de mão simbólicas no seu pod
      await expect(charliePodOnCharlie.locator('.pod-hole-cards .symbolic-hole-card')).toHaveCount(2);
      // A tag AGUARDANDO desapareceu do pod de Charlie
      await expect(charliePodOnCharlie.locator('.action-tag.tag-waiting')).toHaveCount(0);

      // O jogo continua ativo com 3 jogadores
      await expect(page.locator('.seat-pod')).toHaveCount(3);
      await expect(pageBob.locator('.seat-pod')).toHaveCount(3);
      await expect(pageCharlie.locator('.seat-pod')).toHaveCount(3);
    } finally {
      await pageCharlie.close();
      await charlieContext.close();
      await pageBob.close();
      await bobContext.close();
    }
  });

  test('does not stall the next hand if a late newcomer disconnects before hand transition', async ({
    page,
    browser,
  }) => {
    // 1. Host (Alice) cria a sala
    await page.goto('/create');
    await page.getByPlaceholder('Poker de sábado').fill('Mesa Desconexao Tardia');
    await page.getByPlaceholder('Como devemos chamar você?').fill('Alice');
    await page.getByRole('button', { name: 'Criar mesa' }).click();

    await expect(page.locator('.table-heading h1')).toHaveText('Mesa Desconexao Tardia');
    const roomUrl = page.url();
    const roomCode = roomUrl.match(/\/room\/([A-Z0-9]+)/)![1];

    await page.locator('.seat.empty').first().click();

    // 2. Convidado 1 (Bob) entra
    const bobContext = await browser.newContext();
    const pageBob = await bobContext.newPage();

    const offlineContext = await browser.newContext();
    const pageOffline = await offlineContext.newPage();

    try {
      await pageBob.goto(`/join/${roomCode}`);
      await pageBob.getByLabel('Seu nome', { exact: true }).fill('Bob');
      await pageBob.getByRole('button', { name: 'Entrar na mesa' }).click();
      await pageBob.locator('.seat.empty').first().click();

      // Alice inicia a partida
      await page.locator('.lobby-start-btn').click();
      await expect(page.locator('.active-table')).toBeVisible();

      // 3. Convidado ausente (Dave) entra no assento 3
      await pageOffline.goto(`/join/${roomCode}`);
      await pageOffline.getByLabel('Seu nome', { exact: true }).fill('Dave');
      await pageOffline.locator('select[name="seat"]').selectOption('3');
      await pageOffline.getByRole('button', { name: 'Entrar na mesa' }).click();
      await expect(pageOffline.locator('.active-table')).toBeVisible();

      // Alice vê Dave entrar no assento 3
      const davePodOnAlice = page.locator('.seat-pod').filter({ hasText: 'Dave' });
      await expect(davePodOnAlice).toBeVisible();

      // Dave fecha a aba / desconecta antes da próxima mão
      await pageOffline.close();
      await offlineContext.close();

      // Alice vê Dave marcado como desconectado
      await expect(davePodOnAlice).toHaveClass(/pod-offline/);

      // Alice desiste da mão atual
      await page.locator('.action-btn-fold').click();
      const foldDialog = page.locator('dialog[open]');
      await expect(foldDialog).toBeVisible();
      await foldDialog.getByRole('button', { name: 'Desistir da mão' }).click();

      // Conclui liquidação
      const foldCard = page.locator('.host-settlement-controls.host-fold-settlement');
      await expect(foldCard).toBeVisible();
      const settleFoldBtn = foldCard.locator('.settle-fold-btn');
      await expect(settleFoldBtn).toBeVisible();
      await settleFoldBtn.click();

      const confirmDialog = page.locator('dialog[open]');
      await expect(confirmDialog).toBeVisible();
      await confirmDialog.getByRole('button', { name: 'Confirmar Distribuição' }).click();

      // Alice clica em Iniciar Próxima Mão
      const nextHandBtn = page.locator('.next-hand-btn');
      await expect(nextHandBtn).toBeVisible();
      await nextHandBtn.click();

      // Hand 2 é iniciada com sucesso sem travar a partida!
      // Alice e Bob continuam jogando a Hand 2
      await expect(page.locator('.active-table')).toBeVisible();
      await expect(pageBob.locator('.active-table')).toBeVisible();
      await expect(page.locator('.street-badge')).toContainText('PRÉ-FLOP');
    } finally {
      await pageBob.close();
      await bobContext.close();
    }
  });

  test('allows newcomer to join completed game (game-complete), displays clear game-over messaging, and participates after host resets game', async ({
    page,
    browser,
  }) => {
    // 1. Host cria mesa
    await page.goto('/create');
    await page.getByPlaceholder('Poker de sábado').fill('Mesa Torneio Fim');
    await page.getByPlaceholder('Como devemos chamar você?').fill('Helena');
    await page.getByRole('button', { name: 'Criar mesa' }).click();
    await expect(page).toHaveURL(/\/room\/[A-Z0-9]+/);

    const roomUrl = page.url();
    const roomCode = roomUrl.match(/\/room\/([A-Z0-9]+)/)![1];

    // Helena senta no assento 1
    await page.locator('.seat.empty').first().click();

    // 2. Convidado Rafael entra
    const guestContext = await browser.newContext();
    const pageRafael = await guestContext.newPage();

    // 3. Convidado Charlie (latecomer) entrará após game-complete
    const charlieContext = await browser.newContext();
    const pageCharlie = await charlieContext.newPage();

    try {
      await pageRafael.goto(`/join/${roomCode}`);
      await pageRafael.getByLabel('Seu nome', { exact: true }).fill('Rafael');
      await pageRafael.getByRole('button', { name: 'Entrar na mesa' }).click();
      await pageRafael.locator('.seat.empty').first().click();

      // Inicia a partida
      await page.locator('.lobby-start-btn').click();
      await expect(page.locator('.active-table')).toBeVisible();
      await expect(pageRafael.locator('.active-table')).toBeVisible();

      // Helena e Rafael vão all-in pré-flop
      await page.locator('.action-btn-allin').click();
      await page.locator('dialog[open]').getByRole('button', { name: 'Confirmar All-in' }).click();

      await expect(pageRafael.locator('.action-btn-call')).toBeVisible();
      await pageRafael.locator('.action-btn-call').click();
      await pageRafael.locator('dialog[open]').getByRole('button', { name: 'Confirmar All-in' }).click();

      // Showdown: Helena declara a si mesma como vencedora única
      await expect(page.locator('.host-showdown-panel')).toBeVisible();
      const helenaCandidate = page.locator('.candidate-winner-btn').filter({ hasText: 'Helena' });
      await helenaCandidate.click();
      await page.locator('.settle-showdown-btn').click();
      await page.locator('dialog[open]').getByRole('button', { name: 'Confirmar Liquidação' }).click();

      // A partida atinge game-complete!
      await expect(page.locator('.settlement-banner')).toContainText('Fim de Partida');
      await expect(page.locator('.winner-announcement')).toContainText('Helena venceu a partida!');

      // 4. Charlie entra na sala agora que a partida já está encerrada (game-complete)
      await pageCharlie.goto(`/join/${roomCode}`);
      await pageCharlie.getByLabel('Seu nome', { exact: true }).fill('Charlie');
      await pageCharlie.locator('select[name="seat"]').selectOption('3');
      await pageCharlie.getByRole('button', { name: 'Entrar na mesa' }).click();

      await expect(pageCharlie.locator('.active-table')).toBeVisible();

      // 5. Charlie entende claramente que a partida terminou:
      // Vê o banner com o campeão do torneio
      await expect(pageCharlie.locator('.settlement-banner')).toContainText('Fim de Partida');
      await expect(pageCharlie.locator('.winner-announcement')).toContainText('Helena venceu a partida!');

      // Não fica indefinidamente em "Aguardando a próxima mão"
      await expect(pageCharlie.locator('.state-waiting-next-hand')).toHaveCount(0);

      // Seu painel de status indica que aguarda uma nova partida
      await expect(pageCharlie.locator('[data-testid="waiting-reset-game"]')).toHaveText('Aguardando nova partida');
      await expect(pageCharlie.locator('.my-committed-tag')).toContainText('Entrará na nova partida com 1.000 fichas.');

      // O ActionDock orienta que a partida está concluída e aguarda nova partida
      await expect(pageCharlie.locator('.dock-message')).toContainText('Partida concluída. Aguarde o anfitrião iniciar uma nova partida');

      // 6. Helena utiliza reset-game para iniciar uma nova partida
      const resetBtn = page.locator('.host-game-complete-panel .reset-game-btn');
      await expect(resetBtn).toBeVisible();
      await resetBtn.click();
      await page.locator('dialog[open]').getByRole('button', { name: 'Reiniciar Fichas' }).click();

      // A sala retorna ao Lobby com os 3 participantes sentados (Helena, Rafael, Charlie)
      await expect(page.locator('.lobby-start-btn')).toBeVisible();
      await expect(pageCharlie.locator('.table-stats')).toBeVisible();
      await expect(pageRafael.locator('.table-stats')).toBeVisible();

      // 7. Helena inicia a nova partida
      await page.locator('.lobby-start-btn').click();

      // Os 3 jogadores entram na nova partida com fichas restauradas
      await expect(page.locator('.active-table')).toBeVisible();
      await expect(pageRafael.locator('.active-table')).toBeVisible();
      await expect(pageCharlie.locator('.active-table')).toBeVisible();

      // Charlie agora está jogando ativamente a Hand 1 da nova partida
      const charliePod = pageCharlie.locator('.seat-pod').filter({ hasText: 'Charlie' });
      await expect(charliePod.locator('.pod-hole-cards .symbolic-hole-card')).toHaveCount(2);
      await expect(pageCharlie.locator('.my-status-title')).toHaveText('SEU STACK');
    } finally {
      await pageCharlie.close();
      await charlieContext.close();
      await pageRafael.close();
      await guestContext.close();
    }
  });
});
