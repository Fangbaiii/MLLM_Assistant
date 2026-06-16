#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
source "${REPO_ROOT}/scripts/model/env.sh"

TRAIN_DATASET="${TRAIN_DATASET:-${MLLM_DATA_ROOT}/datasets/qwen_vl_cn_quality_train.jsonl}"
EVAL_DATASET="${EVAL_DATASET:-${MLLM_DATA_ROOT}/datasets/qwen_vl_cn_quality_eval.jsonl}"
MAX_LENGTH="${MAX_LENGTH:-2048}"
IMAGE_MAX_TOKEN_NUM="${IMAGE_MAX_TOKEN_NUM:-768}"
MAX_STEPS="${MAX_STEPS:-2}"
OUTPUT_DIR="${OUTPUT_DIR:-${MLLM_DATA_ROOT}/runs/qwen3-vl-quality-smoke-${MAX_LENGTH}-$(date +%Y%m%d-%H%M%S)}"

if [ ! -f "${TRAIN_DATASET}" ]; then
  echo "Quality training manifest not found: ${TRAIN_DATASET}" >&2
  echo "Run scripts/training/run-quality-lora-pipeline.sh first." >&2
  exit 1
fi

cd "${REPO_ROOT}"
env \
  TRAIN_DATASET="${TRAIN_DATASET}" \
  EVAL_DATASET="${EVAL_DATASET}" \
  OUTPUT_DIR="${OUTPUT_DIR}" \
  MAX_LENGTH="${MAX_LENGTH}" \
  IMAGE_MAX_TOKEN_NUM="${IMAGE_MAX_TOKEN_NUM}" \
  MAX_STEPS="${MAX_STEPS}" \
  LOSS_SCALE=last_round \
  TRUNCATION_STRATEGY=delete \
  LEARNING_RATE=5e-5 \
  WARMUP_RATIO=0.03 \
  LORA_RANK=16 \
  LORA_ALPHA=32 \
  LORA_DROPOUT=0.05 \
  SAVE_STEPS=1 \
  EVAL_STEPS=1 \
  SAVE_TOTAL_LIMIT=1 \
  GRADIENT_CHECKPOINTING=true \
  bash scripts/training/finetune-lora.sh
