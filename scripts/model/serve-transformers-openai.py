#!/usr/bin/env python3
from __future__ import annotations

import base64
import io
import os
from typing import Any

import torch
import uvicorn
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field
from PIL import Image
from qwen_vl_utils import process_vision_info
from transformers import AutoModelForImageTextToText, AutoProcessor


MODEL_PATH = os.environ.get("MLLM_MODEL_PATH") or os.environ.get(
    "MLLM_MODEL_DIR",
    "/mnt/data/tianyi/MLLM_Assistant/models/Qwen3-VL-8B-Instruct",
)
SERVED_MODEL_NAME = os.environ.get("MLLM_SERVED_MODEL_NAME") or os.environ.get(
    "MLLM_MODEL_NAME",
    "Qwen/Qwen3-VL-8B-Instruct",
)
API_KEY = os.environ.get("MLLM_MODEL_API_KEY", "")
HOST = os.environ.get("MLLM_SERVE_HOST", "127.0.0.1")
PORT = int(os.environ.get("MLLM_SERVE_PORT", "8000"))

app = FastAPI(title="MLLM Qwen3-VL OpenAI-compatible server")
processor: AutoProcessor | None = None
model: AutoModelForImageTextToText | None = None


class ChatCompletionRequest(BaseModel):
    model: str
    messages: list[dict[str, Any]]
    temperature: float = 0.3
    max_tokens: int = Field(default=2048, alias="max_tokens")
    stream: bool = False


def decode_data_url(data_url: str) -> Image.Image:
    if not data_url.startswith("data:"):
        raise ValueError("Only data URL images are supported by the local Transformers server.")

    _, encoded = data_url.split(",", 1)
    image = Image.open(io.BytesIO(base64.b64decode(encoded)))
    return image.convert("RGB")


def convert_openai_messages(messages: list[dict[str, Any]]) -> list[dict[str, Any]]:
    converted: list[dict[str, Any]] = []

    for message in messages:
        content = message.get("content", "")
        if isinstance(content, str):
            converted.append({"role": message.get("role", "user"), "content": content})
            continue

        parts: list[dict[str, Any]] = []
        for part in content:
            if part.get("type") == "text":
                parts.append({"type": "text", "text": part.get("text", "")})
            elif part.get("type") == "image_url":
                url = part.get("image_url", {}).get("url", "")
                parts.append({"type": "image", "image": decode_data_url(url)})

        converted.append({"role": message.get("role", "user"), "content": parts})

    return converted


@app.on_event("startup")
def load_model() -> None:
    global model, processor
    processor = AutoProcessor.from_pretrained(MODEL_PATH, trust_remote_code=True)
    model = AutoModelForImageTextToText.from_pretrained(
        MODEL_PATH,
        torch_dtype=torch.bfloat16,
        device_map="auto",
        trust_remote_code=True,
    )
    model.eval()


@app.get("/v1/models")
def list_models() -> dict[str, Any]:
    return {
        "object": "list",
        "data": [{"id": SERVED_MODEL_NAME, "object": "model", "owned_by": "local"}],
    }


@app.post("/v1/chat/completions")
def chat_completions(request: ChatCompletionRequest) -> dict[str, Any]:
    if request.stream:
        raise HTTPException(status_code=400, detail="Streaming is not implemented by this fallback server.")

    if processor is None or model is None:
        raise HTTPException(status_code=503, detail="Model is still loading.")

    messages = convert_openai_messages(request.messages)
    prompt = processor.apply_chat_template(messages, tokenize=False, add_generation_prompt=True)
    image_inputs, video_inputs = process_vision_info(messages)
    inputs = processor(
        text=[prompt],
        images=image_inputs,
        videos=video_inputs,
        padding=True,
        return_tensors="pt",
    ).to(model.device)

    do_sample = request.temperature > 0
    with torch.inference_mode():
        generated_ids = model.generate(
            **inputs,
            max_new_tokens=request.max_tokens,
            do_sample=do_sample,
            temperature=request.temperature if do_sample else None,
        )

    trimmed_ids = [
        output_ids[len(input_ids) :]
        for input_ids, output_ids in zip(inputs.input_ids, generated_ids, strict=True)
    ]
    content = processor.batch_decode(trimmed_ids, skip_special_tokens=True, clean_up_tokenization_spaces=False)[0]

    return {
        "id": "chatcmpl-local-qwen3-vl",
        "object": "chat.completion",
        "model": SERVED_MODEL_NAME,
        "choices": [{"index": 0, "message": {"role": "assistant", "content": content}, "finish_reason": "stop"}],
    }


if __name__ == "__main__":
    uvicorn.run(app, host=HOST, port=PORT)
