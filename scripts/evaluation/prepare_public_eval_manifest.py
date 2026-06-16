#!/usr/bin/env python3
"""Prepare a deterministic public-eval manifest for Base vs checkpoint-360."""

from __future__ import annotations

import argparse
import json
from collections import Counter
from pathlib import Path
from typing import Any


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", default="/mnt/data/tianyi/MLLM_Assistant/datasets/qwen_vl_eval.jsonl")
    parser.add_argument("--output", required=True)
    parser.add_argument("--report", required=True)
    parser.add_argument("--limit", type=int, default=0)
    return parser.parse_args()


def has_reference(record: dict[str, Any]) -> bool:
    for message in record.get("messages", []):
        if isinstance(message, dict) and message.get("role") == "assistant" and str(message.get("content", "")).strip():
            return True
    return False


def has_user_prompt(record: dict[str, Any]) -> bool:
    for message in record.get("messages", []):
        if isinstance(message, dict) and message.get("role") == "user" and str(message.get("content", "")).strip():
            return True
    return False


def image_paths_exist(record: dict[str, Any]) -> bool:
    images = record.get("images", [])
    if not isinstance(images, list) or not images:
        return False
    return all(isinstance(path, str) and Path(path).is_file() for path in images)


def main() -> None:
    args = parse_args()
    input_path = Path(args.input)
    output_path = Path(args.output)
    report_path = Path(args.report)

    kept: list[dict[str, Any]] = []
    rejected = Counter()
    source_counts = Counter()

    with input_path.open("r", encoding="utf-8") as handle:
        for line_no, line in enumerate(handle, 1):
            if not line.strip():
                continue
            try:
                record = json.loads(line)
            except json.JSONDecodeError:
                rejected["bad_json"] += 1
                continue
            if not has_user_prompt(record):
                rejected["missing_user_prompt"] += 1
                continue
            if not has_reference(record):
                rejected["missing_reference"] += 1
                continue
            if not image_paths_exist(record):
                rejected["missing_images"] += 1
                continue
            source_counts[str(record.get("source", "unknown"))] += 1
            kept.append(record)
            if args.limit and len(kept) >= args.limit:
                break

    output_path.parent.mkdir(parents=True, exist_ok=True)
    with output_path.open("w", encoding="utf-8") as handle:
        for record in kept:
            handle.write(json.dumps(record, ensure_ascii=False) + "\n")

    report = {
        "input": str(input_path),
        "output": str(output_path),
        "kept": len(kept),
        "rejected": dict(rejected),
        "source_counts": dict(sorted(source_counts.items())),
    }
    report_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
