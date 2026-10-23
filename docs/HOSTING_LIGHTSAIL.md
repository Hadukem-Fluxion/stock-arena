# API e worker no AWS Lightsail

Plano de substituição da hospedagem, preparado em 22/10/2026. O Hadukem informou
um vazamento de variáveis na Railway em 21/10 e o bloqueio continuado do serviço.
**Não removemos serviços, configurações ou documentos da Railway.** Este guia é
para uma instância nova; nenhum servidor foi criado nem segredo real alterado por
este PR. T28 está integrada no PR #23; seu teste real continua pendente.

O Hadukem cria a instância e administra os segredos. O Claude pode orientar os
painéis com a conta do Hadukem; o Codex prepara o código. Nunca enviar chaves,
tokens, `.env` ou strings de conexão pelo chat, issues ou PRs.

## O que vai rodar

- Web continua na Vercel: `https://mstocks-arena.vercel.app`.
- Um Lightsail Ubuntu **24.04 LTS, 64 bits, 1 GB**, com IPv4 público e IP estático.
  Selecionar São Paulo se disponível para a conta, perto do Supabase existente.
- Docker Compose: API, worker, migration temporária e Caddy **2.11.7**.
- Mesma imagem da aplicação: **Node 24.19.0**, pnpm **10.28.0**, instalação com
  `pnpm install --frozen-lockfile`, verificações de tipos da API/worker e runtime
  `tsx` pelos comandos existentes `pnpm start:api` / `pnpm start:worker`.
- Postgres continua no Supabase com CA verificada; nenhum banco local no servidor.
  O entrypoint de produção recusa `DATABASE_URL` vazio, impedindo fallback PGlite.
- Caddy faz HTTPS e proxy de `/api/*` para `api:8787`, com healthcheck ativo em
  `/api/health` e flush imediato para SSE. O restante responde 404.
- Só Caddy publica 80/443 TCP. API publica 8787 **apenas em 127.0.0.1**, para
  diagnóstico local. Worker e migration não publicam portas. HTTP/3 fica desligado,
  portanto não é necessário abrir 443 UDP. O admin do Caddy não é publicado.

A configuração fica em `deploy/lightsail/`. O deploy para o writer antigo local,
aplica `pnpm db:migrate`, espera a API saudável e só depois inicia worker/Caddy.
Uma migration que falha impede a API e o worker de iniciar. Não subir o stack com
comandos improvisados que ignorem as dependências.

## 1. Trocar as credenciais nos provedores

Antes de ligar o servidor, o Hadukem deve trocar a senha do banco no Supabase,
resetar o Discord Client Secret no Developer Portal e revogar/gerar um novo token
do Telegram pelo BotFather. Se houver outros segredos anteriormente guardados na
Railway (por exemplo bot token Discord), trocá-los também no provedor que os emitiu.
Não reutilizar os valores antigos nem copiar os novos para a Railway bloqueada.

Confirmar que o worker antigo está parado antes de habilitar o novo: não manter
dois workers ativos em hosts diferentes. Se não for possível controlar a Railway,
coordenar no Supabase a retirada das conexões antigas identificadas; trocar a
senha não deve ser tratado como prova de encerramento de uma conexão já aberta.
Não executar encerramento indiscriminado de sessões do banco.

O banco e seus dados são os mesmos. Não recriar tabelas, não importar o quiz
novamente e não alterar o ledger por causa desta migração de hospedagem.

## 2. Criar a instância e reservar o IP

No [console do Lightsail](https://lightsail.aws.amazon.com/), criar instância
Linux/Unix, **OS Only → Ubuntu 24.04 LTS**, plano com **1 GB e IPv4 público**.
Não escolher um blueprint de aplicação nem um plano somente IPv6. Criar ou
selecionar uma chave SSH da região e guardar o arquivo privado no computador do
Hadukem, fora do repositório. Nome sugerido: `mstocks-arena-staging`.

Em **Networking → Create static IP**, escolher a mesma região e anexar o IP à
instância. Nome sugerido: `mstocks-arena-api`. O IPv4 dinâmico muda em stop/start;
o [IP estático](https://docs.aws.amazon.com/lightsail/latest/userguide/lightsail-create-static-ip.html)
mantém o destino do DNS. Instância, IP e domínio reais ainda precisam ser definidos.

No firewall da instância, IPv4 e IPv6 quando habilitado:

| Entrada | Origem                                                                     |
| ------- | -------------------------------------------------------------------------- |
| TCP 22  | Apenas IPv4 público atual do Hadukem (`/32`); IPv6 pessoal `/128` se usado |
| TCP 80  | Internet, para redirect e emissão/renovação do certificado                 |
| TCP 443 | Internet, para HTTPS                                                       |

Remover outras regras de entrada **apenas desta instância nova**. Não abrir 8787,
5432, 2019 nem portas do Docker. Se não usar IPv6, desabilitá-lo no Lightsail em
vez de deixar seu firewall sem revisão. O botão de SSH no navegador pode exigir
uma regra própria da AWS; este guia usa a chave local e não libera SSH global.

Isso limita **entrada**. As saídas precisam de DNS, HTTPS e da porta 5432 do
session pooler Supabase. A
[documentação de firewall do Lightsail](https://docs.aws.amazon.com/lightsail/latest/userguide/understanding-firewall-and-port-mappings-in-amazon-lightsail.html)
explica os dois conjuntos de regras.

## 3. Entrar por chave, instalar Docker e preparar RAM

No PowerShell, substituindo os caminhos/IP pelos reais:

```powershell
ssh -i "$env:USERPROFILE\.ssh\lightsail-mstocks.pem" ubuntu@IP_ESTATICO
```

Não desabilitar a checagem da chave do host. Conferir a identidade do servidor na
primeira conexão. No Ubuntu, instalar os pacotes e o repositório oficial Docker:

```bash
sudo apt-get update
sudo apt-get upgrade -y
sudo apt-get install -y ca-certificates curl git ufw unattended-upgrades
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc
sudo tee /etc/apt/sources.list.d/docker.sources >/dev/null <<EOF
Types: deb
URIs: https://download.docker.com/linux/ubuntu
Suites: $(. /etc/os-release && echo "$VERSION_CODENAME")
Components: stable
Signed-By: /etc/apt/keyrings/docker.asc
EOF
sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo systemctl enable --now docker
sudo docker compose version
```

Comandos baseados na [instalação oficial para Ubuntu](https://docs.docker.com/engine/install/ubuntu/).
Em uma máquina nova não devem existir pacotes Docker concorrentes. Usar `sudo`;
não adicionar usuários comuns ao grupo Docker, que dá controle equivalente a root.

No plano de 1 GB, criar **2 GB de swap** uma vez, se `/swapfile` ainda não existir:

```bash
sudo fallocate -l 2G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab >/dev/null
free -h
```

Antes de repetir, verificar `swapon --show` e `/etc/fstab`; não reformatar swap em
uso nem duplicar a linha. API tem limite de 320 MB, worker de 384 MB e Caddy de
96 MB; são limites máximos, não RAM reservada. O build verifica tipos em sequência
e usa heap de 512 MB por processo de TypeScript (ajustado na T30 após o limite
anterior de 384 MB ser esgotado no CI). Isso não muda os limites de runtime.
Manter o swap configurado e não fazer build/testes completos em paralelo nesse host.
1 GB serve como alvo inicial de staging, **não há teste de carga que comprove
capacidade de lançamento**. Se houver OOM, swap constante ou latência, ampliar o
plano antes de aumentar tráfego. Logs Docker têm rotação de 10 MB × 3 por serviço.

## 4. Baixar somente uma revisão aprovada

Depois da revisão/merge deste PR, no servidor:

```bash
sudo git clone https://github.com/Hadukem-Fluxion/stock-arena.git /opt/mstocks-arena
cd /opt/mstocks-arena
sudo git fetch origin
sudo git checkout --detach COMMIT_COMPLETO_APROVADO
release_sha=$(sudo git rev-parse HEAD)
sudo docker build --pull -f deploy/lightsail/Dockerfile -t "mstocks-arena:$release_sha" .
```

O checkout é de root, para o deploy com sudo usar somente arquivos aprovados.
Não há Node necessário no host: a versão fixa fica na imagem. Não rodar `pnpm dev`
nem usar watch. `.dockerignore` exclui `.env`, `.corepack`, `.git`, bancos locais,
chaves privadas e o banco privado de perguntas do contexto de build.

## 5. SSH somente por chave e atualizações de segurança

Na sessão SSH ainda aberta, instalar os arquivos versionados:

```bash
sudo install -m 644 deploy/lightsail/00-mstocks-ssh.conf /etc/ssh/sshd_config.d/00-mstocks.conf
sudo sshd -t
sudo sshd -T | grep -E '^(pubkeyauthentication|passwordauthentication|kbdinteractiveauthentication|authenticationmethods|permitrootlogin) '
sudo systemctl reload ssh
```

Os valores efetivos devem mostrar publickey habilitado, senha/interativo
desabilitados, `authenticationmethods publickey` e root login `no`. Abrir **outra
sessão com a chave e testar sudo antes de fechar a original**. O prefixo `00-`
antecipa os snippets padrão do cloud-init; conferir o resultado efetivo, não só o
texto do arquivo. Referência: [OpenSSH no Ubuntu](https://ubuntu.com/server/docs/how-to/security/openssh-server/).

Aplicar também UFW, substituindo o endereço abaixo pelo IP público real do Hadukem:

```bash
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow from IP_PUBLICO_DO_HADUKEM/32 to any port 22 proto tcp
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable
sudo ufw status numbered
sudo install -m 644 deploy/lightsail/20auto-upgrades /etc/apt/apt.conf.d/20auto-upgrades
sudo install -m 644 deploy/lightsail/52mstocks-security /etc/apt/apt.conf.d/52mstocks-security
sudo systemctl enable --now apt-daily.timer apt-daily-upgrade.timer
sudo unattended-upgrade --dry-run
```

Adicionar a origem IPv6 pessoal se for usar SSH por IPv6. Se o IP residencial
mudar, atualizar a regra restrita no Lightsail **e** no UFW. Não liberar 22 para
`0.0.0.0/0` como solução permanente. O firewall Lightsail continua obrigatório:
portas publicadas pelo Docker podem contornar UFW; a API é limitada explicitamente
a loopback e somente Caddy é publicado para a Internet.

Os arquivos habilitam atualizações automáticas dos canais de segurança Ubuntu/ESM
(ESM apenas se disponível) e mantêm reboot manual. Verificar `/var/run/reboot-required`
e agendar os reboots necessários. `unattended-upgrades` **não atualiza imagens
Docker nem o Node fixado**. Atualizar Docker Engine pelo apt em manutenção; novas
imagens/versões de Node/Caddy passam por revisão e redeploy. Fontes:
[atualizações automáticas Ubuntu](https://ubuntu.com/server/docs/how-to/software/automatic-updates/)
e [limitações de firewall Docker](https://docs.docker.com/engine/install/ubuntu/#firewall-limitations).

## 6. Preparar o `.env` local e transferir sem exibir valores

No Windows, na raiz do workspace, editar o `.env` existente pelo Bloco de Notas.
Se ainda não existir, copiar `.env.example`. Não substituir um `.env` preenchido
com o template nem enviar o arquivo ao Git. Gerar os dois segredos novos:

```powershell
node scripts/lightsail/rotate-secrets.mjs --file .env
notepad .env
```

O script escreve diretamente no arquivo, troca **ambos** os valores e não imprime
seus conteúdos. Cada um usa 36 bytes aleatórios criptográficos codificados em
base64url: **48 caracteres de `[A-Za-z0-9_-]`**. Cada execução é uma nova rotação,
portanto não rodar de novo depois de sincronizar sem repetir o envio e o setup
Telegram. No Linux grava atomicamente com modo `600`; no Windows manter o arquivo
na conta do Hadukem, sem compartilhamento. O arquivo deve conter:

| Variável                                       | Preencher onde/como                                                                                                                                                         |
| ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`                                 | Session pooler Supabase, usuário `postgres.djlyrllwnvvljxexusbw`, host `aws-1-sa-east-1.pooler.supabase.com`, porta 5432, banco postgres, `sslmode=require`, **senha nova** |
| `DATABASE_SSL_CA`                              | `packages/db/certs/supabase-ca.crt`, já incluída na imagem; TLS continua verificado                                                                                         |
| `SESSION_SECRET`, `TELEGRAM_WEBHOOK_SECRET`    | Geradas pelo script; não inventar nem copiar as antigas                                                                                                                     |
| `DISCORD_CLIENT_ID`, `VITE_DISCORD_CLIENT_ID`  | `1560368721216938175` (público)                                                                                                                                             |
| `DISCORD_CLIENT_SECRET`                        | Valor novo após reset no Discord; somente API/`.env`                                                                                                                        |
| `DISCORD_PUBLIC_KEY`                           | Chave pública atual do app no Developer Portal                                                                                                                              |
| `DISCORD_BOT_TOKEN`                            | Novo token se esse segredo existia no ambiente exposto e for usado; deixar vazio se não utilizado                                                                           |
| `DISCORD_GUILD_ID`                             | ID público do servidor de teste, quando necessário                                                                                                                          |
| `TELEGRAM_BOT_TOKEN`                           | Novo token gerado/revogado no BotFather                                                                                                                                     |
| `TELEGRAM_BOT_USERNAME`                        | `mStocksArenaBot`                                                                                                                                                           |
| `TELEGRAM_GROUP_ID`                            | ID do grupo, se utilizado                                                                                                                                                   |
| `ADMIN_WEB_ORIGIN`                             | `https://mstocks-arena.vercel.app`                                                                                                                                          |
| `OWNER_DISCORD_ID`                             | `1225988280596824094` (usuário do Hadukem, não Client ID)                                                                                                                   |
| `API_PORT`                                     | 8787; Compose fixa `PORT=8787` no container                                                                                                                                 |
| `XSTOCKS_API_BASE`                             | `https://api.backed.fi/api/v2`                                                                                                                                              |
| `MANTLE_RPC_URL`                               | `https://rpc.mantle.xyz`, ou RPC aprovado                                                                                                                                   |
| `FLUXION_POOLS_JSON`                           | Vazio usa os pools públicos do catálogo; preservar override aprovado, se existir                                                                                            |
| `PRICE_DIVERGENCE_PCT`, `PRICE_JUMP_LIMIT_PCT` | Manter a configuração já aprovada (template: 3 e 5), sem mudar regras nesta migração                                                                                        |
| `RAILWAY_API_URL`                              | Nova origem HTTPS do Lightsail; chave histórica usada pelo build Vercel                                                                                                     |

Codificar caracteres especiais da senha no componente de senha da URL antes de
montá-la (percent-encoding); não colar a conexão em ferramentas online. Não incluir
credenciais de Supabase/Discord/Telegram em variáveis `VITE_*`. Não copiar o quiz
privado ao servidor; as perguntas já estão no banco.

No servidor, preparar o diretório fora do checkout:

```bash
sudo install -d -m 700 /etc/mstocks-arena
sudo install -m 600 /dev/null /etc/mstocks-arena/.env
sudo install -m 600 /dev/null /etc/mstocks-arena/public.env
sudo nano /etc/mstocks-arena/public.env
```

Em `public.env`, colocar só `API_HOST=DOMINIO_REAL_DA_API`, sem `https://`, caminho
ou porta. Apesar do nome, manter também esse arquivo root/600 para o deploy. Ele
é o único env entregue ao Caddy; os segredos da aplicação não vão ao proxy.

No PowerShell **7**, enviar o `.env` local pela conexão SSH criptografada, sem echo:

```powershell
Get-Content -Raw .env | ssh -i "$env:USERPROFILE\.ssh\lightsail-mstocks.pem" ubuntu@IP_ESTATICO 'sudo sh -c "umask 077; cat > /etc/mstocks-arena/.env; chmod 600 /etc/mstocks-arena/.env"'
if ($LASTEXITCODE -ne 0) { throw "Env upload failed; check the SSH connection." }
```

Não usar `cat .env` solto no terminal, `docker inspect` completo, `docker compose
config` sem `--quiet`, shell `set -x` ou screenshots do editor. Para conferir
somente permissões no servidor: `sudo stat -c '%a %U' /etc/mstocks-arena/.env` deve
mostrar `600 root`. O diretório 700 impede acesso por usuários comuns. Um operador
com sudo/Docker continua capaz de acessar o ambiente; não conceder esses acessos
a contas de suporte/moderação do jogo.

Se preferir gerar no próprio servidor, usar a mesma ferramenta dentro da imagem:

```bash
sudo docker run --rm --user 0 --network none --entrypoint node \
  -v /etc/mstocks-arena:/secrets "mstocks-arena:$release_sha" \
  scripts/lightsail/rotate-secrets.mjs --file /secrets/.env
```

Escolher **um** local para gerar e sincronizar os mesmos valores para o outro por
SSH, nunca gerar pares diferentes. O fluxo recomendado acima gera localmente e
envia para o servidor, deixando `pnpm telegram:setup` já com o segredo correto.

## 7. DNS e primeiro deploy

Definir um hostname da API e criar um registro **A** para o IPv4 estático. Criar
AAAA somente se o IPv6 estiver configurado e protegido. Caddy emite e renova o
certificado do hostname automaticamente com 80/443 acessíveis. Até o domínio ser
escolhido, o IP permite entrar por SSH e testar o health local, mas **não apontar
a Vercel para HTTP ou para um certificado local/não confiável**. Este procedimento
usa domínio com certificado público; HTTPS apenas por IP precisaria de uma
configuração de certificado público compatível separada. Não usar `curl -k` ou
desabilitar verificação TLS como solução. Referência: [HTTPS automático Caddy](https://caddyserver.com/docs/automatic-https).

No checkout aprovado do servidor:

```bash
cd /opt/mstocks-arena
sudo bash deploy/lightsail/deploy.sh
```

O script exige root, checkout limpo, envs root/600 e trava contra deploy concorrente.
Ele define `APP_RELEASE` pelo commit, faz build com lockfile, valida Caddy, para
worker/API locais, força uma execução nova da migration e inicia os serviços na
ordem. A mensagem de sucesso só aparece após a API ficar saudável. Se migration
ou health falhar, investigar; não iniciar o worker por fora. Aplique o primeiro
deploy apenas após confirmar que o writer antigo da Railway está inativo.

`/api/health` é um **liveness check**, não comprova o acesso ao banco nem o polling.
Conferir o sucesso da migration e snapshots nos logs do worker também:

```bash
export APP_RELEASE=$(sudo cat /var/lib/mstocks-arena/current-release)
sudo env APP_RELEASE="$APP_RELEASE" docker compose --env-file /etc/mstocks-arena/public.env -f deploy/lightsail/compose.yml ps
curl --fail --silent --show-error http://127.0.0.1:8787/api/health
curl --fail --silent --show-error https://DOMINIO_REAL_DA_API/api/health
sudo env APP_RELEASE="$APP_RELEASE" docker compose --env-file /etc/mstocks-arena/public.env -f deploy/lightsail/compose.yml logs --tail 60 migrate api worker caddy
```

API/worker usam o logger sanitizado já existente. Caddy não habilita access log e
remove URI, headers e IP dos registros de erro de requisições, preservando o log
operacional. Não ligar debug/registro de payloads para investigar auth.

## 8. Apontar Vercel e reconfigurar Telegram

Na Vercel → projeto → Settings → Environment Variables, trocar **o valor** de
`RAILWAY_API_URL` para `https://DOMINIO_REAL_DA_API`, sem `/api` e sem credenciais,
nos ambientes aplicáveis. **O nome da variável permanece igual.** Fazer novo
deploy da revisão aprovada: o rewrite é resolvido no build, não basta trocar a
variável sem rebuild. A raiz continua Vite estática em `apps/web`.

Verificar `https://mstocks-arena.vercel.app/api/health` e depois login/jogos na
Activity. Não mudar os mappings `/` e `/stock-logos`, pois continuam apontando para
a Vercel/host de logos. O Interactions Endpoint Discord e webhook Telegram também
continuam sob `https://mstocks-arena.vercel.app/api/...`.

Manter no Discord OAuth2 Redirects `https://127.0.0.1` e adicionar/manter
`https://mstocks-arena.vercel.app/api/admin/auth/callback`. Com a nova senha/secret
e o redirect configurados, testar o admin em `/admin` pelo navegador; a rotação
do SESSION_SECRET invalida sessões de jogador/CSRF antigos, então fazer novo login.

Após o rewrite novo estar ativo e o `.env` local conter exatamente o token/segredo
do servidor, o Hadukem roda **localmente**, na raiz do projeto:

```powershell
pnpm telegram:setup
```

O script existente configura webhook, `/start`, `/help` e botão Play; só informa a
contagem de configurações. Nada disso roda automaticamente no deploy/CI. Testar
`/start` e o Mini App no celular. Novo token Telegram/Discord também deve ser
sincronizado em qualquer consumidor ainda autorizado, sem copiar de volta à
Railway bloqueada. Registrar as URLs e os testes reais em INFRA.md por PR após
confirmar o ambiente, sem segredos.

## 9. Operação, atualização e rollback

Usar os comandos acima com `APP_RELEASE` do arquivo para logs/estado, e
`sudo docker stats --no-stream` / `free -h` / `df -h` para recursos. Verificar os
logs de `unattended-upgrades` e a necessidade de reboot. O worker não tem health
HTTP: confirmar os ciclos de snapshots de **todo o catálogo configurado** e as
conferências de pools existentes; não assumir um total fixo no código.

Para atualizar: `sudo git fetch origin`, checkout de um commit aprovado e executar
`sudo bash deploy/lightsail/deploy.sh` novamente. Não apagar a imagem anterior.
Após reboot, Docker reinicia serviços previamente ativos; não roda migration do
worker nem cria um segundo serviço em paralelo. Serviços parados por falha de
deploy não devem ser iniciados sem corrigir a causa.

Para voltar ao código anterior **no próprio Lightsail**, escolher um commit já
implantado com schema compatível, cuja imagem ainda esteja no host:

```bash
sudo bash deploy/lightsail/deploy.sh rollback COMMIT_COMPLETO_ANTERIOR
```

O rollback para os writers locais, roda o migrator da imagem anterior (sem down
migrations) e só reinicia após health. Não desfaz migrations, ledger ou dados do
quiz; revisão incompatível com o schema atual exige corrigir o código em outra
versão aprovada. As configurações de Caddy/Compose são do checkout atual; se elas
forem o defeito, revisar também seus arquivos antes do rollback.

Se mudar de instância/domínio, reapontar DNS/Vercel para outro backend seguro e
fazer rebuild. **Não voltar para a Railway enquanto estiver bloqueada ou reutilizar
segredos expostos.** A configuração histórica permanece em DEPLOY.md. Não executar
`down -v`: os volumes guardam certificados/conta ACME. Guardar pelo menos uma
imagem anterior e um snapshot privado do servidor antes de manutenção relevante.

## Verificação deste PR e pendências

Testes locais do gerador usam arquivos temporários fictícios, nunca o `.env` real.
O CI Linux faz build da imagem, verifica a versão/isolamento do contexto, executa
migrations com PGlite isolado, valida Caddy, testa HTTPS com sua CA local **apenas
no teste** e verifica que migration com Postgres inacessível bloqueia a API.
Nenhum serviço AWS ou banco de produção é acessado por esses testes.

A criação da instância, IP/DNS, senhas/tokens novos, deploy real, consumo de RAM
no plano escolhido e smoke tests Discord/Telegram/admin continuam pendentes do
Hadukem/Claude. Este PR prepara os artefatos; não declara o Lightsail já no ar.
