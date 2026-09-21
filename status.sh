#!/usr/bin/env bash
set -euo pipefail
ENV=prod
while [[ $# -gt 0 ]]; do
  case "$1" in
    --dev) ENV=dev; shift;; --uat) ENV=uat; shift;; --prod) ENV=prod; shift;;
    *) echo "Unknown option: $1"; exit 1;;
  esac
done
case "$ENV" in
 dev) ENV_FILE=.env.dev; COMPOSE=( -f docker-compose.yml -f docker-compose.keycloak.yml -f docker-compose.keycloak.dev.yml );;
 uat) ENV_FILE=.env.uat; COMPOSE=( -f docker-compose.yml -f docker-compose.caddy.yml -f docker-compose.caddy.uat.yml );;
 prod) ENV_FILE=.env; COMPOSE=( -f docker-compose.yml -f docker-compose.caddy.yml );;
esac
[[ -f "$ENV_FILE" ]] || { echo "ERROR: $ENV_FILE not found"; exit 1; }
docker compose --env-file "$ENV_FILE" "${COMPOSE[@]}" ps
if command -v curl >/dev/null 2>&1; then
  curl -fsS http://127.0.0.1:3000/health >/dev/null && echo "API: healthy" || echo "API: unavailable"
fi
docker system df || true
