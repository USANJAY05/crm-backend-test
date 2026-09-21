#!/usr/bin/env bash
set -euo pipefail

if [[ "$(id -u)" -ne 0 ]]; then SUDO=sudo; else SUDO=; fi

if command -v docker >/dev/null 2>&1; then
  echo "Docker already installed: $(docker --version)"
else
  echo "Installing Docker Engine..."
  if command -v apt-get >/dev/null 2>&1; then
    $SUDO apt-get update
    $SUDO apt-get install -y ca-certificates curl git
    curl -fsSL https://get.docker.com | $SUDO sh
  else
    echo "Unsupported package manager. Install Docker manually, then rerun this script."
    exit 1
  fi
fi

$SUDO systemctl enable --now docker 2>/dev/null || true

if [[ -n "${SUDO:-}" ]]; then
  $SUDO usermod -aG docker "${SUDO_USER:-$USER}" 2>/dev/null || true
fi

chmod +x deploy.sh logs.sh status.sh remove.sh start

if [[ ! -f .env ]]; then
  if [[ -f .env.production.example ]]; then
    cp .env.production.example .env
    chmod 600 .env
    echo "Created .env from .env.production.example. Fill in secrets before deployment."
  else
    echo "ERROR: .env.production.example not found."
    exit 1
  fi
fi

echo "Installation/preparation complete."
echo "Next: edit .env, then run ./deploy.sh --prod --build"
