#!/usr/bin/env python3
"""Audit translated ShareGPT4V Chinese captions before SFT mixing."""

from __future__ import annotations

import argparse
import json
import random
import re
from collections import Counter
from pathlib import Path
from typing import Any


BAD_PHRASES = (
    "the image",
    "this image",
    "in the image",
    "as an ai",
    "我无法",
    "作为一个",
    "根据图片可见信息",
    "可以看到的是",
    "这张图片展示了这张图片",
    "请注意",
    "整体而言",
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True)
    parser.add_argument("--report", required=True)
    parser.add_argument("--review-output", required=True)
    parser.add_argument("--sample-rows", type=int, default=200)
    parser.add_argument("--max-bad-ratio", type=float, default=0.03)
    parser.add_argument("--max-english-leakage", type=float, default=0.35)
    return parser.parse_args()


def normalize(value: Any) -> str:
    return re.sub(r"\s+", " ", str(value or "")).strip()


def repeated_ngram_ratio(text: str, n: int = 4) -> float:
    chars = [char for char in normalize(text) if not char.isspace()]
    if len(chars) < n:
        return 0.0
    grams = [tuple(chars[index : index + n]) for index in range(len(chars) - n + 1)]
    return 1.0 - len(set(grams)) / len(grams)


def english_leakage(text: str) -> float:
    content = [char for char in text if char.isalnum()]
    if not content:
        return 0.0
    latin = sum(("a" <= char.lower() <= "z") for char in content)
    return latin / len(content)


def preserves_numbers(source: str, translated: str) -> bool:
    source_numbers = set(re.findall(r"\d+(?:[.,]\d+)?", source))
    translated_numbers = set(re.findall(r"\d+(?:[.,]\d+)?", translated))
    return source_numbers <= translated_numbers


def issue_for(args: argparse.Namespace, row: dict[str, Any]) -> str | None:
    messages = row.get("messages", [])
    answer = normalize(messages[-1].get("content") if messages else "")
    original = normalize(row.get("original_answer"))
    if not (150 <= len(answer) <= 650):
        return "length_out_of_range"
    if english_leakage(answer) > args.max_english_leakage:
        return "english_leakage"
    if repeated_ngram_ratio(answer) > 0.10:
        return "high_repetition"
    if any(phrase in answer.lower() for phrase in BAD_PHRASES):
        return "bad_phrase"
    if not preserves_numbers(original, answer):
        return "number_mismatch"
    for image in row.get("images", []):
        if not Path(str(image)).is_file():
            return "missing_image"
    return None


def write_jsonl(path: Path, rows: list[dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f".{path.name}.tmp")
    with temporary.open("w", encoding="utf-8") as handle:
        for row in rows:
            handle.write(json.dumps(row, ensure_ascii=False) + "\n")
    temporary.replace(path)


def main() -> None:
    args = parse_args()
    rows = [
        json.loads(line)
        for line in Path(args.input).read_text(encoding="utf-8").splitlines()
        if line.strip()
    ]
    issues = Counter()
    lengths: list[int] = []
    leakage: list[float] = []
    clean: list[dict[str, Any]] = []
    for row in rows:
        messages = row.get("messages", [])
        answer = normalize(messages[-1].get("content") if messages else "")
        lengths.append(len(answer))
        leakage.append(english_leakage(answer))
        issue = issue_for(args, row)
        if issue:
            issues[issue] += 1
        else:
            clean.append(row)

    rng = random.Random(42)
    rng.shuffle(clean)
    review_rows = [
        {
            "source_id": row.get("source_id"),
            "image": row.get("images", [None])[0],
            "prompt": row.get("messages", [{}])[0].get("content"),
            "answer": row.get("messages", [{}, {}])[-1].get("content"),
            "original_answer": row.get("original_answer"),
            "needs_review": True,
            "approved": None,
            "notes": "",
        }
        for row in clean[: args.sample_rows]
    ]
    write_jsonl(Path(args.review_output), review_rows)

    bad = sum(issues.values())
    bad_ratio = bad / len(rows) if rows else 1.0
    report = {
        "rows": len(rows),
        "clean_rows": len(clean),
        "bad_rows": bad,
        "bad_ratio": bad_ratio,
        "issues": dict(issues),
        "length_min": min(lengths, default=0),
        "length_max": max(lengths, default=0),
        "english_leakage_max": max(leakage, default=0.0),
        "review_output": str(Path(args.review_output)),
    }
    report_path = Path(args.report)
    report_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False, indent=2))
    if bad_ratio > args.max_bad_ratio or report["english_leakage_max"] > args.max_english_leakage:
        raise SystemExit("Translated ShareGPT4V audit failed; inspect the report before training.")


if __name__ == "__main__":
    main()
