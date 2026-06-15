#!/usr/bin/env python3
"""Generate resumable teacher candidates for human review.

This script never starts automatically from the training pipeline. It calls an
explicit OpenAI-compatible endpoint and writes candidates, not trusted training
data.
"""

from __future__ import annotations

import argparse
import base64
import hashlib
import json
import mimetypes
import os
import random
import re
import time
import urllib.request
from pathlib import Path
from typing import Any


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--category", choices=("detailed_multimodal", "multi_turn", "long_form"), required=True)
    parser.add_argument("--base-url", default=os.environ.get("TEACHER_BASE_URL", ""))
    parser.add_argument("--api-key", default=os.environ.get("TEACHER_API_KEY", ""))
    parser.add_argument("--model", default=os.environ.get("TEACHER_MODEL", ""))
    parser.add_argument("--limit", type=int, default=0)
    parser.add_argument("--seed", type=int, default=20260612)
    parser.add_argument("--sleep-sec", type=float, default=0.2)
    return parser.parse_args()


def data_url(path: str) -> str:
    mime = mimetypes.guess_type(path)[0] or "image/png"
    encoded = base64.b64encode(Path(path).read_bytes()).decode("ascii")
    return f"data:{mime};base64,{encoded}"


def read_rows(path: Path) -> list[dict[str, Any]]:
    return [json.loads(line) for line in path.open(encoding="utf-8") if line.strip()]


def row_key(row: dict[str, Any], category: str) -> str:
    payload = {
        "category": category,
        "messages": row.get("messages", []),
        "images": row.get("images", []),
    }
    return hashlib.sha1(
        json.dumps(payload, ensure_ascii=False, sort_keys=True).encode("utf-8")
    ).hexdigest()


def existing_keys(path: Path) -> set[str]:
    if not path.exists():
        return set()
    keys: set[str] = set()
    with path.open(encoding="utf-8") as handle:
        for line in handle:
            if line.strip():
                row = json.loads(line)
                keys.add(str(row.get("candidate_key", "")))
    return keys


def eligible(row: dict[str, Any], category: str) -> bool:
    messages = row.get("messages", [])
    if category == "detailed_multimodal":
        return bool(row.get("images")) and len(messages) == 2
    if category == "multi_turn":
        return len(messages) >= 5 and messages[-1].get("role") == "assistant"
    return not row.get("images") and bool(messages)


def teacher_prompt(row: dict[str, Any], category: str) -> list[dict[str, Any]]:
    messages = row.get("messages", [])
    if category == "detailed_multimodal":
        question = str(messages[0].get("content", "")).replace("<image>", "")
        known_answer = str(messages[-1].get("content", ""))
        content: list[dict[str, Any]] = [
            {
                "type": "text",
                "text": (
                    "你正在为多模态助手编写高质量中文监督答案。请直接输出 150 到 500 个中文字符的答案。"
                    "必须保留已知结论，并结合图片补充真实可见的主体、属性、动作、空间关系和场景细节。"
                    "不要使用“最稳妥的答案”“根据可见信息”等空泛模板，不要编造看不到的身份或故事。\n"
                    f"用户问题：{question}\n已知短答案：{known_answer}"
                ),
            }
        ]
        content.extend(
            {"type": "image_url", "image_url": {"url": data_url(str(image))}}
            for image in row.get("images", [])[:1]
        )
        return [{"role": "user", "content": content}]

    history = messages[:-1] if messages[-1].get("role") == "assistant" else messages
    if category == "multi_turn":
        instruction = {
            "role": "user",
            "content": (
                "请为上述对话生成下一条高质量中文助手回复，长度 80 到 300 字。"
                "必须具体承接至少两个历史事实并提供新的有用信息；不要复述要求，不要使用通用套话。"
            ),
        }
        return [*history, instruction]

    source_prompt = str(messages[-1].get("content", ""))
    return [
        {
            "role": "user",
            "content": (
                "请生成一条 500 到 1500 字的高质量中文回答，要求结构完整、信息密度高、"
                "无段落循环，并自然满足原请求。只输出最终回答。\n"
                f"原请求：{source_prompt}"
            ),
        }
    ]


def call_teacher(args: argparse.Namespace, messages: list[dict[str, Any]]) -> str:
    payload = {
        "model": args.model,
        "messages": messages,
        "temperature": 0.4,
        "top_p": 0.8,
        "max_tokens": 2048,
        "stream": False,
    }
    request = urllib.request.Request(
        f"{args.base_url.rstrip('/')}/chat/completions",
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Content-Type": "application/json",
            **({"Authorization": f"Bearer {args.api_key}"} if args.api_key else {}),
        },
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=600) as response:
        result = json.loads(response.read().decode("utf-8"))
    return str((result.get("choices") or [{}])[0].get("message", {}).get("content", "")).strip()


def valid_candidate(answer: str, category: str) -> bool:
    compact = re.sub(r"\s+", "", answer)
    minimum = {"detailed_multimodal": 150, "multi_turn": 80, "long_form": 500}[category]
    maximum = {"detailed_multimodal": 500, "multi_turn": 300, "long_form": 1500}[category]
    return minimum <= len(compact) <= maximum


def build_candidate(row: dict[str, Any], category: str, answer: str, key: str) -> dict[str, Any]:
    messages = [dict(message) for message in row.get("messages", [])]
    if category == "multi_turn" and messages[-1].get("role") == "assistant":
        messages = messages[:-1]
    if category == "long_form":
        messages = [messages[-1]]
    messages.append({"role": "assistant", "content": answer})
    candidate: dict[str, Any] = {
        "candidate_key": key,
        "messages": messages,
        "source": f"teacher-{row.get('source', 'curated')}",
        "quality_category": category,
        "answer_mode": "detailed" if category != "multi_turn" else "standard",
        "teacher_review_required": True,
    }
    if row.get("images"):
        candidate["images"] = row["images"]
    return candidate


def main() -> None:
    args = parse_args()
    if not args.base_url or not args.model:
        raise SystemExit("Set --base-url and --model (or TEACHER_BASE_URL/TEACHER_MODEL).")

    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    done = existing_keys(output)
    rows = [row for row in read_rows(Path(args.input)) if eligible(row, args.category)]
    random.Random(args.seed).shuffle(rows)
    generated = 0
    attempted = 0
    with output.open("a", encoding="utf-8") as handle:
        for row in rows:
            key = row_key(row, args.category)
            if key in done:
                continue
            if args.limit and generated >= args.limit:
                break
            attempted += 1
            answer = call_teacher(args, teacher_prompt(row, args.category))
            if not valid_candidate(answer, args.category):
                print(f"[reject] category={args.category} chars={len(answer)}", flush=True)
                continue
            candidate = build_candidate(row, args.category, answer, key)
            handle.write(json.dumps(candidate, ensure_ascii=False) + "\n")
            handle.flush()
            done.add(key)
            generated += 1
            print(f"[generate] accepted={generated} attempted={attempted}", flush=True)
            if args.sleep_sec:
                time.sleep(args.sleep_sec)
    print(json.dumps({"generated": generated, "attempted": attempted, "output": str(output)}))


if __name__ == "__main__":
    main()
