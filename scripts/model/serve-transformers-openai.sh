#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/env.sh"

MODEL_PATH="${MLLM_MODEL_PATH:-${MLLM_MODEL_DIR}}"
if [ ! -d "${MODEL_PATH}" ]; then
  MODEL_PATH="${MLLM_MODEL_NAME}"
fi
export MLLM_MODEL_PATH="${MODEL_PATH}"

if command -v gpustat >/dev/null 2>&1; then
  gpustat || true
fi

eval "$(conda shell.bash hook)"
conda activate "${MLLM_CONDA_ENV}"

python "${SCRIPT_DIR}/serve-transformers-openai.py"
