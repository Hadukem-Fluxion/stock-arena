# Virada para Ohio — roteiro do Hadukem

Atualizado em **24/10/2026**. Hadukem informou a virada concluída no SHA
`9fe93dcbcd1867a6ebee67102e08607376d8924b`: API/worker/Caddy no ar, 13 migrations,
60 perguntas copiadas, Telegram setup e API_ORIGIN na Vercel configurados.
As correções deste follow-up exigem um novo SHA aprovado após revisão/merge.
Este PR não executa deploy, acesso a banco real, rotação real nem mudanças de painel.
Execute só depois de revisão/merge e escolha de um SHA completo aprovado.

| Recurso                     | Configuração                                                                           |
| --------------------------- | -------------------------------------------------------------------------------------- |
| Lightsail                   | mstocks-arena, us-east-2 (Ohio), zona A; Ubuntu 24.04 LTS                              |
| Plano                       | 1 GB RAM / 2 vCPU / 40 GB SSD, dual-stack; swap 2 GB                                   |
| StaticIp-1                  | 77.114.44.78                                                                           |
| API_HOST                    | 77-114-44-78.sslip.io                                                                  |
| API HTTPS                   | https://77-114-44-78.sslip.io                                                          |
| Web/Activity/Mini App/admin | https://mstocks-arena.vercel.app                                                       |
| Supabase novo               | mstocks-arenaUS, fhslaelrgoiibblgfinu, Hadukem-Fluxion, Ohio, Free, Data API desligada |
| Pooler novo                 | aws-0-us-east-2.pooler.supabase.com:5432, session mode, sslmode=require                |
| Usuário/banco               | postgres.fhslaelrgoiibblgfinu / postgres                                               |
| Chave local                 | %USERPROFILE%\.ssh\lightsail-mstocks.pem; nunca ler/copiar/imprimir/commitar           |

Railway está bloqueada após o incidente informado pelo Hadukem. Não enviar segredos
novos para lá. O banco anterior é apenas origem temporária de conteúdo. **Contas,
identidades, pontos, ledger, equipe, flags e recompensas começam do zero**, por
decisão de pré-lançamento. Não executar dump/restauração integral.

Cada bloco tem um comando. Pare no primeiro erro. Não usar transcrição de terminal,
set -x, docker inspect completo, compose config sem --quiet, screenshots de segredos
ou cat .env solto. Hadukem digita valores diretamente; Claude acompanha painéis.

## 1. Windows: PowerShell e ACL da chave

Confira a versão. Acesso SSH/ACL e as alternativas de container no servidor
funcionam com Windows PowerShell 5.1 ou PowerShell 7, sem Node/pnpm no Windows.
As alternativas locais de cópia/setup exigem PowerShell 7 e Node/pnpm.

```powershell
$PSVersionTable.PSVersion
```

Entre no workspace; se não existir, ajuste o caminho, sem copiar a chave ao projeto.

```powershell
Set-Location "$env:USERPROFILE\Documents\projetos\mStocks-miniApp"
```

Defina somente o caminho; não há saída nem leitura de conteúdo.

```powershell
$arenaPem = "$env:USERPROFILE\.ssh\lightsail-mstocks.pem"
```

Esperado: True. Se False, localize a chave baixada pelo Hadukem; nunca envie a terceiros.

```powershell
Test-Path -LiteralPath $arenaPem
```

Remova a herança **apenas desse arquivo**. Esperado: sucesso; se negar acesso,
confira proprietário pelo Explorer. Nunca dar acesso a Everyone.

```powershell
icacls $arenaPem /inheritance:r
```

Conceda leitura ao usuário atual; o comando mostra ACL, nunca a chave.

```powershell
icacls $arenaPem /grant:r "$([System.Security.Principal.WindowsIdentity]::GetCurrent().Name):(R)"
```

Confira que nenhum outro usuário/grupo tem grant explícito. Se tiver, retire-o
em Explorer → Segurança → Avançado antes de conectar. [Referência icacls](https://learn.microsoft.com/en-us/windows-server/administration/windows-commands/icacls).

```powershell
icacls $arenaPem
```

## 2. Firewall Lightsail e primeira conexão

Abra [Networking da instância](https://lightsail.aws.amazon.com/ls/webapp/us-east-2/instances/mstocks-arena/networking).
Se redirecionar, escolha Ohio → Instances → mstocks-arena → Networking.
Confira StaticIp-1 anexado, endereço 77.114.44.78. Em **IPv4 e IPv6**:

- TCP 80 e 443 públicos para Caddy; não precisa liberar UDP 443. **Adicionar 443
  explicitamente**: por padrão, a instância vem apenas com 22 e 80 abertos.
- TCP 22 habilitado para SSH. No **UFW do host**, 22, 80 e 443 ficam abertos sem
  restrição por IP. O SSH usa somente chave via 00-mstocks-ssh.conf. Não fixar o
  IP residencial dinâmico nem os IPs AWS do SSH pelo navegador no UFW.
- Se desejar restringir a origem do SSH, faça isso **somente no firewall Lightsail
  deste painel**, que pode ser corrigido pelo navegador quando o IP mudar. Mantenha
  a opção de SSH pelo navegador habilitada e teste esse acesso antes de restringir.
- Não abrir 5432 ou 8787; worker não publica porta. O hostname inicial usa IPv4.

[Guia oficial do firewall](https://docs.aws.amazon.com/lightsail/latest/userguide/amazon-lightsail-editing-firewall-rules.html).
No Windows, esperado: TcpTestSucceeded True. Se False, confira IP/origem/regras;
corrija a regra no console; não volte a fixar IP no UFW.

```powershell
Test-NetConnection 77.114.44.78 -Port 22
```

Na primeira conexão, compare o fingerprint com a instância pelo console antes
de aceitar. Não desabilite host-key checking. Esperado: prompt ubuntu@...; em
Permission denied, confira chave padrão us-east-2 e ACL, sem ativar senha SSH.

```powershell
ssh -i $arenaPem ubuntu@77.114.44.78
```

## 3. Dentro do SSH: Ubuntu, Docker, swap e hardening

**Blocos bash rodam no Ubuntu pelo SSH, não no PowerShell.** Esperado: atualização
sem erros de rede/assinatura. Em erro, pare antes do próximo comando.

```bash
sudo apt-get update
```

Instale Git; esperado: pacote instalado. Node não precisa estar no host.

```bash
sudo apt-get install -y git
```

Clone só se /opt/mstocks-arena ainda não existe. Se existe, revise checkout e
mudanças; não sobrescreva nem apague a pasta para continuar.

```bash
sudo git clone https://github.com/Hadukem-Fluxion/stock-arena.git /opt/mstocks-arena
```

Esperado: entrar no checkout de root.

```bash
cd /opt/mstocks-arena
```

Atualize referências públicas; esperado: sucesso.

```bash
sudo git fetch origin
```

Substitua pelo SHA aprovado depois dos merges necessários (T31/follow-up,
hospedagem e web compatível). Não usar PR não revisado.

```bash
sudo git checkout --detach SHA_COMPLETO_APROVADO
```

Confira o SHA selecionado; esperado: o SHA completo aprovado. Os comandos Compose
abaixo passam APP_RELEASE explicitamente ao sudo, que descarta exports da sessão.

```bash
sudo git rev-parse HEAD
```

O bootstrap usa o [repositório oficial Docker para Ubuntu](https://docs.docker.com/engine/install/ubuntu/),
cria swap 2 GB, configura UFW, copia os arquivos SSH/unattended-upgrades já
versionados. **Mantenha esta conexão aberta.** Esperado: Compose instalado,
swap ~2 GiB e regras UFW 22/80/443 abertas. Se apt falhar, resolva antes de repetir.
Swap existente inativa exige revisão manual; o script não a reformata.
O bootstrap cria /run/sshd antes de sshd -t, inclusive com socket activation no Ubuntu 24.04.

```bash
sudo bash deploy/lightsail/bootstrap.sh
```

Confira valores efetivos: publickey yes; password/kbdinteractive no;
authenticationmethods publickey; permitrootlogin no. Se diferente, não recarregue.

```bash
sudo sshd -T | grep -E '^(pubkeyauthentication|passwordauthentication|kbdinteractiveauthentication|authenticationmethods|permitrootlogin) '
```

Se corretos, recarregue. Não feche a sessão original ainda.

```bash
sudo systemctl reload ssh
```

Abra **outra janela PowerShell**, conecte e teste sudo -v dentro dela. Só feche
a original após a segunda funcionar. Se falhar, corrija pela original/console.

```powershell
ssh -i "$env:USERPROFILE\.ssh\lightsail-mstocks.pem" ubuntu@77.114.44.78
```

No SSH, confira atualizações automáticas. Esperado: simulação sem erros; reboot
é manual. Verifique /var/run/reboot-required e agende manutenção quando necessário.

```bash
sudo unattended-upgrade --dry-run
```

Docker pode contornar UFW em portas publicadas: o firewall Lightsail também é
obrigatório. API só em loopback, apenas Caddy público. Não dar grupo Docker ao
usuário comum. Fail2ban é opcional e não é instalado/configurado por este bootstrap. Limites: API 320 MB, worker 384 MB, Caddy 96 MB; typecheck de build
sequencial usa heap 512 MB. 1 GB é staging, sem prova de capacidade de lançamento.
OOM/swap constante exigem ampliar o plano antes de liberar tráfego. Logs têm rotação.

## 4. Arquivos root/600 e rotação de segredos

Crie o diretório privado fora do checkout. Esperado: sucesso sem saída.

```bash
sudo install -d -m 700 /etc/mstocks-arena
```

Instale o template **só se não houver .env**. Se já existir, o comando para:
edite o existente, sem sobrescrever valores preenchidos.

```bash
sudo test ! -e /etc/mstocks-arena/.env && sudo install -o root -g root -m 600 deploy/lightsail/server.env.example /etc/mstocks-arena/.env
```

Instale a configuração pública com a mesma proteção.

```bash
sudo test ! -e /etc/mstocks-arena/public.env && sudo install -o root -g root -m 600 deploy/lightsail/public.env.example /etc/mstocks-arena/public.env
```

Esperado: duas linhas 600 root. Em diferença, corrija proprietário/permissão.

```bash
sudo stat -c '%a %U' /etc/mstocks-arena/.env /etc/mstocks-arena/public.env
```

Hadukem preenche no editor, um segredo por vez, sem screenshots/transcrição.
Salvar Ctrl+O/Enter, sair Ctrl+X. Nunca enviar valores ao Claude/Codex.

```bash
sudo nano /etc/mstocks-arena/.env
```

1. [Supabase novo → Database](https://supabase.com/dashboard/project/fhslaelrgoiibblgfinu/settings/database):
   preencha a senha nova no DATABASE_URL do template, com percent-encoding
   **somente da senha**, feito localmente; nunca ferramenta online. Manter
   sslmode=require e DATABASE_SSL_CA versionada. TLS verifica CA/hostname,
   rejectUnauthorized nunca é false. Não usar senha exposta ou service-role key.
2. [@BotFather](https://t.me/BotFather) → /mybots → @mStocksArenaBot → API Token
   → Revoke current token. Cole o token novo em TELEGRAM_BOT_TOKEN. Revogado não
   volta a funcionar no rollback.
3. [Discord OAuth2](https://discord.com/developers/applications/1560368721216938175/oauth2)
   → Reset Secret. Cole em DISCORD_CLIENT_SECRET. Em [General Information](https://discord.com/developers/applications/1560368721216938175/information),
   copie a chave pública em DISCORD_PUBLIC_KEY. Revogue também outros tokens
   que estavam expostos, no provedor emissor; não enviá-los à Railway.
4. Preserve ADMIN_WEB_ORIGIN=https://mstocks-arena.vercel.app,
   OWNER_DISCORD_ID=1225988280596824094, Client ID público do template e
   TELEGRAM_WEBHOOK_URL=https://77-114-44-78.sslip.io/api/telegram/webhook.
   O banco vazio recria o owner no primeiro login; não copie staff antigo.
   RPC/pools/limites ficam nos valores aprovados, sem publicar antifraude privado.

Construa a imagem do SHA aprovado. Esperado: build concluído, Node 24.19.0/pnpm
10.28.0; .dockerignore exclui env/chaves/quiz privado. Se OOM, confira swap;
não execute builds em paralelo. Instalação usa pnpm install --frozen-lockfile.

```bash
sudo docker build --pull -f deploy/lightsail/Dockerfile -t "mstocks-arena:$(sudo git rev-parse HEAD)" .
```

Gere SESSION_SECRET e TELEGRAM_WEBHOOK_SECRET novos, cada um 48 caracteres
URL-safe, direto no arquivo, sem rede nem eco. Esperado: mensagem sem valores.
Cada execução troca ambos; não repetir depois de sincronizar o local.

```bash
sudo docker run --rm --user 0 --network none --entrypoint node -v /etc/mstocks-arena:/secrets "mstocks-arena:$(sudo git rev-parse HEAD)" scripts/lightsail/rotate-secrets.mjs --file /secrets/.env
```

Valide sem conectar a serviços. Esperado: Hosting environment valid; no values
displayed. Falha: revise placeholders, região/pooler, chaves e bot no editor.

```bash
sudo docker run --rm --user 0 --network none --entrypoint node -v /etc/mstocks-arena:/secrets:ro "mstocks-arena:$(sudo git rev-parse HEAD)" scripts/lightsail/validate-env.mjs api --file /secrets/.env
```

O arquivo root/600 exige --user 0 nesses containers temporários. API/worker
continuam com o usuário node. Se a validação disser invalid, primeiro confira
permissões com stat acima e este diagnóstico, que só testa leitura:

```bash
sudo docker run --rm --user 0 --network none --entrypoint node -v /etc/mstocks-arena:/secrets:ro "mstocks-arena:$(sudo git rev-parse HEAD)" -e 'const fs = require("node:fs"); try { fs.accessSync("/secrets/.env", fs.constants.R_OK); console.log("Environment file readable; no values displayed."); } catch { console.error("Environment file unreadable; check mount and permissions."); process.exitCode = 1; }'
```

## 5. Schema novo com API/worker ainda parados

Confirme que o worker antigo está parado. Senha revogada não comprova que uma
conexão já aberta foi encerrada; eventual encerramento é ação dirigida do operador
no banco antigo, nunca um comando indiscriminado para matar todas as sessões.

Prepare: aplica pnpm db:migrate pelo journal completo, **0000 bootstrap e
0001–0012**; não pule 0000 nem edite migrations antigas. Esperado: migrations
concluídas; API/worker continuam parados. Falha impede startup: confira mensagem
sanitizada, senha, CA e permissões, sem exibir URL. Worker nunca migra.

```bash
sudo bash deploy/lightsail/deploy.sh prepare
```

No [SQL Editor novo](https://supabase.com/dashboard/project/fhslaelrgoiibblgfinu/sql/new),
Hadukem/Claude conferem o journal sem consultar perguntas. Esperado: **13** na
revisão com 0000–0012; versões futuras seguem seu próprio journal. Confira public.

```sql
select count(*) as applied_migrations from drizzle.__drizzle_migrations;
```

## 6. Cópia de conteúdo: container no servidor ou PowerShell local

Não faça login ainda. O script recusa destino com jogadores, staff, flags,
ledger ou recompensas; valida os dois projetos aprovados e usa CA verificada.
Copia só quiz_questions (id/slug, opções/resposta/explicação, ativo/agendamento)
e quiz_bank_control. Se o banco antigo não tem controle de 0010, mantém o singleton
novo. Fatos e catálogo são arquivos em game-core: **não há tabela para copiar**.
Não copia sets diários, contas, temporadas antigas, preços ou sessões. Origem
read-only; destino escrito/verificado numa transação. Não gera dump/JSON nem
imprime perguntas. Repetição antes do primeiro login é idempotente; falha desfaz
tudo. Não apagar jogadores para forçar o script a passar.

**Na virada inicial, Hadukem executou a cópia pelo container no servidor.**
Escolha apenas uma das alternativas. Em ambiente já aberto a jogadores, não
repita a cópia: a proteção de destino vazio continuará recusando esse banco.

### 6a. Alternativa oficial no servidor (sem Node/PowerShell 7 no Windows)

No SSH, dentro de /opt/mstocks-arena, com a imagem aprovada construída e o env
root/600 preenchido. Renove o sudo antes de enviar stdin; o pipeline usa sudo -n
para impedir que um prompt de senha consuma os dados. Esperado: sucesso.

```bash
sudo -v
```

Digite apenas a senha da origem antiga no prompt silencioso. O valor fica em uma
variável não exportada da sessão e não entra no histórico. Não usar set -x.

```bash
read -rsp 'Senha da origem temporária: ' arenaSourcePassword
```

Quebre a linha sem exibir a senha.

```bash
printf '\n'
```

Dry-run: senha por stdin, percent-encoding dentro do container; URL nova vem do
DATABASE_URL do arquivo privado. Nenhum valor entra nos argumentos/env do Docker.
Esperado: somente contagens, 60 quiz_questions e 1 quiz_bank_control. Se divergir,
pare e revise. A origem é somente leitura e o destino permanece sem alterações.

```bash
printf '%s' "$arenaSourcePassword" | sudo -n docker run --rm -i --user 0 --entrypoint node -v /etc/mstocks-arena:/secrets:ro "mstocks-arena:$(sudo git rev-parse HEAD)" --env-file=/secrets/.env --import tsx --input-type=module -e 'import { readFileSync } from "node:fs"; process.env.OLD_DATABASE_URL = `postgresql://postgres.djlyrllwnvvljxexusbw:${encodeURIComponent(readFileSync(0, "utf8"))}@aws-1-sa-east-1.pooler.supabase.com:5432/postgres?sslmode=require`; process.env.NEW_DATABASE_URL = process.env.DATABASE_URL; process.argv = [process.execPath, "packages/db/src/copy-game-content.ts", "--dry-run"]; await import("./packages/db/src/copy-game-content.ts");'
```

Depois de validar as contagens, renove sudo; esperado: sucesso.

```bash
sudo -v
```

Cópia transacional pelo mesmo script e mesma imagem, somente contagens na saída.
Se falhar, pare; não contorne a proteção contra jogadores/dados já existentes.

```bash
printf '%s' "$arenaSourcePassword" | sudo -n docker run --rm -i --user 0 --entrypoint node -v /etc/mstocks-arena:/secrets:ro "mstocks-arena:$(sudo git rev-parse HEAD)" --env-file=/secrets/.env --import tsx --input-type=module -e 'import { readFileSync } from "node:fs"; process.env.OLD_DATABASE_URL = `postgresql://postgres.djlyrllwnvvljxexusbw:${encodeURIComponent(readFileSync(0, "utf8"))}@aws-1-sa-east-1.pooler.supabase.com:5432/postgres?sslmode=require`; process.env.NEW_DATABASE_URL = process.env.DATABASE_URL; process.argv = [process.execPath, "packages/db/src/copy-game-content.ts"]; await import("./packages/db/src/copy-game-content.ts");'
```

Remova a senha da sessão ao terminar, inclusive em caso de erro. Sem saída.

```bash
unset arenaSourcePassword
```

### 6b. Alternativa local (PowerShell 7 + Node/pnpm)

No Windows, use checkout aprovado/limpo. Esperado: pull sem conflito; se houver
mudanças locais, pare em vez de sobrescrevê-las.

```powershell
git status --short
```

Esperado: vazio. Em caso de mudanças, pare; não descarte arquivos. Vá à main.

```powershell
git switch main
```

Atualize; esperado: fast-forward sem conflito.

```powershell
git pull --ff-only
```

Selecione o mesmo SHA completo aprovado do servidor, antes de executar scripts.

```powershell
git checkout --detach SHA_COMPLETO_APROVADO
```

Instale pelo lockfile. Esperado: sucesso sem mudança de versões.

```powershell
pnpm install --frozen-lockfile
```

Senha da origem em entrada mascarada, sem histórico do valor. Se possível, redefina
também essa senha exposta no painel antigo antes da cópia. A URL fica só no processo.

```powershell
$env:OLD_DATABASE_URL = 'postgresql://postgres.djlyrllwnvvljxexusbw:' + [uri]::EscapeDataString((Read-Host 'Senha da origem temporária' -MaskInput)) + '@aws-1-sa-east-1.pooler.supabase.com:5432/postgres?sslmode=require'
```

Senha nova, igual à salva no servidor, também sem eco/histórico.

```powershell
$env:NEW_DATABASE_URL = 'postgresql://postgres.fhslaelrgoiibblgfinu:' + [uri]::EscapeDataString((Read-Host 'Senha Supabase Ohio' -MaskInput)) + '@aws-0-us-east-2.pooler.supabase.com:5432/postgres?sslmode=require'
```

Dry-run: só leitura/validação, sem writes. Esperado: JSON com contagens 60
quiz_questions e 1 quiz_bank_control. Se diferente, pare e valide com Claude
o conteúdo aprovado, sem colar perguntas/URLs no chat.

```powershell
pnpm db:copy-game-content --dry-run
```

Cópia: esperado mesmas contagens. Falha: nada parcial é salvo; confira configuração,
migrations e destino vazio. Nunca imprime URL, resposta ou explicação.

```powershell
pnpm db:copy-game-content
```

Remova as URLs do ambiente da sessão; esperado: sem saída.

```powershell
Remove-Item Env:\OLD_DATABASE_URL, Env:\NEW_DATABASE_URL
```

## 7. No SSH: iniciar stack e testar HTTPS

Após contagens aprovadas, suba a mesma revisão. Revalida schema, espera API
saudável e só então inicia worker/Caddy. Esperado: Deployment complete.

```bash
sudo bash deploy/lightsail/deploy.sh deploy
```

Esperado: API healthy, worker/Caddy running. Se não, não vire a Vercel ainda.

```bash
sudo APP_RELEASE=$(sudo git rev-parse HEAD) docker compose --env-file /etc/mstocks-arena/public.env -f deploy/lightsail/compose.yml ps
```

Use **somente --live**: GET health local e HTTPS público, ok:true, sem tocar em
dados/serviços. Esperado: Live health checks passed. Modo sem argumentos é de
CI isolado; não configurar CI=true no servidor para contornar a proteção.
O check HTTPS aguarda até cerca de 60 segundos pela emissão inicial ACME,
repetindo falhas TLS/HTTP/JSON sem exibir body ou traceback. TLS continua verificado.

```bash
sudo bash deploy/lightsail/smoke-test.sh --live
```

Em falha HTTPS, confira DNS do host → 77.114.44.78, portas 80/443 e logs Caddy.
Não usar -k, aceitar certificado inválido nem apagar volumes para forçar emissão.
sslip.io é opção inicial, sem garantia de disponibilidade/certificado: diante de
rate limit ACME, aguarde o emissor ou use domínio próprio aprovado.

Esperado nos logs: snapshots primários para todo o catálogo e conferências dos
pools configurados. Não publicar logs sem revisar; nada de tokens/payloads de login.

```bash
sudo APP_RELEASE=$(sudo git rev-parse HEAD) docker compose --env-file /etc/mstocks-arena/public.env -f deploy/lightsail/compose.yml logs --tail 60 worker
```

Para Caddy troque worker por caddy; para migration, por migrate. O Caddy versionado
não registra query strings de OAuth/initData. Não habilite access/debug logging
que capture dados privados. Logs Docker têm rotação de 10 MB × 3 por serviço.
O Caddyfile é versionado no formato de caddy fmt e conferido no CI.

Em banco novo sem snapshots primários, um fim de semana pode ter quote null na
fonte: Home/Markets mostram "Prices resume when the market opens" quando o estado
é fechado. Sem preço salvo, não há último preço a recuperar. Pool segue apenas
informativo. Histórico existente continua visível; falha de conexão/stale mantém
seu aviso de indisponibilidade. Não trate ausência de preços como falha do deploy.

## 8. .env local opcional, sem imprimir conteúdo

**PowerShell 7 na raiz do repo**: copie o env privado por SSH diretamente para
arquivo ignorado. Confira antes que esta cópia local pode ser substituída. A chave
continua no Windows. Crie .corepack se ainda não existir.

```powershell
New-Item -ItemType Directory -Force .corepack | Out-Null
```

Nenhum valor aparece no terminal: a saída do SSH vai só para o arquivo temporário.

```powershell
ssh -T -i $arenaPem ubuntu@77.114.44.78 'sudo cat /etc/mstocks-arena/.env' | Set-Content -Encoding utf8 .corepack/ohio-env.download
```

Se SSH falhou, não substituir. Esperado: arquivo local trocado só em sucesso.

```powershell
if ($LASTEXITCODE -eq 0) { Move-Item -LiteralPath .corepack/ohio-env.download -Destination .env -Force } else { throw 'Env download failed; local .env not replaced.' }
```

Adicione apenas o Client ID público usado pelo web local.

```powershell
Add-Content .env 'VITE_DISCORD_CLIENT_ID=1560368721216938175'
```

Esperado: mensagem de validação, sem conexão ao banco nem valores na saída.

```powershell
node scripts/lightsail/validate-env.mjs api --file .env
```

## 9. Virada Vercel/Telegram/Discord

No painel Vercel, abra o projeto que publica mstocks-arena.vercel.app → Settings
→ Environment Variables. [Atalho de configurações](https://vercel.com/dashboard).
Em Production/preview aprovado, defina **API_ORIGIN=https://77-114-44-78.sslip.io**.
Atualize também RAILWAY_API_URL para o mesmo valor durante a transição. API_ORIGIN
tem prioridade e, se vazio/inválido, falha sem fallback silencioso. Nunca VITE_
para segredos. Faça **rebuild/redeploy da revisão web aprovada** e espere Ready;
build antigo não troca rewrite sozinho. /api/* permanece relativo e sem CORS novo.

No Windows, esperado: ok True pelo domínio web. Se falhar, não rode setup Telegram.

```powershell
Invoke-RestMethod https://mstocks-arena.vercel.app/api/health
```

### Telegram pelo container no servidor (alternativa oficial usada na virada)

Depois do HTTPS saudável e do rebuild Vercel, no SSH em /opt/mstocks-arena.
Lê token/segredo/webhook do env privado root/600, usando --user 0 só no container
temporário. Não exige copiar segredos para o Windows nem instalar Node lá.
Esperado: Telegram setup complete: 3 settings applied. A API já deve estar no ar.

```bash
sudo docker run --rm --user 0 --entrypoint node -v /etc/mstocks-arena:/secrets:ro "mstocks-arena:$(sudo git rev-parse HEAD)" --env-file=/secrets/.env --import tsx apps/api/src/telegram/setup-cli.ts
```

### Telegram pelo Windows (alternativa com ferramentas locais)

Com .env local já atualizado, execute uma vez. Esperado: três configurações
confirmadas, sem token na saída. Webhook usa Ohio diretamente; menu/Play continuam
abrindo Vercel. Falha exige revisar token/segredo/HTTPS no editor, nunca no chat.

```powershell
pnpm telegram:setup
```

No [Discord OAuth2](https://discord.com/developers/applications/1560368721216938175/oauth2),
confirme **https://mstocks-arena.vercel.app/api/admin/auth/callback**. Não trocar
para o host da API. Activity mantém / → mstocks-arena.vercel.app e /stock-logos
→ xstocks-metadata.backed.fi. Interactions Endpoint continua em
https://mstocks-arena.vercel.app/api/discord/interactions. Não precisa registrar
comandos novamente nem criar serviço extra/polling do Telegram.

## 10. Checklist real, executado pelos operadores

Registrar UTC/SHAs/resultados após autorização de deploy. Estes testes criam dados
novos de staging; não foram executados pelo Codex neste PR.

- [ ] Health local, HTTPS direto e via Vercel válidos; API healthy.
- [ ] Worker atualiza todo o catálogo e pools configurados, sem falhas recorrentes.
- [ ] 60 perguntas e controle copiados; nenhuma conta/ledger/equipe/recompensa antiga.
- [ ] Discord pelo botão de Atividades em canal de voz: login, check-in, quiz,
      HL; fechar/reabrir e conferir liquidação após janela e prêmio único. Mercado
      fechado mostra espera. Se testar /arena, registrar separadamente o caminho real.
- [ ] Telegram /start, Play, abrir Mini App, login, check-in, quiz e HL.
- [ ] /admin no navegador: primeiro login do Hadukem recria owner, overview,
      equipe/controles/temporadas e Rewards. Usar destinatários fictícios para verificar
      cadastro, lock/snapshot/CSV/auditoria; pagamento continua manual/revisado.
- [ ] Sessões antigas invalidadas; nenhum segredo novo na Railway nem login em logs.
- [ ] Segunda sessão SSH por chave e SSH pelo navegador funcionando; UFW permite
      22/80/443 sem IP fixo. 443 foi aberto explicitamente no Lightsail; eventual
      restrição de origem do SSH fica só no console Lightsail. Swap/atualizações
      conferidos; 5432/8787 não públicos.
- [ ] Hadukem aprova encerramento de recursos antigos só depois de tudo verde.

## 11. Rollback

Antes de cada deploy posterior, anote o SHA/imagem anterior saudável no **mesmo
banco novo**. Não fazer docker system prune durante a virada. No SSH, só com uma
imagem anterior existente e schema compatível, substitua o SHA completo:

```bash
sudo bash deploy/lightsail/deploy.sh rollback SHA_COMPLETO_ANTERIOR_APROVADO
```

Esperado: API healthy e worker iniciado depois dela. Não desfaz migrations nem
apaga ledger/auditoria. Se schema incompatível, corrigir para frente. Na primeira
implantação não existe release anterior seguro: manter web indisponível/manutenção
e parar o writer enquanto corrige, sem voltar à Railway ou ao banco exposto.

```bash
sudo APP_RELEASE=$(sudo git rev-parse HEAD) docker compose --env-file /etc/mstocks-arena/public.env -f deploy/lightsail/compose.yml stop worker api
```

Web: fazer **novo build da revisão anterior compatível com API_ORIGIN Ohio**.
Promover artefato antigo pode restaurar o rewrite Railway embutido nele. Tokens
revogados não voltam; manter env novos sincronizados. Não restaurar contas/ledger
antigos nem executar down-migrations/limpezas para contornar falha.

## 12. Encerramento antigo, só após verde e aprovação

1. Registrar contagens, SHAs, UTC e aprovação do Hadukem; revisar backups/faturamento.
2. Conferir que nenhum webhook, env ativo ou rewrite usa o projeto anterior.
3. No [projeto antigo djlyrllwnvvljxexusbw](https://supabase.com/dashboard/project/djlyrllwnvvljxexusbw/settings/general),
   escolher **Pause project**, não Delete. Confirmar nome/ref se a UI mudou; o
   projeto fhslaelrgoiibblgfinu deve continuar ativo.
4. Hadukem/Claude conferem serviço por serviço Railway e retiram variáveis expostas.
   Remover serviços só com aprovação explícita no painel, considerando exclusão
   definitiva. Não enviar segredos novos nem remover Vercel/AWS por engano.
5. Com API_ORIGIN comprovado nos builds ativos, retirar a variável histórica
   RAILWAY_API_URL da Vercel, rebuild e health novamente. Fallback em código pode
   permanecer; não é destino de rollback.
6. Atualizar INFRA.md com estados/testes reais. Exports/logs privados e perguntas
   nunca entram no Git. Nenhuma ação de encerramento é automática neste PR.
