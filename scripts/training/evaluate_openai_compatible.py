#!/usr/bin/env python3
"""Evaluate base vs LoRA through an OpenAI-compatible multimodal endpoint."""

from __future__ import annotations

import argparse
import base64
import json
import math
import mimetypes
import os
import re
import time
import urllib.error
import urllib.request
from collections import defaultdict
from pathlib import Path
from typing import Any


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--eval-jsonl", default="/mnt/data/tianyi/MLLM_Assistant/datasets/qwen_vl_eval.jsonl")
    parser.add_argument("--output", default="/mnt/data/tianyi/MLLM_Assistant/runs/qwen3-vl-eval-report.json")
    parser.add_argument("--base-url", default=os.environ.get("MLLM_MODEL_BASE_URL", "http://127.0.0.1:8000/v1"))
    parser.add_argument("--api-key", default=os.environ.get("MLLM_MODEL_API_KEY", "local-mllm-token"))
    parser.add_argument("--base-model", default=os.environ.get("MLLM_BASE_EVAL_MODEL", "Qwen/Qwen3-VL-8B-Instruct"))
    parser.add_argument("--lora-model", default=os.environ.get("MLLM_LORA_EVAL_MODEL", "mllm-qwen3-vl-lora"))
    parser.add_argument("--limit", type=int, default=0)
    parser.add_argument("--max-tokens", type=int, default=256)
    parser.add_argument("--sleep-sec", type=float, default=0.0)
    return parser.parse_args()


def normalize_text(value: str) -> str:
    value = value.lower().strip()
    value = re.sub(r"\s+", " ", value)
    value = re.sub(r"[^\w\u4e00-\u9fff\.\-%]+", " ", value)
    return value.strip()


def token_f1(prediction: str, reference: str) -> float:
    pred_tokens = normalize_text(prediction).split()
    ref_tokens = normalize_text(reference).split()
    if not pred_tokens or not ref_tokens:
        return float(pred_tokens == ref_tokens)
    common = 0
    used = [False] * len(ref_tokens)
    for token in pred_tokens:
        for idx, ref in enumerate(ref_tokens):
            if not used[idx] and token == ref:
                used[idx] = True
                common += 1
                break
    if common == 0:
        return 0.0
    precision = common / len(pred_tokens)
    recall = common / len(ref_tokens)
    return 2 * precision * recall / (precision + recall)


def char_f1(prediction: str, reference: str) -> float:
    pred = [ch for ch in normalize_text(prediction) if not ch.isspace()]
    ref = [ch for ch in normalize_text(reference) if not ch.isspace()]
    if not pred or not ref:
        return float(pred == ref)
    counts: dict[str, int] = defaultdict(int)
    for ch in ref:
        counts[ch] += 1
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


def lcs_len(a: str, b: str) -> int:
    a = normalize_text(a)
    b = normalize_text(b)
    if not a or not b:
        return 0
    prev = [0] * (len(b) + 1)
    for ca in a:
        curr = [0]
        for j, cb in enumerate(b, 1):
            curr.append(prev[j - 1] + 1 if ca == cb else max(prev[j], curr[-1]))
        prev = curr
    return prev[-1]


def rouge_l(prediction: str, reference: str) -> float:
    norm_pred = normalize_text(prediction)
    norm_ref = normalize_text(reference)
    if not norm_pred or not norm_ref:
        return float(norm_pred == norm_ref)
    lcs = lcs_len(norm_pred, norm_ref)
    precision = lcs / len(norm_pred)
    recall = lcs / len(norm_ref)
    if precision + recall == 0:
        return 0.0
    return 2 * precision * recall / (precision + recall)


def extract_number(value: str) -> float | None:
    match = re.search(r"-?\d+(?:\.\d+)?", value.replace(",", ""))
    if not match:
        return None
    return float(match.group(0))


def score_prediction(source: str, prediction: str, reference: str) -> dict[str, float]:
    norm_pred = normalize_text(prediction)
    norm_ref = normalize_text(reference)
    exact = float(norm_pred == norm_ref)
    score = max(token_f1(prediction, reference), char_f1(prediction, reference))
    if source.lower().startswith("chartqa"):
        pred_num = extract_number(prediction)
        ref_num = extract_number(reference)
        if pred_num is not None and ref_num is not None:
            tolerance = max(1e-4, abs(ref_num) * 0.02)
            numeric = float(math.isclose(pred_num, ref_num, abs_tol=tolerance))
            score = max(score, numeric)
        else:
            numeric = 0.0
    else:
        numeric = 0.0
    return {"exact": exact, "f1": score, "rouge_l": rouge_l(prediction, reference), "numeric": numeric}


def data_url(path: str) -> str:
    mime = mimetypes.guess_type(path)[0] or "image/png"
    encoded = base64.b64encode(Path(path).read_bytes()).decode("ascii")
    return f"data:{mime};base64,{encoded}"


def get_reference(record: dict[str, Any]) -> str:
    messages = record.get("messages", [])
    for message in messages:
        if isinstance(message, dict) and message.get("role") == "assistant":
            return str(message.get("content", "")).strip()
    return ""


def get_user_text(record: dict[str, Any]) -> str:
    messages = record.get("messages", [])
    for message in messages:
        if isinstance(message, dict) and message.get("role") == "user":
            content = message.get("content", "")
            if isinstance(content, str):
                return content.replace("<image>", "").strip()
    return ""


def call_model(args: argparse.Namespace, model: str, record: dict[str, Any]) -> str:
    content: list[dict[str, Any]] = [{"type": "text", "text": get_user_text(record)}]
    for image in record.get("images", [])[:1]:
        content.append({"type": "image_url", "image_url": {"url": data_url(image)}})
    payload = {
        "model": model,
        "messages": [{"role": "user", "content": content}],
        "temperature": 0,
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
    with urllib.request.urlopen(request, timeout=300) as response:  # noqa: S310 - local endpoint
        result = json.loads(response.read().decode("utf-8"))
    return (result.get("choices") or [{}])[0].get("message", {}).get("content", "").strip()


def read_records(path: Path, limit: int) -> list[dict[str, Any]]:
    records: list[dict[str, Any]] = []
    with path.open("r", encoding="utf-8") as handle:
        for line in handle:
            if not line.strip():
                continue
            records.append(json.loads(line))
            if limit and len(records) >= limit:
                break
    return records


def main() -> None:
    args = parse_args()
    records = read_records(Path(args.eval_jsonl), args.limit)
    examples: list[dict[str, Any]] = []
    totals: dict[str, dict[str, float]] = defaultdict(lambda: defaultdict(float))
    counts: dict[str, int] = defaultdict(int)

    for idx, record in enumerate(records, 1):
        source = str(record.get("source", "unknown"))
        reference = get_reference(record)
        row: dict[str, Any] = {"index": idx, "source": source, "reference": reference}
        for label, model in (("base", args.base_model), ("lora", args.lora_model)):
            try:
                prediction = call_model(args, model, record)
            except urllib.error.HTTPError as exc:
                prediction = f"ERROR HTTP {exc.code}: {exc.read().decode('utf-8', errors='ignore')[:300]}"
            metrics = score_prediction(source, prediction, reference)
            row[label] = {"model": model, "prediction": prediction, "metrics": metrics}
            for metric, value in metrics.items():
                totals[f"{source}:{label}"][metric] += value
                totals[f"all:{label}"][metric] += value
        counts[source] += 1
        counts["all"] += 1
        examples.append(row)
        if args.sleep_sec:
            time.sleep(args.sleep_sec)
        print(f"[eval] {idx}/{len(records)} {source}", flush=True)

    summary: dict[str, Any] = {}
    for source, count in counts.items():
        summary[source] = {"count": count}
        for label in ("base", "lora"):
            key = f"{source}:{label}"
            summary[source][label] = {
                metric: (value / count if count else 0.0)
                for metric, value in totals[key].items()
            }
        base_f1 = summary[source].get("base", {}).get("f1", 0.0)
        lora_f1 = summary[source].get("lora", {}).get("f1", 0.0)
        summary[source]["delta_f1"] = lora_f1 - base_f1

    output = {"summary": summary, "examples": examples}
    output_path = Path(args.output)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(output, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(summary, ensure_ascii=False, indent=2))
    print(f"report={output_path}")


if __name__ == "__main__":
    main()
