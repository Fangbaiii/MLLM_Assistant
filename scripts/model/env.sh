#!/usr/bin/env bash
set -euo pipefail

export MLLM_DATA_ROOT="${MLLM_DATA_ROOT:-/mnt/data/tianyi/MLLM_Assistant}"
export MLLM_MODEL_NAME="${MLLM_MODEL_NAME:-Qwen/Qwen3-VL-8B-Instruct}"
export MLLM_MODEL_DIR="${MLLM_MODEL_DIR:-${MLLM_DATA_ROOT}/models/Qwen3-VL-8B-Instruct}"
export MLLM_VENV_DIR="${MLLM_VENV_DIR:-${MLLM_DATA_ROOT}/venvs/vllm-qwen3-vl}"
export MLLM_CONDA_ENV="${MLLM_CONDA_ENV:-${MLLM_VENV_DIR}}"
export MLLM_CONDA_CLONE_SOURCE="${MLLM_CONDA_CLONE_SOURCE:-fedprecise}"
export MLLM_VLLM_VERSION="${MLLM_VLLM_VERSION:-0.10.2}"
export MLLM_MODEL_BASE_URL="${MLLM_MODEL_BASE_URL:-http://127.0.0.1:8000/v1}"
export MLLM_MODEL_API_KEY="${MLLM_MODEL_API_KEY:-local-mllm-token}"
export MLLM_STORAGE_DIR="${MLLM_STORAGE_DIR:-${MLLM_DATA_ROOT}/uploads}"

export HF_HOME="${HF_HOME:-${MLLM_DATA_ROOT}/cache/huggingface}"
export HF_HUB_CACHE="${HF_HUB_CACHE:-${HF_HOME}/hub}"
export HF_DATASETS_CACHE="${HF_DATASETS_CACHE:-${HF_HOME}/datasets}"
export TRANSFORMERS_CACHE="${TRANSFORMERS_CACHE:-${HF_HOME}/transformers}"
export XDG_CACHE_HOME="${XDG_CACHE_HOME:-${MLLM_DATA_ROOT}/cache}"
export PNPM_HOME="${PNPM_HOME:-${MLLM_DATA_ROOT}/cache/pnpm-home}"
export PNPM_STORE_PATH="${PNPM_STORE_PATH:-${MLLM_DATA_ROOT}/cache/pnpm-store}"
export CONDA_NO_PLUGINS="${CONDA_NO_PLUGINS:-true}"
export CONDA_PKGS_DIRS="${CONDA_PKGS_DIRS:-${MLLM_DATA_ROOT}/cache/conda-pkgs}"

mkdir -p \
  "${MLLM_DATA_ROOT}/models" \
  "${MLLM_DATA_ROOT}/datasets" \
  "${MLLM_DATA_ROOT}/runs" \
  "${MLLM_DATA_ROOT}/logs" \
  "${MLLM_DATA_ROOT}/cache" \
  "${MLLM_DATA_ROOT}/uploads"
