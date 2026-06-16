#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
source "${REPO_ROOT}/scripts/model/env.sh"

TRAIN_DATASET="${TRAIN_DATASET:-${MLLM_DATA_ROOT}/datasets/qwen_vl_train.jsonl}"
EVAL_DATASET="${EVAL_DATASET:-${MLLM_DATA_ROOT}/datasets/qwen_vl_eval.jsonl}"
OUTPUT_DIR="${OUTPUT_DIR:-${MLLM_DATA_ROOT}/runs/qwen3-vl-8b-lora-$(date +%Y%m%d-%H%M%S)}"
MODEL_PATH="${MLLM_MODEL_PATH:-${MLLM_MODEL_DIR}}"
CUDA_VISIBLE_DEVICES="${MLLM_TRAIN_CUDA_VISIBLE_DEVICES:-${CUDA_VISIBLE_DEVICES:-0,1,2,3}}"
NPROC_PER_NODE="${NPROC_PER_NODE:-4}"
MAX_STEPS="${MAX_STEPS:-}"
ADAPTERS="${ADAPTERS:-}"
USE_LOGITS_TO_KEEP="${USE_LOGITS_TO_KEEP:-}"
TARGET_MODULES="${TARGET_MODULES:-all-linear}"

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
  echo "swift command not found. Run scripts/model/setup-vllm-env.sh first." >&2
  exit 1
fi

if command -v gpustat >/dev/null 2>&1; then
  gpustat || true
fi

export CUDA_VISIBLE_DEVICES
export NPROC_PER_NODE
export NNODES="${NNODES:-1}"
export MASTER_PORT="${MASTER_PORT:-29501}"
export NCCL_P2P_DISABLE="${NCCL_P2P_DISABLE:-1}"
export NCCL_IB_DISABLE="${NCCL_IB_DISABLE:-1}"
export PYTORCH_ALLOC_CONF="${PYTORCH_ALLOC_CONF:-${PYTORCH_CUDA_ALLOC_CONF:-expandable_segments:True}}"
export QWENVL_BBOX_FORMAT="${QWENVL_BBOX_FORMAT:-new}"
export IMAGE_MAX_TOKEN_NUM="${IMAGE_MAX_TOKEN_NUM:-1536}"
export IMAGE_MIN_TOKEN_NUM="${IMAGE_MIN_TOKEN_NUM:-4}"
export TORCH_EMPTY_CACHE_STEPS="${TORCH_EMPTY_CACHE_STEPS:-1}"
export PYTHONPATH="${REPO_ROOT}/scripts/training/compat${PYTHONPATH:+:${PYTHONPATH}}"

ARGS=(
  sft
  --model "${MODEL_PATH}"
  --dataset "${TRAIN_DATASET}"
  --tuner_type lora
  --torch_dtype bfloat16
  --num_train_epochs "${NUM_TRAIN_EPOCHS:-1}"
  --per_device_train_batch_size "${PER_DEVICE_TRAIN_BATCH_SIZE:-1}"
  --gradient_accumulation_steps "${GRADIENT_ACCUMULATION_STEPS:-8}"
  --learning_rate "${LEARNING_RATE:-1e-4}"
  --weight_decay "${WEIGHT_DECAY:-0.1}"
  --lora_rank "${LORA_RANK:-16}"
  --lora_alpha "${LORA_ALPHA:-32}"
  --lora_dropout "${LORA_DROPOUT:-0.05}"
  --freeze_vit "${FREEZE_VIT:-true}"
  --freeze_aligner "${FREEZE_ALIGNER:-true}"
  --loss_scale "${LOSS_SCALE:-default}"
  --truncation_strategy "${TRUNCATION_STRATEGY:-delete}"
  --gradient_checkpointing "${GRADIENT_CHECKPOINTING:-true}"
  --save_steps "${SAVE_STEPS:-200}"
  --save_total_limit "${SAVE_TOTAL_LIMIT:-2}"
  --logging_steps "${LOGGING_STEPS:-10}"
  --max_length "${MAX_LENGTH:-1536}"
  --warmup_ratio "${WARMUP_RATIO:-0.05}"
  --dataloader_num_workers "${DATALOADER_NUM_WORKERS:-4}"
  --dataset_num_proc "${DATASET_NUM_PROC:-4}"
  --torch_empty_cache_steps "${TORCH_EMPTY_CACHE_STEPS}"
  --ddp_find_unused_parameters "${DDP_FIND_UNUSED_PARAMETERS:-false}"
  --output_dir "${OUTPUT_DIR}"
)

IFS=', ' read -r -a TARGET_MODULE_ARRAY <<<"${TARGET_MODULES}"
ARGS+=(--target_modules "${TARGET_MODULE_ARRAY[@]}")

if [ -n "${ADAPTERS}" ]; then
  ARGS+=(--adapters "${ADAPTERS}")
fi

if [ -f "${EVAL_DATASET}" ]; then
  ARGS+=(--val_dataset "${EVAL_DATASET}" --eval_steps "${EVAL_STEPS:-200}")
fi

if [ -n "${MAX_STEPS}" ]; then
  ARGS+=(--max_steps "${MAX_STEPS}")
fi

if [ -n "${DEEPSPEED:-}" ]; then
  ARGS+=(--deepspeed "${DEEPSPEED}")
fi

if [ -n "${USE_LOGITS_TO_KEEP}" ]; then
  ARGS+=(--use_logits_to_keep "${USE_LOGITS_TO_KEEP}")
fi

echo "Starting LoRA fine-tuning:"
echo "  model=${MODEL_PATH}"
echo "  train_dataset=${TRAIN_DATASET}"
echo "  eval_dataset=$([ -f "${EVAL_DATASET}" ] && echo "${EVAL_DATASET}" || echo none)"
echo "  output_dir=${OUTPUT_DIR}"
echo "  adapters=${ADAPTERS:-none}"
echo "  cuda_visible_devices=${CUDA_VISIBLE_DEVICES}"
echo "  nproc_per_node=${NPROC_PER_NODE}"
echo "  master_port=${MASTER_PORT}"
echo "  pytorch_alloc_conf=${PYTORCH_ALLOC_CONF}"
echo "  image_max_token_num=${IMAGE_MAX_TOKEN_NUM}"
echo "  max_length=${MAX_LENGTH:-1536}"
echo "  loss_scale=${LOSS_SCALE:-default}"
echo "  truncation_strategy=${TRUNCATION_STRATEGY:-delete}"
echo "  torch_empty_cache_steps=${TORCH_EMPTY_CACHE_STEPS}"
echo "  use_logits_to_keep=${USE_LOGITS_TO_KEEP:-auto}"
echo "  target_modules=${TARGET_MODULE_ARRAY[*]}"
echo "  freeze_vit=${FREEZE_VIT:-true}"
echo "  freeze_aligner=${FREEZE_ALIGNER:-true}"
echo "  pythonpath_compat=${REPO_ROOT}/scripts/training/compat"

swift "${ARGS[@]}"

echo "LoRA output: ${OUTPUT_DIR}"
