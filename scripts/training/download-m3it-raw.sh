#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
source "${REPO_ROOT}/scripts/model/env.sh"

RAW_ROOT="${MLLM_RAW_DATA_ROOT:-${MLLM_DATA_ROOT}/datasets/raw-hf-datasets}"
REPO_ID="MMInstruction/M3IT"
DATASET_PREFIX="datasets/${REPO_ID}/resolve/main"
CONNECTIONS="${ARIA2C_CONNECTIONS:-8}"
SPLIT="${1:-all}"

if ! command -v aria2c >/dev/null 2>&1; then
  echo "aria2c is required but not installed." >&2
  exit 1
fi

declare -a ENDPOINTS=()
if [ -n "${HF_ENDPOINT:-}" ]; then
  ENDPOINTS+=("${HF_ENDPOINT%/}")
fi
ENDPOINTS+=("https://hf-mirror.com" "https://huggingface.co")

declare -a FILES=()
case "${SPLIT}" in
  all)
    FILES=(
      "data/vqa/fm-iqa/train.jsonl"
      "data/vqa/fm-iqa/val.jsonl"
      "data/captioning/coco-cn/train.jsonl"
      "data/captioning/coco-cn/val.jsonl"
      "data/captioning/flickr8k-cn/train.jsonl"
      "data/captioning/flickr8k-cn/val.jsonl"
      "data/generation/mmchat/train.jsonl"
      "data/generation/mmchat/validation.jsonl"
    )
    ;;
  cn-core)
    FILES=(
      "data/vqa/fm-iqa/train.jsonl"
      "data/vqa/fm-iqa/val.jsonl"
      "data/captioning/coco-cn/train.jsonl"
      "data/captioning/coco-cn/val.jsonl"
      "data/captioning/flickr8k-cn/train.jsonl"
      "data/captioning/flickr8k-cn/val.jsonl"
      "data/generation/mmchat/train.jsonl"
      "data/generation/mmchat/validation.jsonl"
    )
    ;;
  fm-iqa)
    FILES=(
      "data/vqa/fm-iqa/train.jsonl"
      "data/vqa/fm-iqa/val.jsonl"
    )
    ;;
  coco-cn)
    FILES=(
      "data/captioning/coco-cn/train.jsonl"
      "data/captioning/coco-cn/val.jsonl"
    )
    ;;
  flickr8k-cn)
    FILES=(
      "data/captioning/flickr8k-cn/train.jsonl"
      "data/captioning/flickr8k-cn/val.jsonl"
    )
    ;;
  mmchat)
    FILES=(
      "data/generation/mmchat/train.jsonl"
      "data/generation/mmchat/validation.jsonl"
    )
    ;;
  *)
    echo "Usage: bash scripts/training/download-m3it-raw.sh [all|cn-core|fm-iqa|coco-cn|flickr8k-cn|mmchat]" >&2
    exit 1
    ;;
esac

download_one() {
  local rel_path="$1"
  local target_dir="${RAW_ROOT}/${REPO_ID}/$(dirname "${rel_path}")"
  local target_name
  target_name="$(basename "${rel_path}")"

  mkdir -p "${target_dir}"

  if [ -s "${target_dir}/${target_name}" ]; then
    echo "[info] already present ${rel_path}"
    return 0
  fi

  local endpoint
  for endpoint in "${ENDPOINTS[@]}"; do
    local url="${endpoint}/${DATASET_PREFIX}/${rel_path}"
    echo "[info] downloading ${rel_path}"
    echo "[info] endpoint=${endpoint}"
    if aria2c \
      --continue=true \
      --max-connection-per-server="${CONNECTIONS}" \
      --split="${CONNECTIONS}" \
      --min-split-size=1M \
      --file-allocation=none \
      --timeout=60 \
      --retry-wait=5 \
      --max-tries=0 \
      --summary-interval=30 \
      --dir="${target_dir}" \
      --out="${target_name}" \
      "${url}"; then
      echo "[info] saved=${target_dir}/${target_name}"
      return 0
    fi
    echo "[warn] failed endpoint=${endpoint} rel_path=${rel_path}" >&2
  done

  echo "[error] unable to download ${rel_path} from any configured endpoint" >&2
  return 1
}

for rel_path in "${FILES[@]}"; do
  download_one "${rel_path}"
done

echo "[info] all requested M3IT files are present under ${RAW_ROOT}/${REPO_ID}"
