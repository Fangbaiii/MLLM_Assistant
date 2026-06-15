#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/env.sh"

HOST="${MLLM_SERVE_HOST:-127.0.0.1}"
PORT="${MLLM_SERVE_PORT:-8000}"
MAX_MODEL_LEN="${MLLM_MAX_MODEL_LEN:-4096}"
GPU_MEMORY_UTILIZATION="${MLLM_GPU_MEMORY_UTILIZATION:-0.84}"
SERVED_MODEL_NAME="${MLLM_SERVED_MODEL_NAME:-${MLLM_MODEL_NAME}}"
MODEL_PATH="${MLLM_MODEL_PATH:-${MLLM_MODEL_DIR}}"
LIMIT_MM_PER_PROMPT="${MLLM_LIMIT_MM_PER_PROMPT:-{\"image\": 4, \"video\": 0}}"
TENSOR_PARALLEL_SIZE="${MLLM_TENSOR_PARALLEL_SIZE:-1}"
PIPELINE_PARALLEL_SIZE="${MLLM_PIPELINE_PARALLEL_SIZE:-1}"
DATA_PARALLEL_SIZE="${MLLM_DATA_PARALLEL_SIZE:-1}"
MAX_LORA_RANK="${MLLM_MAX_LORA_RANK:-64}"
VLLM_EXTRA_ARGS="${MLLM_VLLM_EXTRA_ARGS:-}"
DISTRIBUTED_EXECUTOR_BACKEND="${MLLM_DISTRIBUTED_EXECUTOR_BACKEND:-}"

if [ ! -d "${MODEL_PATH}" ]; then
  MODEL_PATH="${MLLM_MODEL_NAME}"
fi

if [ -n "${MLLM_CUDA_VISIBLE_DEVICES:-}" ]; then
  export CUDA_VISIBLE_DEVICES="${MLLM_CUDA_VISIBLE_DEVICES}"
fi

if command -v gpustat >/dev/null 2>&1; then
  gpustat || true
fi

eval "$(conda shell.bash hook)"
conda activate "${MLLM_CONDA_ENV}"

export OMP_NUM_THREADS="${OMP_NUM_THREADS:-1}"

TOTAL_PARALLEL_SIZE=$((TENSOR_PARALLEL_SIZE * PIPELINE_PARALLEL_SIZE * DATA_PARALLEL_SIZE))

if [ -z "${DISTRIBUTED_EXECUTOR_BACKEND}" ] && [ "${TOTAL_PARALLEL_SIZE}" -gt 1 ]; then
  DISTRIBUTED_EXECUTOR_BACKEND="mp"
fi

ARGS=(
  serve "${MODEL_PATH}"
  --served-model-name "${SERVED_MODEL_NAME}" \
  --host "${HOST}" \
  --port "${PORT}" \
  --api-key "${MLLM_MODEL_API_KEY}" \
  --dtype auto \
  --max-model-len "${MAX_MODEL_LEN}" \
  --gpu-memory-utilization "${GPU_MEMORY_UTILIZATION}" \
  --pipeline-parallel-size "${PIPELINE_PARALLEL_SIZE}" \
  --tensor-parallel-size "${TENSOR_PARALLEL_SIZE}" \
  --limit-mm-per-prompt "${LIMIT_MM_PER_PROMPT}" \
  --trust-remote-code
)

if [ "${DATA_PARALLEL_SIZE}" -gt 1 ]; then
  ARGS+=(--data-parallel-size "${DATA_PARALLEL_SIZE}")
fi

if [ -n "${DISTRIBUTED_EXECUTOR_BACKEND}" ]; then
  ARGS+=(--distributed-executor-backend "${DISTRIBUTED_EXECUTOR_BACKEND}")
fi

if [ -n "${MLLM_LORA_MODULES:-}" ]; then
  ARGS+=(
    --enable-lora
    --max-lora-rank "${MAX_LORA_RANK}"
    --lora-modules "${MLLM_LORA_MODULES}"
  )
fi

if [ -n "${VLLM_EXTRA_ARGS}" ]; then
  # shellcheck disable=SC2206
  EXTRA_ARGS=(${VLLM_EXTRA_ARGS})
  ARGS+=("${EXTRA_ARGS[@]}")
fi

echo "Starting vLLM:"
echo "  model=${MODEL_PATH}"
echo "  served_model=${SERVED_MODEL_NAME}"
echo "  host=${HOST} port=${PORT}"
echo "  max_model_len=${MAX_MODEL_LEN} tp=${TENSOR_PARALLEL_SIZE} pp=${PIPELINE_PARALLEL_SIZE} dp=${DATA_PARALLEL_SIZE}"
echo "  gpu_memory_utilization=${GPU_MEMORY_UTILIZATION}"
echo "  cuda_visible_devices=${CUDA_VISIBLE_DEVICES:-all}"
if [ -n "${DISTRIBUTED_EXECUTOR_BACKEND}" ]; then
  echo "  distributed_executor_backend=${DISTRIBUTED_EXECUTOR_BACKEND}"
fi
if [ -n "${MLLM_LORA_MODULES:-}" ]; then
  echo "  lora_modules=${MLLM_LORA_MODULES}"
fi
if [ -n "${VLLM_EXTRA_ARGS}" ]; then
  echo "  extra_args=${VLLM_EXTRA_ARGS}"
fi

exec vllm "${ARGS[@]}"
