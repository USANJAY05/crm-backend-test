#!/usr/bin/env bash
set -euo pipefail
ENV=prod
VOLUMES=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dev) ENV=dev; shift;; --uat) ENV=uat; shift;; --prod) ENV=prod; shift;;
    --volumes) VOLUMES=true; shift;;
    -h|--help) echo "Usage: $0 [--dev|--uat|--prod] [--volumes]"; exit 0;;
    *) echo "Unknown option: $1"; exit 1;;
  esac
done
case "$ENV" in
 dev) ENV_FILE=.env.dev; COMPOSE=( -f docker-compose.yml -f docker-compose.keycloak.yml -f docker-compose.keycloak.dev.yml );;
 uat) ENV_FILE=.env.uat; COMPOSE=( -f docker-compose.yml -f docker-compose.caddy.yml -f docker-compose.caddy.uat.yml );;
 prod) ENV_FILE=.env; COMPOSE=( -f docker-compose.yml -f docker-compose.caddy.yml );;
esac
[[ -f "$ENV_FILE" ]] || { echo "ERROR: $ENV_FILE not found"; exit 1; }

if $VOLUMES; then
  echo "WARNING: this deletes persistent database, vector, object-storage and proxy volumes for $ENV."
  read -r -p "Type DELETE to continue: " confirm
  [[ "$confirm" == DELETE ]] || { echo "Aborted."; exit 1; }
  docker compose --env-file "$ENV_FILE" "${COMPOSE[@]}" down -v --remove-orphans
else
  docker compose --env-file "$ENV_FILE" "${COMPOSE[@]}" down --remove-orphans
fi
