#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/env.sh"

if ! command -v conda >/dev/null 2>&1; then
  echo "conda is required to create the vLLM environment." >&2
  exit 1
fi

eval "$(conda shell.bash hook)"

if [ ! -d "${MLLM_CONDA_ENV}" ]; then
  if conda env list | awk '{print $1}' | grep -qx "${MLLM_CONDA_CLONE_SOURCE}"; then
    conda create --solver classic -y -p "${MLLM_CONDA_ENV}" --clone "${MLLM_CONDA_CLONE_SOURCE}"
  else
    conda create --solver classic -y -p "${MLLM_CONDA_ENV}" python=3.10
  fi
fi

conda activate "${MLLM_CONDA_ENV}"
python -m pip install --upgrade pip wheel setuptools
python -m pip install \
  "vllm==${MLLM_VLLM_VERSION}" \
  --extra-index-url "https://wheels.vllm.ai/${MLLM_VLLM_VERSION}/" \
  --extra-index-url "https://download.pytorch.org/whl/cu128" \
  huggingface_hub[cli] \
  datasets \
  accelerate \
  peft \
  trl \
  qwen-vl-utils

python - <<'PY'
import torch
print("python ok")
print("torch", torch.__version__)
print("cuda available", torch.cuda.is_available())
if torch.cuda.is_available():
    print("cuda devices", torch.cuda.device_count())
PY
