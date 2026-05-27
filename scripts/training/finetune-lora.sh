#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
source "${REPO_ROOT}/scripts/model/env.sh"

TRAIN_DATASET="${TRAIN_DATASET:-${MLLM_DATA_ROOT}/datasets/qwen_vl_train.jsonl}"
OUTPUT_DIR="${OUTPUT_DIR:-${MLLM_DATA_ROOT}/runs/qwen3-vl-8b-lora-$(date +%Y%m%d-%H%M%S)}"
MODEL_PATH="${MLLM_MODEL_PATH:-${MLLM_MODEL_DIR}}"

if [ ! -f "${TRAIN_DATASET}" ]; then
  echo "Training dataset not found: ${TRAIN_DATASET}" >&2
  echo "Create it with scripts/training/prepare_open_data_manifest.py first." >&2
  exit 1
fi

if [ ! -d "${MODEL_PATH}" ]; then
  MODEL_PATH="${MLLM_MODEL_NAME}"
fi

eval "$(conda shell.bash hook)"
conda activate "${MLLM_CONDA_ENV}"

if ! command -v swift >/dev/null 2>&1; then
  python -m pip install "ms-swift[llm]"
fi

if command -v gpustat >/dev/null 2>&1; then
  gpustat || true
fi

swift sft \
  --model "${MODEL_PATH}" \
  --dataset "${TRAIN_DATASET}" \
  --train_type lora \
  --torch_dtype bfloat16 \
  --num_train_epochs "${NUM_TRAIN_EPOCHS:-1}" \
  --per_device_train_batch_size "${PER_DEVICE_TRAIN_BATCH_SIZE:-1}" \
  --gradient_accumulation_steps "${GRADIENT_ACCUMULATION_STEPS:-8}" \
  --learning_rate "${LEARNING_RATE:-1e-4}" \
  --lora_rank "${LORA_RANK:-16}" \
  --lora_alpha "${LORA_ALPHA:-32}" \
  --target_modules "${TARGET_MODULES:-all-linear}" \
  --save_steps "${SAVE_STEPS:-200}" \
  --logging_steps "${LOGGING_STEPS:-10}" \
  --max_length "${MAX_LENGTH:-8192}" \
  --output_dir "${OUTPUT_DIR}"

echo "LoRA output: ${OUTPUT_DIR}"
