#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/env.sh"

if ! command -v conda >/dev/null 2>&1; then
  echo "conda is required." >&2
  exit 1
fi

eval "$(conda shell.bash hook)"
conda activate "${MLLM_CONDA_ENV}"

huggingface-cli download "${MLLM_MODEL_NAME}" \
  --local-dir "${MLLM_MODEL_DIR}" \
  --local-dir-use-symlinks False

echo "Model downloaded to ${MLLM_MODEL_DIR}"
