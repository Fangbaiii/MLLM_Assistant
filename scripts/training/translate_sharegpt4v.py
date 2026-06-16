#!/usr/bin/env python3
"""Translate public ShareGPT4V captions into Chinese through a local endpoint."""

from __future__ import annotations

import argparse
import concurrent.futures
import json
import re
import time
import urllib.error
import urllib.request
from collections import Counter
from pathlib import Path
from typing import Any


PROMPTS = (
    "请详细描述这张图片中能够直接观察到的内容，包括主要对象、动作、场景、"
    "空间关系和显著细节。回答使用自然中文；如有合理推断，请明确标明依据和不确定性。",
    "请用中文完整解释这张图片。先概括整体场景，再说明主体、动作、环境和重要细节，"
    "避免空泛套话和重复。",
    "请为看不到图片的人写一段准确、具体的中文图像说明。以画面可见事实为主，"
    "必要时保留合理推断并说明不确定性，覆盖主体、位置关系、活动和背景。",
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--coco-dir", required=True)
    parser.add_argument("--base-url", default="http://127.0.0.1:8003/v1")
    parser.add_argument("--api-key", default="local-mllm-token")
    parser.add_argument("--model", default="Qwen3-VL-8B-Instruct")
    parser.add_argument("--limit", type=int, default=7000)
    parser.add_argument("--min-chars", type=int, default=150)
    parser.add_argument("--max-chars", type=int, default=650)
    parser.add_argument("--retries", type=int, default=4)
    parser.add_argument("--request-timeout", type=int, default=180)
    parser.add_argument("--workers", type=int, default=8)
    parser.add_argument("--overwrite", action="store_true")
    return parser.parse_args()


def normalize(value: Any) -> str:
    return re.sub(r"\s+", " ", str(value or "")).strip()


def repeated_ngram_ratio(text: str, n: int = 4) -> float:
    chars = [char for char in normalize(text) if not char.isspace()]
    if len(chars) < n:
        return 0.0
    grams = [tuple(chars[index : index + n]) for index in range(len(chars) - n + 1)]
    return 1.0 - len(set(grams)) / len(grams)


def chinese_ratio(text: str) -> float:
    content = [char for char in text if char.isalnum()]
    if not content:
        return 0.0
    chinese = sum("\u3400" <= char <= "\u9fff" for char in content)
    return chinese / len(content)


def preserves_numbers(source: str, translated: str) -> bool:
    source_numbers = set(re.findall(r"\d+(?:[.,]\d+)?", source))
    translated_numbers = set(re.findall(r"\d+(?:[.,]\d+)?", translated))
    return source_numbers <= translated_numbers


def rejection_reason(args: argparse.Namespace, caption: str, answer: str) -> str | None:
    if not (args.min_chars <= len(answer) <= args.max_chars):
        return "length"
    if chinese_ratio(answer) < 0.65:
        return "language"
    if repeated_ngram_ratio(answer) > 0.10:
        return "repetition"
    if not preserves_numbers(caption, answer):
        return "numbers"
    if "<think>" in answer.lower():
        return "think_tag"
    return None


def extract_caption(row: dict[str, Any]) -> str:
    conversations = row.get("conversations", [])
    for item in reversed(conversations):
        if item.get("from") in {"gpt", "assistant"}:
            return normalize(item.get("value"))
    return ""


def translate(args: argparse.Namespace, caption: str) -> str:
    instruction = (
        "把下面英文图像描述转写成面向中文用户的客观图像说明。要求：\n"
        "1. 保留可见对象、数量、颜色、动作、空间关系和场景细节。\n"
        "2. 原文提到的地点、年代、氛围、文字标识和活动背景可以保留，但不要自行新增。\n"
        "3. 压缩空泛赞美、翻译说明、过度故事化联想和模板套话。\n"
        "4. 输出约 180 到 400 个汉字，不解释翻译过程，只输出自然、具体、适合中文语境的图像描述。\n\n英文描述：\n"
        f"{caption}"
    )
    payload = json.dumps(
        {
            "model": args.model,
            "messages": [{"role": "user", "content": instruction}],
            "temperature": 0.1,
            "top_p": 0.8,
            "max_tokens": 900,
        },
        ensure_ascii=False,
    ).encode("utf-8")
    request = urllib.request.Request(
        f"{args.base_url.rstrip('/')}/chat/completions",
        data=payload,
        headers={
            "Authorization": f"Bearer {args.api_key}",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=args.request_timeout) as response:
        result = json.load(response)
    return normalize(result["choices"][0]["message"]["content"])


def translate_candidate(
    args: argparse.Namespace,
    row: dict[str, Any],
    image_path: Path,
    index: int,
    caption: str,
) -> tuple[dict[str, Any], str, Path, int, str, str | None]:
    source_id = str(row.get("id", index))
    last_reason = "empty"
    for attempt in range(args.retries):
        try:
            answer = translate(args, caption)
        except (urllib.error.URLError, TimeoutError, KeyError, json.JSONDecodeError) as exc:
            last_reason = f"request:{type(exc).__name__}"
            time.sleep(2**attempt)
            continue
        reason = rejection_reason(args, caption, answer)
        if reason is None:
            return row, answer, image_path, index, source_id, None
        last_reason = reason
    return row, "", image_path, index, source_id, last_reason


def write_row(
    handle: Any,
    row: dict[str, Any],
    answer: str,
    image_path: Path,
    index: int,
    model: str,
) -> None:
    record = {
        "messages": [
            {"role": "user", "content": f"<image>{PROMPTS[index % len(PROMPTS)]}"},
            {"role": "assistant", "content": answer},
        ],
        "images": [str(image_path)],
        "source": "sharegpt4v-coco-zh",
        "dataset": "Lin-Chen/ShareGPT4V",
        "source_id": str(row.get("id", index)),
        "source_url": "https://huggingface.co/datasets/Lin-Chen/ShareGPT4V",
        "license": "CC-BY-NC-4.0",
        "translation_model": model,
        "original_language": "en",
        "original_answer": extract_caption(row),
    }
    handle.write(json.dumps(record, ensure_ascii=False) + "\n")
    handle.flush()


def main() -> None:
    args = parse_args()
    input_path = Path(args.input)
    output_path = Path(args.output)
    coco_dir = Path(args.coco_dir)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    if args.overwrite and output_path.exists():
        output_path.unlink()

    completed: set[str] = set()
    if output_path.exists():
        with output_path.open("r", encoding="utf-8") as handle:
            for line in handle:
                if line.strip():
                    completed.add(str(json.loads(line).get("source_id")))

    rows = json.loads(input_path.read_text(encoding="utf-8"))
    accepted = len(completed)
    if accepted >= args.limit:
        print(
            json.dumps(
                {"accepted": accepted, "target": args.limit, "candidates": 0, "rejections": {}},
                ensure_ascii=False,
            )
        )
        return

    candidates: list[tuple[dict[str, Any], Path, int, str]] = []
    with output_path.open("a", encoding="utf-8") as output:
        for index, row in enumerate(rows):
            source_id = str(row.get("id", index))
            if source_id in completed:
                continue
            image_value = normalize(row.get("image"))
            if not image_value.startswith("coco/train2017/"):
                continue
            image_path = coco_dir / Path(image_value).name
            if not image_path.is_file():
                continue
            caption = extract_caption(row)
            if len(caption) < 300:
                continue
            candidates.append((row, image_path, index, caption))

        rejection_reasons: Counter[str] = Counter()
        completed_jobs = 0
        executor = concurrent.futures.ThreadPoolExecutor(max_workers=max(1, args.workers))
        futures = [
            executor.submit(translate_candidate, args, row, image_path, index, caption)
            for row, image_path, index, caption in candidates
        ]
        try:
            for future in concurrent.futures.as_completed(futures):
                row, answer, image_path, index, source_id, reason = future.result()
                completed_jobs += 1
                if source_id in completed:
                    continue
                if reason is not None:
                    rejection_reasons[reason] += 1
                else:
                    write_row(output, row, answer, image_path, index, args.model)
                    accepted += 1
                    completed.add(source_id)
                    if accepted % 50 == 0 or accepted == args.limit:
                        print(
                            f"[translate] accepted={accepted}/{args.limit} "
                            f"completed_jobs={completed_jobs}/{len(candidates)} "
                            f"rejects={dict(rejection_reasons)}",
                            flush=True,
                        )
                if accepted >= args.limit:
                    break
        finally:
            executor.shutdown(wait=False, cancel_futures=True)

    print(
        json.dumps(
            {
                "accepted": accepted,
                "target": args.limit,
                "candidates": len(candidates),
                "rejections": dict(rejection_reasons),
            },
            ensure_ascii=False,
        )
    )
    if accepted < args.limit:
        raise SystemExit(f"Only translated {accepted}/{args.limit} eligible ShareGPT4V rows.")


if __name__ == "__main__":
    main()
