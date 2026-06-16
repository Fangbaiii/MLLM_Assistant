#!/usr/bin/env python3
"""Compare two OpenAI-compatible multimodal endpoints on JSONL SFT/eval data."""

from __future__ import annotations

import argparse
import base64
import json
import math
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
    parser.add_argument("--eval-jsonl", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--base-url", required=True)
    parser.add_argument("--base-model", required=True)
    parser.add_argument("--lora-url", required=True)
    parser.add_argument("--lora-model", required=True)
    parser.add_argument("--api-key", default="local-mllm-token")
    parser.add_argument("--limit", type=int, default=0)
    parser.add_argument("--max-tokens", type=int, default=384)
    parser.add_argument("--temperature", type=float, default=0.0)
    parser.add_argument("--concurrency", type=int, default=6)
    parser.add_argument("--sleep-sec", type=float, default=0.0)
    parser.add_argument("--partial-output", default="", help="JSONL file for per-row incremental results.")
    parser.add_argument("--resume", action="store_true", help="Reuse completed rows from --partial-output.")
    return parser.parse_args()


def normalize_text(value: str) -> str:
    value = value.lower().strip()
    value = re.sub(r"\s+", " ", value)
    value = re.sub(r"[^\w\u4e00-\u9fff\.\-%]+", " ", value)
    return value.strip()


def char_f1(prediction: str, reference: str) -> float:
    pred = [ch for ch in normalize_text(prediction) if not ch.isspace()]
    ref = [ch for ch in normalize_text(reference) if not ch.isspace()]
    if not pred or not ref:
        return float(pred == ref)
    counts = Counter(ref)
    common = 0
    for ch in pred:
        if counts[ch] > 0:
            counts[ch] -= 1
            common += 1
    if common == 0:
        return 0.0
    precision = common / len(pred)
    recall = common / len(ref)
    return 2 * precision * recall / (precision + recall)


def token_f1(prediction: str, reference: str) -> float:
    pred_tokens = normalize_text(prediction).split()
    ref_tokens = normalize_text(reference).split()
    if not pred_tokens or not ref_tokens:
        return float(pred_tokens == ref_tokens)
    ref_counts = Counter(ref_tokens)
    common = 0
    for token in pred_tokens:
        if ref_counts[token] > 0:
            ref_counts[token] -= 1
            common += 1
    if common == 0:
        return 0.0
    precision = common / len(pred_tokens)
    recall = common / len(ref_tokens)
    return 2 * precision * recall / (precision + recall)


def lcs_len(a: str, b: str) -> int:
    a = normalize_text(a)
    b = normalize_text(b)
    if not a or not b:
        return 0
    previous = [0] * (len(b) + 1)
    for ca in a:
        current = [0]
        for index, cb in enumerate(b, 1):
            current.append(previous[index - 1] + 1 if ca == cb else max(previous[index], current[-1]))
        previous = current
    return previous[-1]


def rouge_l(prediction: str, reference: str) -> float:
    pred = normalize_text(prediction)
    ref = normalize_text(reference)
    if not pred or not ref:
        return float(pred == ref)
    lcs = lcs_len(pred, ref)
    precision = lcs / len(pred)
    recall = lcs / len(ref)
    return 0.0 if precision + recall == 0 else 2 * precision * recall / (precision + recall)


def repeated_ngram_ratio(text: str, n: int = 4) -> float:
    chars = [ch for ch in normalize_text(text) if not ch.isspace()]
    if len(chars) < n:
        return 0.0
    grams = [tuple(chars[index : index + n]) for index in range(len(chars) - n + 1)]
    return 1.0 - len(set(grams)) / len(grams)


def extract_number(value: str) -> float | None:
    match = re.search(r"-?\d+(?:\.\d+)?", value.replace(",", ""))
    return float(match.group(0)) if match else None


def data_url(path: str) -> str:
    mime = mimetypes.guess_type(path)[0] or "image/png"
    encoded = base64.b64encode(Path(path).read_bytes()).decode("ascii")
    return f"data:{mime};base64,{encoded}"


def get_reference(record: dict[str, Any]) -> str:
    for message in record.get("messages", []):
        if isinstance(message, dict) and message.get("role") == "assistant":
            return str(message.get("content", "")).strip()
    return str(record.get("reference", "")).strip()


def get_user_text(record: dict[str, Any]) -> str:
    for message in record.get("messages", []):
        if isinstance(message, dict) and message.get("role") == "user":
            return str(message.get("content", "")).replace("<image>", "").strip()
    return ""


def source_bucket(source: str) -> str:
    if source.startswith("dureader-vis"):
        return "dureader-vis"
    if source.startswith("xfund"):
        return "xfund"
    if source.startswith("coco-cn"):
        return "coco-cn"
    return source


def call_model(
    base_url: str,
    api_key: str,
    model: str,
    record: dict[str, Any],
    max_tokens: int,
    temperature: float,
) -> dict[str, Any]:
    content: list[dict[str, Any]] = [{"type": "text", "text": get_user_text(record)}]
    for image in record.get("images", [])[:1]:
        content.append({"type": "image_url", "image_url": {"url": data_url(str(image))}})
    payload = {
        "model": model,
        "messages": [{"role": "user", "content": content}],
        "temperature": temperature,
        "max_tokens": max_tokens,
        "stream": False,
    }
    request = urllib.request.Request(
        f"{base_url.rstrip('/')}/chat/completions",
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Content-Type": "application/json",
            **({"Authorization": f"Bearer {api_key}"} if api_key else {}),
        },
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=600) as response:  # noqa: S310 - local endpoint
        result = json.loads(response.read().decode("utf-8"))
    choice = (result.get("choices") or [{}])[0]
    usage = result.get("usage") or {}
    return {
        "prediction": (choice.get("message") or {}).get("content", "").strip(),
        "finish_reason": choice.get("finish_reason", "unknown"),
        "completion_tokens": usage.get("completion_tokens"),
    }


def score(
    record: dict[str, Any],
    source: str,
    prediction: str,
    reference: str,
    finish_reason: str,
    completion_tokens: int | None,
) -> dict[str, float]:
    exact = float(bool(reference) and normalize_text(prediction) == normalize_text(reference))
    f1 = max(token_f1(prediction, reference), char_f1(prediction, reference)) if reference else 0.0
    numeric = 0.0
    if "chartqa" in source.lower():
        pred_num = extract_number(prediction)
        ref_num = extract_number(reference)
        if pred_num is not None and ref_num is not None:
            numeric = float(math.isclose(pred_num, ref_num, abs_tol=max(1e-4, abs(ref_num) * 0.02)))
            f1 = max(f1, numeric)
    criteria = record.get("criteria", {}) if isinstance(record.get("criteria", {}), dict) else {}
    min_chars = int(criteria.get("min_chars", 0) or 0)
    keywords = [str(keyword) for keyword in criteria.get("context_keywords", [])]
    normalized_prediction = normalize_text(prediction)
    keyword_hits = sum(1 for keyword in keywords if normalize_text(keyword) in normalized_prediction)
    return {
        "exact": exact,
        "f1": f1,
        "rouge_l": rouge_l(prediction, reference),
        "numeric": numeric,
        "chars": float(len(prediction)),
        "completion_tokens": float(completion_tokens or 0),
        "early_eos": float(finish_reason == "stop" and len(prediction) < 20 and len(reference) >= 20),
        "repeat_4gram": repeated_ngram_ratio(prediction),
        "length_compliance": float(len(prediction) >= min_chars) if min_chars else 1.0,
        "context_keyword_recall": keyword_hits / len(keywords) if keywords else 1.0,
    }


def read_records(path: Path, limit: int) -> list[dict[str, Any]]:
    records = []
    with path.open("r", encoding="utf-8") as handle:
        for line in handle:
            if line.strip():
                records.append(json.loads(line))
                if limit and len(records) >= limit:
                    break
    return records


def read_partial(path: Path) -> list[dict[str, Any]]:
    rows = []
    if not path.exists():
        return rows
    with path.open("r", encoding="utf-8") as handle:
        for line in handle:
            if line.strip():
                try:
                    rows.append(json.loads(line))
                except json.JSONDecodeError:
                    continue
    return rows


def summarize_examples(examples: list[dict[str, Any]]) -> dict[str, Any]:
    totals: dict[str, dict[str, float]] = defaultdict(lambda: defaultdict(float))
    counts: Counter[str] = Counter()
    success: Counter[str] = Counter()
    errors: Counter[str] = Counter()

    for row in examples:
        bucket = str(row.get("bucket", "unknown"))
        counts[bucket] += 1
        counts["all"] += 1
        for label in ("base", "lora"):
            result = row.get("results", {}).get(label, {})
            if "metrics" in result:
                for metric, value in result["metrics"].items():
                    if isinstance(value, (int, float)):
                        totals[f"{bucket}:{label}"][metric] += float(value)
                        totals[f"all:{label}"][metric] += float(value)
                success[f"{bucket}:{label}"] += 1
                success[f"all:{label}"] += 1
            else:
                errors[f"{bucket}:{label}"] += 1
                errors[f"all:{label}"] += 1

    summary: dict[str, Any] = {}
    for bucket, count in sorted(counts.items()):
        summary[bucket] = {"count": count}
        for label in ("base", "lora"):
            ok = success[f"{bucket}:{label}"]
            averaged = {metric: value / ok for metric, value in totals[f"{bucket}:{label}"].items()} if ok else {}
            summary[bucket][label] = {
                "attempted": count,
                "successful": ok,
                "errors": errors[f"{bucket}:{label}"],
                "error_rate": errors[f"{bucket}:{label}"] / count if count else 0.0,
                **averaged,
            }
        base_f1 = summary[bucket]["base"].get("f1", 0.0)
        lora_f1 = summary[bucket]["lora"].get("f1", 0.0)
        summary[bucket]["delta_f1"] = lora_f1 - base_f1
    return summary


def main() -> None:
    args = parse_args()
    records = read_records(Path(args.eval_jsonl), args.limit)
    output_path = Path(args.output)
    partial_path = Path(args.partial_output) if args.partial_output else output_path.with_suffix(".jsonl")
    partial_path.parent.mkdir(parents=True, exist_ok=True)
    if partial_path.exists() and not args.resume:
        partial_path.unlink()
    examples: list[dict[str, Any]] = read_partial(partial_path) if args.resume else []
    completed_indexes = {int(row.get("index", 0)) for row in examples if str(row.get("index", "")).isdigit()}
    endpoints = {
        "base": (args.base_url, args.base_model),
        "lora": (args.lora_url, args.lora_model),
    }

    with ThreadPoolExecutor(max_workers=max(1, args.concurrency)) as executor:
        partial_handle = partial_path.open("a", encoding="utf-8")
        for index, record in enumerate(records, 1):
            if index in completed_indexes:
                print(f"[eval] {index}/{len(records)} skipped", flush=True)
                continue
            source = str(record.get("source", "unknown"))
            bucket = source_bucket(source)
            reference = get_reference(record)
            row: dict[str, Any] = {"index": index, "source": source, "bucket": bucket, "reference": reference, "results": {}}
            futures = {
                executor.submit(
                    call_model,
                    url,
                    args.api_key,
                    model,
                    record,
                    args.max_tokens,
                    args.temperature,
                ): label
                for label, (url, model) in endpoints.items()
            }
            for future in as_completed(futures):
                label = futures[future]
                try:
                    result = future.result()
                    metrics = score(
                        record,
                        source,
                        result["prediction"],
                        reference,
                        result["finish_reason"],
                        result["completion_tokens"],
                    )
                    row["results"][label] = {**result, "metrics": metrics}
                except Exception as exc:  # noqa: BLE001 - errors are part of the report
                    error = str(exc)
                    if isinstance(exc, urllib.error.HTTPError):
                        error = f"HTTP {exc.code}: {exc.read().decode('utf-8', errors='replace')[:500]}"
                    row["results"][label] = {"error": error}
            examples.append(row)
            partial_handle.write(json.dumps(row, ensure_ascii=False) + "\n")
            partial_handle.flush()
            print(f"[eval] {index}/{len(records)} {bucket}", flush=True)
            if args.sleep_sec:
                time.sleep(args.sleep_sec)
        partial_handle.close()

    summary = summarize_examples(examples)

    output = {
        "config": {
            "eval_jsonl": args.eval_jsonl,
            "base_url": args.base_url,
            "base_model": args.base_model,
            "lora_url": args.lora_url,
            "lora_model": args.lora_model,
            "max_tokens": args.max_tokens,
            "temperature": args.temperature,
            "partial_output": str(partial_path),
            "resume": args.resume,
        },
        "summary": summary,
        "examples": examples,
    }
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(output, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(summary, ensure_ascii=False, indent=2))
    print(f"report={output_path}")


if __name__ == "__main__":
    main()
