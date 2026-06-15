#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
source "${REPO_ROOT}/scripts/model/env.sh"

RAW_ROOT="${MLLM_DIALOGUE_RAW_ROOT:-${MLLM_DATA_ROOT}/datasets/raw-dialogue}"
ARCHIVE_PATH="${NATURALCONV_ARCHIVE:-${RAW_ROOT}/NaturalConv_Release_20210318.zip}"
DOWNLOAD_URL="${NATURALCONV_URL:-https://ailab.tencent.com/ailab/nlp/dialogue/datasets/NaturalConv_Release_20210318.zip}"
TMP_PATH="${ARCHIVE_PATH}.part"

mkdir -p "$(dirname "${ARCHIVE_PATH}")"

if [ -s "${ARCHIVE_PATH}" ] && unzip -tq "${ARCHIVE_PATH}" >/dev/null 2>&1; then
  echo "[info] NaturalConv archive already present: ${ARCHIVE_PATH}"
  exit 0
fi

echo "[info] downloading NaturalConv"
echo "[info] url=${DOWNLOAD_URL}"
echo "[info] target=${ARCHIVE_PATH}"

curl -L \
  --retry 8 \
  --retry-delay 5 \
  --connect-timeout 30 \
  --max-time 1800 \
  -C - \
  -o "${TMP_PATH}" \
  "${DOWNLOAD_URL}"

mv "${TMP_PATH}" "${ARCHIVE_PATH}"

if ! unzip -tq "${ARCHIVE_PATH}" >/dev/null 2>&1; then
  echo "[error] downloaded archive failed integrity check: ${ARCHIVE_PATH}" >&2
  exit 1
fi

echo "[info] NaturalConv archive is ready: ${ARCHIVE_PATH}"
