#!/usr/bin/env bash
set -euo pipefail
ENV=prod
SERVICE=app
FOLLOW=true

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dev) ENV=dev; shift;;
    --uat) ENV=uat; shift;;
    --prod) ENV=prod; shift;;
    --no-follow) FOLLOW=false; shift;;
    --service) SERVICE="$2"; shift 2;;
    -h|--help) echo "Usage: $0 [--dev|--uat|--prod] [--service SERVICE] [--no-follow]"; exit 0;;
    *) SERVICE="$1"; shift;;
  esac
done
case "$ENV" in
 dev) ENV_FILE=.env.dev; COMPOSE=( -f docker-compose.yml -f docker-compose.keycloak.yml -f docker-compose.keycloak.dev.yml );;
 uat) ENV_FILE=.env.uat; COMPOSE=( -f docker-compose.yml -f docker-compose.caddy.yml -f docker-compose.caddy.uat.yml );;
 prod) ENV_FILE=.env; COMPOSE=( -f docker-compose.yml -f docker-compose.caddy.yml );;
esac
[[ -f "$ENV_FILE" ]] || { echo "ERROR: $ENV_FILE not found"; exit 1; }
CMD=(docker compose --env-file "$ENV_FILE" "${COMPOSE[@]}" logs --tail=200)
$FOLLOW && CMD+=(-f)
CMD+=("$SERVICE")
"${CMD[@]}"
