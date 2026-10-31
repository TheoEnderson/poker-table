# Poker Table — Instruções para agentes

## Objetivo

Desenvolver uma aplicação offline para gerenciamento de fichas
em partidas presenciais de Texas Hold'em.

Os jogadores utilizam cartas físicas e celulares conectados
à mesma rede Wi-Fi.

Não implementar distribuição virtual de cartas, pagamentos
ou funcionalidades externas sem solicitação explícita.

## Arquitetura

- Frontend: React + TypeScript.
- Backend: Node.js + Express + Socket.IO.
- Persistência: SQLite.
- Validação: Zod.
- Motor de poker: packages/engine.
- Contratos compartilhados: packages/protocol.

O servidor é autoritativo.
Clientes não podem modificar diretamente o estado da partida.

O motor de poker deve ser independente de React, Socket.IO,
Express e SQLite.

## Regras de desenvolvimento

1. Implementar exclusivamente o escopo solicitado.
2. Priorizar soluções simples, seguras e testáveis.
3. Não reescrever componentes funcionais sem necessidade.
4. Não adicionar dependências sem justificativa.
5. Não copiar código de projetos externos sem licença compatível.
6. Preservar compatibilidade com Node.js 22.
7. Utilizar TypeScript com tipagem rigorosa.
8. Evitar arquivos excessivamente grandes.
9. Não modificar testes apenas para esconder falhas reais.
10. Não avançar automaticamente para a próxima etapa.

## Motor de poker

- Trabalhar exclusivamente com quantidades inteiras de fichas.
- Preservar a quantidade total de fichas nas operações normais.
- Implementar regras determinísticas.
- Separar regras de poker da interface e da comunicação.
- Testar casos extremos e situações de heads-up.
- Nunca presumir que uma ação enviada pelo cliente é válida.

## Testes

Executar preferencialmente testes direcionados durante o desenvolvimento.

Antes de concluir uma entrega, executar:

npm run check

Executar testes E2E quando houver alterações que afetem
interface, navegação ou comunicação multiplayer:

npm run test:e2e

Informar claramente os testes executados e suas falhas.

## Eficiência

- Não executar repetidamente a suíte completa sem necessidade.
- Não realizar auditorias extensas sem solicitação.
- Não produzir relatórios desnecessariamente longos.
- Não pesquisar projetos externos sem necessidade.
- Evitar alterações fora do escopo.
- Reutilizar conhecimento e decisões já documentados.
- Resumir a entrega em poucas linhas.

## Git

- Não criar commits automaticamente, salvo solicitação.
- Não realizar push automaticamente.
- Não modificar arquivos da pasta auditoria.
- Não versionar dependências instaladas, bancos SQLite ou segredos.

## Ao concluir uma tarefa

Informar objetivamente:

1. O que foi implementado.
2. Quais arquivos foram modificados.
3. Quais testes foram executados.
4. Quais problemas permanecem.

Encerrar a execução sem iniciar outras funcionalidades.
