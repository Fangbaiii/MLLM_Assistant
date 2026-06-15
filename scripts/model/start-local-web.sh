#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
source "${REPO_ROOT}/scripts/model/env.sh"

export PATH="${MLLM_DATA_ROOT}/venvs/node20/bin:${HOME}/.local/bin:${PATH}"
hash -r

export MLLM_MODEL_BASE_URL="${MLLM_LOCAL_MODEL_BASE_URL:-${MLLM_MODEL_BASE_URL}}"
export MLLM_MODEL_NAME="${MLLM_LOCAL_MODEL_NAME:-${MLLM_SERVED_MODEL_NAME:-${MLLM_MODEL_NAME}}}"
export MLLM_MODEL_API_KEY="${MLLM_LOCAL_MODEL_API_KEY:-${MLLM_MODEL_API_KEY}}"

cd "${REPO_ROOT}"

npx -y pnpm@9.15.9 install
npx prisma generate
npx prisma db push
node scripts/model/seed-postgres.js
node scripts/model/check-postgres.js

exec npx -y pnpm@9.15.9 dev --hostname 127.0.0.1 --port "${MLLM_WEB_PORT:-3000}"
