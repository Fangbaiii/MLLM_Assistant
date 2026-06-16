#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
source "${REPO_ROOT}/scripts/model/env.sh"

ROOT="${PUBLIC_QUALITY_ROOT:-${MLLM_DATA_ROOT}/datasets/public-quality-sources}"
DOWNLOAD_COCO="${DOWNLOAD_COCO:-false}"

download() {
  local url="$1"
  local output="$2"
  local expected_size="$3"
  mkdir -p "$(dirname "${output}")"
  if [ -f "${output}" ] && [ "$(stat -c %s "${output}")" = "${expected_size}" ]; then
    echo "Verified existing file: ${output}"
    return 0
  fi
  local attempt
  for attempt in $(seq 1 12); do
    if curl \
      --fail \
      --location \
      --retry 3 \
      --retry-connrefused \
      --retry-delay 5 \
      --continue-at - \
      --output "${output}" \
      "${url}"; then
      break
    fi
    if [ "${attempt}" = "12" ]; then
      echo "Download failed after ${attempt} attempts: ${url}" >&2
      return 1
    fi
    echo "Download attempt ${attempt} failed; retrying ${url}" >&2
    sleep 5
  done
  if [ "$(stat -c %s "${output}")" != "${expected_size}" ]; then
    echo "Unexpected size for ${output}: got $(stat -c %s "${output}"), expected ${expected_size}" >&2
    return 1
  fi
}

mkdir -p \
  "${ROOT}/sharegpt4v" \
  "${ROOT}/coig-cqia" \
  "${ROOT}/wikimedia-wikipedia" \
  "${ROOT}/kdconv/data/film" \
  "${ROOT}/kdconv/data/music" \
  "${ROOT}/kdconv/data/travel" \
  "${ROOT}/coco"

download \
  "https://huggingface.co/datasets/Lin-Chen/ShareGPT4V/resolve/main/sharegpt4v_instruct_gpt4-vision_cap100k.json?download=true" \
  "${ROOT}/sharegpt4v/sharegpt4v_instruct_gpt4-vision_cap100k.json" \
  133866626

download \
  "https://huggingface.co/datasets/m-a-p/COIG-CQIA/resolve/main/wikihow/wikihow.jsonl?download=true" \
  "${ROOT}/coig-cqia/wikihow.jsonl" \
  11519024
download \
  "https://huggingface.co/datasets/m-a-p/COIG-CQIA/resolve/main/wiki/zgbk.jsonl?download=true" \
  "${ROOT}/coig-cqia/zgbk.jsonl" \
  5653878
download \
  "https://huggingface.co/datasets/m-a-p/COIG-CQIA/resolve/main/zhihu/zhihu_score9.0-10_clean_v10.jsonl?download=true" \
  "${ROOT}/coig-cqia/zhihu_score9.jsonl" \
  7364243
download \
  "https://huggingface.co/datasets/wikimedia/wikipedia/resolve/refs%2Fconvert%2Fparquet/20231101.zh/train/0000.parquet?download=true" \
  "${ROOT}/wikimedia-wikipedia/20231101.zh-0000.parquet" \
  587109027

for item in \
  "film/train:7892763" \
  "film/dev:1363416" \
  "film/test:1547354" \
  "music/train:4952078" \
  "music/dev:945559" \
  "music/test:1148564" \
  "travel/train:5156841" \
  "travel/dev:904751" \
  "travel/test:1100567"; do
    relative="${item%%:*}"
    expected_size="${item##*:}"
    download \
      "https://raw.githubusercontent.com/thu-coai/KdConv/653db76432de09a004ba708a68f8bbd5500e6bec/data/${relative}.json" \
      "${ROOT}/kdconv/data/${relative}.json" \
      "${expected_size}"
done
download \
  "https://raw.githubusercontent.com/thu-coai/KdConv/653db76432de09a004ba708a68f8bbd5500e6bec/LICENSE" \
  "${ROOT}/kdconv/LICENSE" \
  11357

if [ "${DOWNLOAD_COCO}" = "true" ]; then
  download \
    "http://images.cocodataset.org/zips/train2017.zip" \
    "${ROOT}/coco/train2017.zip" \
    19336861798
  if [ ! -d "${ROOT}/coco/train2017" ]; then
    unzip -q "${ROOT}/coco/train2017.zip" -d "${ROOT}/coco"
  fi
fi

(
  cd "${ROOT}"
  find sharegpt4v coig-cqia kdconv wikimedia-wikipedia -type f -print0 \
    | sort -z \
    | xargs -0 sha256sum > SHA256SUMS
)

echo "Public quality sources ready under ${ROOT}"
