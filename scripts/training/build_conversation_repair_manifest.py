#!/usr/bin/env python3
"""Build a repair SFT mix for Chinese task-oriented multi-turn behavior."""

from __future__ import annotations

import argparse
import hashlib
import json
import random
import re
import statistics
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any


MODE_PREFIX_RE = re.compile(r"^【回答模式：(简洁|标准|详细)】[^\n]*(?:\n+)?")

TRAIN_QUOTAS = {
    "task_multiturn_multimodal": 1800,
    "task_multiturn_text": 1000,
    "natural_multiturn": 250,
    "detailed_multimodal_replay": 650,
    "long_form_replay": 650,
    "concise_replay": 400,
    "document_fact_replay": 250,
}

EVAL_QUOTAS = {
    "task_multiturn_multimodal": 140,
    "task_multiturn_text": 80,
    "natural_multiturn": 25,
    "detailed_multimodal_replay": 55,
    "long_form_replay": 50,
    "concise_replay": 30,
    "document_fact_replay": 20,
}

MULTIMODAL_FOLLOWUPS = (
    "请结合图片和刚才的概括继续补充主体、场景、动作、关系和可见细节；不要重复上一轮，只写能够确认的信息。",
    "请在前面概括的基础上继续说明观察依据和关键细节，不要重新复述开头，也不要因为这是多轮追问就缩成一句话。",
    "请继续详细解释这张图片，承接上一轮补充有信息量的新细节，避免重复和臆测。",
)

TEXT_FOLLOWUPS = (
    "请承接上一轮继续补充背景、核心概念、关键事实和相互关系，不要重复已经说过的内容，也不要只给一句总结。",
    "请继续深入说明，补足尚未展开的要点，保持结构清楚和信息充分，避免重复上一轮。",
    "请结合已经提到的内容继续展开，补足新的背景和关键细节，不要重新复述前面的摘要。",
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--quality-train", required=True)
    parser.add_argument("--quality-eval", required=True)
    parser.add_argument("--balanced-train", required=True)
    parser.add_argument("--balanced-eval", required=True)
    parser.add_argument("--train-output", required=True)
    parser.add_argument("--eval-output", required=True)
    parser.add_argument("--report", required=True)
    parser.add_argument("--seed", type=int, default=20260614)
    parser.add_argument("--natural-min-chars", type=int, default=55)
    return parser.parse_args()


def read_jsonl(path: Path) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    with path.open("r", encoding="utf-8") as handle:
        for line_number, line in enumerate(handle, 1):
            if not line.strip():
                continue
            row = json.loads(line)
            if not isinstance(row, dict):
                raise ValueError(f"{path}:{line_number} is not a JSON object")
            rows.append(row)
    return rows


def normalize(value: Any) -> str:
    return re.sub(r"\s+", " ", str(value or "")).strip()


def strip_mode_prefix(value: Any) -> str:
    return MODE_PREFIX_RE.sub("", str(value or "")).strip()


def clone_messages(row: dict[str, Any]) -> list[dict[str, Any]]:
    return [
        {"role": message.get("role", "user"), "content": str(message.get("content", ""))}
        for message in row.get("messages", [])
        if isinstance(message, dict)
    ]


def final_answer(row: dict[str, Any]) -> str:
    answers = [
        normalize(message.get("content"))
        for message in row.get("messages", [])
        if isinstance(message, dict) and message.get("role") == "assistant"
    ]
    return answers[-1] if answers else ""


def answer_excerpt(text: str, minimum: int, maximum: int) -> tuple[str, int]:
    normalized = normalize(text)
    if len(normalized) <= maximum:
        return normalized, len(normalized)
    candidate = normalized[:maximum]
    boundaries = [candidate.rfind(mark) for mark in ("。", "！", "？", "；")]
    boundary = max(boundaries)
    if boundary + 1 >= minimum:
        cut = boundary + 1
        return candidate[:cut], cut
    cut = maximum
    return candidate.rstrip("，,；;：: ") + "。", cut


def mode_conditioned_prompt(prompt: str, rng: random.Random) -> tuple[str, str]:
    draw = rng.random()
    if draw < 0.30:
        return f"【回答模式：详细】请完整、清晰地回答，避免重复和凑字数。\n\n{prompt}", "detailed"
    if draw < 0.50:
        return f"【回答模式：标准】请充分回答当前任务，并保留必要依据和上下文约束。\n\n{prompt}", "standard"
    return prompt, "natural"


def copy_metadata(source: dict[str, Any], target: dict[str, Any]) -> None:
    for field in (
        "source",
        "dataset",
        "source_id",
        "source_url",
        "license",
        "copyright",
        "public_data",
        "translation_model",
        "original_language",
        "original_answer",
        "grounding_attrs",
    ):
        if field in source:
            target[field] = source[field]
    if source.get("images"):
        target["images"] = list(source["images"])


def make_task_multiturn(
    row: dict[str, Any],
    category: str,
    followups: tuple[str, ...],
    excerpt_min: int,
    excerpt_max: int,
    rng: random.Random,
) -> dict[str, Any] | None:
    messages = clone_messages(row)
    if len(messages) != 2 or messages[0]["role"] != "user" or messages[1]["role"] != "assistant":
        return None
    answer = normalize(messages[1]["content"])
    if len(answer) < excerpt_max + 40:
        return None
    first_prompt = strip_mode_prefix(messages[0]["content"])
    excerpt, cut = answer_excerpt(answer, excerpt_min, excerpt_max)
    continuation = answer[cut:].lstrip("，,；;：:。！？!? ")
    if len(continuation) < 60:
        return None
    followup, mode = mode_conditioned_prompt(rng.choice(followups), rng)
    record: dict[str, Any] = {
        "messages": [
            {"role": "user", "content": first_prompt},
            {"role": "assistant", "content": excerpt},
            {"role": "user", "content": followup},
            {"role": "assistant", "content": continuation},
        ],
        "quality_category": category,
        "answer_mode": mode,
        "repair_sample": True,
    }
    copy_metadata(row, record)
    return record


def make_replay(
    row: dict[str, Any],
    category: str,
    rng: random.Random,
    allow_standard: bool = True,
) -> dict[str, Any] | None:
    messages = clone_messages(row)
    if len(messages) < 2 or messages[-1]["role"] != "assistant":
        return None
    user_indexes = [index for index, message in enumerate(messages) if message["role"] == "user"]
    if not user_indexes:
        return None
    last_user = user_indexes[-1]
    prompt = strip_mode_prefix(messages[last_user]["content"])
    draw = rng.random()
    if draw < 0.30:
        prompt = f"【回答模式：详细】请完整、清晰地回答，避免重复和凑字数。\n\n{prompt}"
        mode = "detailed"
    elif allow_standard and draw < 0.50:
        prompt = f"【回答模式：标准】请充分回答当前任务，并保留必要依据和上下文约束。\n\n{prompt}"
        mode = "standard"
    else:
        mode = "natural"
    messages[last_user]["content"] = prompt
    record: dict[str, Any] = {
        "messages": messages,
        "quality_category": category,
        "answer_mode": mode,
        "repair_sample": False,
    }
    copy_metadata(row, record)
    return record


def make_natural_multiturn(row: dict[str, Any], minimum_chars: int) -> dict[str, Any] | None:
    answer = final_answer(row)
    if len(answer) < minimum_chars:
        return None
    messages = clone_messages(row)
    user_indexes = [index for index, message in enumerate(messages) if message["role"] == "user"]
    if len(messages) < 8 or not user_indexes or messages[-1]["role"] != "assistant":
        return None
    messages[user_indexes[-1]]["content"] = strip_mode_prefix(messages[user_indexes[-1]]["content"])
    record: dict[str, Any] = {
        "messages": messages,
        "quality_category": "natural_multiturn",
        "answer_mode": "natural",
        "repair_sample": False,
    }
    copy_metadata(row, record)
    return record


def make_concise_replay(row: dict[str, Any], rng: random.Random) -> dict[str, Any] | None:
    messages = clone_messages(row)
    if len(messages) != 2 or messages[0]["role"] != "user" or messages[1]["role"] != "assistant":
        return None
    prompt = strip_mode_prefix(messages[0]["content"])
    if rng.random() < 0.50:
        prompt = f"【回答模式：简洁】请直接给出准确结论；只有必要时补充一句依据。\n\n{prompt}"
        mode = "concise"
    else:
        mode = "natural"
    messages[0]["content"] = prompt
    record: dict[str, Any] = {
        "messages": messages,
        "quality_category": "concise_replay",
        "answer_mode": mode,
        "repair_sample": False,
    }
    copy_metadata(row, record)
    return record


def make_document_fact(row: dict[str, Any]) -> dict[str, Any] | None:
    messages = clone_messages(row)
    if len(messages) < 2 or messages[0]["role"] != "user" or messages[1]["role"] != "assistant":
        return None
    answer = normalize(messages[1]["content"])
    if not answer or len(answer) > 80:
        return None
    record: dict[str, Any] = {
        "messages": [
            {"role": "user", "content": strip_mode_prefix(messages[0]["content"])},
            {"role": "assistant", "content": answer},
        ],
        "source": row.get("source", "document-fact"),
        "quality_category": "document_fact_replay",
        "answer_mode": "natural",
        "repair_sample": False,
    }
    if row.get("images"):
        record["images"] = list(row["images"])
    return record


def record_key(row: dict[str, Any]) -> str:
    payload = {"messages": row.get("messages", []), "images": row.get("images", [])}
    return hashlib.sha1(
        json.dumps(payload, ensure_ascii=False, sort_keys=True).encode("utf-8")
    ).hexdigest()


def select_rows(
    candidates: dict[str, list[dict[str, Any]]],
    quotas: dict[str, int],
    rng: random.Random,
) -> list[dict[str, Any]]:
    selected: list[dict[str, Any]] = []
    seen: set[str] = set()
    for category, quota in quotas.items():
        pool = list(candidates.get(category, []))
        rng.shuffle(pool)
        category_rows: list[dict[str, Any]] = []
        for row in pool:
            key = record_key(row)
            if key in seen:
                continue
            seen.add(key)
            category_rows.append(row)
            if len(category_rows) >= quota:
                break
        if len(category_rows) < quota:
            raise SystemExit(
                f"Underfilled category {category}: selected={len(category_rows)} quota={quota} "
                f"candidates={len(pool)}"
            )
        selected.extend(category_rows)
    rng.shuffle(selected)
    return selected


def build_candidates(
    quality_rows: list[dict[str, Any]],
    balanced_rows: list[dict[str, Any]],
    natural_min_chars: int,
    rng: random.Random,
) -> dict[str, list[dict[str, Any]]]:
    candidates: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for row in quality_rows:
        category = row.get("quality_category")
        if category == "detailed_multimodal":
            task = make_task_multiturn(
                row,
                "task_multiturn_multimodal",
                MULTIMODAL_FOLLOWUPS,
                35,
                80,
                rng,
            )
            replay = make_replay(row, "detailed_multimodal_replay", rng)
            if task:
                candidates["task_multiturn_multimodal"].append(task)
            if replay:
                candidates["detailed_multimodal_replay"].append(replay)
        elif category == "long_form":
            task = make_task_multiturn(
                row,
                "task_multiturn_text",
                TEXT_FOLLOWUPS,
                80,
                180,
                rng,
            )
            replay = make_replay(row, "long_form_replay", rng)
            if task:
                candidates["task_multiturn_text"].append(task)
            if replay:
                candidates["long_form_replay"].append(replay)
        elif category == "multi_turn":
            natural = make_natural_multiturn(row, natural_min_chars)
            if natural:
                candidates["natural_multiturn"].append(natural)
        elif category == "concise":
            replay = make_concise_replay(row, rng)
            if replay:
                candidates["concise_replay"].append(replay)

    for row in balanced_rows:
        if row.get("source") not in {"docvqa-long", "chartqa-long"}:
            continue
        record = make_document_fact(row)
        if record:
            candidates["document_fact_replay"].append(record)
    return candidates


def percentile(values: list[int], ratio: float) -> int:
    ordered = sorted(values)
    return ordered[min(len(ordered) - 1, round((len(ordered) - 1) * ratio))] if ordered else 0


def summarize(rows: list[dict[str, Any]]) -> dict[str, Any]:
    categories = Counter()
    modes = Counter()
    lengths: dict[str, list[int]] = defaultdict(list)
    for row in rows:
        category = str(row.get("quality_category", "unknown"))
        categories[category] += 1
        modes[str(row.get("answer_mode", "unknown"))] += 1
        lengths[category].append(len(final_answer(row)))
    return {
        "rows": len(rows),
        "categories": dict(categories),
        "answer_modes": dict(modes),
        "answer_lengths": {
            category: {
                "mean": round(statistics.mean(values), 2),
                "p50": percentile(values, 0.50),
                "p90": percentile(values, 0.90),
                "min": min(values),
                "max": max(values),
            }
            for category, values in sorted(lengths.items())
        },
    }


def write_jsonl(path: Path, rows: list[dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f".{path.name}.tmp")
    with temporary.open("w", encoding="utf-8") as handle:
        for row in rows:
            handle.write(json.dumps(row, ensure_ascii=False) + "\n")
    temporary.replace(path)


def build_split(
    quality_path: Path,
    balanced_path: Path,
    quotas: dict[str, int],
    natural_min_chars: int,
    rng: random.Random,
) -> tuple[list[dict[str, Any]], dict[str, int]]:
    candidates = build_candidates(
        read_jsonl(quality_path),
        read_jsonl(balanced_path),
        natural_min_chars,
        rng,
    )
    selected = select_rows(candidates, quotas, rng)
    return selected, {category: len(rows) for category, rows in candidates.items()}


def main() -> None:
    args = parse_args()
    train_rng = random.Random(args.seed)
    eval_rng = random.Random(args.seed + 1)

    train_rows, train_candidates = build_split(
        Path(args.quality_train),
        Path(args.balanced_train),
        TRAIN_QUOTAS,
        args.natural_min_chars,
        train_rng,
    )
    eval_rows, eval_candidates = build_split(
        Path(args.quality_eval),
        Path(args.balanced_eval),
        EVAL_QUOTAS,
        args.natural_min_chars,
        eval_rng,
    )

    write_jsonl(Path(args.train_output), train_rows)
    write_jsonl(Path(args.eval_output), eval_rows)
    report = {
        "seed": args.seed,
        "natural_min_chars": args.natural_min_chars,
        "train_quotas": TRAIN_QUOTAS,
        "eval_quotas": EVAL_QUOTAS,
        "train_candidate_counts": train_candidates,
        "eval_candidate_counts": eval_candidates,
        "train": summarize(train_rows),
        "eval": summarize(eval_rows),
        "design": {
            "adapter_continuation": "Continue checkpoint-1050 with a fresh optimizer.",
            "mode_conditioning": (
                "Long targets use 30% detailed label, 20% standard label, and 50% natural prompts. "
                "This weakens the old standard=short and detailed=long shortcut."
            ),
            "loss_scope": (
                "Use last_round so short intermediate summaries provide context but are not optimized as targets."
            ),
        },
    }
    report_path = Path(args.report)
    report_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
