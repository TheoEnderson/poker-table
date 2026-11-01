# Etapa 4B — Controles de Apostas Mobile

## 1. Visão Geral

A **Etapa 4B** implementou os controles funcionais de apostas (Fold, Check, Call, Raise e All-in) para o cliente mobile-first do Poker Table.

O objetivo central foi conferir aos jogadores a capacidade de agir diretamente de seus smartphones em partidas presenciais conectadas via Wi-Fi local, preservando integralmente a autoridade do servidor e as regras determinísticas do motor de Texas Hold'em.

Todos os **456 testes Vitest** (21 arquivos de teste) e **10 testes Playwright E2E** foram aprovados.

---

## 2. Auditoria e Semântica dos Contratos de Aposta

### 2.1 Semântica de `game-action`
O protocolo utiliza a união discriminada `gameActionCommandSchema`:
```typescript
{ type: 'game-action', action: 'fold' }
{ type: 'game-action', action: 'check' }
{ type: 'game-action', action: 'call' }
{ type: 'game-action', action: 'raise', amount: number }
{ type: 'game-action', action: 'all-in' }
```
Cada comando transporta `commandId` (UUID) e `expectedRevision` para validação transacional e idempotência.

### 2.2 Semântica de `amount` no Raise
- O valor `amount` enviado no comando `raise` representa o **total acumulado de fichas que o jogador terá investido na street atual** (`targetTotal`), e **não** o incremento extra em relação à aposta anterior.
- Exemplo: em um pote com Big Blind de 20 fichas, onde o Small Blind já colocou 10 fichas e decide aumentar para 60 total, o comando enviado é `{ action: 'raise', amount: 60 }`. O motor calcula que o jogador necessita desembolsar 50 fichas adicionais de sua pilha (`60 - 10`).

### 2.3 Cálculo do Call e Aumento Mínimo
- **Call:** `callAmount = Math.min(player.chips, Math.max(0, currentBet - player.committed))`.
- **Aumento Mínimo:** `minRaiseAmount = currentBet + minRaiseIncrement`.
- Em rodadas pré-flop, `currentBet` inicia no valor nominal do Big Blind e `minRaiseIncrement` inicia no Big Blind.
- Em rodadas pós-flop (flop, turn e river), `currentBet` inicia em 0 e `minRaiseIncrement` inicia no Big Blind.
- Após um raise de incremento `X >= minRaiseIncrement`, o novo `minRaiseIncrement` torna-se `X`.

### 2.4 All-in, Short Raises e Regra 49 da Poker TDA 2026
- Se o montante total disponível do jogador (`player.committed + player.chips`) for inferior ou igual à aposta atual (`currentBet`), o All-in constitui um **Call** (short call).
- Se for superior à aposta atual, constitui um **Raise**.
- Quando um all-in constitui um aumento inferior ao incremento mínimo permitido (`increment < minRaiseIncrement`), trata-se de um **short all-in raise** (aumento incompleto).
- De acordo com a **Regra 49 da Poker TDA 2026**, um aumento incompleto **não reabre a rodada de apostas** para jogadores que já tenham agido previamente. Nesses casos, o motor rejeita novas tentativas de raise por esses jogadores (`ACTION_NOT_REOPENED`), restringindo suas opções exclusivamente a Fold ou Call.

---

## 3. Projeção de Ações Permitidas (`AllowedActions`)

Para evitar a duplicação frágil de regras complexas de poker no frontend, o servidor agora calcula e expõe a projeção autoritativa de ações legais no snapshot público (`handSnapshotSchema.allowedActions`):

```typescript
export interface AllowedActionsInfo {
  readonly playerId: string;
  readonly canFold: boolean;
  readonly canCheck: boolean;
  readonly canCall: boolean;
  readonly callAmount: number;
  readonly canRaise: boolean;
  readonly minRaiseAmount: number | null;
  readonly maxRaiseAmount: number | null;
  readonly minRaiseIncrement: number | null;
  readonly currentBet: number | null;
  readonly canAllIn: boolean;
  readonly allInAmount: number | null;
  readonly allInType: 'call' | 'raise' | null;
  readonly actionNotReopened: boolean;
}
```

A função `getAllowedActions(state, playerId?)` foi incorporada a `packages/engine` e é executada pelo servidor durante `publicHand()`. O cliente utiliza esses valores para orientar a interface, enquanto a validação final permanece rigorosamente autoritativa no servidor.

---

## 4. Componentes Implementados

### 4.1 `ActionDock` (`components/table/ActionDock.tsx`)
Substitui o antigo `FutureActionDock`:
- **Fora do turno / Estados especiais:** Exibe um rodapé informativo e compacto indicando a situação (espera por outro jogador, all-in, fold, showdown, liquidação ou modo espectador).
- **No turno do jogador (`isMyTurn`):** Ativa um console fixado na parte inferior (`position: sticky`), com botões ergonômicos para polegar em celulares:
  - **Desistir (Fold):** Botão discreto com confirmação modal acessível para impedir desistências acidentais por toque inadvertido.
  - **Check:** Destaque verde esmeralda quando não há valor a pagar (`canCheck: true`).
  - **Call:** Destaque com o valor numérico explícito a ser pago (ex.: "Pagar 20" ou "Pagar 15 (All-in)").
  - **Aumentar (Raise):** Abre o seletor `RaiseControl`.
  - **All-in:** Botão rubi com a quantidade exata de fichas envolvidas e modal de confirmação explícita.
  - **Aviso TDA 49:** Exibe aviso visual caso apostas anteriores não tenham reaberto o direito a raise.

### 4.2 `RaiseControl` (`components/table/RaiseControl.tsx`)
Seletor numérico especializado para aumentos:
- Entrada numérica direta com suporte a teclado virtual numérico (`inputMode="numeric"`, `pattern="[0-9]*"`).
- Botões de passo (`−` e `+`) baseados no incremento real da rodada.
- Atalhos rápidos: "Mínimo" e "All-in".
- Esclarecimento financeiro transparente: exibe simultaneamente o **Total da aposta na street** e o **débito adicional correspondente do stack**.
- Validações em tempo real: impede valores fora dos limites autorizados e desabilita a confirmação durante comandos pendentes.

---

## 5. Refinamentos Visuais e UX

1. **Eliminação de Marca Redundante:** O cabeçalho da mesa ativa (`ActiveTable`) agora exibe o nome real da sala (`room.config.name`) e código da mesa, removendo a duplicação desnecessária do logotipo "Poker Table" já presente no cabeçalho global.
2. **Destaque Limpo do Turno:** O status pessoal em `MyStatusPanel` exibe uma pílula concisa `"Sua vez"`, eliminando textos longos e repetitivos.
3. **Painel Secundário Recolhível:** A seção inferior ("Assentos e Opções") foi transformada em um elemento HTML nativo `<details>` com `<summary>`, iniciando fechada por padrão durante a partida. Isso libera espaço vertical total para o jogo, mantendo a consulta aos assentos e perfil a um clique.
4. **Ocultação de Controles Inaplicáveis:** A ação "Liberar minha posição" é ocultada automaticamente enquanto a partida estiver iniciada.

---

## 6. Segurança e Resiliência Transacional

- **Idempotência e Concorrência:** Comandos são enviados com `commandId` único e `expectedRevision`. Comandos concorrentes ou com revisão desatualizada recebem `STALE_STATE`, acionando `sync()` automático no cliente.
- **Prevenção de Toques Duplos:** O cliente trava a emissão de novos comandos financeiros enquanto uma requisição estiver pendente (`busy.current = true`).
- **Desconexão:** Durante perdas de sinal Wi-Fi, os botões são desabilitados e a barra de conexão sinaliza o estado de reconexão automática.
- **Nenhuma Mutação Otimista:** O cliente nunca antecipa visualmente débitos de fichas ou incrementos do pote antes da confirmação autoritativa do servidor.

---

## 7. Auditoria de Segurança, Acessibilidade e Refinamentos Finais

Durante a auditoria de conclusão da Etapa 4B, quatro melhorias essenciais de segurança, acessibilidade e integridade de estado foram consolidadas:

### 7.1 Confirmação Obrigatória para Qualquer Ação de All-in
Qualquer ação capaz de comprometer todo o stack restante de um jogador exige confirmação explícita em diálogo modal antes do envio do comando:
1. **Botão Principal de All-in:** Exige confirmação exibindo o montante total de fichas do stack.
2. **Raise Máximo:** Ao selecionar o valor máximo no `RaiseControl` (ou qualquer quantia que esgote o stack), o envio direto é interceptado e submetido ao diálogo de confirmação de All-in, informando o total de fichas do stack e o total apostado na rodada.
3. **Call de All-in:** Quando o valor necessário para cobrir a aposta for igual ou superior ao stack restante (`callAmount >= currentChips`), o botão "Pagar" abre o diálogo de confirmação informando expressamente o valor total que será empenhado.
4. **Cancelamento Seguro:** O cancelamento de qualquer confirmação descarta o intento e mantém o estado anterior com exatamente zero alterações financeiras na partida.

### 7.2 Identificadores Únicos e Acessibilidade em Diálogos (`ConfirmDialog`)
- O identificador estático `confirmation-title` foi substituído por identificadores únicos por instância gerados via `useId()` do React.
- O elemento `<dialog>` vincula-se ao título via `aria-labelledby={titleId}`, garantindo conformidade com padrões de acessibilidade WAI-ARIA e eliminando a ocorrência de IDs duplicados no DOM quando múltiplos diálogos coexistem no componente.
- O diálogo implementa limpeza defensiva no fechamento/desmontagem (`el.close()`).

### 7.3 Descarte de Estado Transitório e Prevenção de Ações Obsoletas
- No `ActionDock`, todo estado transitório (`showRaise`, `confirmFold`, `confirmAllIn`, `allInIntent`) é descartado imediatamente quando a oportunidade de ação do jogador se encerra ou é alterada:
  - Perda ou mudança de turno (`game.hand.currentActorId`, `isMyTurn`).
  - Avanço de street (`game.hand.street`).
  - Nova mão (`game.hand.dealerSeat`).
  - Atualização de versão de estado da sala (`room.revision`).
- Previne que seleções numéricas ou diálogos de confirmação antigos reapareçam em turnos futuros ou enviem comandos com base em snapshots financeiros defasados.

### 7.4 Validação Numérica Estrita no `RaiseControl`
- A utilização de `parseInt()` foi substituída por validação numérica rigorosa baseada em expressão regular (`/^\d+$/`) e `Number.isSafeInteger()`, impedindo o truncamento silencioso de números decimais (por exemplo, "40.5").
- O campo de entrada armazena a string exata digitada pelo usuário, exibindo mensagens de erro específicas e desabilitando o botão de confirmação quando a entrada for vazia, fracionária ou estiver fora dos limites mínimo/máximo da rodada.
- O atributo HTML `step="any"` é aplicado no `<input type="number">` para que validações nativas do navegador não restrinjam valores inteiros válidos autorizados pelo motor, enquanto os botões de passo (`−` e `+`) continuam incrementando e decrementando pelo passo real da rodada.

