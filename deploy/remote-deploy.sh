#!/usr/bin/env bash
# Executado NA instancia pelo workflow: bash ~/app/remote-deploy.sh <tag> <ghcr-user>
# O token do GHCR (read:packages) chega pela entrada padrao.
set -euo pipefail

NEW_TAG="${1:?uso: remote-deploy.sh <tag> <ghcr-user>}"
GHCR_USER="${2:?uso: remote-deploy.sh <tag> <ghcr-user>}"
IMAGE="ghcr.io/joaosp7/pokemon-card-collector"
APP_DIR="${APP_DIR:-$HOME/app}"
WAIT_TIMEOUT="${WAIT_TIMEOUT:-120}"

cd "$APP_DIR"

# Pastas de dados: o container roda como uid 1000.
mkdir -p data cards
if [ "$(stat -c %u data)" != "1000" ] || [ "$(stat -c %u cards)" != "1000" ]; then
  sudo -n chown -R 1000:1000 data cards
fi

PREV_TAG=""
if [ -f .current_tag ]; then
  PREV_TAG="$(cat .current_tag)"
fi

IFS= read -r GHCR_TOKEN
printf '%s' "$GHCR_TOKEN" | docker login ghcr.io -u "$GHCR_USER" --password-stdin

export IMAGE_TAG="$NEW_TAG"
docker compose pull app

if ! docker compose up -d --wait --wait-timeout "$WAIT_TIMEOUT" app; then
  echo "::error::Deploy de $NEW_TAG falhou (healthcheck). Ultimos logs:"
  docker compose logs --tail 50 app || true
  if [ -n "$PREV_TAG" ] && [ "$PREV_TAG" != "$NEW_TAG" ]; then
    echo "Rollback para $PREV_TAG"
    IMAGE_TAG="$PREV_TAG" docker compose up -d --wait --wait-timeout "$WAIT_TIMEOUT" app \
      || echo "ATENCAO: rollback para $PREV_TAG tambem falhou"
  fi
  exit 1
fi

echo "$NEW_TAG" > .current_tag

# Limpeza: mantem a tag em execucao e a anterior (rollback rapido); remove o resto.
docker image ls "$IMAGE" --format '{{.Tag}}' | sort -u | while read -r tag; do
  if [ "$tag" != "$NEW_TAG" ] && [ "$tag" != "$PREV_TAG" ]; then
    docker image rm "$IMAGE:$tag" || true
  fi
done
docker image prune -f
