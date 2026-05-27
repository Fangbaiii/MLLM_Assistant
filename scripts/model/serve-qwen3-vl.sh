#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/env.sh"

HOST="${MLLM_SERVE_HOST:-127.0.0.1}"
PORT="${MLLM_SERVE_PORT:-8000}"
MAX_MODEL_LEN="${MLLM_MAX_MODEL_LEN:-32768}"
GPU_MEMORY_UTILIZATION="${MLLM_GPU_MEMORY_UTILIZATION:-0.86}"
SERVED_MODEL_NAME="${MLLM_SERVED_MODEL_NAME:-${MLLM_MODEL_NAME}}"
MODEL_PATH="${MLLM_MODEL_PATH:-${MLLM_MODEL_DIR}}"
LIMIT_MM_PER_PROMPT="${MLLM_LIMIT_MM_PER_PROMPT:-{\"image\": 4, \"video\": 0}}"

if [ ! -d "${MODEL_PATH}" ]; then
  MODEL_PATH="${MLLM_MODEL_NAME}"
fi

if command -v gpustat >/dev/null 2>&1; then
  gpustat || true
fi

eval "$(conda shell.bash hook)"
conda activate "${MLLM_CONDA_ENV}"

export OMP_NUM_THREADS="${OMP_NUM_THREADS:-1}"

vllm serve "${MODEL_PATH}" \
  --served-model-name "${SERVED_MODEL_NAME}" \
  --host "${HOST}" \
  --port "${PORT}" \
  --api-key "${MLLM_MODEL_API_KEY}" \
  --dtype auto \
  --max-model-len "${MAX_MODEL_LEN}" \
  --gpu-memory-utilization "${GPU_MEMORY_UTILIZATION}" \
  --limit-mm-per-prompt "${LIMIT_MM_PER_PROMPT}" \
  --trust-remote-code
