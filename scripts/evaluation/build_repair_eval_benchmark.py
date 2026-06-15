#!/usr/bin/env python3
"""Build a focused benchmark from the conversation-repair eval manifest."""

from __future__ import annotations

import argparse
import json
import random
import re
from collections import defaultdict
from pathlib import Path
from typing import Any


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--input",
        default="/mnt/data/tianyi/MLLM_Assistant/datasets/qwen_vl_cn_conversation_repair_eval.jsonl",
    )
    parser.add_argument("--output", required=True)
    parser.add_argument("--per-category", type=int, default=6)
    parser.add_argument("--seed", type=int, default=20260614)
    return parser.parse_args()


def last_assistant_index(messages: list[dict[str, Any]]) -> int | None:
    for index in range(len(messages) - 1, -1, -1):
        if messages[index].get("role") == "assistant":
            return index
    return None


def min_chars_for(category: str, reference: str) -> int:
    length = len(reference)
    if category == "ocr_single":
        return min(260, max(120, int(length * 0.55)))
    if category == "ocr_composite":
        return min(420, max(220, int(length * 0.55)))
    if category == "ocr_multiturn":
        return min(320, max(150, int(length * 0.55)))
    if category == "multimodal_analysis":
        return min(180, max(100, int(length * 0.6)))
    if category == "multimodal_multiturn":
        return min(160, max(80, int(length * 0.55)))
    if category == "document_chart_fact":
        return 1
    if category == "concise_replay":
        return 1
    if category == "document_fact_replay":
        return 1
    if category == "natural_multiturn":
        return min(80, max(40, int(length * 0.65)))
    if category == "task_multiturn_multimodal":
        return min(180, max(80, int(length * 0.65)))
    if category == "detailed_multimodal_replay":
        return min(220, max(100, int(length * 0.65)))
    if category == "task_multiturn_text":
        return min(700, max(280, int(length * 0.35)))
    if category == "long_form_replay":
        return min(800, max(500, int(length * 0.35)))
    return max(1, int(length * 0.5))


def context_keywords(messages: list[dict[str, Any]]) -> list[str]:
    text = "\n".join(
        str(message.get("content", ""))
        for message in messages
        if message.get("role") == "user"
    )
    patterns = [
        r"\d+(?:\.\d+)?\s*(?:GB|GiB|MB|秒|k|K|%|年|公里|米|mm|ah|mAh)",
        r"《[^》]{2,20}》",
        r"[A-Za-z][A-Za-z0-9_-]{2,}",
    ]
    keywords: list[str] = []
    for pattern in patterns:
        for match in re.findall(pattern, text):
            item = str(match).strip()
            if item.lower() in {"image", "video"}:
                continue
            if item and item not in keywords:
                keywords.append(item)
            if len(keywords) >= 4:
                return keywords
    return keywords


def to_benchmark(row: dict[str, Any]) -> dict[str, Any] | None:
    messages = [message for message in row.get("messages", []) if isinstance(message, dict)]
    index = last_assistant_index(messages)
    if index is None:
        return None
    prompt_messages = messages[:index]
    if not prompt_messages or prompt_messages[-1].get("role") != "user":
        return None
    category = str(row.get("quality_category") or row.get("source") or "unknown")
    reference = str(messages[index].get("content", ""))
    return {
        "id": "",
        "category": category,
        "source": row.get("source", "unknown"),
        "messages": prompt_messages,
        "images": row.get("images", []),
        "reference": reference,
        "criteria": {
            "min_chars": min_chars_for(category, reference),
            "context_keywords": context_keywords(prompt_messages),
        },
    }


def main() -> None:
    args = parse_args()
    rng = random.Random(args.seed)
    groups: dict[str, list[dict[str, Any]]] = defaultdict(list)
    with Path(args.input).open("r", encoding="utf-8") as handle:
        for line in handle:
            if not line.strip():
                continue
            row = json.loads(line)
            benchmark = to_benchmark(row)
            if benchmark is not None:
                groups[benchmark["category"]].append(benchmark)

    selected: list[dict[str, Any]] = []
    for category in sorted(groups):
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
