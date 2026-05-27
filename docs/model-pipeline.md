# Qwen3-VL Model Pipeline

## Data Disk Layout

All large files stay under `/mnt/data/tianyi/MLLM_Assistant`:

- `models/`: downloaded base model weights
- `datasets/`: open-data JSONL, images, parquet exports, converted training manifests
- `runs/`: LoRA adapters and training logs
- `cache/`: Hugging Face, Transformers, datasets, pnpm caches
- `uploads/`: files uploaded through the app and evidence JSON used by `/api/chat`
- `venvs/`: Python environments for vLLM and fine-tuning

## Serving

1. Create the environment. The script clones the existing `fedprecise` CUDA/PyTorch environment by default, then installs `vllm==0.10.2` into the data-disk copy:
   ```bash
   bash scripts/model/setup-vllm-env.sh
   ```
2. Download the base model:
   ```bash
   bash scripts/model/download-qwen3-vl.sh
   ```
3. Start vLLM when GPU memory is available:
   ```bash
   bash scripts/model/serve-qwen3-vl.sh
   ```
   On the current CUDA stack, `vllm==0.10.2` imports correctly but does not register `Qwen3VLForConditionalGeneration`. Until the driver/CUDA stack can run a newer vLLM build, use the OpenAI-compatible Transformers fallback on the same `/v1/chat/completions` contract:
   ```bash
   bash scripts/model/serve-transformers-openai.sh
   ```
4. Configure the Next.js app with:
   ```env
   MLLM_MODEL_BASE_URL="http://127.0.0.1:8000/v1"
   MLLM_MODEL_NAME="Qwen/Qwen3-VL-8B-Instruct"
   MLLM_MODEL_API_KEY="local-mllm-token"
   MLLM_STORAGE_DIR="/mnt/data/tianyi/MLLM_Assistant/uploads"
   MLLM_CONTEXT_WINDOW_CHARS="18000"
   MLLM_CONTEXT_MAX_MESSAGES="16"
   ```

For cloud API routing (OpenAI/DeepSeek), keep the same OpenAI-compatible contract and switch only env values:

```env
# OpenAI
MLLM_MODEL_BASE_URL="https://api.openai.com/v1"
MLLM_MODEL_NAME="gpt-4.1"
MLLM_MODEL_API_KEY="sk-..."

# DeepSeek
MLLM_MODEL_BASE_URL="https://api.deepseek.com/v1"
MLLM_MODEL_NAME="deepseek-chat"
MLLM_MODEL_API_KEY="sk-..."
```

`/api/chat` now emits SSE (`text/event-stream`) and relays real streaming deltas from OpenAI-compatible providers.

## Fine-Tuning

Use open datasets as source material first, then convert rows into Qwen-VL chat JSONL:

```bash
python scripts/training/prepare_open_data_manifest.py \
  --input /mnt/data/tianyi/MLLM_Assistant/datasets/source_qa.jsonl \
  --output /mnt/data/tianyi/MLLM_Assistant/datasets/qwen_vl_train.jsonl \
  --dataset-root /mnt/data/tianyi/MLLM_Assistant/datasets
```

Expected source row shape:

```json
{"image":"images/example.png","question":"请总结这张图。","answer":"这是一张...","source":"dataset-name"}
```

Start LoRA SFT:

```bash
TRAIN_DATASET=/mnt/data/tianyi/MLLM_Assistant/datasets/qwen_vl_train.jsonl \
bash scripts/training/finetune-lora.sh
```

Current machine note: at implementation time all four RTX 4090 cards were already using roughly 16-18 GB each, so Qwen3-VL-8B serving/training should wait for a clearer GPU window.
