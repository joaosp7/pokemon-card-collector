# Deploy no AWS Lightsail (GitHub Actions + Docker + Tailscale)

Arquitetura: **o app nao tem nenhuma porta publica e nao tem autenticacao propria.** Ele so e
acessivel pela tailnet (Tailscale).

```
push na main -> GitHub Actions builda a imagem (linux/amd64) -> GHCR (tag = SHA do commit)
             -> runner entra na tailnet (tag:ci) -> Tailscale SSH na instancia (tag:server)
             -> remote-deploy.sh: pull da SHA, `compose up --wait`, rollback automatico se falhar

instancia: container app (127.0.0.1:3000)  <-  tailscale serve (HTTPS :443, so tailnet)
```

## Como o app guarda dados

O app nao usa variaveis de ambiente para caminhos: ele resolve tudo a partir de `process.cwd()/..`
(`web/lib/data-paths.ts`). Na imagem o cwd e `/app/web`, entao:

| Caminho no container | Conteudo | Volume no host |
| --- | --- | --- |
| `/app/data/catalog.db` | catalogo (sets/cartas) | `~/app/data` |
| `/app/data/ownership.db` | cartas que voce possui | `~/app/data` |
| `/app/cards/` | imagens das cartas | `~/app/cards` |

O esquema SQLite e criado automaticamente na primeira execucao; **nao ha migrations**.

Limitacao: o botao de download de colecoes chama `uv run download-collection` (Python + Playwright),
que **nao esta na imagem**. Em producao `data/` e `cards/` sao populados a partir de uma maquina que
tenha o downloader (veja "Enviar/restaurar dados").

## Gerenciador de pacotes: pnpm

Versao fixada em `web/package.json` > `packageManager` (`pnpm@11.9.0`), igual a do `Dockerfile` (corepack).
Lockfile: `web/pnpm-lock.yaml`. Scripts de build de dependencias ficam todos desativados
(`web/pnpm-workspace.yaml`): `better-sqlite3` traz `prebuilds/linux-x64.node`; `esbuild`/`unrs-resolver`
usam pacotes opcionais por plataforma. O `sharp` (PDF/imagens) usa `@img/sharp-linux-x64` + libvips, presentes na imagem.
Ao atualizar o pnpm, altere `packageManager` e o `Dockerfile` juntos.

## Pre-requisitos

- Instancia Lightsail Ubuntu 24.04 (x86_64, 1 GB RAM). O usuario SSH precisa estar no grupo `docker` e
  ter `sudo` sem senha (o deploy faz `sudo chown -R 1000:1000 ~/app/data ~/app/cards`; o container roda como uid 1000).
- Conta Tailscale com **MagicDNS** e **HTTPS Certificates** habilitados (admin console > DNS).
- Pacote GHCR legivel pela instancia (token com `read:packages`).

## Secrets do GitHub (Settings > Secrets and variables > Actions)

| Secret | Para que serve |
| --- | --- |
| `TS_OAUTH_CLIENT_ID` | OAuth client do Tailscale (escopo escopo `auth_keys` (write) com a tag `tag:ci`; nenhum outro escopo e necessario, o acesso SSH e controlado pela ACL); o runner entra na tailnet |
| `TS_OAUTH_SECRET` | Segredo do mesmo OAuth client |
| `DEPLOY_HOST` | Nome MagicDNS ou IP Tailscale (100.x) da instancia |
| `DEPLOY_USER` | Usuario de login na instancia (ex.: `ubuntu`); precisa constar em `users` da regra `ssh` da ACL |
| `GHCR_PULL_TOKEN` | PAT (classic) com `read:packages`, usado pela instancia para `docker login ghcr.io` |

Sao 5 secrets. **Nao ha chave SSH**: o deploy usa Tailscale SSH (autenticacao pela identidade `tag:ci` na ACL).
O push da imagem usa o `GITHUB_TOKEN` automatico. Nenhum segredo fica no repositorio.

## ACL da tailnet (exemplo)

Ajuste usuarios e o `users` (= `DEPLOY_USER`). `tag:ci` so entra na instancia por **Tailscale SSH**; so os
dispositivos do dono acessam o app na 443.

```json
{
  "tagOwners": {
    "tag:ci":     ["autogroup:admin"],
    "tag:server": ["autogroup:admin"]
  },
  "acls": [
    { "action": "accept", "src": ["dono@example.com"], "dst": ["tag:server:443"] }
  ],
  "ssh": [
    { "action": "accept", "src": ["tag:ci"], "dst": ["tag:server"], "users": ["ubuntu"] },
    { "action": "accept", "src": ["dono@example.com"], "dst": ["tag:server"], "users": ["ubuntu"] }
  ]
}
```

**Tailscale SSH e obrigatorio**: a instancia precisa rodar `tailscale up --ssh` (mantenha habilitado) e a
regra `ssh` da ACL e **obrigatoria**; uma regra TCP na 22 sozinha nao basta (o Tailscale SSH intercepta a 22
e ignora `~/.ssh/authorized_keys`). O workflow nao usa chave, `known_hosts` nem `scp`: envia os arquivos com
`tar` via `ssh` (nao depende de SFTP/scp) e dispensa `ssh-keyscan` (a identidade do host vem do tunel WireGuard).

## Preparar a instancia (uma vez)

```bash
# 1) Docker + plugin compose
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER   # reconecte a sessao depois

# 2) Tailscale, com tag do servidor
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up --ssh --advertise-tags=tag:server

# 3) Pasta do app (data/cards e .env sao criados/ajustados a cada deploy)
mkdir -p ~/app

# 4) Expor o app SO na tailnet (HTTPS com certificado *.ts.net), uma vez:
sudo tailscale serve --bg --https=443 http://127.0.0.1:3000
tailscale serve status
```

O app fica em `https://<maquina>.<tailnet>.ts.net`. **NUNCA habilite `tailscale funnel`**: ele
exporia o app (sem autenticacao) a internet publica.

Swap (recomendado com 1 GB de RAM):

```bash
sudo fallocate -l 1G /swapfile && sudo chmod 600 /swapfile
sudo mkswap /swapfile && sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```

Firewall do Lightsail (aba Networking): **todas as portas publicas fechadas**, inclusive 22, 80 e 443.
O Tailscale funciona por conexoes de saida (e UDP direto/DERP); nao precisa de porta de entrada.
Remova a regra SSH padrao depois de confirmar o acesso via Tailscale. O compose publica a porta do
app apenas em `127.0.0.1:3000`.

## Enviar/restaurar dados (uma vez, ou apos um desastre)

O `cards/` **nao pode ser recriado na instancia** (uv/Playwright nao estao na imagem). A fonte e uma
maquina que tenha o downloader do repositorio (`uv run download-collection <url>`; veja o README da raiz)
ou um backup. De uma maquina assim (na tailnet):

```bash
ssh user@HOST 'cd ~/app && docker compose stop app'
rsync -av data/catalog.db data/ownership.db user@HOST:app/data/
rsync -av cards/ user@HOST:app/cards/
ssh user@HOST 'sudo chown -R 1000:1000 ~/app/data ~/app/cards && cd ~/app && docker compose up -d --wait app'
```

Para restaurar de um backup, copie `catalog-AAAA-MM-DD.db` -> `data/catalog.db`, `ownership-...db` ->
`data/ownership.db` e o conteudo de `cards/` do mesmo modo (com o app parado).

## Deploy

- Push na `main` ou `workflow_dispatch`: builda a imagem e implanta a **SHA do commit** (`IMAGE_TAG` e passado
  no comando remoto e sobrepoe o `.env`).
- `remote-deploy.sh` (copiado a cada deploy para `~/app`): registra a tag atual em `~/app/.current_tag`,
  faz `pull` da SHA nova, `docker compose up -d --wait --wait-timeout 120`. Se o healthcheck falhar, sobe de
  novo a tag anterior (regravada no `.env`), mostra `docker compose logs --tail 50 app` e **o job falha**. Em sucesso grava a nova
  tag em `.current_tag` **e em `~/app/.env` (`IMAGE_TAG=<tag>`)**, assim `docker compose up/restart` manual ou reboot
  sempre usam a imagem validada. O compose exige `IMAGE_TAG` (sem `:latest` padrao) e o build nao publica `:latest`.
  Nao edite o `.env` a mao; para trocar a versao, rode o workflow.
- Limpeza: ao final remove imagens antigas do app, **mantendo a tag em execucao e a anterior** (rollback
  manual rapido sem novo pull), mais `docker image prune -f`.

## Rollback

Execute o workflow `Deploy` manualmente (Actions > Deploy > Run workflow) informando `image_tag` com a SHA
anterior (ja publicada no GHCR). Isso pula o build e implanta essa tag, com o mesmo healthcheck/rollback.

## Backup (dados e imagens)

Use `.backup` para os bancos (consistente com o banco em uso); `cards/` deve ser copiado inteiro
(nao e recriavel na instancia):

```bash
sudo apt-get install -y sqlite3
mkdir -p ~/backups
cat > ~/backup-sqlite.sh <<'EOF'
#!/bin/sh
set -e
d=$(date +%F)
for db in catalog ownership; do
  sqlite3 ~/app/data/$db.db ".backup '$HOME/backups/$db-$d.db'"
done
find ~/backups -name '*.db' -mtime +14 -delete
EOF
chmod +x ~/backup-sqlite.sh
( crontab -l 2>/dev/null; echo '0 3 * * * ~/backup-sqlite.sh' ) | crontab -
```

Copie periodicamente `~/backups/` e `~/app/cards/` para fora da instancia (ex.: `rsync` via Tailscale para
sua maquina) e/ou use snapshots do Lightsail.

## Operacao

```bash
cd ~/app
docker compose ps
docker compose logs -f app
cat .current_tag
tailscale serve status
```
