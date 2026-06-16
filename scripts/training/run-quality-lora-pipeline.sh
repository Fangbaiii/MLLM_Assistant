#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
source "${REPO_ROOT}/scripts/model/env.sh"

SOURCE_DATASETS="${SOURCE_DATASETS:-${MLLM_DATA_ROOT}/datasets/qwen_vl_cn_multimodal_balanced_train.jsonl}"
CURATED_DATASETS="${CURATED_DATASETS:-}"
RAW_TRAIN_DATASET="${RAW_TRAIN_DATASET:-${MLLM_DATA_ROOT}/datasets/qwen_vl_cn_quality_train.raw.jsonl}"
RAW_EVAL_DATASET="${RAW_EVAL_DATASET:-${MLLM_DATA_ROOT}/datasets/qwen_vl_cn_quality_eval.raw.jsonl}"
TRAIN_DATASET="${TRAIN_DATASET:-${MLLM_DATA_ROOT}/datasets/qwen_vl_cn_quality_train.jsonl}"
EVAL_DATASET="${EVAL_DATASET:-${MLLM_DATA_ROOT}/datasets/qwen_vl_cn_quality_eval.jsonl}"
BUILD_REPORT="${BUILD_REPORT:-${MLLM_DATA_ROOT}/datasets/qwen_vl_cn_quality_build-report.json}"
AUDIT_REPORT="${AUDIT_REPORT:-${MLLM_DATA_ROOT}/datasets/qwen_vl_cn_quality_audit-report.json}"
EVAL_AUDIT_REPORT="${EVAL_AUDIT_REPORT:-${MLLM_DATA_ROOT}/datasets/qwen_vl_cn_quality_eval-audit-report.json}"
REVIEW_OUTPUT="${REVIEW_OUTPUT:-${MLLM_DATA_ROOT}/datasets/qwen_vl_cn_quality_human-review-500.jsonl}"
TARGET_ROWS="${TARGET_ROWS:-18000}"
EVAL_ROWS="${EVAL_ROWS:-1000}"
MAX_LENGTH="${MAX_LENGTH:-3072}"
IMAGE_MAX_TOKEN_NUM="${IMAGE_MAX_TOKEN_NUM:-768}"
MIN_RETENTION="${MIN_RETENTION:-0.95}"
OUTPUT_DIR="${OUTPUT_DIR:-${MLLM_DATA_ROOT}/runs/qwen3-vl-8b-lora-cn-quality-$(date +%Y%m%d-%H%M%S)}"
RUN_TRAINING="${RUN_TRAINING:-false}"
ALLOW_UNREVIEWED_TRAINING="${ALLOW_UNREVIEWED_TRAINING:-false}"

cd "${REPO_ROOT}"

BUILD_ARGS=()
IFS=: read -r -a SOURCE_ARRAY <<<"${SOURCE_DATASETS}"
for dataset in "${SOURCE_ARRAY[@]}"; do
  BUILD_ARGS+=(--input "${dataset}")
done
if [ -n "${CURATED_DATASETS}" ]; then
  IFS=: read -r -a CURATED_ARRAY <<<"${CURATED_DATASETS}"
  for dataset in "${CURATED_ARRAY[@]}"; do
    BUILD_ARGS+=(--curated-input "${dataset}")
  done
fi

echo "Building quality-first manifest..."
"${MLLM_CONDA_ENV}/bin/python" scripts/training/build_quality_sft_manifest.py \
  "${BUILD_ARGS[@]}" \
  --output "${RAW_TRAIN_DATASET}" \
  --eval-output "${RAW_EVAL_DATASET}" \
  --report "${BUILD_REPORT}" \
  --target-rows "${TARGET_ROWS}" \
  --eval-rows "${EVAL_ROWS}"

echo "Auditing train manifest with the real Qwen3-VL processor..."
IMAGE_MAX_TOKEN_NUM="${IMAGE_MAX_TOKEN_NUM}" \
  "${MLLM_CONDA_ENV}/bin/python" scripts/training/audit_sft_manifest.py \
  --input "${RAW_TRAIN_DATASET}" \
  --output "${TRAIN_DATASET}" \
  --report "${AUDIT_REPORT}" \
  --model "${MLLM_MODEL_DIR}" \
  --max-length "${MAX_LENGTH}" \
  --image-max-token-num "${IMAGE_MAX_TOKEN_NUM}" \
  --min-retention "${MIN_RETENTION}"

echo "Auditing eval manifest..."
IMAGE_MAX_TOKEN_NUM="${IMAGE_MAX_TOKEN_NUM}" \
  "${MLLM_CONDA_ENV}/bin/python" scripts/training/audit_sft_manifest.py \
  --input "${RAW_EVAL_DATASET}" \
  --output "${EVAL_DATASET}" \
  --report "${EVAL_AUDIT_REPORT}" \
  --model "${MLLM_MODEL_DIR}" \
  --max-length "${MAX_LENGTH}" \
  --image-max-token-num "${IMAGE_MAX_TOKEN_NUM}" \
  --min-retention "${MIN_RETENTION}"

if [ ! -f "${REVIEW_OUTPUT}" ] || [ "${REGENERATE_REVIEW:-false}" = "true" ]; then
  echo "Preparing the stratified 500-row human review sheet..."
  "${MLLM_CONDA_ENV}/bin/python" scripts/training/prepare_human_review.py \
    --input "${TRAIN_DATASET}" \
    --output "${REVIEW_OUTPUT}" \
    --rows 500
else
  echo "Keeping existing human review sheet: ${REVIEW_OUTPUT}"
fi

if [ "${RUN_TRAINING}" != "true" ]; then
  echo "Quality manifests are ready. Formal training was not started (RUN_TRAINING=${RUN_TRAINING})."
  echo "Set RUN_TRAINING=true after reviewing at least 500 sampled records and both audit reports."
  exit 0
fi

if [ "${ALLOW_UNREVIEWED_TRAINING}" = "true" ]; then
  echo "WARNING: Starting with explicit user authorization while row-level review is incomplete."
  echo "The review sheet is left unchanged; this run must not be reported as 500-row human-reviewed."
else
  echo "Validating completed human review..."
  "${MLLM_CONDA_ENV}/bin/python" scripts/training/validate_human_review.py \
    --input "${REVIEW_OUTPUT}" \
    --min-rows 500 \
    --min-approval-rate "${MIN_REVIEW_APPROVAL_RATE:-0.90}"
fi

echo "Starting attributable quality LoRA run..."
env \
  TRAIN_DATASET="${TRAIN_DATASET}" \
  EVAL_DATASET="${EVAL_DATASET}" \
  OUTPUT_DIR="${OUTPUT_DIR}" \
  MAX_LENGTH="${MAX_LENGTH}" \
  IMAGE_MAX_TOKEN_NUM="${IMAGE_MAX_TOKEN_NUM}" \
  LOSS_SCALE=last_round \
  TRUNCATION_STRATEGY=delete \
  LEARNING_RATE="${LEARNING_RATE:-5e-5}" \
  WARMUP_RATIO="${WARMUP_RATIO:-0.03}" \
  NUM_TRAIN_EPOCHS="${NUM_TRAIN_EPOCHS:-1}" \
  LORA_RANK="${LORA_RANK:-16}" \
  LORA_ALPHA="${LORA_ALPHA:-32}" \
  LORA_DROPOUT="${LORA_DROPOUT:-0.05}" \
  SAVE_STEPS="${SAVE_STEPS:-150}" \
  EVAL_STEPS="${EVAL_STEPS:-150}" \
  SAVE_TOTAL_LIMIT="${SAVE_TOTAL_LIMIT:-4}" \
  GRADIENT_CHECKPOINTING=true \
  bash scripts/training/run-lora-train-only.sh
