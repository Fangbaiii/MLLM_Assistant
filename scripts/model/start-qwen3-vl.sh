#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/env.sh"

MAX_MODEL_LEN="${MLLM_START_MAX_MODEL_LEN:-${MLLM_MAX_MODEL_LEN:-4096}}"

count_visible_gpus() {
  if [ -n "${MLLM_CUDA_VISIBLE_DEVICES:-}" ]; then
    awk -F',' '{print NF}' <<<"${MLLM_CUDA_VISIBLE_DEVICES}"
    return
  fi

  if command -v nvidia-smi >/dev/null 2>&1; then
    nvidia-smi --query-gpu=index --format=csv,noheader | wc -l
    return
  fi

  echo 1
}

VISIBLE_GPU_COUNT="$(count_visible_gpus | tr -d '[:space:]')"

default_parallel_plans() {
  case "${VISIBLE_GPU_COUNT}" in
    3)
      echo "pp=3,tp=1,dp=1 pp=1,tp=2,dp=1 pp=1,tp=1,dp=1"
      ;;
    2)
      echo "pp=1,tp=2,dp=1 pp=1,tp=1,dp=1"
      ;;
    4|5|6|7|8)
      echo "pp=1,tp=4,dp=1 pp=1,tp=2,dp=1 pp=1,tp=1,dp=1"
      ;;
    *)
      echo "pp=1,tp=1,dp=1"
      ;;
  esac
}

PARALLEL_PLANS="${MLLM_PARALLEL_PLANS:-$(default_parallel_plans)}"
read -r -a PLAN_VALUES <<<"${PARALLEL_PLANS}"

if [ "${#PLAN_VALUES[@]}" -eq 0 ]; then
  echo "No parallel plans configured." >&2
  exit 1
fi

parse_plan() {
  local plan="$1"
  local tp=1
  local pp=1
  local dp=1
  local entry key value

  IFS=',' read -r -a entries <<<"${plan}"
  for entry in "${entries[@]}"; do
    key="${entry%%=*}"
    value="${entry#*=}"
    case "${key}" in
      tp) tp="${value}" ;;
      pp) pp="${value}" ;;
      dp) dp="${value}" ;;
      *)
        echo "Unsupported parallel plan entry: ${entry}" >&2
        return 1
        ;;
    esac
  done

  echo "${tp} ${pp} ${dp}"
}

LAST_RC=1

for plan in "${PLAN_VALUES[@]}"; do
  if ! read -r tp pp dp <<<"$(parse_plan "${plan}")"; then
    LAST_RC=1
    continue
  fi

  REQUIRED_GPUS=$((tp * pp * dp))
  if [ "${REQUIRED_GPUS}" -gt "${VISIBLE_GPU_COUNT}" ]; then
    echo "Skipping plan ${plan}: requires ${REQUIRED_GPUS} visible GPUs, but only found ${VISIBLE_GPU_COUNT}"
    continue
  fi

  echo "Attempting Qwen3-VL start with plan ${plan} max_model_len=${MAX_MODEL_LEN}"
  set +e
  MLLM_TENSOR_PARALLEL_SIZE="${tp}" \
  MLLM_PIPELINE_PARALLEL_SIZE="${pp}" \
  MLLM_DATA_PARALLEL_SIZE="${dp}" \
  MLLM_MAX_MODEL_LEN="${MAX_MODEL_LEN}" \
  bash "${SCRIPT_DIR}/serve-qwen3-vl.sh"
  RC=$?
  set -e
  LAST_RC="${RC}"

  if [ "${RC}" -eq 0 ]; then
    exit 0
  fi

  echo "vLLM exited with code ${RC} for plan ${plan}"
done

echo "All Qwen3-VL start attempts failed. Tried plans: ${PARALLEL_PLANS}" >&2
exit "${LAST_RC}"
