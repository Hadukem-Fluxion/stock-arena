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

| Serviço                  | Estado      | Endereço                                                 |
| ------------------------ | ----------- | -------------------------------------------------------- |
| GitHub                   | Configurado | https://github.com/Hadukem-Fluxion/stock-arena (privado) |
| Supabase                 | A criar     | —                                                        |
| Discord Developer Portal | A criar     | —                                                        |
| Telegram BotFather       | A criar     | —                                                        |
| Vercel                   | A criar     | —                                                        |
| Railway                  | A criar     | —                                                        |

O Claude atualiza esta tabela à medida que cada serviço é configurado.
