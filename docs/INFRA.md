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

| Serviço                  | Estado                                       | Endereço                                                 |
| ------------------------ | -------------------------------------------- | -------------------------------------------------------- |
| GitHub                   | Configurado                                  | https://github.com/Hadukem-Fluxion/stock-arena (privado) |
| Supabase                 | Configurado                                  | Projeto `mstocks-arena`, ref `djlyrllwnvvljxexusbw`      |
| Discord Developer Portal | Configurado (Activities pendente de staging) | mStocks Arena, Client ID `1560368721216938175`           |
| Telegram BotFather       | A criar                                      | —                                                        |
| Vercel                   | A criar                                      | —                                                        |
| Railway                  | A criar                                      | —                                                        |

O Claude informa as mudanças e o Codex atualiza esta tabela.

## Discord e URL mappings de staging

- App: **mStocks Arena**, Client ID público `1560368721216938175`.
- OAuth2 redirect cadastrado: `https://127.0.0.1`.
- Activities ainda desligado até existir o domínio público da Vercel. O Claude
  configura os mappings e habilita Activities no Developer Portal com o Hadukem.
- `DISCORD_CLIENT_ID` na API e `VITE_DISCORD_CLIENT_ID` no build web recebem o ID
  público acima. O segredo fica somente no `.env` local e na API Railway.

Em Activities → URL Mappings, cadastrar os destinos **sem `https://`** e colocar o
prefixo mais específico antes da raiz:

| Prefix         | Target                                               | Uso                                                                                                                 |
| -------------- | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `/stock-logos` | `xstocks-metadata.backed.fi`                         | Logos oficiais; `/stock-logos/logos/tokens/AAPLx.png` encaminha para `/logos/tokens/AAPLx.png` no host de metadados |
| `/`            | Host público da Vercel, a registrar depois do deploy | Web, `/brand/*`, fontes locais e `/api/*` pelo rewrite da Vercel para a API Railway                                 |

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
Ainda falta registrar o hostname real da Vercel e validar login, logos e check-in
no servidor de teste do Discord; testes simulados não concluem essa validação.

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
