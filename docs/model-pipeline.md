# Qwen3-VL Local Pipeline

## Data Disk Layout

All large artifacts stay under `/mnt/data/tianyi/MLLM_Assistant`:

- `models/`: base model weights such as `Qwen3-VL-8B-Instruct`
- `datasets/`: sampled JSONL manifests, public images, and smoke/eval splits
- `runs/`: LoRA checkpoints and training outputs
- `cache/`: Hugging Face, datasets, pnpm, and conda caches
- `uploads/`: files uploaded through the app and OCR evidence JSON
- `venvs/`: Python and Node runtimes used by serving and training
- `logs/`: long-running job logs

## Serving Qwen3-VL

1. Prepare the CUDA environment:
   ```bash
   bash scripts/model/setup-vllm-env.sh
   ```
   This installs `vllm>=0.11`, `ms-swift`, `bitsandbytes`, `deepspeed`, and `qwen-vl-utils` into the data-disk environment.

2. Download the base model:
   ```bash
   bash scripts/model/download-qwen3-vl.sh
   ```

3. Start the local OpenAI-compatible endpoint. The high-level launcher tries `TP=1`, then `TP=2`, then `TP=4` while keeping `max_model_len=4096` unless you override it:
   ```bash
   MLLM_CUDA_VISIBLE_DEVICES=0,1,2,3 \
   bash scripts/model/start-qwen3-vl.sh
   ```

4. Smoke test the endpoint:
   ```bash
   /mnt/data/tianyi/MLLM_Assistant/venvs/vllm-qwen3-vl/bin/python \
     scripts/model/check-openai-compatible.py \
     --base-url http://127.0.0.1:8000/v1 \
     --api-key local-mllm-token \
     --model Qwen/Qwen3-VL-8B-Instruct
   ```

### Serving a LoRA Adapter

After fine-tuning finishes, start vLLM with LoRA enabled:

```bash
MLLM_CUDA_VISIBLE_DEVICES=0,1,2,3 \
MLLM_SERVED_MODEL_NAME=mllm-qwen3-vl-lora \
MLLM_LORA_MODULES="mllm-qwen3-vl-lora=/mnt/data/tianyi/MLLM_Assistant/runs/qwen3-vl-8b-lora-*/checkpoint-*" \
bash scripts/model/start-qwen3-vl.sh
```

Point the web app at the served LoRA name:

```bash
MLLM_LOCAL_MODEL_NAME=mllm-qwen3-vl-lora \
bash scripts/model/start-local-web.sh
```

## Next.js App Routing

For the local model path, keep the app on the same OpenAI-compatible contract:

```bash
bash scripts/model/start-local-web.sh
```

The script bootstraps pnpm and Prisma, then starts Next.js with:

- `MLLM_MODEL_BASE_URL=http://127.0.0.1:8000/v1`
- `MLLM_MODEL_API_KEY=local-mllm-token`
- `MLLM_MODEL_NAME=${MLLM_LOCAL_MODEL_NAME:-Qwen/Qwen3-VL-8B-Instruct}`

## Public Data Preparation

Generate the first-round open-data mix:

```bash
/mnt/data/tianyi/MLLM_Assistant/venvs/vllm-qwen3-vl/bin/python -u \
  scripts/training/prepare_open_data_manifest.py \
  --public \
  --sources docvqa chartqa m3it-fm-iqa m3it-coco-cn m3it-flickr8k-cn m3it-mmchat \
  --max-train-rows 27000 \
  --smoke-rows 16 \
  --output /mnt/data/tianyi/MLLM_Assistant/datasets/qwen_vl_train.jsonl \
  --eval-output /mnt/data/tianyi/MLLM_Assistant/datasets/qwen_vl_eval.jsonl \
  --smoke-output /mnt/data/tianyi/MLLM_Assistant/datasets/qwen_vl_smoke.jsonl
```

The script writes ms-swift multimodal JSONL with absolute image paths and a de-duplicated holdout split.

## LoRA Fine-Tuning

### Quality-first long-answer pipeline

The old `*-long` manifests contain fixed template expansions and should not be
used for another formal run. Build a quality-first manifest instead:

```bash
SOURCE_DATASETS=/mnt/data/tianyi/MLLM_Assistant/datasets/qwen_vl_cn_multimodal_balanced_train.jsonl \
CURATED_DATASETS=/path/to/human-or-teacher-curated.jsonl \
bash scripts/training/run-quality-lora-pipeline.sh
```

When no private human-written corpus is available, build the same mix from
traceable public sources:

```bash
bash scripts/training/run-public-quality-pipeline.sh
```

This public-only path uses:

- ShareGPT4V COCO captions (`CC-BY-NC-4.0`), translated by the local base model
  while retaining the English answer and source ID for audit. The translation
  prompt keeps useful source details such as location, era, atmosphere, visible
  text, and activity context, but asks the model not to invent new facts. English
  brands, team names, signs, and labels visible in the image may remain as
  evidence when the surrounding answer is Chinese.
- KdConv (`Apache-2.0`) for 4-8 round knowledge-grounded dialogue prefixes
- Wikimedia Wikipedia Chinese (`CC-BY-SA-3.0` and `GFDL-1.3`) for native
  500-1500 character long-form answers

COIG-CQIA is downloaded for comparison but excluded from the formal mix because
the dataset card has no aggregate license and the selected subsets use placeholder
per-row copyright metadata. `SHA256SUMS` under `public-quality-sources` pins every
downloaded source file.

This pipeline:

- rejects the known fixed expansion templates and high-repetition answers
- converts real dialogues into prefix samples whose final assistant turn is the target
- enforces the 20/35/30/15 concise, detailed multimodal, multi-turn, and long-form mix
- fails when a category is underfilled instead of fabricating image details
- audits every retained row with the real Qwen3-VL processor
- requires at least 95% retention at `max_length=3072` and `IMAGE_MAX_TOKEN_NUM=768`
- writes a stratified 500-row `*_human-review-500.jsonl` review sheet
- stops before training unless `RUN_TRAINING=true`

For faster local translation, set `TRANSLATION_WORKERS` if needed; the default
public pipeline uses 16 concurrent OpenAI-compatible requests and keeps the same
quality gates. If you need a mirror endpoint for dataset downloads, you can run:

```bash
HF_ENDPOINT=https://hf-mirror.com \
bash scripts/training/run-public-quality-pipeline.sh
```

Note: `hf-mirror.com` is a third-party mirror, not an official Hugging Face domain.

Review at least 500 sampled rows and both audit reports before enabling formal training.
When `RUN_TRAINING=true`, the pipeline rejects incomplete reviews and requires at
least a 90% approval rate.
The formal defaults are `loss_scale=last_round`, LoRA rank 16/alpha 32/dropout
0.05, learning rate `5e-5`, warmup 3%, and one epoch.

Teacher generation is available as an explicit, resumable candidate step:

```bash
TEACHER_BASE_URL=https://your-openai-compatible-endpoint/v1 \
TEACHER_MODEL=your-teacher-model \
TEACHER_API_KEY=... \
python scripts/training/generate_curated_candidates.py \
  --input /mnt/data/tianyi/MLLM_Assistant/datasets/qwen_vl_cn_multimodal_balanced_train.jsonl \
  --output /mnt/data/tianyi/MLLM_Assistant/datasets/qwen_vl_teacher_candidates.jsonl \
  --category detailed_multimodal \
  --limit 100
```

Generated rows remain marked `teacher_review_required=true`; pass only reviewed
rows back through `--curated-input`. This script is never invoked automatically,
because it may use a paid or networked endpoint.

Run the two memory smoke tests separately:

```bash
MAX_LENGTH=2048 bash scripts/training/smoke-quality-lora.sh
MAX_LENGTH=3072 bash scripts/training/smoke-quality-lora.sh
```

Use 3072 only when the smoke run stays below the per-GPU memory target. Otherwise
re-run the manifest audit and formal training at 2048.

1. Smoke test training:
   ```bash
   TRAIN_DATASET=/mnt/data/tianyi/MLLM_Assistant/datasets/qwen_vl_smoke.jsonl \
   EVAL_DATASET=/mnt/data/tianyi/MLLM_Assistant/datasets/qwen_vl_eval.jsonl \
   OUTPUT_DIR=/mnt/data/tianyi/MLLM_Assistant/runs/qwen3-vl-smoke \
   MAX_STEPS=2 \
   MLLM_TRAIN_CUDA_VISIBLE_DEVICES=0,1,2,3 \
   NPROC_PER_NODE=4 \
   bash scripts/training/finetune-lora.sh
   ```

2. Full 4-GPU run:
   ```bash
   TRAIN_DATASET=/mnt/data/tianyi/MLLM_Assistant/datasets/qwen_vl_train.jsonl \
   EVAL_DATASET=/mnt/data/tianyi/MLLM_Assistant/datasets/qwen_vl_eval.jsonl \
   OUTPUT_DIR=/mnt/data/tianyi/MLLM_Assistant/runs/qwen3-vl-8b-lora \
   MLLM_TRAIN_CUDA_VISIBLE_DEVICES=0,1,2,3 \
   NPROC_PER_NODE=4 \
   LORA_RANK=16 \
   LORA_ALPHA=32 \
   LEARNING_RATE=1e-4 \
   MAX_LENGTH=4096 \
   IMAGE_MAX_TOKEN_NUM=4096 \
   bash scripts/training/finetune-lora.sh
   ```

If you hit OOM during training, lower `IMAGE_MAX_TOKEN_NUM` to `2048` before touching other knobs.

The data-preparation flow disables Hugging Face `xet` by default (`HF_HUB_DISABLE_XET=1`) because the M3IT download path can otherwise stall on resumable range requests in this environment.
It also uses longer Hugging Face timeouts by default:

- `HF_HUB_ETAG_TIMEOUT=60`
- `HF_HUB_DOWNLOAD_TIMEOUT=600`
- `MLLM_HTTP_TIMEOUT=120`

## Evaluation

Build the fixed five-category benchmark:

```bash
python scripts/training/build_capability_benchmark.py
```

Compare multiple served checkpoints in one report:

```bash
python scripts/training/evaluate_capabilities.py \
  --benchmark /mnt/data/tianyi/MLLM_Assistant/datasets/qwen3_vl_capability_v1.jsonl \
  --base-url http://127.0.0.1:8003/v1 \
  --model base=mllm-qwen3-vl-base \
  --model balanced=mllm-qwen3-vl-cn-balanced-lora \
  --model quality=mllm-qwen3-vl-cn-quality-lora \
  --output /mnt/data/tianyi/MLLM_Assistant/runs/capability-comparison.json
```

The report includes output length, length compliance, early EOS, repeated
4-gram ratio, context-keyword retention, factual character F1, token usage, and
`finish_reason`. Its `manual_preference` fields are intentionally left empty for
blind human comparison.

Compare base vs LoRA on the same holdout set:

```bash
/mnt/data/tianyi/MLLM_Assistant/venvs/vllm-qwen3-vl/bin/python \
  scripts/training/evaluate_openai_compatible.py \
  --eval-jsonl /mnt/data/tianyi/MLLM_Assistant/datasets/qwen_vl_eval.jsonl \
  --base-url http://127.0.0.1:8000/v1 \
  --api-key local-mllm-token \
  --base-model Qwen/Qwen3-VL-8B-Instruct \
  --lora-model mllm-qwen3-vl-lora \
  --output /mnt/data/tianyi/MLLM_Assistant/runs/base-vs-lora-report.json
```
