#!/usr/bin/env python3
"""Audit and filter an ms-swift multimodal manifest before training."""

from __future__ import annotations

import argparse
import json
import os
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any

from PIL import Image
from transformers import AutoProcessor


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--report", required=True)
    parser.add_argument(
        "--model",
        default="/mnt/data/tianyi/MLLM_Assistant/models/Qwen3-VL-8B-Instruct",
    )
    parser.add_argument("--max-length", type=int, default=3072)
    parser.add_argument("--image-max-token-num", type=int, default=768)
    parser.add_argument("--min-retention", type=float, default=0.95)
    parser.add_argument("--limit", type=int, default=0)
    return parser.parse_args()


def percentile(values: list[int], ratio: float) -> int:
    if not values:
        return 0
    ordered = sorted(values)
    return ordered[min(len(ordered) - 1, int((len(ordered) - 1) * ratio))]


def convert_messages(row: dict[str, Any]) -> tuple[list[dict[str, Any]], list[Image.Image]]:
    images: list[Image.Image] = []
    image_paths = [str(path) for path in row.get("images", [])]
    attached = False
    converted: list[dict[str, Any]] = []

    for message in row.get("messages", []):
        role = message.get("role", "user")
        text = str(message.get("content", ""))
        if role == "user" and image_paths and not attached:
            parts: list[dict[str, Any]] = []
            for image_path in image_paths:
                image = Image.open(image_path).convert("RGB")
                images.append(image)
                parts.append({"type": "image", "image": image})
            parts.append({"type": "text", "text": text.replace("<image>", "")})
            converted.append({"role": role, "content": parts})
            attached = True
        else:
            converted.append({"role": role, "content": text.replace("<image>", "")})
    return converted, images


def token_length(processor: AutoProcessor, row: dict[str, Any]) -> int:
    messages, images = convert_messages(row)
    prompt = processor.apply_chat_template(messages, tokenize=False, add_generation_prompt=False)
    kwargs: dict[str, Any] = {
        "text": [prompt],
        "padding": False,
        "return_tensors": "pt",
    }
    if images:
        kwargs["images"] = images
    encoded = processor(**kwargs)
    return int(encoded.input_ids.shape[-1])


def write_jsonl(path: Path, rows: list[dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temp_path = path.with_name(f".{path.name}.tmp")
    with temp_path.open("w", encoding="utf-8") as handle:
        for row in rows:
            handle.write(json.dumps(row, ensure_ascii=False) + "\n")
    temp_path.replace(path)


def main() -> None:
    args = parse_args()
    os.environ["IMAGE_MAX_TOKEN_NUM"] = str(args.image_max_token_num)
    processor = AutoProcessor.from_pretrained(args.model, trust_remote_code=True)
    image_processor = getattr(processor, "image_processor", None)
    if image_processor is not None and hasattr(image_processor, "size"):
        patch_size = int(getattr(image_processor, "patch_size", 16))
        merge_size = int(getattr(image_processor, "merge_size", 2))
        image_factor = patch_size * merge_size
        image_processor.size = {
            "longest_edge": args.image_max_token_num * image_factor**2,
            "shortest_edge": 4 * image_factor**2,
        }
    rows: list[dict[str, Any]] = []
    with Path(args.input).open("r", encoding="utf-8") as handle:
        for line in handle:
            if line.strip():
                rows.append(json.loads(line))
                if args.limit and len(rows) >= args.limit:
                    break

    kept: list[dict[str, Any]] = []
    rejected = Counter()
    source_lengths: dict[str, list[int]] = defaultdict(list)
    source_kept = Counter()
    source_total = Counter()

    for index, row in enumerate(rows, 1):
        source = str(row.get("source", "unknown"))
        source_total[source] += 1
        try:
            length = token_length(processor, row)
        except Exception as exc:
            rejected[f"processor_error:{type(exc).__name__}"] += 1
            continue
        source_lengths[source].append(length)
        if length > args.max_length:
            rejected["over_max_length"] += 1
            continue
        row["token_length"] = length
        kept.append(row)
        source_kept[source] += 1
        if index % 100 == 0:
            print(f"[audit] {index}/{len(rows)} kept={len(kept)}", flush=True)

    retention = len(kept) / len(rows) if rows else 0.0
    report = {
        "input_rows": len(rows),
        "kept_rows": len(kept),
        "retention": retention,
        "required_retention": args.min_retention,
        "max_length": args.max_length,
        "image_max_token_num": args.image_max_token_num,
        "rejected": dict(rejected),
        "sources": {
            source: {
                "total": source_total[source],
                "kept": source_kept[source],
                "retention": source_kept[source] / source_total[source],
                "token_length_p50": percentile(source_lengths[source], 0.50),
                "token_length_p90": percentile(source_lengths[source], 0.90),
                "token_length_max": max(source_lengths[source], default=0),
            }
            for source in sorted(source_total)
        },
    }
    write_jsonl(Path(args.output), kept)
    report_path = Path(args.report)
    report_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False, indent=2))
    if retention < args.min_retention:
        raise SystemExit(
            f"Retention {retention:.2%} is below required {args.min_retention:.2%}; "
            "do not start formal training."
        )


if __name__ == "__main__":
    main()
