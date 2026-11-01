# Etapa 3D — Auditoria de Estabilidade e Robustez do Multiplayer LAN

## 1. Visão Geral

A **Etapa 3D** consolidou e auditou a estabilidade, resiliência e integridade do Poker Table em cenários operacionais avançados de rede local (LAN). O foco foi certificar que a infraestrutura autoritativa do servidor, o motor de poker e a persistência SQLite suportam sessões prolongadas e anomalias comuns de conectividade antes de avançarmos para a interface móvel completa.

A suíte de testes do projeto foi expandida para **450 testes automatizados** aprovados em 21 arquivos, além dos 3 testes E2E com Playwright.

---

## 2. Cenários Testados e Garantias Verificadas

### 2.1 Sessões Prolongadas (25+ mãos consecutivas)
- **Conservação estrita do bankroll:** Testado deterministicamente ao longo de 25 mãos consecutivas com 3 jogadores. O bankroll total de 3.000 fichas permaneceu rigorosamente conservado (soma dos stacks + pote atual = 3.000) em cada street, ação e liquidação.
- **Rotação de Dealer e Cobrança de Blinds:** O botão do dealer rotacionou continuamente em sentido horário, recalculando os assentos de Small Blind e Big Blind sem cobranças duplicadas ou omissões.
- **Incremento de `handNumber`:** Registrado de 1 até 25 sequencialmente, mantendo histórico consistente.
- **Eliminação e Heads-Up:** Sessão com redução gradual de jogadores até a eliminação de um participante (0 fichas). A transição para Heads-Up aplicou a Regra 36-C da Poker TDA 2026 (evitando que um jogador pague o Big Blind duas vezes seguidas). O heads-up continuou até a eliminação do segundo jogador, culminando no encerramento determinístico com estado `game-complete` e identificação do `winnerId`.

### 2.2 Desconexões e Reconexões em Momentos Críticos
Foram verificadas desconexões forçadas e reconexões em sete pontos críticos do ciclo de vida:
1. **No pré-flop durante a vez do jogador:** O servidor preservou o `currentActorId`, aguardando indefinidamente pela reconexão do jogador sem aplicar auto-fold ou temporizadores (respeitando o modelo de jogo presencial físico).
2. **Imediatamente após uma aposta ou raise:** O montante apostado permaneceu no pote e a ação transitou para os adversários.
3. **Durante o Showdown:** A mão permaneceu em `showdown`. O anfitrião pôde liquidar os prêmios atribuindo potes ao jogador desconectado, que recebeu os créditos normalmente e sincronizou o saldo atualizado ao reconectar.
4. **Após a liquidação (`hand-settled`):** Desconexões não afetaram os stacks nem impediram o anfitrião de chamar `next-hand`.
5. **Antes da próxima mão:** Jogador desconectado manteve sua vaga e recebeu as cartas/blinds na mão seguinte.
6. **Após eliminação:** O jogador com 0 fichas permaneceu na sala como espectador, mas foi excluído da rotação de dealer e ordem de apostas ativas da nova mão.
7. **Conexões simultâneas com as mesmas credenciais (múltiplas abas):**
   - Abrir duas abas com as mesmas credenciais mantém `connected: true`.
   - Ambas as abas recebem eventos `room:state` em broadcast.
   - Fechar uma aba mantém `connected: true` enquanto a outra estiver ativa. O status só transita para `connected: false` quando todos os sockets da credencial encerram.

### 2.3 Recuperação pós-Reinício do Servidor
- **Reinício no meio de uma street (ex: Flop com aposta em aberto):** Ao reiniciar o servidor a partir do arquivo SQLite, os stacks exatos, o pote acumulado, o ator atual e as apostas da street foram recuperados integralmente, sem reexecutar cobranças de blinds ou apostas já registradas.
- **Idempotência pós-reinício:** Retentativas de comandos antigos com o mesmo `commandId` após o reinício continuam sendo reconhecidas e devolvem o estado confirmado sem reaplicar ações financeiras.

### 2.4 Comandos Atrasados, Concorrentes e Duplicados
- **Revisão desatualizada:** Qualquer comando enviado com `expectedRevision` defasado é rejeitado com `STALE_STATE` e provoca o reenvio do estado atual ao cliente.
- **Reenvio de comando (perda de ACK):** Envio duplicado com o mesmo `commandId` e fingerprint idêntico é tratado como idempotente, retornando sucesso e o estado corrente sem mutações duplicadas.
- **Conflito de identificador:** Reutilização de `commandId` com payload distinto é rejeitada com `COMMAND_CONFLICT`.
- **Ações fora da vez:** Tentativa de ação por jogador que não possui a vez é bloqueada com `OUT_OF_TURN`.

### 2.5 Isolamento entre Salas no Mesmo Servidor
- Múltiplas salas simultâneas operando sob a mesma instância do Node.js.
- Comandos emitidos por jogadores de uma sala com credenciais inválidas ou cruzadas são bloqueados (`UNAUTHORIZED`).
- Broadcasts de `room:state` de uma sala jamais são propagados para sockets de outra sala.
- O encerramento (`close-room`) de uma sala desconecta apenas os clientes daquela sala, mantendo as demais ativas e inalteradas.

### 2.6 Auditoria de Integridade e Persistência
- **Compatibilidade retroativa:** O validador `decodeGame` carrega registros legados v1 (Etapa 3A) e v2 (Etapa 3B) e os promove apenas após novas mutações autorizadas.
- **Verificação profunda v3:** Validação em todas as variantes (`hand-active`, `hand-settled`, `game-complete`). Rejeição com `STORAGE_ERROR` diante de adulterações em:
  - `tableBudget` inconsistente.
  - `handNumber` nulo ou negativo.
  - Fraude em prêmios no `settlement` (mesmo preservando a soma, a verificação pura contra `settleHandFlow` detecta a fraude).
  - Adulteração de `winnerId` para jogador eliminado.
  - Adulteração de `previousSettlement` na mão seguinte.
- **Preservação de registros em leituras inválidas:** Falhas na decodificação ou corrupção do JSON persistido geram erro de leitura (`STORAGE_ERROR`), mas o banco SQLite em disco jamais é apagado, sobrescrito ou reinicializado. A correção do registro no banco restaura imediatamente a sala sem perda de dados.

### 2.7 Robustez de Socket.IO e Segurança de Snapshots
- **Payloads malformados:** Entradas nulas, tipos desconhecidos, valores numéricos negativos ou ausência de callback ACK não derrubam o processo do Node.js e são rejeitados com validações seguras (`INVALID_INPUT`).
- **Segurança dos snapshots:** A inspeção recursiva dos estados retornados por `room:sync` e pelos ACKs de `room:command` não identificou credenciais ou hashes sensíveis. O broadcast `room:state` utiliza a mesma projeção pública, mas sua captura explícita em todas as fases não integra este teste específico.

### 2.8 Gestão de Recursos e Memória
- O mapa em memória `RoomService.connections` descarta completamente o registro do jogador quando todas as suas conexões fecham.
- A tabela `commands` registra os comandos confirmados, e sua chave primária impede duplicações do mesmo identificador por jogador e sala. O teste verifica a quantidade de registros após três ações. Não há política de expiração implementada: a tabela continuará crescendo conforme a utilização.

---

## 3. Problemas Identificados e Ajustes Realizados

1. **Pendência de formatação da Etapa 3C:**
   - Havia avisos de linhas em branco residuais no final dos arquivos `apps/server/src/game/settlement.ts`, `docs/etapa-3c.md` e `tests/game-3c-concurrency.test.ts`. Foram removidas e `git diff --check` passou sem avisos.
2. **Limite de taxa de Socket.IO em testes automatizados ultra-rápidos:**
   - O servidor impõe limite de 80 requisições por janela de 10 segundos por socket (`RATE_LIMITED`). Em testes que executam 25 mãos em poucos segundos em um único processo, os sockets podiam acumular chamadas além da taxa normal humana. No teste de 25 mãos consecutivas, adicionou-se uma rotina de renovação de sockets a cada 5 mãos (`refreshSockets`), que simula reconexões reais de rede e valida o ciclo de vida contínuo sem violar os limites anti-abuso.
3. **Transição imediata para Showdown em All-in Geral:**
   - No motor de poker (`packages/engine`), quando todos os jogadores ativos com fichas restantes vão all-in, não há rodadas de apostas futuras possíveis. O método `applyHandAction()` transita a mão imediatamente para `status: 'showdown'`. Tentativas posteriores de chamar `advanceStreet()` são rejeitadas com `HAND_ALREADY_COMPLETED`, pois a mão já está no showdown. Os testes foram estruturados respeitando rigorosamente essa garantia do motor.

---

## 4. Limitações Conhecidas e Riscos Reservados para Testes Presenciais

| Área | Testes Automatizados (Garantido) | Testes Presenciais em Dispositivos Físicos (Reservado) |
| :--- | :--- | :--- |
| **Flutuações de Wi-Fi** | Queda abrupta de TCP, desconexões e reconexões consecutivas com mesma sessão. | Latência irregular, jitter de rádio, roaming entre pontos de acesso (APs) mesh em ambientes residenciais. |
| **Suspensão de Navegadores Mobile** | Múltiplas conexões, concorrência de abas e retomada de sessão salva no localStorage. | Política do iOS Safari / Android Chrome de colocar abas em segundo plano (congelamento de timers e WebSocket em background). |
| **Resolução de Endereço LAN** | Fallbacks de IP, ausência de APIs em localhost vs LAN, cabeçalhos de mesma origem. | Descoberta local por mDNS (`.local`), leitura de QR Code físico sob iluminação real de mesa de poker. |
| **Comportamento Humano** | Ordem determinística de apostas, folds, showdowns e prêmios. | Jogadores que demoram para decidir, necessidade de pausar a mesa ou corrigir apostas físicas antes da confirmação. |

---

## 5. Conclusão

A infraestrutura multiplayer LAN do Poker Table atinge um nível sólido de robustez e estabilidade. O estado do servidor é plenamente autoritativo, idempotente, seguro contra vazamento de credenciais e protegido contra adulteração ou perda de estado no banco SQLite.

A base está pronta para a **Etapa 4 (Interface Mobile Completa)**.
