# Deploy de staging (T23)

> **22/10/2026:** Railway bloqueada após incidente de variáveis informado pelo
> Hadukem em 21/10. Este guia é preservado como configuração histórica. Para a
> hospedagem substituta e rotação das credenciais, usar
> [HOSTING_LIGHTSAIL.md](HOSTING_LIGHTSAIL.md). Não copiar os novos segredos para
> a Railway bloqueada nem interpretar as instruções antigas abaixo como estado atual.

Este documento é para o Claude configurar os painéis com o Hadukem logado. O Codex
prepara código e testes; não cria contas, projetos ou serviços. Os segredos são
inseridos pelo Hadukem nos painéis, nunca enviados pelo chat.

A configuração está pronta para revisão. O ambiente público só estará confirmado
quando os serviços forem criados e os testes finais abaixo passarem. As URLs ainda
não foram informadas; registrar os endereços em `docs/INFRA.md` após a implantação.

## Arquitetura e ordem

- Vercel: `apps/web`, build estático do Vite.
- Railway: dois serviços do mesmo repositório, API e worker, com raiz `/`.
- Supabase: Postgres `mstocks-arena`, região São Paulo, session pooler IPv4/5432,
  com a CA pública já incluída em `packages/db/certs/supabase-ca.crt`.
- O browser, Discord e Telegram sempre chamam `/api/*` no domínio da Vercel.
  O rewrite mantém o prefixo `/api` e encaminha ao domínio HTTPS da API Railway.
  A API não precisa de CORS para esse fluxo.

Depois da aprovação e merge do PR: configurar e iniciar a API primeiro (ela aplica
as migrations no pre-deploy); depois iniciar o worker; por último configurar a
Vercel com o domínio da API. O deploy público e a aceitação dependem dessas ações
nos painéis, não são executados por este PR.

### Atualização Higher or Lower (T26)

Após o merge, o pre-deploy da API deve aplicar `0008_hl-predictions`. A migration
encerra sequências Classic ainda ativas, preservando rodadas e ledger; não há
reembolso ou prêmio extra nessa troca. Implantar API, worker e web da mesma revisão.
O worker novo precisa estar online: ele marca a validade de cada amostra primária,
confirma reaberturas, registra halts e liquida as previsões. Amostras antigas com
validade desconhecida não são usadas. Não há variável nova nem seed nesta tarefa.

O cronômetro do cliente não liquida: se o worker estiver atrasado, mostra a espera
pela confirmação. Checar nos logs do worker ciclos sem falhas; testar um palpite
real, fechar/reabrir a Activity, aguardar os 15 minutos e verificar um único prêmio.
Os testes locais usam PGlite e dados fictícios; o PR não aplica migrations no Supabase.
No rollback, encerrar novas previsões até restabelecer API/worker compatíveis;
rollback de código não desfaz a migration nem reativa sequências Classic.

## Admin hub (T28)

Depois do merge, a API aplica `0009_admin-foundation` no pre-deploy. Ela adiciona
Staff, sessões administrativas, estado transitório OAuth e o bloqueio de equipe;
estende a auditoria existente e instala seu trigger de imutabilidade. Não remove
histórico, pontos ou dados de jogadores. Não há seed nesta tarefa.

No serviço **API** da Railway, manter `SESSION_SECRET`, `DISCORD_CLIENT_ID` e
`DISCORD_CLIENT_SECRET` existentes e adicionar:

- `ADMIN_WEB_ORIGIN=https://mstocks-arena.vercel.app` (origem pública HTTPS, sem
  caminho, query, credenciais ou fragmento; usada também para validar Origin).
- `OWNER_DISCORD_ID`: ID pessoal do Hadukem no Discord. Com Developer Mode ativo,
  copiar o ID do usuário. Nunca usar o Client ID do aplicativo.

No Discord Developer Portal → aplicativo mStocks Arena → OAuth2 → Redirects,
**adicionar** `https://mstocks-arena.vercel.app/api/admin/auth/callback`. Manter
o redirect da Activity existente (`https://127.0.0.1`). O admin usa o fluxo web de
[authorization code com state](https://discord.com/developers/docs/topics/oauth2#authorization-code-grant),
scope `identify`, separado da autenticação do SDK da Activity. Não alterar os URL
mappings, Interactions Endpoint ou escopos da Activity para esta tarefa.

Implantar API e web da mesma revisão. Abrir `/admin` diretamente em um navegador
HTTPS (não dentro da Activity/Mini App), entrar com a conta configurada e conferir
o primeiro owner. A criação inicial ocorre uma única vez; mudanças posteriores
de equipe e transferência de ownership são feitas pela tela **Team**, sem editar
env. Se o owner já existe, alterar `OWNER_DISCORD_ID` não transfere seu acesso.

O cookie final é HttpOnly + Secure + SameSite=Strict, por 12h, limitado a
`/api/admin`, sem Domain. Somente o cookie transitório OAuth de 10min usa Lax para
permitir o callback do Discord. O state é de uso único, ligado ao navegador,
e apenas hashes de state/cookie são persistidos. As escritas exigem Origin exato e
CSRF ligado à sessão. Não desativar Secure para testar por HTTP; usar HTTPS local
com origem/redirect registrados, ou staging após o merge. Os testes usam mocks,
sem credenciais reais.

As páginas `/admin` recebem headers contra embedding, cache e vazamento de
referer; isso não bloqueia a raiz do jogo no Discord. A API não confia em XFF
arbitrário: o hash de IP da auditoria usa o peer de socket (pode ser o proxy no
Railway), sem persistir o IP bruto. Nunca habilitar `trustProxy: true` sem definir
quais proxies são confiáveis.

Teste após o deploy: login de owner, grant de um membro de teste, login do membro,
revogação e nova chamada com sua sessão antiga (deve falhar), filtros da auditoria,
logout e novo login. Confirmar a migration `0009` no Supabase. O PR valida tudo
com PGlite/OAuth simulado; esse teste real continua pendente até o deploy.
O guia do operador é [ADMIN_GUIDE.md](ADMIN_GUIDE.md).

Na T29, as allowlists `ADMIN_DISCORD_IDS`/`ADMIN_TELEGRAM_IDS` foram removidas.
Antes de atualizar, o owner deve cadastrar os operadores pela tela Team; remova
as variáveis antigas do ambiente. Tokens de jogador também não autorizam o admin.
Aplique a migration `0010_admin-operations` antes da API.
A T30 exige também `0011_admin-game-controls` antes de atualizar API/worker;
publique primeiro o web atualizado (compatível com os campos antigos), depois
aplique a migration e atualize API/worker juntos. Activities/Mini Apps já abertas
precisam de reload para os novos formatos de resposta de jogos/ranking.
A migration preserva a Season 1 e adiciona controles. Validar com contas/dados sintéticos os
switches de jogos, a persistência das pausas de ticker e o bloqueio de alterações
de início passado para admin. Consultar o ADMIN_GUIDE para as janelas UTC.
Em um rollback, preservar schema/auditoria e preferir uma revisão compatível com Staff:
uma API anterior à T28 não reconhece suas sessões e volta à autorização legada.

## Railway: configurações dos dois serviços

Em um projeto de staging, criar dois serviços a partir do repositório público
`Hadukem-Fluxion/stock-arena`. Em cada serviço, abrir Settings e configurar:

| Campo                 | API                                                                                              | Worker                                                                                              |
| --------------------- | ------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------- |
| Source / branch       | `main`                                                                                           | `main`                                                                                              |
| Root Directory        | `/` (raiz do monorepo)                                                                           | `/` (raiz do monorepo)                                                                              |
| Builder               | Railpack                                                                                         | Railpack                                                                                            |
| Build Command         | `pnpm install --frozen-lockfile && pnpm verify:node && pnpm --filter @stock-arena/api typecheck` | `pnpm install --frozen-lockfile && pnpm verify:node && pnpm --filter @stock-arena/worker typecheck` |
| Pre-deploy Command    | `pnpm db:migrate`                                                                                | vazio                                                                                               |
| Start Command         | `pnpm start:api`                                                                                 | `pnpm start:worker`                                                                                 |
| Healthcheck Path      | `/api/health`                                                                                    | vazio                                                                                               |
| Healthcheck Timeout   | `300` segundos                                                                                   | padrão                                                                                              |
| Replicas              | `1`                                                                                              | `1`                                                                                                 |
| Restart Policy        | On Failure                                                                                       | On Failure                                                                                          |
| Serverless / sleeping | desativado                                                                                       | desativado                                                                                          |
| Public Networking     | Generate Domain, target port automático (`PORT`)                                                 | desativado                                                                                          |

Usar a raiz inteira: os serviços precisam de `packages/*`, do lockfile, do `tsx` e
do certificado. Não usar `apps/api` ou `apps/worker` como Root Directory. Não usar
`pnpm dev` no Railway: ele inicia serviços extras e um watcher.

A brief permite comandos documentados em vez de `railway.json`; os campos acima
são a configuração a aplicar no painel.

### Variáveis comuns do Railway

Definir nos dois serviços:

| Variável                | Valor/configuração                                           |
| ----------------------- | ------------------------------------------------------------ |
| `NODE_ENV`              | `production`                                                 |
| `RAILPACK_NODE_VERSION` | copiar o conteúdo atual de `.nvmrc` (`24.19.0` neste PR)     |
| `RAILPACK_PRUNE_DEPS`   | `false`, pois o runtime usa `tsx` instalado no workspace     |
| `RAILPACK_NO_SPA`       | `1`, pois ambos são processos Node, não sites estáticos      |
| `DATABASE_URL`          | Hadukem insere a conexão do session pooler Supabase, com SSL |
| `DATABASE_SSL_CA`       | opcional; padrão `packages/db/certs/supabase-ca.crt`         |

O Railpack prioriza `engines.node` antes de `.nvmrc`; o projeto permite Node 22+.
Por isso, selecionar a versão do arquivo por `RAILPACK_NODE_VERSION`. O script
`pnpm verify:node` e os dois start commands interrompem o processo se a versão
não corresponder exatamente a `.nvmrc`. Ao atualizar esse arquivo, atualizar a
variável nos dois serviços e reconstruir as imagens. O pnpm vem de `packageManager`
no package.json raiz (10.28.0), com instalação por lockfile congelado.

A verificação TLS fica sempre ativa. Não usar `rejectUnauthorized: false`,
`NODE_TLS_REJECT_UNAUTHORIZED=0` ou desativar SSL para resolver erros. O arquivo CA
é público e deve permanecer na imagem; `DATABASE_SSL_CA`, quando relativo, parte
sempre da raiz do repositório. Outra CA exige caminho de um arquivo acessível no
container.

### Variáveis somente da API

| Variável                  | Configuração                                                                                      |
| ------------------------- | ------------------------------------------------------------------------------------------------- |
| `SESSION_SECRET`          | segredo aleatório de pelo menos 32 bytes, inserido pelo Hadukem                                   |
| `PORT`                    | automático do Railway; não copiar a porta local nem configurar manualmente                        |
| `API_PORT`                | opcional para desenvolvimento; ignorado quando `PORT` está presente                               |
| `DISCORD_CLIENT_ID`       | ID público, quando o app de teste estiver criado                                                  |
| `DISCORD_CLIENT_SECRET`   | segredo do app, inserido pelo Hadukem                                                             |
| `DISCORD_PUBLIC_KEY`      | chave pública Ed25519 de General Information no Developer Portal; Claude copia para a API Railway |
| `TELEGRAM_BOT_TOKEN`      | token do bot de teste, inserido pelo Hadukem                                                      |
| `TELEGRAM_WEBHOOK_SECRET` | segredo aleatório de 32–256 caracteres URL-safe, inserido pelo Hadukem; valida o webhook T16a     |
| `ADMIN_WEB_ORIGIN`        | `https://mstocks-arena.vercel.app`; origem HTTPS pública do web, sem `/admin`                     |
| `OWNER_DISCORD_ID`        | ID do usuário Discord do Hadukem, para criar o primeiro owner; não é o Client ID                  |

Os provedores não configurados retornam erro de login tipado; `/api/health` continua
público e funciona sem app Discord ou bot Telegram. Não preencher credenciais
fictícias para aparentar uma integração real.

O pre-deploy da API aplica somente migrations pendentes e deve terminar com
`Database migrations applied (postgres).`. Uma falha impede o início da nova
versão. Nunca colocar migrations no worker ou no start compartilhado dos serviços.

### Variáveis somente do worker

| Variável               | Configuração                                                                          |
| ---------------------- | ------------------------------------------------------------------------------------- |
| `XSTOCKS_API_BASE`     | opcional; padrão `https://api.backed.fi/api/v2`                                       |
| `MANTLE_RPC_URL`       | opcional; padrão `https://rpc.mantle.xyz`, ou RPC escolhido pelo time                 |
| `FLUXION_POOLS_JSON`   | vazio/ausente usa os cinco pools públicos em `assets.ts`; `{}` desativa a conferência |
| `PRICE_DIVERGENCE_PCT` | opcional; padrão existente `3`                                                        |
| `PRICE_JUMP_LIMIT_PCT` | opcional; padrão existente `5`                                                        |

Sem `SESSION_SECRET`, tokens de bot ou segredos OAuth no worker. As chamadas de
preço são públicas. O worker deve receber `DATABASE_URL`; o fallback PGlite é para
desenvolvimento e não é persistente no container efêmero do Railway.

A retenção roda na primeira rodada e na primeira rodada de cada novo dia UTC.
Mantém todos os snapshots das últimas 48h (incluindo a fronteira exata) e somente
o último de cada hora UTC anterior por ticker e fonte. Empates antigos preservam
uma linha; linhas recentes nunca são reduzidas. Uma única instrução SQL faz a
limpeza, sem tocar no ledger. Falhas são registradas sem detalhes sensíveis e
retentadas em outra rodada; não interrompem o polling. Horários e ambas as fontes
são cobertos por testes PGlite, inclusive catálogos de 3 e 30 tickers.

## Vercel: web estático

Importar o mesmo repositório. Em Project Settings / Build and Deployment:

| Campo                                                         | Valor                                                               |
| ------------------------------------------------------------- | ------------------------------------------------------------------- |
| Root Directory                                                | `apps/web`                                                          |
| Include source files outside Root Directory in the Build Step | habilitado (workspaces em `packages/`)                              |
| Framework Preset                                              | Vite                                                                |
| Node.js Version                                               | `24.x` (a Vercel gerencia o patch do build estático)                |
| Install Command                                               | `pnpm install --frozen-lockfile` (definido em `vercel.ts`)          |
| Build Command                                                 | `pnpm build` (executa o build de apps/web, definido em `vercel.ts`) |
| Output Directory                                              | `dist` (definido em `vercel.ts`)                                    |
| Git / Production Branch                                       | `main`, cujo domínio será o staging da campanha                     |

`apps/web/vercel.ts` substitui o JSON estático com autorização do Hadukem. A
configuração é avaliada no build e usa `RAILWAY_API_URL` para gerar as rotas:

1. `/api/:path*` → `<origem Railway>/api/:path*`.
2. As rotas do app usam o fallback SPA `/index.html`.

Isso preserva `/api/health`, rotas de login e os futuros endpoints de jogos. Não
mudar o cliente para chamar a origem Railway diretamente. Erros da API continuam
respostas da API; o rewrite de `/api/*` vem antes do fallback da SPA.

Em Settings / Environment Variables, cadastrar para os ambientes usados:

| Variável                 | Onde e qual valor                                                                                                           |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------- |
| `RAILWAY_API_URL`        | Production (staging) e Preview: origem HTTPS do domínio público da API Railway, sem `/api`, query, fragmento ou credenciais |
| `VITE_DISCORD_CLIENT_ID` | Production e Preview: o mesmo ID público da API, quando disponível                                                          |

`RAILWAY_API_URL` não usa prefixo `VITE_` e não precisa ser exposto ao código do
browser. Somente o ID público pode usar esse prefixo. Não cadastrar `DATABASE_URL`,
`SESSION_SECRET`, tokens de bot nem segredo Discord no frontend.

Após alterar `RAILWAY_API_URL`, fazer novo deploy; versões anteriores mantêm a
origem usada em seus builds. Ausência ou formato inválido interrompe a avaliação
com mensagem genérica. Não usar uma URL de exemplo como destino real.

O domínio precisa carregar publicamente no Discord/Telegram: em Deployment
Protection, desabilitar a barreira de login da Vercel para o domínio de staging
escolhido. A autenticação do jogador continua sendo validada pela nossa API.
O rótulo Production da Vercel designa esse domínio de staging; não é a aprovação
para o lançamento público da campanha.

O build de produção não oferece usuário falso no browser. Fora das plataformas,
a página carrega e mostra a instrução para abrir Discord ou Telegram. Isso é o
comportamento esperado da T08.

Após obter o domínio público da Vercel, seguir os URL mappings documentados em
[INFRA.md](INFRA.md#discord-e-url-mappings-de-staging): `/stock-logos` para o host
oficial de imagens antes de `/` para o web. Só então habilitar Activities no app
Discord já cadastrado. O Client ID público está em INFRA.md; o segredo fica na API.

## Testes finais e evidências

### Comandos Discord via Interactions (T24)

A T24 atende `/arena` e `/start` na API por HTTP, sem processo de bot, gateway ou
discord.js. A T15 (bot completo) continua para depois. O handler verifica a
assinatura Ed25519 sobre timestamp + bytes brutos antes de interpretar o JSON;
somente esse POST dispensa sessão do jogador. Assinatura inválida/ausente retorna
401; chave pública ausente ou malformada retorna 503 para pedidos com headers
válidos. A API não consulta o banco nem chama provedores para responder ao PING.

Sequência após aprovação e merge:

1. Claude abre o app **mStocks Arena** no Developer Portal → General Information,
   copia **Public Key** para `DISCORD_PUBLIC_KEY` nas variáveis do serviço **API**
   no Railway e aguarda o deploy. Essa é uma chave pública hexadecimal de 32 bytes
   (64 caracteres); não é o Client Secret nem o Bot Token. Não precisa ir para a
   Vercel, worker ou código-fonte.
2. Confirmar que a nova versão da API está no ar. O rewrite `/api/*` da Vercel já
   encaminha a rota; nenhum novo URL mapping é necessário.
3. Claude cadastra em General Information → **Interactions Endpoint URL**:
   `https://mstocks-arena.vercel.app/api/discord/interactions`.
   O Discord faz um **PING assinado ao salvar** e espera PONG JSON. Portanto, a
   rota e a chave pública correta precisam estar no deploy **antes** de salvar.
   Um POST manual sem assinatura retornar 401 é esperado e não testa o PONG.
4. Codex executa localmente, da raiz do repositório, **uma vez após o merge**:
   `pnpm discord:register-commands`. O `.env` é carregado sem imprimir valores.
   A opção preferida usa `DISCORD_CLIENT_ID` + `DISCORD_CLIENT_SECRET` para obter
   um bearer com `applications.commands.update`. Sem Client Secret, usa o mesmo
   Client ID + `DISCORD_BOT_TOKEN`. Credenciais só no ambiente local; não precisam
   ser adicionadas à Vercel nem ao CI. O comando imprime apenas a contagem em uma
   mensagem de sucesso e sanitiza erros.
5. Testar `/arena` e `/start` no servidor de teste: ambos devem abrir a Activity.
   Os dois são comandos globais CHAT_INPUT, com descrição `Open mStocks Arena`.
   Confirmar que o app está autorizado no servidor para `applications.commands`
   caso os comandos não apareçam. Não registrar novamente apenas por demora de
   propagação global. O comando `/launch` não é registrado nem removido pela T24
   e continua sem teste, conforme informado pelo Hadukem.

O registro faz POST individual por nome/tipo; repetições atualizam os mesmos dois
comandos sem apagar o entry point da Activity nem comandos futuros da T15. Se uma
requisição falhar depois da primeira, corrigir a configuração/erro e repetir o
comando é seguro. Não usar bulk overwrite para esta tarefa. Tokens OAuth, payloads
de interactions e respostas brutas de erro não devem aparecer em logs ou chats.

Referências oficiais: [assinaturas e validação do endpoint](https://docs.discord.com/developers/interactions/overview),
[tipo LAUNCH_ACTIVITY](https://docs.discord.com/developers/interactions/receiving-and-responding),
[registro global e upsert](https://docs.discord.com/developers/interactions/application-commands)
e [client credentials](https://docs.discord.com/developers/topics/oauth2#client-credentials-grant).

### Telegram via webhook na API (T16a)

Esta entrega usa a API existente: nenhum serviço novo no Railway e nenhum
polling do bot. O merge e a configuração real aguardam a recuperação da Railway.
O comando de setup não roda em CI, startup, worker ou deploy.

1. Hadukem gera localmente um segredo aleatório de pelo menos 32 caracteres,
   usando apenas `A-Z`, `a-z`, `0-9`, `_` e `-` (máximo 256). Pode usar o gerenciador
   de senhas ou salvar um valor gerado por `randomBytes(32).toString('base64url')`
   direto no arquivo, sem imprimir. Não enviar o valor no chat.
2. Hadukem preenche `TELEGRAM_BOT_TOKEN` e `TELEGRAM_WEBHOOK_SECRET` no `.env`
   local. Na API Railway, configurar `TELEGRAM_WEBHOOK_SECRET` com o mesmo valor;
   manter o `TELEGRAM_BOT_TOKEN` já usado pelo login Telegram. Não colocar esses
   valores na Vercel, no worker nem no GitHub Actions.
3. Após o merge autorizado, implantar a API e confirmar `/api/health` pelo domínio
   Vercel. A rota precisa estar acessível antes do setup:
   `https://mstocks-arena.vercel.app/api/telegram/webhook`.
   POST sem o header correto deve retornar 401, inclusive sem segredo configurado.
4. **Hadukem**, da raiz do repositório, executa `pnpm telegram:setup`. O comando
   carrega o `.env`, configura `setWebhook` (somente updates `message`),
   `setMyCommands` (start/help) e `setChatMenuButton` (Play, web_app) e imprime
   somente `Telegram setup complete: 3 settings applied.` em caso de sucesso.
   Não imprimir respostas, URLs com token, segredos nem erros brutos. Se falhar
   parcialmente, corrigir o ambiente/acesso e repetir: atualiza as mesmas opções,
   sem apagar updates pendentes. Não executar `getUpdates` nem outro bot por polling
   com o mesmo token enquanto houver webhook configurado.
5. No **chat privado** com o bot, testar `/start`, `/start TEST_PAYLOAD`, `/help`
   e um texto comum. Todas as respostas de texto incluem Play; verificar que ele
   abre o Mini App e que o menu também abre `https://mstocks-arena.vercel.app`.
   O payload fica apenas disponível no parser para T13: nada é salvo por T16a.

O Telegram envia `X-Telegram-Bot-Api-Secret-Token`; apenas esse POST dispensa
sessão de jogador. O endpoint responde com o objeto `sendMessage` no próprio
HTTP, sem chamar a API do Telegram. Updates não suportados são reconhecidos sem
mensagem. O Telegram não retorna o resultado desse envio ao nosso endpoint;
um 200 isolado não substitui a confirmação de recebimento no aplicativo.

Logs da API devem conter apenas caminho/status e erros sanitizados, nunca o
header secreto, token, texto ou update inteiro. Para trocar o segredo, atualizar
Railway e `.env`, implantar e repetir setup; um desencontro retorna 401 até os
valores coincidirem. Em rollback, manter uma revisão que suporte esse endpoint
ou restaurar conscientemente a configuração anterior do webhook; rollback de
código sozinho não muda o que foi configurado no Telegram. Lembretes opt-in ficam
para a T16 futura.

Referências oficiais: [responder pelo próprio webhook](https://core.telegram.org/bots/api#making-requests-when-getting-updates),
[segredo do webhook](https://core.telegram.org/bots/api#setwebhook),
[botão web_app em chat privado](https://core.telegram.org/bots/api#inlinekeyboardbutton)
e [menu padrão](https://core.telegram.org/bots/api#setchatmenubutton).

### Verificações do staging (T23)

Preflight local em 15/10/2026: lint, formatação, tipagem, 162 testes unitários,
build e 7 testes Playwright passaram. A entrada real da API respondeu 200 usando
`PORT` com prioridade sobre `API_PORT`. Um ciclo real de preços públicos gravou
sete fontes primárias e cinco conferências de pools em PGlite isolado em memória,
sem acessar ou limpar o Supabase.

Nesse ciclo houve falha na consulta paginada dos status de negociação; uma nova
tentativa limitada a 45 segundos terminou com erro de rede. Os quotes chegaram,
mas os tickers mantiveram a proteção `paused/stale` por ausência de metadados.
O oráculo integrado não foi alterado neste PR. Revalidar os metadados no staging
antes de liberar jogos que dependem de preços; este preflight não confirma a
saúde completa do feed.

Claude e Hadukem executam após configurar os painéis:

1. Abrir o domínio público HTTPS da API e consultar `/api/health`: HTTP 200, JSON
   com `ok: true` e a lista de tickers atual.
2. Abrir a URL Vercel: shell e marcas carregam sem erro. Abrir também uma rota do
   app, como `/profile`, para confirmar que o fallback entrega o shell (a navegação
   atual por abas permanece na T08).
3. Consultar `<domínio Vercel>/api/health`: deve responder JSON da API, não HTML,
   sem redirecionar o navegador ao Railway. Exemplo em PowerShell, substituindo o
   domínio público:

   ```powershell
   Invoke-RestMethod 'https://SEU-DOMINIO.vercel.app/api/health'
   ```

4. Em Railway / worker / Deploy Logs, aguardar pelo menos duas rodadas de preços:
   `stored xStocks snapshots: ...`. Conferir todos os ativos do catálogo de
   lançamento (atualmente Magnificent 7) e o contador das conferências dos pools.
   Ver `Price retention complete: ...` na primeira rodada.
5. Com os apps de teste criados, configurar o URL mapping raiz da Activity para o
   domínio Vercel e o Mini App do bot de teste para a mesma origem HTTPS. Repetir
   login nas duas plataformas. Capturas reais completam a aceitação externa da T08.
6. Informar ao Codex URLs públicas, commit implantado e resultados. O Codex registra
   no INFRA; não compartilhar segredos ou conteúdo do `.env`.

A T23 só tem a aceitação pública concluída depois dessas evidências. Sem painéis
configurados, testes locais e CI confirmam a preparação, não um staging publicado.

## Logs e diagnóstico

- Railway / serviço / Deployments / deployment / Build Logs: versão de Node/pnpm,
  instalação congelada e typecheck. Deploy Logs: migration da API, porta, health e
  ciclos do worker. Logs também ficam na aba Observability / Logs do projeto.
- Vercel / projeto / Deployments / deployment / Build Logs: avaliação do config,
  build Vite e arquivos estáticos. Runtime Logs / logs de requests ajudam a conferir
  falhas de rewrite. A lógica do backend e seus logs ficam no Railway.
- Erro no health direto da API: conferir serviço ativo, `PORT` automático, comando
  de start e health path. API direta saudável e rewrite com falha: conferir a origem
  em `RAILWAY_API_URL`, novo deploy e proteção do domínio.
- `self-signed certificate in certificate chain`: conferir CA na imagem e caminho
  de `DATABASE_SSL_CA`, mantendo validação TLS ativa.
- Falha de migration: interromper a implantação e informar só a mensagem sanitizada.
  Não copiar a conexão completa, senha, headers de autenticação ou initData em logs.

## Rollback

1. Na Vercel, abrir Deployments e selecionar o último deployment saudável compatível
   com a API. Usar a ação de rollback/promover para restaurar seu domínio. Conferir
   `/api/health` pelo domínio e o shell novamente. A origem Railway acompanha a
   configuração daquele build; uma alteração de variável exige outro deploy.
2. No Railway, abrir Deployments de cada serviço e usar Rollback no último deploy
   saudável, quando disponível, ou redeploy do commit aprovado correspondente.
   Começar pela API, verificar health e depois restaurar o worker compatível.
3. Rollback de código não desfaz migrations nem recupera snapshots já reduzidos pela
   retenção. As migrations são aplicadas por histórico; não editar migrations
   antigas ou reverter o ledger. Mudança futura incompatível exige plano de banco
   separado e backup pelo Hadukem antes de implantar.
4. Validar health/rewrite e os ciclos de preço novamente e registrar os commits.

Referências oficiais: [configuração dinâmica Vercel](https://vercel.com/docs/project-configuration/vercel-ts),
[rewrites](https://vercel.com/docs/routing/rewrites), [Railpack Node](https://railpack.com/languages/node/),
[comandos Railway](https://docs.railway.com/builds/build-and-start-commands),
[pre-deploy](https://docs.railway.com/deployments/pre-deploy-command) e
[healthchecks](https://docs.railway.com/deployments/healthchecks).
