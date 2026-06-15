#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
source "${REPO_ROOT}/scripts/model/env.sh"

PUBLIC_ROOT="${PUBLIC_ROOT:-${MLLM_DATA_ROOT}/datasets/public-quality-sources}"
SHAREGPT_META="${SHAREGPT_META:-${PUBLIC_ROOT}/sharegpt4v/sharegpt4v_instruct_gpt4-vision_cap100k.json}"
COCO_DIR="${COCO_DIR:-${PUBLIC_ROOT}/coco/train2017}"
COCO_SUBSET_MANIFEST="${COCO_SUBSET_MANIFEST:-${PUBLIC_ROOT}/coco/sharegpt4v-coco-subset.jsonl}"
SHAREGPT_ZH="${SHAREGPT_ZH:-${MLLM_DATA_ROOT}/datasets/sharegpt4v_coco_zh_detailed.jsonl}"
SHAREGPT_AUDIT_REPORT="${SHAREGPT_AUDIT_REPORT:-${MLLM_DATA_ROOT}/datasets/sharegpt4v_coco_zh_audit.json}"
SHAREGPT_REVIEW_OUTPUT="${SHAREGPT_REVIEW_OUTPUT:-${MLLM_DATA_ROOT}/datasets/sharegpt4v_coco_zh_review-200.jsonl}"
PUBLIC_MANIFEST="${PUBLIC_MANIFEST:-${MLLM_DATA_ROOT}/datasets/public_quality_curated.jsonl}"
PUBLIC_REPORT="${PUBLIC_REPORT:-${MLLM_DATA_ROOT}/datasets/public_quality_curated_report.json}"
LEGACY_DATASET="${LEGACY_DATASET:-${MLLM_DATA_ROOT}/datasets/qwen_vl_cn_multimodal_balanced_train.jsonl}"
TRANSLATION_BASE_URL="${TRANSLATION_BASE_URL:-http://127.0.0.1:8003/v1}"
TRANSLATION_MODEL="${TRANSLATION_MODEL:-Qwen3-VL-8B-Instruct}"
TRANSLATION_API_KEY="${TRANSLATION_API_KEY:-${MLLM_MODEL_API_KEY}}"
TRANSLATION_WORKERS="${TRANSLATION_WORKERS:-16}"
DETAILED_SOURCE_ROWS="${DETAILED_SOURCE_ROWS:-7000}"
MULTI_TURN_SOURCE_ROWS="${MULTI_TURN_SOURCE_ROWS:-6200}"
LONG_FORM_SOURCE_ROWS="${LONG_FORM_SOURCE_ROWS:-3200}"
DOWNLOAD_SOURCES="${DOWNLOAD_SOURCES:-true}"

cd "${REPO_ROOT}"

if [ "${DOWNLOAD_SOURCES}" = "true" ]; then
  DOWNLOAD_COCO=false bash scripts/training/download-public-quality-data.sh
  "${MLLM_CONDA_ENV}/bin/python" scripts/training/download_sharegpt4v_coco_subset.py \
    --metadata "${SHAREGPT_META}" \
    --output-dir "${COCO_DIR}" \
    --manifest "${COCO_SUBSET_MANIFEST}" \
    --limit "${COCO_SUBSET_ROWS:-8000}"
fi

if [ ! -f "${SHAREGPT_META}" ] || [ ! -d "${COCO_DIR}" ]; then
  echo "ShareGPT4V metadata or COCO images are missing under ${PUBLIC_ROOT}." >&2
  exit 1
fi

echo "Translating traceable ShareGPT4V COCO captions through the local model..."
"${MLLM_CONDA_ENV}/bin/python" scripts/training/translate_sharegpt4v.py \
  --input "${SHAREGPT_META}" \
  --output "${SHAREGPT_ZH}" \
  --coco-dir "${COCO_DIR}" \
  --base-url "${TRANSLATION_BASE_URL}" \
  --api-key "${TRANSLATION_API_KEY}" \
  --model "${TRANSLATION_MODEL}" \
  --limit "${DETAILED_SOURCE_ROWS}" \
  --workers "${TRANSLATION_WORKERS}"

"${MLLM_CONDA_ENV}/bin/python" scripts/training/audit_public_translations.py \
  --input "${SHAREGPT_ZH}" \
  --report "${SHAREGPT_AUDIT_REPORT}" \
  --review-output "${SHAREGPT_REVIEW_OUTPUT}"

echo "Converting ShareGPT4V, KdConv, and Wikimedia into a public quality manifest..."
"${MLLM_CONDA_ENV}/bin/python" scripts/training/prepare_public_quality_sources.py \
  --root "${PUBLIC_ROOT}" \
  --sharegpt4v-zh "${SHAREGPT_ZH}" \
  --output "${PUBLIC_MANIFEST}" \
  --report "${PUBLIC_REPORT}" \
  --detailed-limit "${DETAILED_SOURCE_ROWS}" \
  --multi-turn-limit "${MULTI_TURN_SOURCE_ROWS}" \
  --long-form-limit "${LONG_FORM_SOURCE_ROWS}"

echo "Building and auditing the final 20/35/30/15 quality mix..."
env \
  SOURCE_DATASETS="${LEGACY_DATASET}" \
  CURATED_DATASETS="${PUBLIC_MANIFEST}" \
  TARGET_ROWS="${TARGET_ROWS:-18000}" \
  EVAL_ROWS="${EVAL_ROWS:-1000}" \
  MAX_LENGTH="${MAX_LENGTH:-3072}" \
  IMAGE_MAX_TOKEN_NUM="${IMAGE_MAX_TOKEN_NUM:-768}" \
  MIN_RETENTION="${MIN_RETENTION:-0.95}" \
  RUN_TRAINING="${RUN_TRAINING:-false}" \
  bash scripts/training/run-quality-lora-pipeline.sh
