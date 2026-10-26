# Deploy de staging — Ohio

**24/10/2026:** Hadukem informou a virada concluída no SHA `9fe93dc`: API/worker/Caddy
no ar em Ohio, 13 migrations, 60 perguntas copiadas, Telegram setup e Vercel API_ORIGIN ok.
O follow-up corrige os pontos encontrados na execução; novos deploys exigem SHA aprovado.
Railway é histórico bloqueado após o incidente
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
  Caddy 80/443. UFW permite 22/80/443 sem IP fixo; SSH só por chave, com
  restrição opcional de origem apenas no console Lightsail. Abrir 443 explicitamente
  no painel (padrão: apenas 22/80). Docker tem limites de memória/logs; swap 2 GB
  é necessário no plano.

Depois da revisão/merge: checkout aprovado → bootstrap/hardening → env privado
e rotação → deploy.sh prepare (migrations, apps parados) → cópia só de conteúdo
pelo Hadukem (container no servidor ou PowerShell 7 local) → deploy.sh deploy → smoke-test.sh --live → Vercel rebuild
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
| Somente processo de cópia                        | No servidor: read -s + stdin do container; DATABASE_URL novo vem do arquivo privado. Alternativa PowerShell 7: OLD_DATABASE_URL e NEW_DATABASE_URL via Read-Host -MaskInput; limpar variáveis ao terminar, nunca imprimir                                                                                                                                                                                             |

API_ORIGIN tem prioridade sobre RAILWAY_API_URL; o fallback só existe se a nova
chave estiver ausente. Nova chave vazia/inválida falha o build. Nenhuma das duas
vai ao bundle VITE_; só determina o rewrite /api/:path* antes do fallback SPA.
Não usar origem com /api, query, credenciais ou HTTP. Nenhum CORS novo é necessário.

Os templates server.env.example/public.env.example têm só placeholders/públicos.
O gerador rotate-secrets.mjs grava dois valores URL-safe de 48 caracteres sem
imprimir. validate-env.mjs api --file valida placeholders/Ohio sem conectar a
serviços e sem mostrar valores. Não repetir rotação sem sincronizar servidor/local.
Validate-env e diagnósticos de arquivo usam `docker run --user 0` nos containers
temporários, pois o env é root/600; API/worker continuam como node. Comandos Compose
no SSH passam `sudo APP_RELEASE=$(sudo git rev-parse HEAD) docker compose ...`.
O smoke --live aguarda até cerca de 60 s pelo HTTPS/ACME, mantendo TLS verificado.
O [roteiro](HOSTING_LIGHTSAIL.md) inclui cópia de conteúdo e telegram:setup no
container; Windows precisa apenas de SSH, sem Node/PowerShell 7 nessa alternativa.

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

## Convites (T34)

Aplique a migration 0013 antes de implantar a API/worker correspondentes. Não há
script de configuração ou registro novo de comandos. Na API, configure
TELEGRAM_BOT_USERNAME=mStocksArenaBot (sem @), junto do DISCORD_CLIENT_ID já
existente. Esses identificadores públicos geram os links; nenhum token é enviado
ao cliente. Sem um identificador válido, a tela informa que o link está pendente
e mantém o código manual disponível.

A atribuição no Telegram usa o start_param do initData assinado no login, não o
payload do /start no webhook. Após a implantação pelo operador, valide uma conta
nova em cada plataforma: convite registrado no login, +20 no primeiro check-in
e +50 ao convidador somente após 200 pontos de jogos do amigo. O controle
Invite friends no admin pausa cadastro/bônus sem interromper os outros jogos.

## mStocks Flyer (T27)

Antes da API desta versão, aplique a migration 0014 (nova tabela flyer_sessions e
controle de manutenção). Nenhum banco real é alterado pelo Codex nesta entrega.
O operador configura na API duas variáveis privadas, sem valores padrão no repo:

- FLYER_MAX_FINISHES_PER_DAY: inteiro positivo, escolhido pelo Hadukem.
- FLYER_MAX_SESSION_SECONDS: inteiro positivo menor que os 600 segundos da
  expiração pública da sessão, reservando tempo para enviar o resultado.

Não coloque valores de antifraude em PR, documentação pública ou conversa. Sem
valores válidos, a API continua saudável e os outros jogos funcionam; o Flyer
informa que está sendo preparado. Worker, Vercel e bots não precisam dessas variáveis.
Rebuild/deploy e mudanças no .env real são feitos pelo operador após o merge.

O percurso usa até um dia de amostras primárias por ativo (24h divididas pelo
intervalo de coleta), distribuídas por posição em dez grupos, preservando os
preços inicial/final. Precisa de pelo menos dez timestamps distintos. Lacunas de
mercado fechado não gastam o orçamento de amostras: segunda-feira/feriado combinam
a sessão nova com o histórico anterior, inclusive os dados horários da retenção.
Se o último dado tiver mais de 120 segundos, mostra "Last session". Sem histórico
suficiente, a tela mostra "Flyer is getting today's charts ready. Try again soon."
e um botão "Try again" que tenta iniciar novamente.
Não usa pools nem dados fictícios como fallback. Após iniciar um banco sem histórico,
aguarde a coleta real; ausência de um gráfico completo não consome uma sessão.
Valide Discord e Telegram: iniciar, segurar/soltar fora do canvas, terminar uma
partida, ver melhor resultado/pontos e rankings; conferir pausa e void no admin.
