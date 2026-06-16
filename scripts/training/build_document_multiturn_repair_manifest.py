#!/usr/bin/env python3
"""Build an anti-repetition repair mix for Chinese document and multimodal chat."""

from __future__ import annotations

import argparse
import hashlib
import json
import random
import re
import statistics
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any, Iterable


MODE_PREFIX_RE = re.compile(r"^【回答模式：(简洁|标准|详细)】[^\n]*(?:\n+)?")
SENTENCE_RE = re.compile(r"(?<=[。！？!?；;])")

TRAIN_QUOTAS = {
    "ocr_single": 1300,
    "ocr_composite": 600,
    "ocr_multiturn": 500,
    "multimodal_analysis": 1800,
    "multimodal_multiturn": 800,
    "document_chart_fact": 600,
    "natural_multiturn": 300,
    "concise_replay": 300,
}

EVAL_QUOTAS = {
    "ocr_single": 70,
    "ocr_composite": 30,
    "ocr_multiturn": 30,
    "multimodal_analysis": 100,
    "multimodal_multiturn": 50,
    "document_chart_fact": 80,
    "natural_multiturn": 40,
    "concise_replay": 40,
}

MODE_INSTRUCTIONS = {
    "direct": "请直接给出结构化答案，避免复述问题或整段照抄材料。",
    "explain": "请解释结论与关键依据，保持信息密度，不要重复同一观点。",
    "think": "请先核对证据和约束，再给出结论、依据与不确定性；不要输出隐藏思维链。",
}


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
    return parser.parse_args()


def read_jsonl(path: Path) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    with path.open("r", encoding="utf-8") as handle:
        for line_number, line in enumerate(handle, 1):
            if not line.strip():
                continue
            row = json.loads(line)
            if not isinstance(row, dict):
                raise ValueError(f"{path}:{line_number} is not an object")
            rows.append(row)
    return rows


def write_jsonl(path: Path, rows: Iterable[dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as handle:
        for row in rows:
            handle.write(json.dumps(row, ensure_ascii=False) + "\n")


def normalize(value: Any) -> str:
    return re.sub(r"\s+", " ", str(value or "")).strip()


def strip_mode_prefix(value: Any) -> str:
    return MODE_PREFIX_RE.sub("", str(value or "")).strip()


def clone_messages(row: dict[str, Any]) -> list[dict[str, str]]:
    return [
        {"role": str(message.get("role", "user")), "content": str(message.get("content", ""))}
        for message in row.get("messages", [])
        if isinstance(message, dict)
    ]


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
        "grounding_attrs",
    ):
        if field in source:
            target[field] = source[field]
    if source.get("images"):
        target["images"] = list(source["images"])


def final_answer(row: dict[str, Any]) -> str:
    answers = [
        normalize(message.get("content"))
        for message in row.get("messages", [])
        if isinstance(message, dict) and message.get("role") == "assistant"
    ]
    return answers[-1] if answers else ""


def title_from_row(row: dict[str, Any], fallback: str) -> str:
    messages = clone_messages(row)
    prompt = messages[0]["content"] if messages else ""
    match = re.search(r"《([^》]{1,80})》", prompt)
    return match.group(1).strip() if match else fallback


def unique_sentences(text: str, minimum: int = 18, maximum: int = 220) -> list[str]:
    sentences: list[str] = []
    seen: set[str] = set()
    for raw in SENTENCE_RE.split(normalize(text)):
        sentence = raw.strip(" \t\r\n")
        if len(sentence) < minimum:
            continue
        if len(sentence) > maximum:
            chunks = [
                chunk.strip(" ，,")
                for chunk in re.split(r"(?<=[，,：:])", sentence)
                if len(chunk.strip()) >= minimum
            ]
        else:
            chunks = [sentence]
        for chunk in chunks:
            key = re.sub(r"[\W_]+", "", chunk).lower()
            if not key or key in seen:
                continue
            seen.add(key)
            sentences.append(chunk)
    return sentences


def mode_for_index(index: int) -> str:
    return ("direct", "direct", "explain", "think")[index % 4]


def structured_answer(sentences: list[str], mode: str, title: str) -> str:
    if mode == "direct":
        selected = sentences[:4]
        return "\n".join([f"结论：材料主要围绕“{title}”展开。"] + [f"- {item}" for item in selected])
    if mode == "explain":
        selected = sentences[:6]
        midpoint = max(1, len(selected) // 2)
        return "\n".join(
            [
                f"核心结论：材料围绕“{title}”给出了定义、背景和关键事实。",
                "关键依据：",
                *[f"- {item}" for item in selected[:midpoint]],
                "进一步说明：",
                *[f"- {item}" for item in selected[midpoint:]],
            ]
        )
    selected = sentences[:5]
    return "\n".join(
        [
            f"判断：这段材料的核心主题是“{title}”。",
            "可核对依据：",
            *[f"- {item}" for item in selected],
            "边界：以上结论只依据给定 OCR 文本，不补写材料之外的信息。",
        ]
    )


def make_ocr_single(row: dict[str, Any], index: int) -> dict[str, Any] | None:
    source_text = final_answer(row)
    sentences = unique_sentences(source_text)
    if len(sentences) < 5:
        return None
    mode = mode_for_index(index)
    title = title_from_row(row, f"资料 {index + 1}")
    prompt = (
        f"{MODE_INSTRUCTIONS[mode]}\n\n"
        f"以下是“{title}”相关资料的 OCR 转录。请提炼核心主题、关键事实和必要边界。\n\n"
        f"【OCR 转录开始】\n{source_text}\n【OCR 转录结束】"
    )
    record: dict[str, Any] = {
        "messages": [
            {"role": "user", "content": prompt},
            {"role": "assistant", "content": structured_answer(sentences, mode, title)},
        ],
        "quality_category": "ocr_single",
        "answer_mode": mode,
        "anti_repeat_repair": True,
    }
    copy_metadata(row, record)
    record.pop("images", None)
    return record


def make_ocr_composite(
    first: dict[str, Any],
    second: dict[str, Any],
    index: int,
) -> dict[str, Any] | None:
    first_text = final_answer(first)
    second_text = final_answer(second)
    first_sentences = unique_sentences(first_text)
    second_sentences = unique_sentences(second_text)
    if len(first_sentences) < 4 or len(second_sentences) < 4:
        return None
    first_title = title_from_row(first, "材料 A")
    second_title = title_from_row(second, "材料 B")
    mode = mode_for_index(index + 1)
    prompt = (
        f"{MODE_INSTRUCTIONS[mode]}\n\n"
        "下面混合了两段较长的 OCR 转录。请分别概括，不要把两份材料的事实混在一起，并指出共同点与差异。\n\n"
        f"【材料 A：{first_title}】\n{first_text}\n\n"
        f"【材料 B：{second_title}】\n{second_text}"
    )
    answer = "\n".join(
        [
            f"材料 A（{first_title}）：",
            *[f"- {item}" for item in first_sentences[:3]],
            f"材料 B（{second_title}）：",
            *[f"- {item}" for item in second_sentences[:3]],
            "比较：两份材料主题不同，应分别依据各自转录作答；不能用其中一份的背景替代另一份的证据。",
        ]
    )
    return {
        "messages": [
            {"role": "user", "content": prompt},
            {"role": "assistant", "content": answer},
        ],
        "quality_category": "ocr_composite",
        "answer_mode": mode,
        "anti_repeat_repair": True,
        "source": "quality-long-form-composite",
    }


def make_ocr_multiturn(row: dict[str, Any], index: int) -> dict[str, Any] | None:
    source_text = final_answer(row)
    sentences = unique_sentences(source_text)
    if len(sentences) < 7:
        return None
    title = title_from_row(row, f"资料 {index + 1}")
    mode = mode_for_index(index + 2)
    first_answer = f"这份材料主要讨论“{title}”。" + "".join(sentences[:2])
    final_sentences = sentences[2:7]
    final_answer_text = "\n".join(
        [
            "在不重复上一轮摘要的前提下，新增信息如下：",
            *[f"- {item}" for item in final_sentences],
            "以上内容均来自当前 OCR 转录；材料没有提供的细节不作推断。",
        ]
    )
    record: dict[str, Any] = {
        "messages": [
            {
                "role": "user",
                "content": (
                    f"以下是“{title}”相关资料的 OCR 转录，请先概括主题。\n\n"
                    f"【OCR 转录开始】\n{source_text}\n【OCR 转录结束】"
                ),
            },
            {"role": "assistant", "content": first_answer},
            {
                "role": "user",
                "content": (
                    f"{MODE_INSTRUCTIONS[mode]} 请承接上一轮，补充尚未提到的关键事实、关系和边界。"
                ),
            },
            {"role": "assistant", "content": final_answer_text},
        ],
        "quality_category": "ocr_multiturn",
        "answer_mode": mode,
        "anti_repeat_repair": True,
    }
    copy_metadata(row, record)
    record.pop("images", None)
    return record


def make_multimodal_analysis(row: dict[str, Any], index: int) -> dict[str, Any] | None:
    messages = clone_messages(row)
    if len(messages) != 2 or not row.get("images"):
        return None
    mode = mode_for_index(index)
    prompt = strip_mode_prefix(messages[0]["content"])
    messages[0]["content"] = f"{MODE_INSTRUCTIONS[mode]}\n\n{prompt}"
    answer = normalize(messages[1]["content"])
    if len(answer) < 100:
        return None
    messages[1]["content"] = answer
    record: dict[str, Any] = {
        "messages": messages,
        "quality_category": "multimodal_analysis",
        "answer_mode": mode,
        "anti_repeat_repair": True,
    }
    copy_metadata(row, record)
    return record


def make_multimodal_multiturn(row: dict[str, Any], index: int) -> dict[str, Any] | None:
    messages = clone_messages(row)
    if len(messages) != 2 or not row.get("images"):
        return None
    answer = normalize(messages[1]["content"])
    sentences = unique_sentences(answer, minimum=12, maximum=180)
    if len(sentences) < 3:
        return None
    mode = mode_for_index(index + 1)
    first_answer = sentences[0]
    final_answer_text = "\n".join(
        [
            "补充观察：",
            *[f"- {item}" for item in sentences[1:5]],
            "不确定性：无法从画面直接确认的身份、动机或背景信息不作断言。",
        ]
    )
    record: dict[str, Any] = {
        "messages": [
            {"role": "user", "content": strip_mode_prefix(messages[0]["content"])},
            {"role": "assistant", "content": first_answer},
            {
                "role": "user",
                "content": (
                    f"{MODE_INSTRUCTIONS[mode]} 请补充上一轮没有提到的空间关系、动作、文字线索或显著细节。"
                ),
            },
            {"role": "assistant", "content": final_answer_text},
        ],
        "quality_category": "multimodal_multiturn",
        "answer_mode": mode,
        "anti_repeat_repair": True,
    }
    copy_metadata(row, record)
    return record


def make_document_chart_fact(row: dict[str, Any]) -> dict[str, Any] | None:
    messages = clone_messages(row)
    if len(messages) < 2 or not row.get("images"):
        return None
    if row.get("source") not in {"docvqa-long", "chartqa-long"}:
        return None
    answer = normalize(messages[1]["content"])
    tokens = answer.split()
    normalized_tokens = [re.sub(r"[\W_]+", "", token).lower() for token in tokens]
    for period in range(1, len(tokens) // 2 + 1):
        if normalized_tokens[:period] == normalized_tokens[period : period * 2]:
            answer = " ".join(tokens[:period]).rstrip("，,；;：:。") + "。"
            break
    if not answer or len(answer) > 160:
        return None
    record: dict[str, Any] = {
        "messages": [
            {
                "role": "user",
                "content": (
                    "请直接读取页面中与问题对应的字段、标签或数值后作答；不要复述问题，不要补写页面外的信息。\n\n"
                    f"{strip_mode_prefix(messages[0]['content'])}"
                ),
            },
            {"role": "assistant", "content": answer},
        ],
        "quality_category": "document_chart_fact",
        "answer_mode": "direct",
        "anti_repeat_repair": True,
    }
    copy_metadata(row, record)
    return record


def make_natural_multiturn(row: dict[str, Any]) -> dict[str, Any] | None:
    if row.get("source") != "naturalconv":
        return None
    messages = clone_messages(row)
    if len(messages) < 8 or messages[-1]["role"] != "assistant":
        return None
    messages[-2]["content"] = strip_mode_prefix(messages[-2]["content"])
    record: dict[str, Any] = {
        "messages": messages,
        "quality_category": "natural_multiturn",
        "answer_mode": "direct",
        "anti_repeat_repair": False,
    }
    copy_metadata(row, record)
    return record


def make_concise_replay(row: dict[str, Any]) -> dict[str, Any] | None:
    messages = clone_messages(row)
    if len(messages) != 2:
        return None
    answer = normalize(messages[1]["content"])
    if not answer or len(answer) > 80:
        return None
    messages[0]["content"] = (
        "这是一个简短事实问题，请直接回答，不需要扩写。\n\n"
        f"{strip_mode_prefix(messages[0]['content'])}"
    )
    messages[1]["content"] = answer
    record: dict[str, Any] = {
        "messages": messages,
        "quality_category": "concise_replay",
        "answer_mode": "direct",
        "anti_repeat_repair": False,
    }
    copy_metadata(row, record)
    return record


def take_valid(
    rows: list[dict[str, Any]],
    quota: int,
    builder: Any,
    rng: random.Random,
) -> list[dict[str, Any]]:
    shuffled = list(rows)
    rng.shuffle(shuffled)
    output: list[dict[str, Any]] = []
    for index, row in enumerate(shuffled):
        candidate = builder(row, index)
        if candidate is not None:
            output.append(candidate)
        if len(output) >= quota:
            break
    if len(output) != quota:
        raise ValueError(f"builder {builder.__name__} produced {len(output)} rows, expected {quota}")
    return output


def repeated_ngram_ratio(text: str, n: int = 4) -> float:
    compact = re.sub(r"\s+", "", text)
    if len(compact) < n:
        return 0.0
    grams = [compact[index : index + n] for index in range(len(compact) - n + 1)]
    return 1.0 - len(set(grams)) / len(grams)


def fingerprint(row: dict[str, Any]) -> str:
    payload = json.dumps(row.get("messages", []), ensure_ascii=False, sort_keys=True)
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def build_split(
    quality_rows: list[dict[str, Any]],
    balanced_rows: list[dict[str, Any]],
    quotas: dict[str, int],
    rng: random.Random,
) -> list[dict[str, Any]]:
    long_rows = [row for row in quality_rows if row.get("quality_category") == "long_form"]
    multimodal_rows = [row for row in quality_rows if row.get("quality_category") == "detailed_multimodal"]
    concise_rows = [row for row in quality_rows if row.get("quality_category") == "concise"]
    fact_rows = [row for row in balanced_rows if row.get("source") in {"docvqa-long", "chartqa-long"}]
    natural_rows = [row for row in balanced_rows if row.get("source") == "naturalconv"]

    rng.shuffle(long_rows)
    rng.shuffle(multimodal_rows)
    rng.shuffle(fact_rows)
    rng.shuffle(natural_rows)
    rng.shuffle(concise_rows)

    output: list[dict[str, Any]] = []
    output.extend(take_valid(long_rows, quotas["ocr_single"], make_ocr_single, rng))

    composite_source = long_rows[quotas["ocr_single"] :]
    composite_rows: list[dict[str, Any]] = []
    for index in range(0, len(composite_source) - 1, 2):
        candidate = make_ocr_composite(composite_source[index], composite_source[index + 1], index // 2)
        if candidate is not None:
            composite_rows.append(candidate)
        if len(composite_rows) >= quotas["ocr_composite"]:
            break
    if len(composite_rows) != quotas["ocr_composite"]:
        raise ValueError(f"ocr_composite produced {len(composite_rows)} rows")
    output.extend(composite_rows)

    output.extend(take_valid(long_rows, quotas["ocr_multiturn"], make_ocr_multiturn, rng))
    multimodal_analysis_source = multimodal_rows[: quotas["multimodal_analysis"]]
    remaining_multimodal = multimodal_rows[quotas["multimodal_analysis"] :]
    output.extend(
        take_valid(
            multimodal_analysis_source,
            quotas["multimodal_analysis"],
            make_multimodal_analysis,
            rng,
        )
    )
    output.extend(
        take_valid(
            remaining_multimodal,
            quotas["multimodal_multiturn"],
            make_multimodal_multiturn,
            rng,
        )
    )
    output.extend(take_valid(fact_rows, quotas["document_chart_fact"], lambda row, _index: make_document_chart_fact(row), rng))
    output.extend(take_valid(natural_rows, quotas["natural_multiturn"], lambda row, _index: make_natural_multiturn(row), rng))
    output.extend(take_valid(concise_rows, quotas["concise_replay"], lambda row, _index: make_concise_replay(row), rng))
    rng.shuffle(output)
    return output


def summarize(rows: list[dict[str, Any]]) -> dict[str, Any]:
    category_counts = Counter(str(row.get("quality_category", "unknown")) for row in rows)
    mode_counts = Counter(str(row.get("answer_mode", "unknown")) for row in rows)
    lengths: defaultdict[str, list[int]] = defaultdict(list)
    repeats: defaultdict[str, list[float]] = defaultdict(list)
    for row in rows:
        category = str(row.get("quality_category", "unknown"))
        answer = final_answer(row)
        lengths[category].append(len(answer))
        repeats[category].append(repeated_ngram_ratio(answer))
    return {
        "count": len(rows),
        "category_counts": dict(sorted(category_counts.items())),
        "mode_counts": dict(sorted(mode_counts.items())),
        "categories": {
            category: {
                "count": len(values),
                "answer_chars_mean": round(statistics.mean(values), 2),
                "answer_chars_p50": statistics.median(values),
                "repeat_4gram_mean": round(statistics.mean(repeats[category]), 6),
                "repeat_4gram_max": round(max(repeats[category]), 6),
            }
            for category, values in sorted(lengths.items())
        },
    }


def main() -> None:
    args = parse_args()
    rng = random.Random(args.seed)
    quality_train = read_jsonl(Path(args.quality_train))
    quality_eval = read_jsonl(Path(args.quality_eval))
    balanced_train = read_jsonl(Path(args.balanced_train))
    balanced_eval = read_jsonl(Path(args.balanced_eval))

    train_rows = build_split(quality_train, balanced_train, TRAIN_QUOTAS, rng)
    eval_rows = build_split(quality_eval, balanced_eval, EVAL_QUOTAS, random.Random(args.seed + 1))

    train_fingerprints = {fingerprint(row) for row in train_rows}
    eval_fingerprints = {fingerprint(row) for row in eval_rows}
    overlap = train_fingerprints & eval_fingerprints
    if overlap:
        raise ValueError(f"train/eval overlap detected: {len(overlap)}")

    write_jsonl(Path(args.train_output), train_rows)
    write_jsonl(Path(args.eval_output), eval_rows)
    report = {
        "seed": args.seed,
        "train": summarize(train_rows),
        "eval": summarize(eval_rows),
        "train_eval_overlap": 0,
        "design": {
            "source_adapter": "checkpoint-1050",
            "long_ocr_strategy": "extractive structured synthesis, not raw continuation",
            "mode_strategy": "direct/explain/think natural instructions without fixed length labels",
            "anti_repeat": True,
        },
    }
    Path(args.report).write_text(
        json.dumps(report, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
