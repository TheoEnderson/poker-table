import { test, expect } from '@playwright/test';
import type { Admission, Reply } from '@poker-table/protocol';

test.describe('Progressive Blinds E2E (Blinds Progressivos)', () => {
  test('allows host to configure progressive blinds in creation screen and synchronizes levels across players in real-time', async ({
    page,
    browser,
    request,
  }) => {
    // 1. Criar sala pela interface de criação com blinds progressivos por mãos
    await page.goto('/create');
    await expect(page.getByRole('heading', { name: 'Prepare sua mesa.' })).toBeVisible();

    await page.getByLabel('Seu nome').fill('Anfitrião');
    await page.getByLabel('Nome da mesa').fill('Torneio Progressivo');

    // Seleciona tipo de blinds: Progressão por Mãos
    await page.getByLabel('Estrutura de Blinds').selectOption('hands');

    // Define 1 mão por nível para transição imediata no teste
    const handsInput = page.getByLabel('Mãos por nível');
    await expect(handsInput).toBeVisible();
    await handsInput.fill('1');

    // Verifica a tabela de níveis visível
    await expect(page.locator('.levels-table')).toBeVisible();

    // Clica em Criar mesa
    await page.getByRole('button', { name: 'Criar mesa' }).click();

    // Aguarda redirecionamento para a tela da sala
    await page.waitForURL(/\/room\/[A-Z0-9]{6}/);
    const roomCodeMatch = page.url().match(/\/room\/([A-Z0-9]{6})/);
    expect(roomCodeMatch).not.toBeNull();
    const code = roomCodeMatch![1];

    // Verifica estatísticas no lobby mostrando a progressão de blinds
    await expect(page.getByText('1 mãos/nível')).toBeVisible();

    // 2. Anfitrião escolhe posição 1
    await page.getByRole('button', { name: /Posição 1/i }).click();
    await expect(page.getByRole('button', { name: /Posição 1, Anfitrião/i })).toBeVisible();

    // 3. Convidada (Bia) entra na sala pela API e abre em outro contexto de navegador
    const joinRes = await request.post(`/api/rooms/${code}/join`, {
      data: { name: 'Bia', seat: 2 },
    });
    const joinReply = (await joinRes.json()) as Reply<Admission>;
    expect(joinReply.ok).toBe(true);
    if (!joinReply.ok) throw new Error(joinReply.error.message);
    const biaAdmission = joinReply.data;

    const guestContext = await browser.newContext();
    const guestPage = await guestContext.newPage();
    await guestPage.addInitScript(
      ({ c, creds }) => {
        localStorage.setItem(`poker-table.session.v1.${c}`, JSON.stringify(creds));
      },
      { c: code, creds: biaAdmission.credentials },
    );
    await guestPage.goto(`/room/${code}`);
    await expect(guestPage.getByText('Conectado · mesa sincronizada')).toBeVisible();

    // 4. Anfitrião inicia a partida
    const startBtn = page.getByRole('button', { name: 'Iniciar Partida' });
    await expect(startBtn).toBeVisible();
    await startBtn.click();

    // 5. Ambos os jogadores devem ver a mesa ativa com o indicador de blinds no Nível 1
    await expect(page.getByLabel('Mesa de jogo ativa')).toBeVisible();
    await expect(guestPage.getByLabel('Mesa de jogo ativa')).toBeVisible();

    const hostBlindsBadge = page.locator('.blinds-badge-progressive');
    const guestBlindsBadge = guestPage.locator('.blinds-badge-progressive');

    await expect(hostBlindsBadge).toBeVisible();
    await expect(guestBlindsBadge).toBeVisible();

    // Verifica valores do Nível 1 (10 / 20)
    await expect(hostBlindsBadge.locator('.blinds-level-tag')).toHaveText('NÍVEL 1');
    await expect(guestBlindsBadge.locator('.blinds-level-tag')).toHaveText('NÍVEL 1');
    await expect(hostBlindsBadge.locator('.blinds-amounts')).toHaveText('10 / 20');
    await expect(guestBlindsBadge.locator('.blinds-amounts')).toHaveText('10 / 20');

    // Como é 1 mão por nível, isNextLevelPending deve estar ativo (Próx. mão: 20/40)
    await expect(hostBlindsBadge.locator('.blinds-pending-tag')).toBeVisible();
    await expect(guestBlindsBadge.locator('.blinds-pending-tag')).toBeVisible();

    // 6. O jogador com a vez desiste da mão
    const hostDesistir = page.getByRole('button', { name: 'Desistir desta mão' });
    const guestDesistir = guestPage.getByRole('button', { name: 'Desistir desta mão' });

    if (await hostDesistir.isVisible()) {
      await hostDesistir.click();
      await page.getByRole('button', { name: 'Desistir da mão' }).click();
    } else {
      await guestDesistir.click();
      await guestPage.getByRole('button', { name: 'Desistir da mão' }).click();
    }

    // 7. Anfitrião liquida a mão
    const settleFoldBtn = page.getByRole('button', { name: 'Confirmar distribuição das fichas' });
    await expect(settleFoldBtn).toBeVisible();
    await settleFoldBtn.click();

    const confirmSettleBtn = page.getByRole('button', { name: 'Confirmar Distribuição', exact: true });
    await expect(confirmSettleBtn).toBeVisible();
    await confirmSettleBtn.click();

    // 8. Anfitrião clica em Iniciar Próxima Mão
    const nextHandBtn = page.getByRole('button', { name: /Iniciar Próxima Mão/i });
    await expect(nextHandBtn).toBeVisible();
    await nextHandBtn.click();

    // 9. Verifica transição sincronizada para o NÍVEL 2 (20 / 40) em ambas as telas!
    await expect(hostBlindsBadge.locator('.blinds-level-tag')).toHaveText('NÍVEL 2');
    await expect(guestBlindsBadge.locator('.blinds-level-tag')).toHaveText('NÍVEL 2');
    await expect(hostBlindsBadge.locator('.blinds-amounts')).toHaveText('20 / 40');
    await expect(guestBlindsBadge.locator('.blinds-amounts')).toHaveText('20 / 40');

    // Pote inicial da nova mão deve ser 20 + 40 = 60
    await expect(page.locator('.pot-total-badge')).toContainText('60');
    await expect(guestPage.locator('.pot-total-badge')).toContainText('60');

    await guestContext.close();
  });
});
