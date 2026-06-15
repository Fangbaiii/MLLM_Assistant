#!/usr/bin/env python3
"""Build a quality-first SFT manifest for adaptive-length, multi-turn training."""

from __future__ import annotations

import argparse
import hashlib
import json
import random
import re
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any, Iterable


DEFAULT_DATA_ROOT = Path("/mnt/data/tianyi/MLLM_Assistant/datasets")
DEFAULT_OUTPUT = DEFAULT_DATA_ROOT / "qwen_vl_cn_quality_train.jsonl"
DEFAULT_EVAL_OUTPUT = DEFAULT_DATA_ROOT / "qwen_vl_cn_quality_eval.jsonl"
DEFAULT_REPORT = DEFAULT_DATA_ROOT / "qwen_vl_cn_quality_report.json"

MODE_PREFIXES = {
    "concise": "【回答模式：简洁】请直接给出准确结论；只有必要时补充一句依据。",
    "standard": "【回答模式：标准】请先回答问题，再给出必要依据和补充说明，避免空泛复述。",
    "detailed": "【回答模式：详细】请给出完整、结构清晰且有信息增量的回答，避免重复和凑字数。",
}

TEMPLATE_PATTERNS = (
    "这张图最核心的内容可以概括为",
    "从直接可见的信息出发，比较完整的中文说明",
    "如果把这张图解释给看不到图片的人",
    "最稳妥的答案",
    "当前问题的稳妥结论",
    "这个问题可以完整表述为",
    "原始标注没有明确给出",
    "不把看不见的背景设定当成事实",
    "不额外编造人物身份",
    "针对“",
    "如果把这个答案写得更稳一些",
    "围绕这份文档，当前最可靠的答案",
    "对于“",
    "更完整的中文说法可以先给出结论",
    "根据图表里的可见信息，当前最稳妥的回答",
    "后续展开时",
    "如果顺着现在的语境继续聊",
    "更自然的后续说法应该一边承接上文",
    "接下来如果继续回应，重点应该放在",
    "重点应该放在当前对话已经提到的关注点上",
    "图表直接支持的答案",
    "文档中能够支持的结论",
)

CATEGORY_TARGETS = {
    "concise": 0.20,
    "detailed_multimodal": 0.35,
    "multi_turn": 0.30,
    "long_form": 0.15,
}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", action="append", required=True, help="Source ms-swift JSONL. Repeatable.")
    parser.add_argument(
        "--curated-input",
        action="append",
        default=[],
        help="Human- or teacher-curated JSONL. Repeatable and preferred over legacy rows.",
    )
    parser.add_argument("--output", default=str(DEFAULT_OUTPUT))
    parser.add_argument("--eval-output", default=str(DEFAULT_EVAL_OUTPUT))
    parser.add_argument("--report", default=str(DEFAULT_REPORT))
    parser.add_argument("--target-rows", type=int, default=18_000)
    parser.add_argument("--eval-rows", type=int, default=1_000)
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--min-detailed-chars", type=int, default=150)
    parser.add_argument("--min-long-form-chars", type=int, default=500)
    parser.add_argument("--max-prefixes-per-dialogue", type=int, default=3)
    parser.add_argument("--allow-underfilled", action="store_true")
    return parser.parse_args()


def read_jsonl(paths: Iterable[str], curated: bool) -> Iterable[dict[str, Any]]:
    for raw_path in paths:
        path = Path(raw_path)
        with path.open("r", encoding="utf-8") as handle:
            for line_number, line in enumerate(handle, 1):
                if not line.strip():
                    continue
                row = json.loads(line)
                if not isinstance(row, dict):
                    raise ValueError(f"{path}:{line_number} is not a JSON object")
                row["_curated"] = curated
                row["_origin"] = str(path)
                yield row


def normalize_text(value: Any) -> str:
    return re.sub(r"\s+", " ", str(value or "")).strip()


def assistant_messages(row: dict[str, Any]) -> list[dict[str, Any]]:
    return [
        message
        for message in row.get("messages", [])
        if isinstance(message, dict) and message.get("role") == "assistant"
    ]


def final_answer(row: dict[str, Any]) -> str:
    messages = assistant_messages(row)
    return normalize_text(messages[-1].get("content")) if messages else ""


def is_template_expansion(text: str) -> bool:
    return any(pattern in text for pattern in TEMPLATE_PATTERNS)


def repeated_ngram_ratio(text: str, n: int = 4) -> float:
    chars = [char for char in normalize_text(text) if not char.isspace()]
    if len(chars) < n:
        return 0.0
    grams = [tuple(chars[index : index + n]) for index in range(len(chars) - n + 1)]
    return 1.0 - len(set(grams)) / len(grams)


def information_density(text: str) -> float:
    normalized = normalize_text(text)
    if not normalized:
        return 0.0
    content_chars = sum(char.isalnum() or "\u3400" <= char <= "\u9fff" for char in normalized)
    unique_chars = len(set(char for char in normalized if not char.isspace()))
    return (content_chars / len(normalized)) * min(1.0, unique_chars / 45)


def add_mode_prefix(messages: list[dict[str, Any]], mode: str) -> list[dict[str, Any]]:
    result = [dict(message) for message in messages]
    for message in reversed(result):
        if message.get("role") != "user":
            continue
        content = normalize_text(message.get("content"))
        message["content"] = f"{MODE_PREFIXES[mode]}\n\n{content}"
        break
    return result


def make_record(row: dict[str, Any], messages: list[dict[str, Any]], category: str, mode: str) -> dict[str, Any]:
    record: dict[str, Any] = {
        "messages": add_mode_prefix(messages, mode),
        "source": row.get("source", "curated"),
        "quality_category": category,
        "answer_mode": mode,
        "origin": row.get("_origin"),
    }
    for field in (
        "dataset",
        "source_id",
        "source_url",
        "license",
        "copyright",
        "public_data",
        "answer_from",
        "human_verified",
        "translation_model",
        "original_language",
        "original_answer",
        "grounding_attrs",
        "split_hint",
        "prefix_sample",
    ):
        if field in row:
            record[field] = row[field]
    if row.get("teacher_review_required"):
        record["teacher_review_required"] = True
        record["approved"] = row.get("approved")
    if row.get("images"):
        record["images"] = row["images"]
    return record


def dialogue_prefixes(row: dict[str, Any], max_prefixes: int) -> list[dict[str, Any]]:
    messages = [message for message in row.get("messages", []) if isinstance(message, dict)]
    assistant_indexes = [
        index
        for index, message in enumerate(messages)
        if message.get("role") == "assistant" and index >= 3
    ]
    if not assistant_indexes:
        return []

    selected_indexes = (
        assistant_indexes[-1:]
        if row.get("prefix_sample")
        else assistant_indexes[-max_prefixes:]
    )
    records: list[dict[str, Any]] = []
    for index in selected_indexes:
        prefix = messages[: index + 1]
        answer = normalize_text(prefix[-1].get("content"))
        minimum_answer_chars = 25 if row.get("public_data") and row.get("prefix_sample") else 35
        if len(answer) < minimum_answer_chars or is_template_expansion(answer):
            continue
        records.append(make_record(row, prefix, "multi_turn", "standard"))
    return records


def classify_single_turn(row: dict[str, Any], min_detailed: int, min_long: int) -> tuple[str, str] | None:
    answer = final_answer(row)
    message_count = len(row.get("messages", []))
    has_image = bool(row.get("images"))
    curated = bool(row.get("_curated"))

    if not answer or is_template_expansion(answer) or repeated_ngram_ratio(answer) > 0.18:
        return None
    if len(answer) <= 45 and message_count <= 2:
        return "concise", "concise"
    if len(answer) >= min_long and (curated or not has_image):
        return "long_form", "detailed"
    if len(answer) >= min_detailed and has_image and (curated or message_count <= 2):
        return "detailed_multimodal", "detailed"
    return None


def record_key(record: dict[str, Any]) -> str:
    payload = {
        "messages": record.get("messages", []),
        "images": record.get("images", []),
    }
    return hashlib.sha1(
        json.dumps(payload, ensure_ascii=False, sort_keys=True).encode("utf-8")
    ).hexdigest()


def validate_record(record: dict[str, Any]) -> str | None:
    if record.get("teacher_review_required") and record.get("approved") is not True:
        return "teacher_candidate_not_approved"
    messages = record.get("messages", [])
    if len(messages) < 2 or messages[-1].get("role") != "assistant":
        return "invalid_turn_structure"
    answer = normalize_text(messages[-1].get("content"))
    if not answer:
        return "empty_answer"
    if is_template_expansion(answer):
        return "template_expansion"
    if repeated_ngram_ratio(answer) > 0.18:
        return "high_repetition"
    if len(answer) >= 80 and information_density(answer) < 0.35:
        return "low_information_density"
    for image in record.get("images", []):
        if not Path(str(image)).exists():
            return "missing_image"
    return None


def quota_counts(target_rows: int) -> dict[str, int]:
    counts = {category: int(target_rows * ratio) for category, ratio in CATEGORY_TARGETS.items()}
    counts["detailed_multimodal"] += target_rows - sum(counts.values())
    return counts


def write_jsonl(path: Path, rows: list[dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temp_path = path.with_name(f".{path.name}.tmp")
    with temp_path.open("w", encoding="utf-8") as handle:
        for row in rows:
            handle.write(json.dumps(row, ensure_ascii=False) + "\n")
    temp_path.replace(path)


def main() -> None:
    args = parse_args()
    rng = random.Random(args.seed)
    candidates: dict[str, list[dict[str, Any]]] = defaultdict(list)
    rejected = Counter()
    seen: set[str] = set()

    rows = list(read_jsonl(args.curated_input, curated=True))
    rows.extend(read_jsonl(args.input, curated=False))

    for row in rows:
        generated = dialogue_prefixes(row, args.max_prefixes_per_dialogue)
        single = classify_single_turn(row, args.min_detailed_chars, args.min_long_form_chars)
        if single is not None:
            category, mode = single
            generated.append(make_record(row, row.get("messages", []), category, mode))
        if not generated:
            rejected["not_eligible"] += 1
            continue

        for record in generated:
            reason = validate_record(record)
            if reason:
                rejected[reason] += 1
                continue
            key = record_key(record)
            if key in seen:
                rejected["duplicate"] += 1
                continue
            seen.add(key)
            candidates[record["quality_category"]].append(record)

    quotas = quota_counts(args.target_rows)
    train_set: list[dict[str, Any]] = []
    eval_set: list[dict[str, Any]] = []
    selection_counts: dict[str, int] = {}
    eval_quotas = quota_counts(args.eval_rows)
    for category, quota in quotas.items():
        pool = candidates[category]
        rng.shuffle(pool)
        pool.sort(key=lambda record: record.get("public_data") is True, reverse=True)
        hinted_eval = [record for record in pool if record.get("split_hint") == "eval"]
        regular = [record for record in pool if record.get("split_hint") != "eval"]
        category_eval = (hinted_eval + regular)[: eval_quotas[category]]
        eval_keys = {record_key(record) for record in category_eval}
        train_pool = [
            record
            for record in regular
            if record_key(record) not in eval_keys
        ]
        category_train = train_pool[: max(0, quota - len(category_eval))]
        eval_set.extend(category_eval)
        train_set.extend(category_train)
        selection_counts[category] = len(category_eval) + len(category_train)

    rng.shuffle(train_set)
    rng.shuffle(eval_set)
    selected_count = len(train_set) + len(eval_set)
    if selected_count < args.target_rows and not args.allow_underfilled:
        shortages = {
            category: quotas[category] - selection_counts.get(category, 0)
            for category in quotas
            if selection_counts.get(category, 0) < quotas[category]
        }
        raise SystemExit(
            "Quality manifest is underfilled. Add curated data or pass --allow-underfilled. "
            f"selected={selected_count} target={args.target_rows} shortages={shortages}"
        )

    write_jsonl(Path(args.output), train_set)
    write_jsonl(Path(args.eval_output), eval_set)

    report = {
        "target_rows": args.target_rows,
        "train_rows": len(train_set),
        "eval_rows": len(eval_set),
        "quotas": quotas,
        "candidate_counts": {key: len(value) for key, value in candidates.items()},
        "selected_counts": selection_counts,
        "rejected": dict(rejected),
        "assurance": (
            "Legacy fixed-template expansions are rejected. Detailed multimodal and long-form quotas "
            "must be supplied by native or curated answers; the script does not fabricate image details."
        ),
    }
    report_path = Path(args.report)
    report_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
