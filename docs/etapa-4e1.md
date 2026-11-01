# Etapa 4E.1 — Correções de Usabilidade

## 1. Visão Geral

A **Etapa 4E.1** implementa correções pontuais de usabilidade e ergonomia mobile identificadas durante testes práticos manuais em computadores Ubuntu e dispositivos Android conectados na rede Wi-Fi local:
- Eliminação de controles deformados nativos (checkbox).
- Sincronização e priorização correta de estados da interface pós-liquidação.
- Redução de redundâncias comunicacionais para o anfitrião da mesa.
- Discriminação individual de fichas recebidas em empates (split pots).
- Clareza léxica nas ações de apostas (`Passar (Check)` e `Apostar` vs `Aumentar (Raise)`).
- Otimização moderada do aproveitamento vertical em telas compactas (320px e 390px).

Toda a arquitetura autoritativa do servidor, contratos do protocolo e o motor financeiro determinístico foram rigorosamente preservados.

---

## 2. Problemas Identificados e Soluções Implementadas

### 2.1 Controle de Empate Compacto e Acessível (`HostSettlementControls.tsx`)
- **Problema:** O elemento `<input type="checkbox">` nativo renderizava um controle desproporcional e quebrava linhas em celulares Android.
- **Solução:** Substituição por botão de alternância compacto (`.tie-toggle-btn`) com `aria-pressed`, altura tátil adequada (40px) e suporte a teclado (Space/Enter).
  - Estado desativado: `⚖ Ativar empate` (estilo neutro escuro).
  - Estado ativado: `✓ Empate ativado` (destaque dourado e pílula de empate).
  - Sem quebras indesejadas de texto (`white-space: nowrap`).

### 2.2 Prioridade Correta de Estados no Painel Pessoal (`MyStatusPanel.tsx`)
- **Problema:** Após a liquidação (`settle-hand`), o painel pessoal ainda exibia `Showdown · Cartas na mesa` porque a street da mão anterior permanecia em `showdown`.
- **Solução:** Reordenação estrita da verificação de estados:
  1. `isSpectator`: `Apenas observando`.
  2. `isEliminated`: `Você foi eliminado desta partida`.
  3. `game.status === 'game-complete'`: `Partida encerrada`.
  4. `game.status === 'hand-settled'`: `Mão encerrada`.
  5. Estados da mão ativa (`isFolded`, `isAllIn`, `isMyTurn`, `showdown`, etc.).

### 2.3 Feedback Contextual Não Redundante para o Anfitrião (`ActionDock.tsx`)
- **Problema:** Quando a rodada de apostas era concluída, o anfitrião visualizava o botão de avançar a street e simultaneamente um dock inferior informando "Aguardando o anfitrião avançar a rodada".
- **Solução:** O `ActionDock` agora diferencia o anfitrião dos demais jogadores:
  - Para o anfitrião: diretiva ativa indicando ação nos controles acima (ex.: `Apostas igualadas. Avance a rodada no painel acima.`, `Showdown: selecione os vencedores no painel acima.`, `Mão liquidada. Inicie a próxima mão no painel acima.`).
  - Para participantes comuns: preservação do aviso informativo de espera (ex.: `Aguardando o anfitrião iniciar o Flop.`, `Aguardando o anfitrião iniciar a próxima mão.`).

### 2.4 Resumo de Prêmios Individuais em Empates (`SettlementBanner.tsx`)
- **Problema:** Em potes divididos, o banner exibia apenas a lista de nomes e o total acumulado do pote, sem indicar a quantia exata de fichas recebida por cada vencedor.
- **Solução:** Renderização de lista discriminada (`.pot-split-list`) consumindo diretamente os dados autoritativos de `pot.awards` calculados pelo servidor, indicando o valor exato creditado a cada participante (ex.: `• Lenovo (#1): +30 fichas`, `• Théo (#2): +30 fichas`), inclusive na resolução de fichas indivisíveis e side pots.

### 2.5 Nomenclatura das Ações de Aposta (`ActionDock.tsx` e `RaiseControl.tsx`)
- **Check:** Atualizado de `Check ✕` para `Passar (Check)` para evitar confusão do símbolo `✕` com ações de cancelar ou fechar.
- **Raise vs Bet:** Quando ninguém apostou ainda na street atual (`allowed.currentBet === 0` em streets pós-flop), o botão apresenta `Apostar` e o modal abre com o título `Definir Aposta`. Quando já existe aposta anterior (pré-flop ou pós-flop com aposta), apresenta `Aumentar (Raise)` e `Definir Aumento (Raise)`.

### 2.6 Refinamento de Espaçamento Vertical Mobile (`style.css`)
- Redução de gaps (`active-table`: de 14px para 10px) e paddings internos dos cards principais (`pot-summary`, `my-status-panel`, `future-action-dock`), poupando espaço vertical e mantendo botões essenciais visíveis sem necessidade de rolagem excessiva em telas de 320px e 390px.
- Preservação rigorosa da altura mínima de toque de 48px para botões de ação e contraste com tema escuro verde e dourado.

---

## 3. Componentes Modificados

- `apps/web/src/components/table/HostSettlementControls.tsx`
- `apps/web/src/components/table/MyStatusPanel.tsx`
- `apps/web/src/components/table/ActionDock.tsx`
- `apps/web/src/components/table/RaiseControl.tsx`
- `apps/web/src/components/table/SettlementBanner.tsx`
- `apps/web/src/style.css`
- `tests/e2e/active-table.spec.ts`

---

## 4. Resultados da Validação

Execução sequencial com 1 worker:
1. `npm run lint`: 0 erros, 0 avisos.
2. `npm run build`: Sucesso (compilação de tipos TypeScript e bundle Vite).
3. `npx vitest run --maxWorkers=1 --no-file-parallelism`: 476 testes aprovados em 23 arquivos.
4. `npx playwright test --workers=1`: 17 testes aprovados em 3 arquivos.
5. `git diff --check`: 0 erros de formatação ou espaços excedentes.

---

## 5. Próximos Passos

- Revisão visual pelo usuário.
- Prosseguir para a Etapa 4E.2 (refinamentos finais de transição, feedback tátil e auditoria de empacotamento offline) após aprovação explícita.

