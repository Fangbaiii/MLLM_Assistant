#!/usr/bin/env python3
"""Evaluate length control, repetition, factuality, and multi-turn retention."""

from __future__ import annotations

import argparse
import base64
import json
import mimetypes
import re
import time
import urllib.error
import urllib.request
from collections import Counter, defaultdict
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from typing import Any


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--benchmark", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--base-url", default="http://127.0.0.1:8000/v1")
    parser.add_argument("--api-key", default="local-mllm-token")
    parser.add_argument(
        "--model",
        action="append",
        required=True,
        help="Model in label=model-name form. Repeat to compare checkpoints.",
    )
    parser.add_argument("--max-tokens", type=int, default=1536)
    parser.add_argument("--temperature", type=float, default=0.3)
    parser.add_argument("--top-p", type=float, default=0.8)
    parser.add_argument("--top-k", type=int, default=20)
    parser.add_argument("--repetition-penalty", type=float, default=1.05)
    parser.add_argument("--min-tokens", type=int, default=0)
    parser.add_argument("--sleep-sec", type=float, default=0.0)
    parser.add_argument("--limit", type=int, default=0)
    parser.add_argument(
        "--concurrency",
        type=int,
        default=1,
        help="Number of model requests to run concurrently for each benchmark row.",
    )
    return parser.parse_args()


def parse_models(values: list[str]) -> list[tuple[str, str]]:
    parsed: list[tuple[str, str]] = []
    for value in values:
        if "=" not in value:
            raise ValueError(f"Invalid --model {value!r}; expected label=model-name")
        label, model = value.split("=", 1)
        parsed.append((label.strip(), model.strip()))
    return parsed


def normalize_text(value: str) -> str:
    return re.sub(r"\s+", "", value.lower())


def char_f1(prediction: str, reference: str) -> float:
    prediction_chars = list(normalize_text(prediction))
    reference_chars = list(normalize_text(reference))
    if not prediction_chars or not reference_chars:
        return float(prediction_chars == reference_chars)
    reference_counts = Counter(reference_chars)
    common = 0
    for char in prediction_chars:
        if reference_counts[char]:
            reference_counts[char] -= 1
            common += 1
    if not common:
        return 0.0
    precision = common / len(prediction_chars)
    recall = common / len(reference_chars)
    return 2 * precision * recall / (precision + recall)


def repeated_ngram_ratio(text: str, n: int = 4) -> float:
    chars = [char for char in normalize_text(text) if not char.isspace()]
    if len(chars) < n:
        return 0.0
    grams = [tuple(chars[index : index + n]) for index in range(len(chars) - n + 1)]
    return 1.0 - len(set(grams)) / len(grams)


def data_url(path: str) -> str:
    mime = mimetypes.guess_type(path)[0] or "image/png"
    encoded = base64.b64encode(Path(path).read_bytes()).decode("ascii")
    return f"data:{mime};base64,{encoded}"


def request_messages(record: dict[str, Any]) -> list[dict[str, Any]]:
    messages = [dict(message) for message in record.get("messages", [])]
    images = [str(path) for path in record.get("images", [])]
    if not images:
        return messages
    for message in messages:
        if message.get("role") != "user":
            continue
        text = str(message.get("content", "")).replace("<image>", "")
        message["content"] = [
            {"type": "text", "text": text},
            *[
                {"type": "image_url", "image_url": {"url": data_url(image)}}
                for image in images
            ],
        ]
        break
    return messages


def call_model(args: argparse.Namespace, model: str, record: dict[str, Any]) -> dict[str, Any]:
    payload = {
        "model": model,
        "messages": request_messages(record),
        "temperature": args.temperature,
        "top_p": args.top_p,
        "top_k": args.top_k,
        "repetition_penalty": args.repetition_penalty,
        "min_tokens": args.min_tokens,
        "max_tokens": args.max_tokens,
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
    choice = (result.get("choices") or [{}])[0]
    usage = result.get("usage") or {}
    return {
        "content": (choice.get("message") or {}).get("content", "").strip(),
        "finish_reason": choice.get("finish_reason", "unknown"),
        "completion_tokens": usage.get("completion_tokens"),
        "response_model": result.get("model", model),
    }


def format_request_error(exc: Exception) -> str:
    if isinstance(exc, urllib.error.HTTPError):
        body = exc.read().decode("utf-8", errors="replace").strip()
        detail = body[:1000] if body else str(exc)
        return f"HTTP {exc.code}: {detail}"
    return str(exc)


def score(record: dict[str, Any], result: dict[str, Any]) -> dict[str, Any]:
    prediction = result["content"]
    reference = str(record.get("reference", ""))
    criteria = record.get("criteria", {})
    min_chars = int(criteria.get("min_chars", 0))
    keywords = [str(keyword) for keyword in criteria.get("context_keywords", [])]
    normalized_prediction = normalize_text(prediction)
    keyword_hits = sum(normalize_text(keyword) in normalized_prediction for keyword in keywords)
    return {
        "chars": len(prediction),
        "completion_tokens": result.get("completion_tokens"),
        "finish_reason": result.get("finish_reason"),
        "length_compliance": float(len(prediction) >= min_chars),
        "early_eos": float(
            result.get("finish_reason") == "stop"
            and (result.get("completion_tokens") or len(prediction)) < 64
            and min_chars >= 100
        ),
        "repeat_4gram": repeated_ngram_ratio(prediction),
        "context_keyword_recall": keyword_hits / len(keywords) if keywords else 1.0,
        "char_f1": char_f1(prediction, reference) if reference else None,
        "manual_preference": None,
    }


def main() -> None:
    args = parse_args()
    models = parse_models(args.model)
    records: list[dict[str, Any]] = []
    with Path(args.benchmark).open("r", encoding="utf-8") as handle:
        for line in handle:
            if line.strip():
                records.append(json.loads(line))
                if args.limit and len(records) >= args.limit:
                    break

    examples: list[dict[str, Any]] = []
    totals: dict[str, dict[str, float]] = defaultdict(lambda: defaultdict(float))
    counts: Counter[str] = Counter()
    success_counts: Counter[str] = Counter()
    error_counts: Counter[str] = Counter()

    with ThreadPoolExecutor(max_workers=max(1, args.concurrency)) as executor:
        for index, record in enumerate(records, 1):
            row = {
                "id": record.get("id", index),
                "category": record.get("category", "unknown"),
                "source": record.get("source", "unknown"),
                "reference": record.get("reference", ""),
                "results": {},
            }
            category = row["category"]
            futures = {
                executor.submit(call_model, args, model, record): label
                for label, model in models
            }
            for future in as_completed(futures):
                label = futures[future]
                try:
                    result = future.result()
                    metrics = score(record, result)
                    row["results"][label] = {
                        **result,
                        "metrics": metrics,
                    }
                    for metric, value in metrics.items():
                        if isinstance(value, (int, float)):
                            totals[f"{category}:{label}"][metric] += float(value)
                            totals[f"all:{label}"][metric] += float(value)
                    success_counts[f"{category}:{label}"] += 1
                    success_counts[f"all:{label}"] += 1
                except (urllib.error.URLError, TimeoutError, ValueError) as exc:
                    row["results"][label] = {"error": format_request_error(exc)}
                    error_counts[f"{category}:{label}"] += 1
                    error_counts[f"all:{label}"] += 1
            counts[category] += 1
            counts["all"] += 1
            examples.append(row)
            print(f"[eval] {index}/{len(records)} {category}", flush=True)
            if args.sleep_sec:
                time.sleep(args.sleep_sec)

    summary: dict[str, Any] = {}
    for category, count in sorted(counts.items()):
        summary[category] = {"count": count}
        for label, _ in models:
            key = f"{category}:{label}"
            successful = success_counts[key]
            errors = error_counts[key]
            summary[category][label] = {
                "attempted": count,
                "successful": successful,
                "errors": errors,
                "error_rate": errors / count if count else 0.0,
                **{
                    metric: total / successful
                    for metric, total in totals[key].items()
                    if successful
                },
            }

    output = {
        "config": {
            "benchmark": args.benchmark,
            "base_url": args.base_url,
            "models": dict(models),
            "max_tokens": args.max_tokens,
            "temperature": args.temperature,
            "top_p": args.top_p,
            "top_k": args.top_k,
            "repetition_penalty": args.repetition_penalty,
            "min_tokens": args.min_tokens,
            "concurrency": args.concurrency,
        },
        "summary": summary,
        "examples": examples,
    }
    output_path = Path(args.output)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(output, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(summary, ensure_ascii=False, indent=2))
    print(f"report={output_path}")


if __name__ == "__main__":
    main()
