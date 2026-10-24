# Deploy de staging — Ohio

**24/10/2026:** Lightsail e Supabase foram criados pelo Hadukem em us-east-2.
Deploy/virada ainda pendentes. Railway é histórico bloqueado após o incidente
informado pelo Hadukem; não recebe segredos novos nem é destino de rollback.
O roteiro completo, com um comando por bloco e tratamento de erros, está em
[HOSTING_LIGHTSAIL.md](HOSTING_LIGHTSAIL.md). Codex prepara o PR/testes;
Hadukem executa e digita segredos, Claude acompanha os painéis. Nenhuma ação
real de deploy/banco ou exclusão é executada pelo PR.

## Destinos e ordem

- Web na Vercel: https://mstocks-arena.vercel.app, Root Directory apps/web,
  configuração versionada vercel.ts, Vite estático. Não trocar URL de Activity/Mini App.
- API/worker: Lightsail mstocks-arena, Ohio/zona A, Ubuntu 24.04, 1 GB/2 vCPU/40 GB,
  StaticIp-1 77.114.44.78. Caddy atende https://77-114-44-78.sslip.io.
- Banco: mstocks-arenaUS, fhslaelrgoiibblgfinu, Ohio/Free, Data API desligada;
  session pooler aws-0-us-east-2.pooler.supabase.com:5432, sslmode=require,
  CA verificada em packages/db/certs/supabase-ca.crt.
- Build pinned Node 24.19.0 / pnpm 10.28.0, frozen lockfile; pnpm start:api e
  pnpm start:worker com tsx. Worker sem porta pública, API apenas loopback,
  Caddy 80/443. Docker tem limites de memória/logs; swap 2 GB é necessário no plano.

Depois da revisão/merge: checkout aprovado → bootstrap/hardening → env privado
e rotação → deploy.sh prepare (migrations, apps parados) → cópia só de conteúdo
local pelo Hadukem → deploy.sh deploy → smoke-test.sh --live → Vercel rebuild
→ telegram:setup → testes manuais → aprovação → pausa/retirada do ambiente antigo.
Não executar smoke-test sem --live em produção: esse modo é exclusivo de CI.

Journal completo nesta revisão: 0000 bootstrap, 0001–0012 (13 entradas). A migration
é da API/pre-start, nunca do worker. Falha impede startup. Não mudar SQL antigo,
não usar fallback PGlite em produção e não copiar o banco inteiro.

## Variáveis por destino

| Destino                                          | Configuração                                                                                                                                                                                                                                                                                                                                                                                                          |
| ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Servidor /etc/mstocks-arena/.env, root/600       | DATABASE_URL novo, DATABASE_SSL_CA, SESSION_SECRET novo, DISCORD_CLIENT_ID, DISCORD_CLIENT_SECRET novo, DISCORD_PUBLIC_KEY, TELEGRAM_BOT_TOKEN novo, TELEGRAM_WEBHOOK_SECRET novo, TELEGRAM_BOT_USERNAME=mStocksArenaBot, TELEGRAM_WEBHOOK_URL=https://77-114-44-78.sslip.io/api/telegram/webhook, ADMIN_WEB_ORIGIN=https://mstocks-arena.vercel.app, OWNER_DISCORD_ID=1225988280596824094, RPC/pools/config aprovada |
| Servidor /etc/mstocks-arena/public.env, root/600 | API_HOST=77-114-44-78.sslip.io; nenhum segredo da aplicação vai para Caddy                                                                                                                                                                                                                                                                                                                                            |
| Vercel, build Production/preview aprovado        | API_ORIGIN=https://77-114-44-78.sslip.io, VITE_DISCORD_CLIENT_ID=1560368721216938175; durante transição RAILWAY_API_URL com a mesma origem                                                                                                                                                                                                                                                                            |
| .env local ignorado                              | Cópia privada dos valores novos, mais VITE_DISCORD_CLIENT_ID público, para ferramentas locais/setup; nunca commitar                                                                                                                                                                                                                                                                                                   |
| Somente processo PowerShell durante cópia        | OLD_DATABASE_URL e NEW_DATABASE_URL, digitadas via Read-Host -MaskInput; remover ao terminar, nunca imprimir                                                                                                                                                                                                                                                                                                          |

API_ORIGIN tem prioridade sobre RAILWAY_API_URL; o fallback só existe se a nova
chave estiver ausente. Nova chave vazia/inválida falha o build. Nenhuma das duas
vai ao bundle VITE_; só determina o rewrite /api/:path* antes do fallback SPA.
Não usar origem com /api, query, credenciais ou HTTP. Nenhum CORS novo é necessário.

Os templates server.env.example/public.env.example têm só placeholders/públicos.
O gerador rotate-secrets.mjs grava dois valores URL-safe de 48 caracteres sem
imprimir. validate-env.mjs api --file valida placeholders/Ohio sem conectar a
serviços e sem mostrar valores. Não repetir rotação sem sincronizar servidor/local.

## Dados novos e owner

O comando db:copy-game-content lê apenas perguntas e controle do quiz, com modo
dry-run e contagens. Origem read-only; destino transacional, idempotente antes
do primeiro login e bloqueado se houver contas/ledger/staff/flags/recompensas.
Se o controle não existe no schema antigo, usa o singleton novo. Fatos/catálogo
estão no código, não no banco. Não copia sets diários, histórico ou preços.

Pré-lançamento reinicia jogadores, identidades, pontos, ledger, flags, equipe e
recompensas. Não é uma migração de contas. OWNER_DISCORD_ID público recria o
primeiro owner no primeiro login do banco vazio; alterações posteriores de equipe
usam o admin hub, nunca allowlists legadas. Não rodar seed-quiz contra o banco
novo além da cópia sem uma necessidade aprovada.

## Admin hub (T28–T31)

O admin abre em /admin no navegador, fora de Activity/Mini App. No Discord OAuth2,
manter o redirect https://mstocks-arena.vercel.app/api/admin/auth/callback. A API
constrói o callback com ADMIN_WEB_ORIGIN, sem confiar no host interno do proxy.
Não substituir pelo domínio Lightsail. Cookie admin Secure/HttpOnly/SameSite=Strict,
12 h, revogação e permissões de Staff continuam obrigatórios; não relaxar CSRF
nem adicionar allowlists antigas para resolver login.

0009 cria equipe/auditoria, 0010 operações/controle do banco de quiz, 0011 jogos e
temporadas, 0012 recompensas. Implantar API/worker compatíveis e web aprovada.
Temporadas começam com os dados provisórios de configuração sem importar temporadas
antigas. Ledger/admin_actions/históricos são append-only. O follow-up T31 tem PR
separado; conferir sua integração para trava automática ao congelar e flag CSV.
[ADMIN_GUIDE.md](ADMIN_GUIDE.md) mantém o fluxo operacional em inglês.

Quiz mantém a política documentada: 30 s continuam durante manutenção. HL mantém
liquidação no worker de previsões já travadas, mesmo com jogo pausado; cliente
apenas exibe. A virada não muda regras nem valores; testes reais de partidas
novas devem aguardar os 15 min ou a reabertura quando o mercado está fechado.

## Discord e Telegram

- Client ID público 1560368721216938175 igual na API/web; secret novo só API/local.
  DISCORD_PUBLIC_KEY é a chave Ed25519 pública usada nas Interactions.
- URL mappings: / → mstocks-arena.vercel.app; /stock-logos → xstocks-metadata.backed.fi.
  Fontes/brand são locais. Chamadas do cliente continuam relativas /api/*.
- Interactions Endpoint continua https://mstocks-arena.vercel.app/api/discord/interactions;
  Discord valida PING assinado. /arena e /start não exigem registro novamente.
- telegram:setup usa TELEGRAM_WEBHOOK_URL para registrar webhook direto em Ohio,
  allowed_updates message e segredo novo; Play/menu continuam com a URL web Vercel.
  Configura webhook, comandos e menu explicitamente, nunca no CI/startup/worker.
  Nenhum novo serviço/polling. Mensagens privadas /start e /help continuam na API.
- Revoke do BotFather e Reset Secret Discord são feitos por Hadukem nos painéis;
  não colar valores no chat ou logs. Não usar tokens revogados no rollback.

## Aceitação, logs e rollback

Executar o checklist de HOSTING_LIGHTSAIL.md com Discord/Telegram reais e admin
owner/overview/rewards. Health precisa responder direto e via rewrite; worker
precisa gravar primários de todo o catálogo e conferências dos pools. Conferir
as contagens da cópia e ausência de contas importadas. Registrar UTC/SHA/testes
em INFRA.md; recursos criados não significam deploy validado.

Logs limitados pelo Compose, sem tokens/initData/OAuth codes; nunca publicar env
ou dumps. Erros de banco/TLS devem permanecer sanitizados. Em falha, parar writer
e corrigir; rollback só para imagem compatível já saudável no banco novo, sem
down-migration/apagar volume/ledger. Web anterior precisa de **novo build com
API_ORIGIN Ohio**; promover artefato antigo pode restaurar rewrite Railway.

Só após tudo verde e aprovação do Hadukem: pausar projeto antigo djlyrllwnvvljxexusbw,
retirar variáveis/serviços antigos da Railway pelos painéis e remover a variável
de compatibilidade da Vercel com rebuild/health. Procedimento histórico Railway
permanece nos arquivos railway.json e no histórico Git; nunca é destino ativo.
