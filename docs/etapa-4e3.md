# Poker Table — Documentação da Etapa 4E.3: Validação Offline e Preparação para Uso Real

## 1. Visão Geral

A Etapa 4E.3 encerra o ciclo de desenvolvimento funcional do MVP do Poker Table (preparação para a v0.1.0).

O objetivo central foi consolidar a independência completa de internet externa, auditar todas as dependências de rede, simplificar a inicialização no ambiente Ubuntu/Linux, garantir robustez contra falhas e quedas de conexão, documentar o sistema e fornecer um roteiro claro para validação presencial com conexão externa desativada.

---

## 2. Resultado da Auditoria de Dependências Externas

Foi realizada uma auditoria exaustiva em todos os componentes e camadas do projeto para assegurar que nenhuma requisição externa seja disparada durante a execução da aplicação:

1. **Ativos Estáticos e HTML (`index.html`)**:
   - Não há carregamento de fontes externas (Google Fonts, Typekit ou similares). O CSS adota fontes nativas do sistema (`ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif`).
   - Não há scripts, estilos ou favicons hospedados em CDNs externos.
2. **Geração de QR Code**:
   - A biblioteca `qrcode` foi empacotada localmente pelo Vite no bundle de produção.
   - O QR code de convite é sintetizado inteiramente no cliente via Canvas/Data URL (`data:image/png;base64,...`), sem requisições a serviços como Google Chart API ou APIs externas de QR code.
3. **Comunicação em Tempo Real e Requisições HTTP**:
   - O cliente Socket.IO conecta-se exclusivamente a `window.location.origin`.
   - Todas as chamadas de API (`/api/rooms`, `/api/rooms/:code/join`, `/api/health`, `/api/network-info`) apontam para a mesma origem do servidor local.
4. **Política de Segurança de Conteúdo (CSP)**:
   - O servidor HTTP injeta cabeçalhos estritos de segurança:
     `Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; font-src 'self'; object-src 'none'`.
   - Essa política bloqueia qualquer tentativa de conexão externa ou carregamento de recursos remotos no navegador.
5. **Banco de Dados e Persistência**:
   - Utilização do módulo nativo `node:sqlite` do Node.js 22, gravando no arquivo local `data/poker-table.sqlite`, sem drivers externos nem serviços em nuvem.

---

## 3. Script de Inicialização e Tratamento de Rede e Portas

### 3.1 Script Facilitador (`scripts/start.sh`)
- Desenvolvido em Bash para sistemas Linux/Ubuntu.
- Valida rigorosamente a versão instalada do Node.js (exige `>= 22.13.0` checando componentes major e minor para suporte estável ao `node:sqlite`).
- Verifica se os arquivos compilados (`apps/server/dist/main.js` e `apps/web/dist`) existem antes de iniciar.
- Executa diretamente `node apps/server/dist/main.js` sem invocar `npm install`, `git` ou qualquer comando que exija internet.
- Repassa variáveis de ambiente como `PORT` e `DATABASE_PATH`.

### 3.2 Filtro e Priorização de Interfaces de Rede (`network.ts`)
- Em ambientes de desenvolvimento Linux com Docker instalado, interfaces virtuais de ponte (`docker0`, `br-*`, `veth*`, `virbr*`, `vboxnet*`, `vmnet*`) criavam rotas inacessíveis para dispositivos móveis conectados ao Wi-Fi.
- O utilitário `network.ts` foi atualizado com um filtro rigoroso (`isVirtualInterface`):
  - Prioriza explicitamente interfaces Wi-Fi (`wl*`, `wifi*`) e Ethernet física (`eth*`, `en*`).
  - Descarta interfaces virtuais e de contêineres da lista principal quando há interfaces físicas ativas.
  - No terminal, não apresenta bridges virtuais como se fossem endereços Wi-Fi acessíveis para smartphones; se apenas bridges virtuais forem encontradas, rotula-as explicitamente como interfaces virtuais/locais e orienta a conexão ao Wi-Fi.
  - No componente `Invite.tsx`, a URL preferencial do QR Code prioriza interfaces físicas e exibe aviso caso apenas interfaces virtuais estejam selecionadas.
  - Mantém compatibilidade com contêineres e ambientes virtuais de teste.

### 3.3 Tratamento Amigável de Porta em Uso (`EADDRINUSE`)
- O servidor (`apps/server/src/main.ts`) monitora o evento de erro de escuta TCP.
- Se a porta configurada (ex.: 3000) já estiver ocupada, o servidor não emite um stack trace confuso; em vez disso, exibe uma mensagem amigável com a instrução exata para rodar em outra porta:
  `A porta 3000 já está em uso por outro processo. Para iniciar em outra porta, use: PORT=3001 ./scripts/start.sh`

---

## 4. Comportamento de Recuperação após Interrupções

1. **Aba do Celular Fechada ou Atualizada**:
   - O token da sessão é armazenado no `localStorage` do dispositivo móvel sob a chave `poker-table.session.v1.<codigo-da-sala>`.
   - Ao reabrir o navegador ou recarregar a página, o cliente reconecta automaticamente via Socket.IO ou rota `/join/:code`, reocupando o mesmo assento e exibindo as fichas e status em tempo real.
2. **Queda Temporária de Wi-Fi / Celular em Espera**:
   - O Socket.IO reestabelece a conexão assim que a rede local volta a responder, solicitando a sincronização do estado (`room-state`).
   - Se o jogador estiver na sua vez, a contagem de tempo e as opções de aposta permanecem autoritativas e sincronizadas.
3. **Servidor Reiniciado / Interrupção do Computador**:
   - Cada aposta, avanço de street, showdown e distribuição de fichas é persistido atomicamente em `data/poker-table.sqlite`.
   - Ao reiniciar o servidor (`./scripts/start.sh`), o estado completo da sala e da mão ativa é restaurado do SQLite. Os clientes conectados reingressam na partida sem perda de fichas ou de progresso.

---

## 5. Resumo dos Testes Automatizados Adicionados

1. **Teste Unitário de Interfaces de Rede (`tests/network.test.ts`)**:
   - Valida que interfaces de Docker (`docker0`, `br-xxx`, `vethxxx`) são filtradas e que a interface Wi-Fi física é selecionada com prioridade para a geração do QR Code.
   - Valida o comportamento de fallback seguro caso apenas interfaces virtuais estejam presentes.
2. **Teste E2E de Operação 100% Offline (`tests/e2e/active-table.spec.ts` - Teste 19)**:
   - Intercepta todas as requisições HTTP/HTTPS efetuadas pelo navegador durante o ciclo de vida completo da aplicação (carregamento de assets, criação de sala, geração de QR Code, entrada de jogadores, apostas, avanço de streets e distribuição de potes).
   - Assevera que exatamente zero requisições a servidores ou domínios externos foram disparadas (`externalRequests.length === 0`), atestando a independência offline da aplicação.

---

## 6. Procedimento Detalhado para o Teste Prático sem Internet

Para realizar o teste de validação presencial em ambiente estritamente desconectado da internet:

### Passo 1: Preparação Prévia (com internet)
Certifique-se de que o projeto já foi compilado:
```bash
npm run build
```

### Passo 2: Desconectar a Internet Externa
- No roteador Wi-Fi: desconecte o cabo WAN/fibra de internet, mantendo a rede Wi-Fi local ativa; **OU**
- No smartphone: crie um ponto de acesso Wi-Fi (roteador móvel / hotspot) com os dados móveis (4G/5G) desativados.
- Conecte o notebook e os celulares a essa mesma rede Wi-Fi sem internet.

### Passo 3: Iniciar o Servidor no Notebook
No terminal do notebook, execute:
```bash
./scripts/start.sh
```
Observe a saída do terminal, que indicará o endereço IP local na rede Wi-Fi (exemplo: `http://192.168.1.15:3000`).

### Passo 4: Conectar os Dispositivos
1. No navegador do notebook, acesse `http://localhost:3000` e clique em **Criar Sala**.
2. No celular Android/iOS, aponte a câmera para o QR Code exibido na tela do notebook ou digite o endereço local no navegador mobile.
3. Escolha o nome e o assento no celular.

### Passo 5: Executar a Partida
1. Inicie a partida no painel do anfitrião.
2. Realize apostas (Check, Call, Raise, All-in) alternando entre o notebook e o celular.
3. Avance as streets (Flop, Turn, River) e liquide o pote no Showdown.
4. Experimente colocar o celular em modo avião por alguns segundos e desativá-lo, verificando a reconexão automática e a integridade das fichas.

---

## 7. Limitações Conhecidas do Aplicativo

- **Uso Exclusivo com Cartas Físicas**: O sistema não sorteia nem distribui cartas virtuais; os jogadores manipulam cartas de baralho físico na mesa.
- **Ambiente Restrito à Rede Local (LAN)**: Não é suportado acesso através da internet aberta (sem suporte nativo a túneis ou NAT traversal).
- **Sem Senha nas Salas**: A segurança baseia-se na restrição de acesso físico à rede Wi-Fi local e no código alfanumérico da sala.
- **Fichas e Pontos Fictícios**: O aplicativo não processa dinheiro real ou transações financeiras.

---

## 8. Avaliação de Prontidão para a Versão v0.1.0

O Poker Table atinge na Etapa 4E.3 o estado de maturidade necessário para a primeira versão utilizável (v0.1.0):

- **Motor Financeiro**: Autoritativo, determinístico, com preservação estrita da conservação de fichas em potes múltiplos e side pots.
- **Interface Mobile**: Otimizada para telas de 320px a 390px, com áreas de toque confortáveis (≥ 48px) e leitura integral de valores financeiros.
- **Confiabilidade**: Total independência de serviços em nuvem, inicialização simples e recuperação resiliente via SQLite local.
- **Qualidade de Código**: Cobertura por 482 testes unitários e de integração (Vitest) e 19 testes E2E (Playwright) executados e aprovados de ponta a ponta.
