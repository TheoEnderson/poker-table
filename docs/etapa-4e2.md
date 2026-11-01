# Poker Table — Documentação da Etapa 4E.2: Refinamento Mobile e Redução de Redundâncias

## 1. Visão Geral

A Etapa 4E.2 realizou refinamentos de interface, ergonomia tátil e apresentação mobile baseados nos testes presenciais com múltiplos dispositivos (notebook Ubuntu e smartphone Android via Wi-Fi local).

O objetivo central foi eliminar mensagens redundantes para o anfitrião, assegurar conforto tátil com áreas de toque padronizadas (≥ 44-48px), garantir adaptação perfeita a telas estreitas (320px a 390px) sem rolagem horizontal indevida e manter total integridade das regras financeiras e contratos do servidor.

---

## 2. Melhorias Implementadas

### 2.1 Eliminação de Mensagens Administrativas Redundantes
- **Cenário identificado**: Quando o anfitrião alcançava momentos de decisão administrativa (avanço de street, apuração de showdown, liquidação por desistência ou início de próxima mão), o sistema renderizava simultaneamente o painel administrativo superior com o botão de ação e uma mensagem inferior no dock (`Apostas igualadas. Avance a rodada no painel acima.`, `Showdown: apure os vencedores no painel acima.`, `Mão liquidada. Inicie a próxima mão no painel acima.`).
- **Solução implementada**: Em `ActionDock.tsx`, quando o jogador é o anfitrião (`isHost === true`) e possui um controle administrativo visível e funcional (`hasHostStreetControl` ou `hasHostSettlementControl`), o componente não renderiza a mensagem inferior redundante (`return null`), liberando espaço vertical e focando a atenção na ação principal.
- **Preservação de mensagens essenciais**:
  - Participantes comuns continuam recebendo todas as mensagens contextuais de espera (`Aguardando o anfitrião iniciar o Flop/Turn/River/Showdown`, `Showdown: cartas na mesa. Aguardando a distribuição dos prêmios`, `Mão liquidada. Aguardando o anfitrião iniciar a próxima mão`).
  - O anfitrião continua recebendo mensagens quando outro jogador está na sua vez de apostar (`Aguardando [Nome] agir…`) ou quando a partida chega ao fim (`Partida concluída. O torneio chegou ao fim.`).
  - Alertas de erro e status de conexão na rede local permanecem intactos no topo da mesa.

### 2.2 Padronização de Áreas de Toque (Touch Targets)
- **Botão de alternar empate (`.tie-toggle-btn`)**: Altura mínima elevada de 40px para 48px, com espaçamento interno de 8px 16px e alinhamento centralizado, mantendo visual compacto e garantindo conforto para toque no celular.
- **Seletor de aposta (`RaiseControl`)**:
  - Botão de fechar (`.raise-cancel-x`): ampliado para área de toque mínima de 44 × 44px com foco visível.
  - Botões de incremento/decremento (`.stepper-btn`): mantidos em 48 × 48px com anel de foco reforçado (`:focus-visible`).
  - Botões de atalho/preset (`.preset-btn`): área vertical mínima ampliada para 44px.
  - Botões de confirmar e cancelar (`.raise-btn-confirm`, `.raise-btn-cancel`): altura mínima padronizada em 48px.
- **Diálogos de confirmação (`ConfirmDialog`)**: Botões padronizados em altura mínima de 48px, com layout adaptado para telas estreitas (≤ 480px) em coluna vertical para facilitar o acionamento pelo polegar.

### 2.3 Adaptação a Telas Pequenas, Nomes Longos e Stacks Elevados
- **Prevenção de rolagem horizontal**: Configurado `overflow-x: hidden` nas camadas estruturais (`html, body`), mantendo rolagem horizontal fluida e restrita exclusivamente ao contêiner de assentos (`.seat-strip-container`). Bounding client rects de todos os elementos essenciais (controles de aposta, resumo de potes, painel pessoal, botões administrativos, diálogos e seleção de vencedores) validados estritamente dentro da largura de 320px.
- **Leitura integral de stacks sem truncamento**: Removido `text-overflow: ellipsis` em `.card-stack .chip-value` e ampliada a largura do cartão para 112px, garantindo que valores elevados (ex.: 1.000.000 a 10.000.000 fichas) permaneçam integralmente legíveis sem reticências ou quebra indesejada.
- **Nomes longos em cartões de jogadores**: Em `.card-name`, configurada quebra segura em até 2 linhas (`-webkit-line-clamp: 2; overflow-wrap: break-word; min-height: 1.9em;`), evitando que nomes extensos sejam truncados precocemente ou distorçam a altura dos cartões.
- **Faixa de vez (`.turn-banner`)**: Configurado com `max-width: 100%`, `overflow-wrap: anywhere` e `box-sizing: border-box`, prevenindo transbordamento em viewports de 320px.

### 2.4 Transições e Estabilidade Visual
- Alturas mínimas consistentes em cartões (`124px`) e barras de ação (`20px`), mitigando deslocamentos abruptos de layout (Cumulative Layout Shift) durante alternância de turnos e streets.
- Suporte total a `prefers-reduced-motion: reduce`, desabilitando animações de pulso (`pulse-turn`, `turn-pulse`) e transições em conformidade com as preferências do sistema.

---

## 3. Arquivos Modificados

1. `apps/web/src/components/table/ActionDock.tsx`:
   - Remoção de mensagens administrativas redundantes para o anfitrião quando `hasHostStreetControl` ou `hasHostSettlementControl` estão ativos.
   - Preservação das mensagens informativas de espera para jogadores comuns.
2. `apps/web/src/style.css`:
   - Ajuste de `html, body` com `overflow-x: hidden`.
   - Ajuste de `.turn-banner` com `max-width: 100%` e `overflow-wrap: anywhere`.
   - Cartões de jogador (`.player-card`, `.card-name`, `.card-stack`, `.card-status-bar`) otimizados para nomes longos e stacks elevados.
   - Padronização de áreas de toque: `.tie-toggle-btn` (48px), `.raise-cancel-x` (44px), `.preset-btn` (44px), `.raise-btn-cancel`/`.raise-btn-confirm` (48px), `.action-btn` em mobile (48px).
   - Responsividade para `dialog` em telas estreitas (≤ 480px).
3. `tests/e2e/active-table.spec.ts`:
   - Atualização das asserções que esperavam a mensagem redundante anterior no dock do anfitrião.
   - Novo teste E2E abrangente (teste 18) cobrindo viewports 320px e 390px, ausência de rolagem horizontal, botões de toque ≥ 48px, adaptação de nomes longos e ausência de mensagens redundantes.
4. `docs/etapa-4e1.md`:
   - Remoção da quebra de linha excedente ao final do arquivo.
5. `docs/etapa-4e2.md`:
   - Criação desta documentação técnica.

---

## 4. Testes e Validação

Conforme orientação para economia de memória no ambiente Ubuntu, as validações foram executadas estritamente de forma sequencial com single worker:

- `npm run lint`: Aprovado sem erros ou avisos (0 warnings, 0 errors).
- `npm run build`: Compilação de tipos (`tsc`) e bundle de produção (`vite build`) concluídos com sucesso.
- `npx vitest run --maxWorkers=1 --no-file-parallelism`: **476 testes unitários e de integração aprovados** (23 suítes).
- `npx playwright test --workers=1`: **18 testes E2E aprovados** (todos os fluxos de ponta a ponta verdes).
- `git diff --check`: 0 erros de formatação ou linhas em branco excedentes.

---

## 5. Pontos de Atenção para Uso Presencial

- Ao utilizar dispositivos antigos em orientação paisagem com altura reduzida (< 400px), a rolagem vertical da página é necessária e permanece intencionalmente disponível para acesso a todas as seções.
- Cartões físicos na mesa devem ser revelados pelo anfitrião antes de acionar a confirmação de cada street (`Iniciar Flop`, `Iniciar Turn`, `Iniciar River`), mantendo a sincronia entre a mesa real e a virtual.
