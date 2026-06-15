#!/usr/bin/env python3
"""Smoke-test an OpenAI-compatible multimodal chat endpoint."""

from __future__ import annotations

import argparse
import json
import os
import urllib.request


TINY_PNG_DATA_URL = (
    "data:image/png;base64,"
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII="
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--base-url", default=os.environ.get("MLLM_MODEL_BASE_URL", "http://127.0.0.1:8000/v1"))
    parser.add_argument("--api-key", default=os.environ.get("MLLM_MODEL_API_KEY", "local-mllm-token"))
    parser.add_argument("--model", default=os.environ.get("MLLM_MODEL_NAME", "Qwen/Qwen3-VL-8B-Instruct"))
    return parser.parse_args()


def request_json(args: argparse.Namespace, path: str, payload: dict | None = None) -> dict:
    data = None if payload is None else json.dumps(payload).encode("utf-8")
    request = urllib.request.Request(
        f"{args.base_url.rstrip('/')}{path}",
        data=data,
        headers={
            "Content-Type": "application/json",
            **({"Authorization": f"Bearer {args.api_key}"} if args.api_key else {}),
        },
        method="GET" if payload is None else "POST",
    )
    with urllib.request.urlopen(request, timeout=300) as response:  # noqa: S310 - local endpoint
        return json.loads(response.read().decode("utf-8"))


def request_sse(args: argparse.Namespace) -> str:
    payload = {
        "model": args.model,
        "messages": [{"role": "user", "content": "请用一句中文介绍你自己。"}],
        "temperature": 0,
        "max_tokens": 64,
        "stream": True,
    }
    request = urllib.request.Request(
        f"{args.base_url.rstrip('/')}/chat/completions",
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Content-Type": "application/json",
            "Accept": "text/event-stream",
            **({"Authorization": f"Bearer {args.api_key}"} if args.api_key else {}),
        },
        method="POST",
    )
    content = ""
    with urllib.request.urlopen(request, timeout=300) as response:  # noqa: S310 - local endpoint
        for raw_line in response:
            line = raw_line.decode("utf-8", errors="ignore").strip()
            if not line.startswith("data:"):
                continue
            data = line[5:].strip()
            if data == "[DONE]":
                break
            try:
                chunk = json.loads(data)
            except json.JSONDecodeError:
                continue
            delta = (chunk.get("choices") or [{}])[0].get("delta", {})
            token = delta.get("content") or ""
            content += token
    return content.strip()


def main() -> None:
    args = parse_args()
    models = request_json(args, "/models")
    text = request_json(
        args,
        "/chat/completions",
        {
            "model": args.model,
            "messages": [{"role": "user", "content": "请用一句中文回答：1+1 等于多少？"}],
            "temperature": 0,
            "max_tokens": 64,
            "stream": False,
        },
    )
    image = request_json(
        args,
        "/chat/completions",
        {
            "model": args.model,
            "messages": [
                {
                    "role": "user",
                    "content": [
                        {"type": "text", "text": "请简短描述这张图片。"},
                        {"type": "image_url", "image_url": {"url": TINY_PNG_DATA_URL}},
                    ],
                }
            ],
            "temperature": 0,
            "max_tokens": 64,
            "stream": False,
        },
    )
    stream_content = request_sse(args)
    print(
        json.dumps(
            {
                "models": [item.get("id") for item in models.get("data", [])],
                "text_ok": bool((text.get("choices") or [{}])[0].get("message", {}).get("content")),
                "image_ok": bool((image.get("choices") or [{}])[0].get("message", {}).get("content")),
                "stream_ok": bool(stream_content),
            },
            ensure_ascii=False,
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
