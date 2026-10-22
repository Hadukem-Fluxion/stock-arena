# Infraestrutura

Todas as contas pertencem ao Hadukem. O Claude configura os painéis pelo navegador depois que o Hadukem faz login; o Codex trabalha só no repositório e no terminal. Ninguém além do Hadukem digita senhas ou chaves secretas.

## Serviços

| Serviço                  | Para que serve                        | Quando é necessário     | Variáveis que gera                                                                              | Onde o valor fica                                              |
| ------------------------ | ------------------------------------- | ----------------------- | ----------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| GitHub                   | Código, pull requests e CI            | Agora                   | —                                                                                               | —                                                              |
| Supabase                 | Banco Postgres                        | Antes da T04            | `DATABASE_URL`                                                                                  | `.env` local e Railway                                         |
| Discord Developer Portal | App com Activities e bot              | Antes da T07            | `DISCORD_CLIENT_ID` (público), `DISCORD_CLIENT_SECRET`, `DISCORD_BOT_TOKEN`, `DISCORD_GUILD_ID` | `.env` local, Railway; o Client ID também na Vercel            |
| Telegram BotFather       | Bot de teste e bot oficial            | Antes da T07            | `TELEGRAM_BOT_TOKEN`, `TELEGRAM_BOT_USERNAME`                                                   | `.env` local (bot de teste), Railway (bot oficial)             |
| Vercel                   | Frontend (`apps/web`)                 | Fim da fase 0 (staging) | —                                                                                               | —                                                              |
| Railway                  | API, worker e bots                    | Fim da fase 0 (staging) | `SESSION_SECRET`, `MANTLE_RPC_URL`, `FLUXION_POOLS_JSON`, ids de admin                          | Variáveis do projeto no Railway                                |
| AWS Lightsail            | API e worker substitutos, Caddy HTTPS | Migração de hospedagem  | Segredos novos e configuração existente                                                         | `/etc/mstocks-arena/.env`, root, modo 600; cópia local privada |

## Regras

- Segredos nunca entram no repositório, em issues, em PRs nem em chats. Se um segredo vazar, ele é trocado no painel do serviço no mesmo dia.
- Valores públicos (Client ID do Discord, nome do bot, URL do repositório) podem aparecer em documentos e chats.
- Desenvolvimento usa o bot de teste do Telegram e um servidor de teste do Discord. O bot oficial e o servidor da Mantle só recebem versões aprovadas.
- Cada ambiente tem seus próprios segredos: local (`.env`), staging e produção. No Lightsail, `/etc/mstocks-arena/.env` fica fora do checkout com dono root/modo 600. O proxy recebe apenas configuração pública. As referências à Railway abaixo preservam a configuração anterior.

## Estado atual

| Serviço                  | Estado                                                                         | Endereço                                                              |
| ------------------------ | ------------------------------------------------------------------------------ | --------------------------------------------------------------------- |
| GitHub                   | Configurado                                                                    | https://github.com/Hadukem-Fluxion/stock-arena (público)              |
| Supabase                 | Configurado                                                                    | Projeto `mstocks-arena`, ref `djlyrllwnvvljxexusbw`                   |
| Discord Developer Portal | Configurado (Activities ligado: Web/iOS/Android)                               | mStocks Arena, Client ID `1560368721216938175`                        |
| Telegram BotFather       | A criar                                                                        | —                                                                     |
| Vercel                   | Configurado (Hobby)                                                            | https://mstocks-arena.vercel.app                                      |
| Railway                  | Bloqueado — incidente informado pelo Hadukem em 21/10; configuração preservada | https://stock-arenaapi-production.up.railway.app (endereço histórico) |
| AWS Lightsail            | Artefatos preparados em `chore-lightsail-hosting`; criação/deploy pendentes    | IP estático e domínio da API a definir                                |

O Claude informa as mudanças e o Codex atualiza esta tabela.

## Migração para Lightsail — 22/10/2026

O Hadukem informou vazamento de variáveis na Railway em 21/10 e bloqueio continuado.
Não foi realizada uma verificação independente do incidente neste PR. API e worker
passam a ter um procedimento de instalação no Lightsail Ubuntu LTS/1 GB, com
Compose, Caddy, SSH por chave, firewall restrito e rotação de segredos.

O guia é [HOSTING_LIGHTSAIL.md](HOSTING_LIGHTSAIL.md). Não criamos instância nem
alteramos serviços Railway, banco ou segredos reais. Hadukem troca as credenciais
nos provedores, configura IP/DNS e envia o `.env` novo ao servidor, fora do repo.
`OWNER_DISCORD_ID=1225988280596824094` e o Client ID Discord são públicos.

Na Vercel, manter o nome `RAILWAY_API_URL`, substituindo o valor pela nova origem
HTTPS após validar o Lightsail e fazendo rebuild. URLs do web/Activity, mappings,
Interactions Endpoint e webhook Telegram continuam no domínio da Vercel.
O setup real do Telegram e os smoke tests admin/Discord/Telegram ficam pendentes.
T28 foi integrada pelo Hadukem no PR #23; T29 ainda não foi iniciada.

As tabelas e verificações de staging de 16/10 abaixo descrevem o ambiente anterior;
não confirmam a disponibilidade atual da Railway nem do futuro Lightsail.

## Staging

Estado informado pelo Hadukem em 16/10/2026:

- Repositório público por decisão do Hadukem, para uso da Vercel Hobby. A mudança
  de visibilidade não altera as regras de revisão e merge nem a proibição de
  commitar segredos, banco de perguntas do quiz ou limites do antifraude.
- Web: https://mstocks-arena.vercel.app, Vercel Hobby, Root Directory `apps/web`.
  `RAILWAY_API_URL` e o ID público `VITE_DISCORD_CLIENT_ID` configurados no painel.
- API: https://stock-arenaapi-production.up.railway.app; health em `/api/health`
  respondendo e migrations aplicadas. O web mantém chamadas relativas `/api/*`,
  encaminhadas pelo rewrite da Vercel.
- Worker online no Railway, gravando snapshots dos 7 ativos do catálogo de
  lançamento e 5 conferências de pools. Sem endpoint público ou migrations no worker.
- Discord: Activities ligado para Web, iOS e Android. App **mStocks Arena**, Client
  ID público `1560368721216938175`; OAuth2 redirect `https://127.0.0.1`.

URL mappings: ver a tabela única na seção [Discord e URL mappings de staging](#discord-e-url-mappings-de-staging).

Configuração e rollback: [DEPLOY.md](DEPLOY.md). Credenciais permanecem apenas no
`.env` local e nos painéis apropriados; segredos da API não entram no frontend.
Activities habilitado não substitui o teste real de login, logos e jogos nas
plataformas. O Telegram continua com o estado acima até confirmação do setup.

Verificação sem autenticação pelo Codex em 16/10/2026: web, `/api/health` da API
Railway e `/api/health` pelo rewrite da Vercel responderam HTTP 200; os dois health
checks retornaram `ok: true`. O estado do worker e as opções do Developer Portal
acima foram informados pelo Hadukem, sem acesso do Codex aos painéis.

## Discord e URL mappings de staging

- App: **mStocks Arena**, Client ID público `1560368721216938175`.
- OAuth2 redirect cadastrado: `https://127.0.0.1`.
- Activities ligado para Web, iOS e Android; mappings de staging configurados pelo Claude e pelo Hadukem.
- `DISCORD_CLIENT_ID` na API e `VITE_DISCORD_CLIENT_ID` no build web recebem o ID
  público acima. O segredo fica somente no `.env` local e na API Railway.

Em Activities → URL Mappings, os destinos estão cadastrados **sem `https://`**,
com o prefixo mais específico antes da raiz:

| Prefix         | Target                       | Uso                                                                                                                 |
| -------------- | ---------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `/stock-logos` | `xstocks-metadata.backed.fi` | Logos oficiais; `/stock-logos/logos/tokens/AAPLx.png` encaminha para `/logos/tokens/AAPLx.png` no host de metadados |
| `/`            | `mstocks-arena.vercel.app`   | Web, `/brand/*`, fontes locais e `/api/*` pelo rewrite da Vercel para a API Railway                                 |

O código usa caminhos relativos para API e logos dentro da Activity; fora do
Discord, os logos continuam usando suas URLs HTTPS oficiais. Não cadastrar o
domínio Railway separadamente: o cliente chama `/api/*` no mesmo domínio do web.
Se o catálogo passar a usar outro host de imagens, adicionar seu mapping e o
correspondente caminho relativo antes de liberar o ativo.

Links de navegação para Fluxion, Mantle, xStocks e documentação legal usam
`openExternalLink`, sem carregar esses sites dentro do iframe. API pública da
xStocks e RPC Mantle são acessados só pelo worker; não precisam de mapping no
cliente. O script do Telegram só é carregado no Telegram.

Referências oficiais: [URL mappings e ordem dos prefixos](https://github.com/discord/discord-api-docs/blob/main/developers/activities/development-guides/local-development.mdx)
e [mapeamento de URLs no Embedded App SDK](https://github.com/discord/embedded-app-sdk/blob/main/patch-url-mappings.md).
Hadukem confirmou a abertura e o funcionamento da Activity após entrar em um canal
de voz do servidor de teste do Discord e usar o botão de Atividades (foguete),
após o deploy de staging. O comando `/launch` ainda não foi testado. A validação
real do Daily Quiz permanece pendente da T10 e do seed após merge; testes
simulados não substituem essa validação.

## Scan de segredos do histórico

Executado em 16/10/2026 com [Gitleaks 8.30.1](https://github.com/gitleaks/gitleaks/releases/tag/v8.30.1),
binário oficial para Windows com SHA256 conferido contra o arquivo de checksums
da release. Checkout completo (não shallow), após `git fetch --all --tags --prune`.

```powershell
gitleaks git . --log-opts="--all --full-history" --redact=100 --no-banner --no-color --log-level=error --ignore-gitleaks-allow --max-decode-depth=2 --max-archive-depth=2 --report-format=json --report-path=.corepack/gitleaks-history.json
```

Escopo: todo o histórico alcançável por branches locais/remotas e tags, incluindo
a T09 (em revisão na execução original, agora integrada à main). Nenhuma baseline ou exceção local foi adicionada;
comentários `gitleaks:allow` não foram usados para omitir achados. O scan lê o Git,
não o `.env` local ignorado. Relatório detalhado e logs ficam em `.corepack/`,
ignorada pelo Git, com redaction habilitado.

Resultado bruto: **7 alertas**, todos classificados como falsos positivos após
conferência das linhas históricas com os metadados públicos atuais. São os sete
endereços públicos de contratos de tokens; nenhuma credencial foi identificada.
O exit code do scanner é `1` por esses alertas, não um scan sem achados. Localização
única, sem reproduzir nenhum valor detectado:

| Arquivo                            | Commit                                     |
| ---------------------------------- | ------------------------------------------ |
| `packages/game-core/src/assets.ts` | `a07416a210556187bf5a5ec52b2135e1658be625` |

O resultado representa os padrões e o histórico disponíveis nessa execução; não
é uma garantia de ausência de qualquer segredo. Repetir após novos commits ou
alterações de refs. Nenhum histórico foi reescrito e nenhuma credencial foi alterada.

## Supabase

- Projeto: `mstocks-arena` (`djlyrllwnvvljxexusbw`).
- Região: `sa-east-1` (São Paulo); plano free.
- Conexão: session pooler (IPv4), porta `5432`, `sslmode=require`.
- Data API desligada; API e worker acessam o Postgres diretamente pelo pooler.
- Credenciais somente no `.env` local e nas variáveis do Railway. Nunca registrar
  a senha ou a string completa de conexão nesta documentação.
- TLS: CA pública oficial em `packages/db/certs/supabase-ca.crt` (subject
  `Supabase Root 2021 CA`, validade até 26/04/2031). O client usa
  `ssl: { ca, rejectUnauthorized: true }`. `DATABASE_SSL_CA` pode indicar outra CA;
  caminhos relativos partem da raiz do repositório. Não desativar a verificação.
- Verificado no Supabase em 15/10/2026: migrations `0000`, `0001` e `0002`
  aplicadas, com hashes conferidos no histórico do Drizzle; 12 tabelas no schema
  `public`; trigger do ledger rejeitou UPDATE e DELETE com código `55000`,
  sem modificar linhas.
