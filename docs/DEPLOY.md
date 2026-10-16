# Deploy de staging (T23)

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

| Variável                                  | Configuração                                                                                      |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `SESSION_SECRET`                          | segredo aleatório de pelo menos 32 bytes, inserido pelo Hadukem                                   |
| `PORT`                                    | automático do Railway; não copiar a porta local nem configurar manualmente                        |
| `API_PORT`                                | opcional para desenvolvimento; ignorado quando `PORT` está presente                               |
| `DISCORD_CLIENT_ID`                       | ID público, quando o app de teste estiver criado                                                  |
| `DISCORD_CLIENT_SECRET`                   | segredo do app, inserido pelo Hadukem                                                             |
| `DISCORD_PUBLIC_KEY`                      | chave pública Ed25519 de General Information no Developer Portal; Claude copia para a API Railway |
| `TELEGRAM_BOT_TOKEN`                      | token do bot de teste, inserido pelo Hadukem                                                      |
| `ADMIN_DISCORD_IDS`, `ADMIN_TELEGRAM_IDS` | opcionais, IDs de administradores autorizados                                                     |

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
   retenção. As 3 migrations atuais são aplicadas por histórico; não editar migrations
   antigas ou reverter o ledger. Mudança futura incompatível exige plano de banco
   separado e backup pelo Hadukem antes de implantar.
4. Validar health/rewrite e os ciclos de preço novamente e registrar os commits.

Referências oficiais: [configuração dinâmica Vercel](https://vercel.com/docs/project-configuration/vercel-ts),
[rewrites](https://vercel.com/docs/routing/rewrites), [Railpack Node](https://railpack.com/languages/node/),
[comandos Railway](https://docs.railway.com/builds/build-and-start-commands),
[pre-deploy](https://docs.railway.com/deployments/pre-deploy-command) e
[healthchecks](https://docs.railway.com/deployments/healthchecks).
