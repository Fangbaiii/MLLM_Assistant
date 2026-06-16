#!/usr/bin/env python3
"""Build a deterministic five-category Qwen3-VL capability benchmark."""

from __future__ import annotations

import argparse
import json
import random
from collections import defaultdict
from pathlib import Path
from typing import Any


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--eval-jsonl",
        default="/mnt/data/tianyi/MLLM_Assistant/datasets/qwen_vl_cn_multimodal_balanced_eval.jsonl",
    )
    parser.add_argument(
        "--output",
        default="/mnt/data/tianyi/MLLM_Assistant/datasets/qwen3_vl_capability_v1.jsonl",
    )
    parser.add_argument("--per-category", type=int, default=40)
    parser.add_argument("--seed", type=int, default=20260612)
    return parser.parse_args()


def last_assistant_index(messages: list[dict[str, Any]]) -> int | None:
    for index in range(len(messages) - 1, -1, -1):
        if messages[index].get("role") == "assistant":
            return index
    return None


def benchmark_row(
    row: dict[str, Any],
    category: str,
    min_chars: int,
    context_keywords: list[str] | None = None,
) -> dict[str, Any] | None:
    messages = [message for message in row.get("messages", []) if isinstance(message, dict)]
    answer_index = last_assistant_index(messages)
    if answer_index is None:
        return None
    prompt_messages = messages[:answer_index]
    if not prompt_messages or prompt_messages[-1].get("role") != "user":
        return None
    return {
        "id": "",
        "category": category,
        "source": row.get("source", "unknown"),
        "messages": prompt_messages,
        "images": row.get("images", []),
        "reference": messages[answer_index].get("content", ""),
        "criteria": {
            "min_chars": min_chars,
            "context_keywords": context_keywords or [],
        },
    }


def add_text_tasks(groups: dict[str, list[dict[str, Any]]]) -> None:
    groups["long_form"].extend(
        [
            {
                "id": "",
                "category": "long_form",
                "source": "curated-text",
                "messages": [
                    {
                        "role": "user",
                        "content": (
                            "【回答模式：详细】为一个准备部署本地多模态模型的团队，写一份风险清单。"
                            "请覆盖数据质量、显存、推理一致性、评测和上线监控，并给出优先级。"
                        ),
                    }
                ],
                "images": [],
                "reference": "",
                "criteria": {
                    "min_chars": 500,
                    "context_keywords": ["数据质量", "显存", "评测", "监控"],
                },
            },
            {
                "id": "",
                "category": "long_form",
                "source": "curated-text",
                "messages": [
                    {
                        "role": "user",
                        "content": (
                            "【回答模式：详细】以雨夜火车站为背景写一个完整短篇故事。"
                            "故事必须有明确人物目标、冲突、转折和结尾，不要重复段落。"
                        ),
                    }
                ],
                "images": [],
                "reference": "",
                "criteria": {
                    "min_chars": 700,
                    "context_keywords": ["雨", "火车站"],
                },
            },
        ]
    )
    groups["multi_turn"].append(
        {
            "id": "",
            "category": "multi_turn",
            "source": "curated-text",
            "messages": [
                {"role": "user", "content": "我们要在两张 24GB 显卡上部署一个 8B 多模态模型。"},
                {"role": "assistant", "content": "可以先从张量并行、上下文长度和图像 token 预算三个方面规划。"},
                {"role": "user", "content": "延迟目标是首 token 3 秒内，同时必须保留 8k 上下文。"},
                {"role": "assistant", "content": "那么需要优先测量 KV cache 占用，并避免把全部显存交给模型权重。"},
                {
                    "role": "user",
                    "content": "请结合前面所有约束给出部署方案，并明确哪些参数不能同时拉满。",
                },
            ],
            "images": [],
            "reference": "",
            "criteria": {
                "min_chars": 280,
                "context_keywords": ["两张", "24GB", "3 秒", "8k"],
            },
        }
    )


def main() -> None:
    args = parse_args()
    rng = random.Random(args.seed)
    groups: dict[str, list[dict[str, Any]]] = defaultdict(list)

    with Path(args.eval_jsonl).open("r", encoding="utf-8") as handle:
        for line in handle:
            if not line.strip():
                continue
            row = json.loads(line)
            source = str(row.get("source", "")).lower()
            messages = row.get("messages", [])
            candidate: dict[str, Any] | None = None
            if source in {"m3it-fm-iqa", "m3it-coco-cn", "m3it-flickr8k-cn"}:
                candidate = benchmark_row(row, "short_fact", 1)
            elif source in {"docvqa-long", "chartqa-long"}:
                candidate = benchmark_row(row, "document_chart", 60)
            elif source in {"naturalconv", "m3it-mmchat"} and len(messages) >= 6:
                prior_user_text = " ".join(
                    str(message.get("content", ""))
                    for message in messages[-6:-1]
                    if message.get("role") == "user"
                )
                keywords = [word for word in prior_user_text.split() if len(word) >= 3][:3]
                candidate = benchmark_row(row, "multi_turn", 40, keywords)
            elif source in {"m3it-coco-cn-long", "m3it-flickr8k-cn-long", "m3it-fm-iqa-long"}:
                candidate = benchmark_row(row, "detailed_image", 100)
            if candidate is not None:
                groups[candidate["category"]].append(candidate)

    add_text_tasks(groups)
    selected: list[dict[str, Any]] = []
    for category in ("short_fact", "detailed_image", "document_chart", "multi_turn", "long_form"):
        rng.shuffle(groups[category])
        selected.extend(groups[category][: args.per_category])

    for index, row in enumerate(selected, 1):
        row["id"] = f"{row['category']}-{index:04d}"

    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    with output.open("w", encoding="utf-8") as handle:
        for row in selected:
            handle.write(json.dumps(row, ensure_ascii=False) + "\n")
    print(
        json.dumps(
            {
                "output": str(output),
                "rows": len(selected),
                "categories": {
                    category: sum(row["category"] == category for row in selected)
                    for category in sorted(groups)
                },
            },
            ensure_ascii=False,
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
