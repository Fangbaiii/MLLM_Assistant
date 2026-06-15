#!/usr/bin/env python3
"""Convert traceable public datasets into quality-first ms-swift records."""

from __future__ import annotations

import argparse
import hashlib
import json
import random
import re
from collections import Counter
from pathlib import Path
from typing import Any, Iterable


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", required=True)
    parser.add_argument("--sharegpt4v-zh", required=True)
    parser.add_argument(
        "--wikipedia-parquet",
        default="",
        help="Defaults to ROOT/wikimedia-wikipedia/20231101.zh-0000.parquet.",
    )
    parser.add_argument("--output", required=True)
    parser.add_argument("--report", required=True)
    parser.add_argument("--detailed-limit", type=int, default=7000)
    parser.add_argument("--multi-turn-limit", type=int, default=6000)
    parser.add_argument("--long-form-limit", type=int, default=3200)
    parser.add_argument("--seed", type=int, default=42)
    return parser.parse_args()


def normalize(value: Any) -> str:
    return re.sub(r"\s+", " ", str(value or "")).strip()


def repeated_ngram_ratio(text: str, n: int = 4) -> float:
    chars = [char for char in normalize(text) if not char.isspace()]
    if len(chars) < n:
        return 0.0
    grams = [tuple(chars[index : index + n]) for index in range(len(chars) - n + 1)]
    return 1.0 - len(set(grams)) / len(grams)


def record_key(row: dict[str, Any]) -> str:
    payload = {
        "messages": row.get("messages", []),
        "images": row.get("images", []),
    }
    return hashlib.sha1(
        json.dumps(payload, ensure_ascii=False, sort_keys=True).encode("utf-8")
    ).hexdigest()


def read_jsonl(path: Path) -> Iterable[dict[str, Any]]:
    with path.open("r", encoding="utf-8") as handle:
        for line_number, line in enumerate(handle, 1):
            if not line.strip():
                continue
            row = json.loads(line)
            if not isinstance(row, dict):
                raise ValueError(f"{path}:{line_number} is not an object")
            yield row


def valid_message_record(row: dict[str, Any]) -> bool:
    messages = row.get("messages", [])
    if len(messages) != 2:
        return False
    answer = normalize(messages[-1].get("content"))
    images = [Path(str(path)) for path in row.get("images", [])]
    return (
        messages[0].get("role") == "user"
        and messages[-1].get("role") == "assistant"
        and 150 <= len(answer) <= 650
        and repeated_ngram_ratio(answer) <= 0.10
        and len(images) == 1
        and images[0].is_file()
        and bool(row.get("source_id"))
        and bool(row.get("license"))
    )


def load_detailed(path: Path, limit: int, rng: random.Random) -> tuple[list[dict[str, Any]], Counter]:
    rejected = Counter()
    rows: list[dict[str, Any]] = []
    for row in read_jsonl(path):
        if not valid_message_record(row):
            rejected["invalid_detailed"] += 1
            continue
        row["public_data"] = True
        row["quality_category"] = "detailed_multimodal"
        rows.append(row)
    rng.shuffle(rows)
    return rows[:limit], rejected


def context_overlap(messages: list[dict[str, str]]) -> float:
    if len(messages) < 4:
        return 0.0
    answer_chars = set(normalize(messages[-1]["content"]))
    history_chars = set(normalize(" ".join(item["content"] for item in messages[:-1])))
    answer_chars.discard(" ")
    return len(answer_chars & history_chars) / max(1, len(answer_chars))


def load_kdconv(root: Path, limit: int, rng: random.Random) -> tuple[list[dict[str, Any]], Counter]:
    rejected = Counter()
    candidates: list[dict[str, Any]] = []
    for domain in ("film", "music", "travel"):
        for split in ("train", "dev", "test"):
            path = root / "kdconv" / "data" / domain / f"{split}.json"
            conversations = json.loads(path.read_text(encoding="utf-8"))
            for dialog_index, conversation in enumerate(conversations):
                turns = conversation.get("messages", [])
                converted: list[dict[str, str]] = []
                dialogue_candidates: list[tuple[float, dict[str, Any]]] = []
                for turn_index, turn in enumerate(turns):
                    text = normalize(turn.get("message"))
                    if not text:
                        continue
                    role = "user" if turn_index % 2 == 0 else "assistant"
                    converted.append({"role": role, "content": text})
                    if role != "assistant" or len(converted) < 8:
                        continue
                    answer = text
                    attrs = turn.get("attrs") or []
                    if len(answer) < 25:
                        rejected["short_kdconv_answer"] += 1
                        continue
                    if not attrs and context_overlap(converted) < 0.20:
                        rejected["weak_context_dependency"] += 1
                        continue
                    context = converted[-16:]
                    score = min(len(answer), 120) + min(len(attrs), 3) * 30 + len(context)
                    dialogue_candidates.append(
                        (
                            score,
                            {
                                "messages": [dict(message) for message in context],
                                "source": f"kdconv-{domain}",
                                "dataset": "thu-coai/KdConv",
                                "source_id": f"{domain}:{split}:{dialog_index}:{turn_index}",
                                "source_url": "https://github.com/thu-coai/KdConv",
                                "license": "Apache-2.0",
                                "public_data": True,
                                "quality_category": "multi_turn",
                                "grounding_attrs": attrs,
                                "split_hint": "train" if split == "train" else "eval",
                                "prefix_sample": True,
                            },
                        )
                    )
                per_dialogue = 3 if split == "train" else 1
                dialogue_candidates.sort(key=lambda item: item[0], reverse=True)
                candidates.extend(record for _, record in dialogue_candidates[:per_dialogue])
    rng.shuffle(candidates)
    return candidates[:limit], rejected


def coig_files(root: Path) -> list[tuple[str, Path]]:
    base = root / "coig-cqia"
    return [
        ("wikihow", base / "wikihow.jsonl"),
        ("zgbk", base / "zgbk.jsonl"),
        ("zhihu-score9", base / "zhihu_score9.jsonl"),
    ]


def audit_coig(root: Path) -> Counter:
    rejected = Counter()
    for _, path in coig_files(root):
        for row in read_jsonl(path):
            copyright_value = normalize(row.get("copyright"))
            if (
                not copyright_value
                or "暂无版权" in copyright_value
                or "暂无作者" in copyright_value
                or copyright_value.lower() in {"unknown", "none", "null"}
            ):
                rejected["missing_copyright"] += 1
            else:
                rejected["usable_copyright"] += 1
    return rejected


def chinese_ratio(text: str) -> float:
    content = [char for char in text if char.isalnum()]
    if not content:
        return 0.0
    return sum("\u3400" <= char <= "\u9fff" for char in content) / len(content)


def sentence_bounded_excerpt(text: str, minimum: int = 500, maximum: int = 1500) -> str:
    cleaned = normalize(text)
    if len(cleaned) <= maximum:
        return cleaned
    candidate = cleaned[:maximum]
    boundaries = [candidate.rfind(mark) for mark in ("。", "！", "？", "；")]
    boundary = max(boundaries)
    if boundary + 1 >= minimum:
        return candidate[: boundary + 1]
    return ""


def load_wikipedia(path: Path, limit: int, rng: random.Random) -> tuple[list[dict[str, Any]], Counter]:
    try:
        import pyarrow.parquet as parquet
    except ImportError as exc:
        raise RuntimeError("pyarrow is required to read the Wikimedia Parquet source.") from exc

    rejected = Counter()
    candidates: list[dict[str, Any]] = []
    prompts = (
        "请详细介绍《{title}》，说明其核心概念、背景和主要内容。",
        "请围绕《{title}》写一份信息充分、结构清楚的中文说明。",
        "我想系统了解《{title}》，请给出完整而具体的介绍。",
    )
    parquet_file = parquet.ParquetFile(path)
    source_index = 0
    for batch in parquet_file.iter_batches(batch_size=2048, columns=["id", "url", "title", "text"]):
        for row in batch.to_pylist():
            source_index += 1
            title = normalize(row.get("title"))
            text = normalize(row.get("text"))
            if (
                not title
                or len(title) > 80
                or "消歧义" in title
                or title.startswith(("列表", "索引"))
            ):
                rejected["wikipedia_title"] += 1
                continue
            answer = sentence_bounded_excerpt(text)
            if not (500 <= len(answer) <= 1500):
                rejected["wikipedia_length"] += 1
                continue
            if chinese_ratio(answer) < 0.65:
                rejected["wikipedia_language"] += 1
                continue
            if repeated_ngram_ratio(answer) > 0.10:
                rejected["wikipedia_repetition"] += 1
                continue
            candidates.append(
                {
                    "messages": [
                        {
                            "role": "user",
                            "content": prompts[source_index % len(prompts)].format(title=title),
                        },
                        {"role": "assistant", "content": answer},
                    ],
                    "source": "wikimedia-wikipedia-zh",
                    "dataset": "wikimedia/wikipedia",
                    "source_id": str(row.get("id", source_index)),
                    "source_url": normalize(row.get("url")),
                    "license": "CC-BY-SA-3.0 AND GFDL-1.3",
                    "copyright": "Wikipedia contributors; attribution URL retained in source_url",
                    "public_data": True,
                    "quality_category": "long_form",
                }
            )
            if len(candidates) >= limit * 4:
                break
        if len(candidates) >= limit * 4:
            break
    rng.shuffle(candidates)
    return candidates[:limit], rejected


def write_jsonl(path: Path, rows: list[dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f".{path.name}.tmp")
    with temporary.open("w", encoding="utf-8") as handle:
        for row in rows:
            handle.write(json.dumps(row, ensure_ascii=False) + "\n")
    temporary.replace(path)


def main() -> None:
    args = parse_args()
    root = Path(args.root)
    rng = random.Random(args.seed)
    wikipedia_path = (
        Path(args.wikipedia_parquet)
        if args.wikipedia_parquet
        else root / "wikimedia-wikipedia" / "20231101.zh-0000.parquet"
    )

    detailed, detailed_rejected = load_detailed(Path(args.sharegpt4v_zh), args.detailed_limit, rng)
    multi_turn, multi_rejected = load_kdconv(root, args.multi_turn_limit, rng)
    long_form, long_rejected = load_wikipedia(wikipedia_path, args.long_form_limit, rng)
    coig_audit = audit_coig(root)

    rows = detailed + multi_turn + long_form
    rng.shuffle(rows)
    seen: set[str] = set()
    unique_rows: list[dict[str, Any]] = []
    duplicates = 0
    for row in rows:
        key = record_key(row)
        if key in seen:
            duplicates += 1
            continue
        seen.add(key)
        unique_rows.append(row)

    write_jsonl(Path(args.output), unique_rows)
    report = {
        "rows": len(unique_rows),
        "selected": {
            "detailed_multimodal": len(detailed),
            "multi_turn": len(multi_turn),
            "long_form": len(long_form),
        },
        "rejected": dict(detailed_rejected + multi_rejected + long_rejected),
        "excluded_coig_audit": dict(coig_audit),
        "duplicates": duplicates,
        "sources": {
            "ShareGPT4V": {
                "license": "CC-BY-NC-4.0",
                "url": "https://huggingface.co/datasets/Lin-Chen/ShareGPT4V",
            },
            "KdConv": {
                "license": "Apache-2.0",
                "url": "https://github.com/thu-coai/KdConv",
            },
            "COIG-CQIA": {
                "license": "dataset card unspecified; excluded from formal mix",
                "url": "https://huggingface.co/datasets/m-a-p/COIG-CQIA",
            },
            "Wikimedia Wikipedia": {
                "license": "CC-BY-SA-3.0 and GFDL-1.3",
                "url": "https://huggingface.co/datasets/wikimedia/wikipedia",
            },
        },
    }
    report_path = Path(args.report)
    report_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False, indent=2))

    expected = args.detailed_limit + args.multi_turn_limit + args.long_form_limit
    if len(unique_rows) < expected:
        raise SystemExit(f"Public quality source mix is underfilled: {len(unique_rows)}/{expected}")


if __name__ == "__main__":
    main()
