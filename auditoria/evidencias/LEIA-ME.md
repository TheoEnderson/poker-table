# Evidências e reprodução

Estas evidências documentam a auditoria de 31/10/2026. Nenhum código de aplicação foi alterado. Os scripts com extensão `.txt` são cópias textuais dos instrumentos externos de auditoria, não arquivos adicionados aos projetos originais.

## Checkouts e ambiente

- PocketPoker: `7ae65c8c89e28afed8d899141ae34b93226b900f`.
- TableChips: `f877424f02f685d76c0eae8df0ee9d621b5c6e7c`.
- Diretório dos checkouts: `/tmp/poker-audit-20261031/`.
- Node 22.22.1, npm 10.9.4, Chrome 156.0.8078.47, OpenJDK 25.0.4.1, Gradle wrapper 9.7.1.
- `git diff` e `git status --short` ficaram vazios nos dois projetos após os checks. Dependências, builds e caches foram gerados em caminhos temporários/ignorados.

## Comandos PocketPoker

O npm não estava disponível no PATH. Foi obtido com `COREPACK_HOME=/tmp/poker-audit-20261031/corepack corepack npm@10.9.4`; depois foi executado por `node /tmp/poker-audit-20261031/corepack/npm/10.9.4/bin/npm-cli.js`. Os comandos abaixo usam a abreviação `npm`.

```sh
git clone https://github.com/k1bot2026/PocketPoker.git /tmp/poker-audit-20261031/PocketPoker
cd /tmp/poker-audit-20261031/PocketPoker
git checkout --detach 7ae65c8c89e28afed8d899141ae34b93226b900f
npm ci --cache /tmp/poker-audit-20261031/npm-cache --no-audit --no-fund
# Falha esperada neste ambiente: ERESOLVE, Vite 8 versus peer range do plugin PWA.
npm ci --legacy-peer-deps --cache /tmp/poker-audit-20261031/npm-cache --no-audit --no-fund
npm test
npm run typecheck
npm run lint
node node_modules/eslint/bin/eslint.js src/engine/actions.ts
npm run build
```

`--legacy-peer-deps` foi uma exceção para diagnóstico. Não mudou package.json/package-lock.json e não representa correção do conflito.

Resultados: suíte original 91/91 em 14 arquivos; typecheck e build com saída zero; lint com saída zero, mas ignorando TypeScript. `eslint-target.log` registra a comprovação de arquivo TS ignorado.

## Sondagens externas

Restaurar `audit.test.ts.txt` como `/tmp/poker-audit-20261031/probes/audit.test.ts` e `vitest.config.ts.txt` como `vitest.config.ts` no mesmo diretório. Criar ali um link `node_modules` para `../PocketPoker/node_modules`. O alias do config aponta ao checkout temporário fixado acima.

```sh
cd /tmp/poker-audit-20261031/probes
node node_modules/vitest/vitest.mjs run --reporter=verbose
```

Os 14 testes **afirmam o defeito observado**. Portanto, 14 testes passando significam 14 reproduções confirmadas, não 14 requisitos corretos. O transporte é um stub; os casos de Host/Client não exercitam WebRTC real. Não houve mudança no motor antes ou depois das sondagens.

## Experimento no navegador

Restaurar `offline-browser.mjs.txt` como `/tmp/poker-audit-20261031/probes/offline-browser.mjs` e executar com Node após o build. Requer `/usr/bin/google-chrome`, autorização para iniciar processos e bind local nas portas 18083 e 19222.

O instrumento serve o build exclusivamente em loopback, abre Chrome headless com perfil descartável, usa dois contextos isolados e bloqueia a resolução de nomes externos com `--host-resolver-rules`. A flag `--no-sandbox` está restrita a esse navegador descartável de teste. O instrumento não deve ser usado como servidor de produto.

Fluxo: perfis de teste → criar sala → entrar pelo código → aguardar 35 segundos. O servidor de teste retorna 404 para PHP, como uma hospedagem estática sem PHP; o loader original prossegue para o JSON. A falha observada de descoberta é dos brokers MQTT externos. O resumo retém estados finais, destinos e contagem de erros. Eventos CDP completos ficaram em `/tmp/poker-audit-20261031/offline-browser.json`; não são necessários para entender o resultado.

Este teste não desliga fisicamente a WAN, não usa telefones e não comprova comportamento de HTTP em IP privado. Demonstra que o fluxo de nova sala depende de DNS/serviços externos mesmo com o frontend disponível localmente.

## Comandos TableChips

```sh
git clone https://github.com/tablechips/tablechips.git /tmp/poker-audit-20261031/tablechips
cd /tmp/poker-audit-20261031/tablechips
git checkout --detach f877424f02f685d76c0eae8df0ee9d621b5c6e7c
GRADLE_USER_HOME=/tmp/poker-audit-20261031/gradle-cache ./gradlew :core:test :server:test --no-daemon
GRADLE_USER_HOME=/tmp/poker-audit-20261031/gradle-cache ./gradlew :server:test --tests io.github.tablechips.server.OrderingTest --no-daemon
```

A execução completa teve 125 testes core aprovados e 57 server, dos quais 56 aprovados e 1 com timeout. A repetição executou apenas OrderingTest e falhou novamente. O timeout ocorreu na espera pelos quatro jogadores sentados, antes de conferir revisões.

O resumo XML foi salvo **depois** da repetição: contém os 125 testes de core e apenas o teste de servidor repetido, pois Gradle substitui os XML da tarefa. Não somar esse resumo aos números da execução completa. A causa do timeout não foi determinada. O log registra ausência de Android SDK e omissão de `:app`.

## Integridade

`SHA256SUMS` permite conferir os arquivos de evidência e o relatório entregues. A auditoria não fez commit, instalação global, deploy, alteração de dependências versionadas ou correção dos defeitos.
