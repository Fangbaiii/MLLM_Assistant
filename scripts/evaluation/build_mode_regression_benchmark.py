#!/usr/bin/env python3
"""Build default/explain/think regressions from the document repair eval set."""

from __future__ import annotations

import argparse
import json
import random
import re
from collections import defaultdict
from pathlib import Path
from typing import Any


CATEGORIES = {
    "ocr_single",
    "ocr_composite",
    "ocr_multiturn",
    "multimodal_analysis",
    "multimodal_multiturn",
}

MODE_PREFIXES = (
    "请直接给出结构化答案，避免复述问题或整段照抄材料。",
    "请解释结论与关键依据，保持信息密度，不要重复同一观点。",
    "请先核对证据和约束，再给出结论、依据与不确定性；不要输出隐藏思维链。",
)

MODE_INSTRUCTIONS = {
    "default": (
        "你是 MLLM Studio 的多模态助手。请使用中文回答，优先基于图片、OCR 和证据上下文。"
        "回答长度应自适应任务；面对长 OCR 先提炼相关信息，不复述问题或连续照抄原文。"
    ),
    "explain": (
        "你是 MLLM Studio 的多模态助手。请使用中文采用详细讲解模式：先给结论，再解释依据、"
        "关键步骤和必要例子。保持信息密度，不重复同一观点；长文档只引用关键证据。"
    ),
    "think": (
        "你是 MLLM Studio 的多模态助手。请使用中文充分分析后给出清晰结论、依据、风险与权衡。"
        "不要输出隐藏思维链；先核对文档证据与历史约束，发现重复时主动压缩并纠正。"
    ),
}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--per-category", type=int, default=2)
    parser.add_argument("--seed", type=int, default=20260615)
    return parser.parse_args()


def clean_mode_prefix(content: str) -> str:
    value = content.strip()
    for prefix in MODE_PREFIXES:
        if value.startswith(prefix):
            return value[len(prefix) :].lstrip()
    return value


def last_assistant_index(messages: list[dict[str, Any]]) -> int | None:
    for index in range(len(messages) - 1, -1, -1):
        if messages[index].get("role") == "assistant":
            return index
    return None


def context_keywords(messages: list[dict[str, Any]]) -> list[str]:
    text = "\n".join(
        str(message.get("content", ""))
        for message in messages
        if message.get("role") == "user"
    )
    patterns = (
        r"\d+(?:\.\d+)?\s*(?:GB|GiB|MB|秒|k|K|%|年|公里|米|mm|ah|mAh)",
        r"《[^》]{2,20}》",
        r"[A-Za-z][A-Za-z0-9_-]{2,}",
    )
    keywords: list[str] = []
    for pattern in patterns:
        for match in re.findall(pattern, text):
            item = str(match).strip()
            if item.lower() in {"image", "video", "ocr"}:
                continue
            if item and item not in keywords:
                keywords.append(item)
            if len(keywords) >= 4:
                return keywords
    return keywords


def min_chars(category: str, reference: str) -> int:
    if category == "ocr_composite":
        return min(420, max(220, int(len(reference) * 0.55)))
    if category in {"ocr_single", "ocr_multiturn"}:
        return min(280, max(120, int(len(reference) * 0.5)))
    return min(180, max(90, int(len(reference) * 0.55)))


def main() -> None:
    args = parse_args()
    rng = random.Random(args.seed)
    groups: dict[str, list[dict[str, Any]]] = defaultdict(list)

    with Path(args.input).open("r", encoding="utf-8") as handle:
        for line in handle:
            if not line.strip():
                continue
            row = json.loads(line)
            category = str(row.get("quality_category", "unknown"))
            if category not in CATEGORIES:
                continue
            messages = [dict(message) for message in row.get("messages", [])]
            index = last_assistant_index(messages)
            if index is None:
                continue
            prompt_messages = messages[:index]
            if not prompt_messages or prompt_messages[-1].get("role") != "user":
                continue
            prompt_messages[-1]["content"] = clean_mode_prefix(
                str(prompt_messages[-1].get("content", ""))
            )
            groups[category].append(
                {
                    "category": category,
                    "source": row.get("source", "unknown"),
                    "messages": prompt_messages,
                    "images": row.get("images", []),
                    "reference": str(messages[index].get("content", "")),
                }
            )

    records: list[dict[str, Any]] = []
    for category in sorted(groups):
        rng.shuffle(groups[category])
        for sample_index, sample in enumerate(groups[category][: args.per_category], 1):
            for mode, instruction in MODE_INSTRUCTIONS.items():
                messages = [{"role": "system", "content": instruction}, *sample["messages"]]
                records.append(
                    {
                        **sample,
                        "id": f"{category}-{sample_index:02d}-{mode}",
                        "category": f"{category}:{mode}",
                        "messages": messages,
                        "criteria": {
                            "min_chars": min_chars(category, sample["reference"]),
                            "context_keywords": context_keywords(messages),
                        },
                    }
                )

    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    with output.open("w", encoding="utf-8") as handle:
        for record in records:
            handle.write(json.dumps(record, ensure_ascii=False) + "\n")
    print(json.dumps({"output": str(output), "rows": len(records)}, ensure_ascii=False))


if __name__ == "__main__":
    main()
