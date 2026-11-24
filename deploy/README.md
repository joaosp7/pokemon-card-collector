# Deploy no AWS Lightsail (GitHub Actions + Docker + Caddy)

Fluxo: push na `main` -> GitHub Actions builda a imagem (linux/amd64) e publica no GHCR
(`ghcr.io/joaosp7/pokemon-card-collector`, tags `latest` e SHA) -> o runner entra na tailnet
do Tailscale, faz SSH na instancia pela rede privada, copia `docker-compose.yml` e `Caddyfile`
para `~/app` e roda `docker compose pull && docker compose up -d`.

Na instancia rodam 2 containers: `app` (Next.js standalone, sem porta publicada no host) e
`caddy` (80/443, HTTPS automatico, proxy reverso para `app:3000`).

## Como o app guarda dados

O app nao usa variaveis de ambiente para caminhos. Ele resolve tudo a partir de `process.cwd()/..`
(`web/lib/data-paths.ts`). Na imagem o cwd e `/app/web`, entao:

| Caminho no container | Conteudo | Volume no host |
| --- | --- | --- |
| `/app/data/catalog.db` | catalogo (sets/cartas) | `~/app/data` |
| `/app/data/ownership.db` | cartas que voce possui | `~/app/data` |
| `/app/cards/` | imagens das cartas | `~/app/cards` |

Os bancos nunca ficam dentro da imagem. O esquema SQLite e criado automaticamente na primeira
execucao (`CREATE TABLE IF NOT EXISTS`); **nao ha migrations** e por isso nao existe passo de migrate no deploy.

Limitacao: o botao de download de colecoes chama `uv run download-collection` (Python + Playwright),
que **nao esta na imagem**. Em producao, popule `data/` e `cards/` a partir da sua maquina (veja abaixo).

## Pre-requisitos

- Instancia Lightsail Ubuntu 24.04 (x86_64, 1 GB RAM), IP estatico anexado.
- Dominio com registro DNS tipo A apontando para o IP estatico.
- Conta Tailscale (tailnet) com a tag `tag:ci` criada nas ACLs.
- Pacote GHCR legivel pela instancia (token com `read:packages`).

## Secrets do GitHub (Settings > Secrets and variables > Actions)

| Secret | Para que serve |
| --- | --- |
| `TS_OAUTH_CLIENT_ID` | OAuth client do Tailscale (escopo `auth_keys` write, tag `tag:ci`); o runner entra na tailnet |
| `TS_OAUTH_SECRET` | Segredo do mesmo OAuth client |
| `DEPLOY_HOST` | Nome MagicDNS ou IP Tailscale (100.x) da instancia |
| `DEPLOY_USER` | Usuario SSH na instancia (ex.: `ubuntu`) |
| `DEPLOY_SSH_KEY` | Chave privada SSH (a publica vai em `~/.ssh/authorized_keys` da instancia) |
| `GHCR_PULL_TOKEN` | PAT (classic) com `read:packages`, usado pela instancia para `docker login ghcr.io` |

O push da imagem usa o `GITHUB_TOKEN` automatico (nenhum secret extra). Nenhum segredo fica no repositorio.

Nas ACLs do Tailscale, permita `tag:ci` acessar a instancia na porta 22 (ex.: `tag:server`).

## Preparar a instancia (uma vez)

```bash
# 1) Docker + plugin compose
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER   # reconecte a sessao depois

# 2) Tailscale (com SSH do Tailscale, opcional) e tag para a ACL
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up --ssh --advertise-tags=tag:server

# 3) Pastas do app e dos dados (o container roda como uid 1000 = usuario "node")
mkdir -p ~/app/data ~/app/cards
sudo chown -R 1000:1000 ~/app/data ~/app/cards

# 4) .env a partir do exemplo (copie deploy/.env.example do repo)
nano ~/app/.env      # defina DOMAIN=seu.dominio.com
chmod 600 ~/app/.env
```

Swap (recomendado com 1 GB de RAM; evita OOM no `docker compose pull`):

```bash
sudo fallocate -l 1G /swapfile && sudo chmod 600 /swapfile
sudo mkswap /swapfile && sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```

Firewall do Lightsail (aba Networking):

- **Abra apenas 80/tcp e 443/tcp (e 443/udp se quiser HTTP/3).**
- **A porta 22 NAO deve ficar aberta para a internet**: o deploy e o acesso administrativo passam pelo Tailscale.
  Remova a regra SSH padrao depois de confirmar que o acesso via Tailscale funciona.

DNS: crie o registro A de `DOMAIN` apontando para o IP estatico. O Caddy emite o certificado
automaticamente quando o DNS propagar (80/443 precisam estar abertas).

## Enviar os dados existentes (uma vez)

Da sua maquina (via Tailscale), com o app parado se possivel:

```bash
ssh user@HOST 'cd ~/app && docker compose stop app'
rsync -av data/catalog.db data/ownership.db user@HOST:app/data/
rsync -av cards/ user@HOST:app/cards/
ssh user@HOST 'sudo chown -R 1000:1000 ~/app/data ~/app/cards && cd ~/app && docker compose up -d app'
```

## Primeiro deploy

Rode o workflow `Deploy` (push na `main` ou `workflow_dispatch`). Depois acesse `https://DOMAIN`.

## Backup do SQLite

Use `.backup` (consistente com o banco em uso), nao `cp`:

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

Copie os backups para fora da instancia (ex.: `rsync` via Tailscale ou snapshot do Lightsail).
As imagens em `cards/` podem ser recriadas pelo download, mas inclua-as no snapshot se preferir.

## Rollback

Cada build publica a tag com o SHA do commit. Para voltar:

```bash
cd ~/app
sed -i 's/^IMAGE_TAG=.*/IMAGE_TAG=<sha-anterior>/' .env   # ou adicione a linha
docker compose up -d
```

Para voltar ao normal, defina `IMAGE_TAG=latest`. Observacao: o proximo deploy automatico usa o
`.env` da instancia; se `IMAGE_TAG` continuar fixado, o deploy nao atualiza a imagem.

## Operacao

```bash
cd ~/app
docker compose ps
docker compose logs -f app
docker compose logs -f caddy
```
