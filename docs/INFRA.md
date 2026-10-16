# Infraestrutura

Todas as contas pertencem ao Hadukem. O Claude configura os painéis pelo navegador depois que o Hadukem faz login; o Codex trabalha só no repositório e no terminal. Ninguém além do Hadukem digita senhas ou chaves secretas.

## Serviços

| Serviço                  | Para que serve             | Quando é necessário     | Variáveis que gera                                                                              | Onde o valor fica                                   |
| ------------------------ | -------------------------- | ----------------------- | ----------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| GitHub                   | Código, pull requests e CI | Agora                   | —                                                                                               | —                                                   |
| Supabase                 | Banco Postgres             | Antes da T04            | `DATABASE_URL`                                                                                  | `.env` local e Railway                              |
| Discord Developer Portal | App com Activities e bot   | Antes da T07            | `DISCORD_CLIENT_ID` (público), `DISCORD_CLIENT_SECRET`, `DISCORD_BOT_TOKEN`, `DISCORD_GUILD_ID` | `.env` local, Railway; o Client ID também na Vercel |
| Telegram BotFather       | Bot de teste e bot oficial | Antes da T07            | `TELEGRAM_BOT_TOKEN`, `TELEGRAM_BOT_USERNAME`                                                   | `.env` local (bot de teste), Railway (bot oficial)  |
| Vercel                   | Frontend (`apps/web`)      | Fim da fase 0 (staging) | —                                                                                               | —                                                   |
| Railway                  | API, worker e bots         | Fim da fase 0 (staging) | `SESSION_SECRET`, `MANTLE_RPC_URL`, `FLUXION_POOLS_JSON`, ids de admin                          | Variáveis do projeto no Railway                     |

## Regras

- Segredos nunca entram no repositório, em issues, em PRs nem em chats. Se um segredo vazar, ele é trocado no painel do serviço no mesmo dia.
- Valores públicos (Client ID do Discord, nome do bot, URL do repositório) podem aparecer em documentos e chats.
- Desenvolvimento usa o bot de teste do Telegram e um servidor de teste do Discord. O bot oficial e o servidor da Mantle só recebem versões aprovadas.
- Cada ambiente tem seus próprios segredos: local (`.env`), staging e produção (painéis da Vercel e do Railway).

## Estado atual

| Serviço                  | Estado                                           | Endereço                                                                            |
| ------------------------ | ------------------------------------------------ | ----------------------------------------------------------------------------------- |
| GitHub                   | Configurado                                      | https://github.com/Hadukem-Fluxion/stock-arena (público)                            |
| Supabase                 | Configurado                                      | Projeto `mstocks-arena`, ref `djlyrllwnvvljxexusbw`                                 |
| Discord Developer Portal | Configurado (Activities ligado: Web/iOS/Android) | mStocks Arena, Client ID `1560368721216938175`                                      |
| Telegram BotFather       | A criar                                          | —                                                                                   |
| Vercel                   | Configurado (Hobby)                              | https://mstocks-arena.vercel.app                                                    |
| Railway                  | Configurado (API e worker)                       | https://stock-arenaapi-production.up.railway.app (API); worker sem endpoint público |

O Claude informa as mudanças e o Codex atualiza esta tabela.

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

URL mappings cadastrados no Discord (targets sem protocolo; prefixo específico
antes da raiz):

| Prefix         | Target                       | Uso                                              |
| -------------- | ---------------------------- | ------------------------------------------------ |
| `/stock-logos` | `xstocks-metadata.backed.fi` | Logos oficiais das ações                         |
| `/`            | `mstocks-arena.vercel.app`   | Web, marcas/fontes locais e `/api/*` via rewrite |

Configuração e rollback: [DEPLOY.md](DEPLOY.md). Credenciais permanecem apenas no
`.env` local e nos painéis apropriados; segredos da API não entram no frontend.
Activities habilitado não substitui o teste real de login, logos e jogos nas
plataformas. O Telegram continua com o estado acima até confirmação do setup.

Verificação sem autenticação pelo Codex em 16/10/2026: web, `/api/health` da API
Railway e `/api/health` pelo rewrite da Vercel responderam HTTP 200; os dois health
checks retornaram `ok: true`. O estado do worker e as opções do Developer Portal
acima foram informados pelo Hadukem, sem acesso do Codex aos painéis.

## Scan de segredos do histórico

Executado em 16/10/2026 com [Gitleaks 8.30.1](https://github.com/gitleaks/gitleaks/releases/tag/v8.30.1),
binário oficial para Windows com SHA256 conferido contra o arquivo de checksums
da release. Checkout completo (não shallow), após `git fetch --all --tags --prune`.

```powershell
gitleaks git . --log-opts="--all --full-history" --redact=100 --no-banner --no-color --log-level=error --ignore-gitleaks-allow --max-decode-depth=2 --max-archive-depth=2 --report-format=json --report-path=.corepack/gitleaks-history.json
```

Escopo: todo o histórico alcançável por branches locais/remotas e tags, incluindo
a branch da T09 ainda em revisão. Nenhuma baseline ou exceção local foi adicionada;
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
