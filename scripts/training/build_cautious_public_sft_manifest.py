#!/usr/bin/env python3
"""Build a source-isolated public Chinese multimodal SFT mixture."""

from __future__ import annotations

import argparse
import hashlib
import json
import random
import re
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any, Iterable


MODE_RE = re.compile(r"【回答模式|/(?:explain|think)\b", re.IGNORECASE)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--data-root", default="/mnt/data/tianyi/MLLM_Assistant/datasets")
    parser.add_argument("--train-output", required=True)
    parser.add_argument("--eval-output", required=True)
    parser.add_argument("--regression-output", required=True)
    parser.add_argument("--report", required=True)
    parser.add_argument("--seed", type=int, default=20260615)
    return parser.parse_args()


def read_jsonl(path: Path) -> Iterable[dict[str, Any]]:
    with path.open("r", encoding="utf-8") as handle:
        for line in handle:
            if line.strip():
                yield json.loads(line)


def write_jsonl(path: Path, rows: list[dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_name(f".{path.name}.tmp")
    with temp.open("w", encoding="utf-8") as handle:
        for row in rows:
            handle.write(json.dumps(row, ensure_ascii=False) + "\n")
    temp.replace(path)


def stable_bucket(value: str, modulo: int = 1000) -> int:
    digest = hashlib.sha256(value.encode("utf-8")).hexdigest()
    return int(digest[:12], 16) % modulo


def clean_text(value: Any) -> str:
    return re.sub(r"\s+", " ", str(value or "")).strip()


def dureader_tokens_to_text(tokens: list[Any]) -> str:
    text = "".join(str(token) for token in tokens).replace("▁", " ")
    return re.sub(r"\s+", " ", text).strip()


def percentile(values: list[int], ratio: float) -> int:
    if not values:
        return 0
    ordered = sorted(values)
    return ordered[min(len(ordered) - 1, int((len(ordered) - 1) * ratio))]


def row_text(row: dict[str, Any]) -> str:
    return "\n".join(clean_text(message.get("content")) for message in row.get("messages", []))


def add_metadata(
    row: dict[str, Any],
    *,
    source: str,
    dataset: str,
    source_id: str,
    source_url: str,
    license_name: str,
    split_group: str,
) -> dict[str, Any]:
    row.update(
        {
            "source": source,
            "dataset": dataset,
            "source_id": source_id,
            "source_url": source_url,
            "license": license_name,
            "public_data": True,
            "split_group": split_group,
        }
    )
    return row


def xfund_pairs(document: dict[str, Any]) -> list[tuple[str, str]]:
    elements = document["document"]
    by_id = {int(item["id"]): item for item in elements}
    pairs: list[tuple[str, str]] = []
    seen: set[tuple[str, str]] = set()
    for item in elements:
        if item.get("label") != "question":
            continue
        question = clean_text(item.get("text")).strip(":：")
        answers: list[tuple[int, str]] = []
        for link in item.get("linking", []):
            if not isinstance(link, list) or len(link) != 2:
                continue
            other_id = int(link[1] if int(link[0]) == int(item["id"]) else link[0])
            other = by_id.get(other_id)
            if other and other.get("label") == "answer":
                text = clean_text(other.get("text"))
                if text:
                    answers.append((other_id, text))
        answer = " ".join(text for _, text in sorted(set(answers)))
        if not question or not answer or len(question) > 80 or len(answer) > 300:
            continue
        pair = (question, answer)
        if pair not in seen:
            seen.add(pair)
            pairs.append(pair)
    return pairs


def xfund_ocr_text(document: dict[str, Any]) -> str:
    ordered = sorted(
        document["document"],
        key=lambda item: (
            int(item.get("box", [0, 0, 0, 0])[1]),
            int(item.get("box", [0, 0, 0, 0])[0]),
            int(item.get("id", 0)),
        ),
    )
    return "\n".join(clean_text(item.get("text")) for item in ordered if clean_text(item.get("text")))


def relevant_ocr_excerpt(ocr_text: str, answer: str, max_chars: int = 2600) -> str | None:
    if answer not in ocr_text:
        return None
    if len(ocr_text) <= max_chars:
        return ocr_text
    position = ocr_text.find(answer)
    before = max(0, position - max_chars // 2)
    after = min(len(ocr_text), before + max_chars)
    before = max(0, after - max_chars)
    excerpt = ocr_text[before:after].strip()
    if answer not in excerpt:
        return None
    prefix = "……\n" if before > 0 else ""
    suffix = "\n……" if after < len(ocr_text) else ""
    return f"{prefix}{excerpt}{suffix}"


def build_xfund_rows(
    json_path: Path,
    image_dir: Path,
    split_name: str,
    seed: int,
) -> list[dict[str, Any]]:
    payload = json.loads(json_path.read_text(encoding="utf-8"))
    rows: list[dict[str, Any]] = []
    prompts = [
        "请读取这张中文文档图片，回答字段“{question}”对应的内容，并指出判断所依据的字段关系。",
        "文档中的“{question}”填写了什么？请依据页面可见文字作答。",
        "请从图片中定位“{question}”这一项，给出其对应值并简要说明版面依据。",
        "阅读该表单后，说明“{question}”对应的具体内容。不要补充页面之外的信息。",
    ]
    for document in payload["documents"]:
        doc_id = str(document["id"])
        image_path = image_dir / document["img"]["fname"]
        if not image_path.is_file():
            raise FileNotFoundError(image_path)
        pairs = xfund_pairs(document)
        if not pairs:
            continue
        local_rng = random.Random(seed + stable_bucket(doc_id, 1_000_000))
        local_rng.shuffle(pairs)
        selected = pairs[:6]
        group = f"xfund:{doc_id}"
        ocr_text = xfund_ocr_text(document)

        for index, (question, answer) in enumerate(selected[:4]):
            prompt = prompts[stable_bucket(f"{doc_id}:{index}") % len(prompts)].format(question=question)
            response = (
                f"“{question}”对应的内容是“{answer}”。"
                "依据是该字段标签与页面中相连或紧邻的填写内容之间的版面关系。"
            )
            row = {"messages": [{"role": "user", "content": f"<image>{prompt}"}, {"role": "assistant", "content": response}], "images": [str(image_path)]}
            rows.append(
                add_metadata(
                    row,
                    source=f"xfund-zh-{split_name}-field",
                    dataset="XFUND",
                    source_id=f"{doc_id}:field:{index}",
                    source_url="https://github.com/doc-analysis/XFUND",
                    license_name="CC-BY-NC-SA-4.0",
                    split_group=group,
                )
            )

        for index, (question, answer) in enumerate(selected[:3]):
            excerpt = relevant_ocr_excerpt(ocr_text, answer)
            if excerpt is None:
                continue
            ocr_prompt = (
                "以下是文档助手从一页中文文档中取得的 OCR 文本。"
                "OCR 可能保留了换行或少量识别噪声，请只依据文本回答问题；"
                f"如果依据不足要明确说明。\n\n[OCR 文本]\n{excerpt}\n\n[问题]\n“{question}”对应什么内容？"
            )
            ocr_response = (
                f"根据 OCR 文本，“{question}”对应“{answer}”。"
                "该结论来自字段名称与相邻内容的直接对应；没有使用文本之外的信息。"
            )
            ocr_row = {
                "messages": [
                    {"role": "user", "content": ocr_prompt},
                    {"role": "assistant", "content": ocr_response},
                ]
            }
            rows.append(
                add_metadata(
                    ocr_row,
                    source=f"xfund-zh-{split_name}-ocr-text-field",
                    dataset="XFUND",
                    source_id=f"{doc_id}:ocr-field:{index}",
                    source_url="https://github.com/doc-analysis/XFUND",
                    license_name="CC-BY-NC-SA-4.0",
                    split_group=group,
                )
            )

        summary_pairs = selected[: min(6, len(selected))]
        bullets = "\n".join(f"- {question}：{answer}" for question, answer in summary_pairs)
        summary = (
            "这份文档中能够明确读取的主要字段如下：\n"
            f"{bullets}\n"
            "以上内容均来自页面中可见的字段标签及其对应填写项；无法从图片确认的信息不作推断。"
        )
        summary_row = {
            "messages": [
                {
                    "role": "user",
                    "content": "<image>请提取并解释这份中文文档中的主要字段，按清晰的条目组织，并严格依据页面可见内容。",
                },
                {"role": "assistant", "content": summary},
            ],
            "images": [str(image_path)],
        }
        rows.append(
            add_metadata(
                summary_row,
                source=f"xfund-zh-{split_name}-summary",
                dataset="XFUND",
                source_id=f"{doc_id}:summary",
                source_url="https://github.com/doc-analysis/XFUND",
                license_name="CC-BY-NC-SA-4.0",
                split_group=group,
            )
        )

        summary_answer_values = [answer for _, answer in summary_pairs]
        if all(answer in ocr_text for answer in summary_answer_values):
            summary_excerpt = ocr_text if len(ocr_text) <= 2800 else None
            if summary_excerpt is not None:
                ocr_summary_row = {
                    "messages": [
                        {
                            "role": "user",
                            "content": (
                                "下面是中文文档的 OCR 文本。请整理其中可以明确确认的主要字段，"
                                "区分字段名称与对应值，不要补写原文没有的信息。\n\n"
                                f"[OCR 文本]\n{summary_excerpt}"
                            ),
                        },
                        {"role": "assistant", "content": summary},
                    ]
                }
                rows.append(
                    add_metadata(
                        ocr_summary_row,
                        source=f"xfund-zh-{split_name}-ocr-text-summary",
                        dataset="XFUND",
                        source_id=f"{doc_id}:ocr-summary",
                        source_url="https://github.com/doc-analysis/XFUND",
                        license_name="CC-BY-NC-SA-4.0",
                        split_group=group,
                    )
                )

        if len(selected) >= 3:
            first = selected[:2]
            follow_question, follow_answer = selected[2]
            context = "；".join(f"{question}为“{answer}”" for question, answer in first)
            multi_row = {
                "messages": [
                    {
                        "role": "user",
                        "content": "<image>先概括这张表单中两项可以明确识别的关键信息。",
                    },
                    {"role": "assistant", "content": f"可以明确识别的信息包括：{context}。"},
                    {
                        "role": "user",
                        "content": f"继续查看同一张文档，“{follow_question}”对应什么？请说明可见依据。",
                    },
                    {
                        "role": "assistant",
                        "content": (
                            f"“{follow_question}”对应“{follow_answer}”。"
                            "这是根据该字段标签与其相连或相邻的填写内容确定的。"
                        ),
                    },
                ],
                "images": [str(image_path)],
            }
            rows.append(
                add_metadata(
                    multi_row,
                    source=f"xfund-zh-{split_name}-multiturn",
                    dataset="XFUND",
                    source_id=f"{doc_id}:multiturn",
                    source_url="https://github.com/doc-analysis/XFUND",
                    license_name="CC-BY-NC-SA-4.0",
                    split_group=group,
                )
            )
    return rows


def load_coco_cn(base: Path) -> tuple[dict[str, list[str]], dict[str, list[str]], dict[str, str]]:
    captions: dict[str, list[str]] = defaultdict(list)
    tags: dict[str, list[str]] = defaultdict(list)
    for line in (base / "imageid.human-written-caption.txt").read_text(encoding="utf-8").splitlines():
        key, caption = line.split("\t", 1)
        captions[key.split("#", 1)[0]].append(clean_text(caption))
    for line in (base / "imageid.human-written-tags.txt").read_text(encoding="utf-8").splitlines():
        key, tag_text = line.split(" ", 1)
        tags[key].extend(clean_text(tag_text).split())
    official_split: dict[str, str] = {}
    for split in ("train", "val", "test"):
        for key in (base / f"coco-cn_{split}.txt").read_text(encoding="utf-8").splitlines():
            official_split[clean_text(key)] = split
    return captions, tags, official_split


def build_coco_cn_rows(
    annotation_dir: Path,
    image_dir: Path,
) -> dict[str, list[dict[str, Any]]]:
    captions, tags, official_split = load_coco_cn(annotation_dir)
    image_paths = {path.stem: path for path in image_dir.glob("*.jpg")}
    rows: dict[str, list[dict[str, Any]]] = defaultdict(list)
    prompts = [
        "请用自然中文准确描述这张图片中直接可见的主体、动作和场景。",
        "请为看不到图片的人写一段忠实的中文说明，不要添加无法确认的细节。",
        "这张图片展示了什么？请依据画面可见内容作答。",
        "请概括图片里的主要对象及其活动，回答保持准确、自然。",
    ]
    for coco_key, caption_list in captions.items():
        numeric_id = coco_key.rsplit("_", 1)[-1]
        image_path = image_paths.get(numeric_id)
        split = official_split.get(coco_key)
        if image_path is None or split is None:
            continue
        caption = max(set(caption_list), key=lambda value: (len(value), value))
        if not caption:
            continue
        prompt = prompts[stable_bucket(coco_key) % len(prompts)]
        row = {
            "messages": [
                {"role": "user", "content": f"<image>{prompt}"},
                {"role": "assistant", "content": caption},
            ],
            "images": [str(image_path)],
            "human_tags": sorted(set(tags.get(coco_key, []))),
        }
        rows[split].append(
            add_metadata(
                row,
                source=f"coco-cn-human-{split}",
                dataset="COCO-CN",
                source_id=coco_key,
                source_url="https://github.com/li-xirong/coco-cn",
                license_name="COCO-CN annotations; MS COCO image terms",
                split_group=f"coco:{numeric_id}",
            )
        )
    for split_rows in rows.values():
        split_rows.sort(key=lambda row: stable_bucket(str(row["source_id"]), 10_000_000))
    return rows


def dureader_answer_items(row: dict[str, Any], document_text: str) -> list[str]:
    answers = [clean_text(answer) for answer in row.get("answer") or []]
    answers = [answer for answer in answers if answer and answer in document_text and len(answer) <= 500]
    seen: set[str] = set()
    output: list[str] = []
    for answer in answers:
        if answer not in seen:
            seen.add(answer)
            output.append(answer)
    return output


def dureader_excerpt(document_text: str, answer_items: list[str], max_chars: int = 3000) -> str | None:
    if not answer_items:
        return None
    if len(document_text) <= max_chars:
        return document_text
    positions = [document_text.find(answer) for answer in answer_items if answer in document_text]
    positions = [position for position in positions if position >= 0]
    if not positions:
        return None
    center = positions[0]
    before = max(0, center - max_chars // 2)
    after = min(len(document_text), before + max_chars)
    before = max(0, after - max_chars)
    excerpt = document_text[before:after].strip()
    if not any(answer in excerpt for answer in answer_items):
        return None
    prefix = "…… " if before > 0 else ""
    suffix = " ……" if after < len(document_text) else ""
    return f"{prefix}{excerpt}{suffix}"


def build_dureader_response(row: dict[str, Any], items: list[str]) -> str:
    answer_type = str(row.get("answer_type", "text"))
    question = clean_text(row.get("question"))
    if answer_type == "text" or len(items) == 1:
        return (
            f"根据 OCR 文本，问题“{question}”的答案是：{items[0]}。"
            "这个结论来自 OCR 中与问题相关的连续文本片段；没有使用页面外的信息。"
        )
    title = "表格中可确认的相关内容" if answer_type == "table" else "OCR 文本中可确认的相关条目"
    bullets = "\n".join(f"- {item}" for item in items[:10])
    return (
        f"根据 OCR 文本，{title}如下：\n{bullets}\n"
        "以上条目均能在 OCR 文本中找到；对于截断片段外或无法确认的内容，不作额外补充。"
    )


def build_dureader_rows(json_path: Path, split_name: str, limit: int, seed: int) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    candidates: list[dict[str, Any]] = []
    with json_path.open("r", encoding="utf-8") as handle:
        for line in handle:
            if not line.strip():
                continue
            row = json.loads(line)
            document_text = dureader_tokens_to_text(row.get("document") or [])
            if not (500 <= len(document_text) <= 7000):
                continue
            items = dureader_answer_items(row, document_text)
            answer_type = str(row.get("answer_type", "text"))
            min_items = 1 if answer_type == "text" else 2
            if len(items) < min_items:
                continue
            excerpt = dureader_excerpt(document_text, items)
            if excerpt is None:
                continue
            visible_items = [item for item in items if item in excerpt]
            if len(visible_items) < min_items:
                continue
            copied = dict(row)
            copied["_excerpt"] = excerpt
            copied["_items"] = visible_items
            copied["_score"] = (
                min(len(visible_items), 8),
                -abs(len(excerpt) - 2200),
                -stable_bucket(str(row.get("id")), 10_000_000),
            )
            candidates.append(copied)

    by_type: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for row in candidates:
        by_type[str(row.get("answer_type", "text"))].append(row)
    per_type_limit = max(1, limit // 3)
    selected: list[dict[str, Any]] = []
    rng = random.Random(seed + stable_bucket(split_name, 1_000_000))
    for answer_type in ("text", "table", "list"):
        typed = by_type.get(answer_type, [])
        typed.sort(key=lambda row: row["_score"], reverse=True)
        pool = typed[: max(per_type_limit * 4, per_type_limit)]
        rng.shuffle(pool)
        selected.extend(pool[:per_type_limit])
    if len(selected) < limit:
        remaining_ids = {row["id"] for row in selected}
        remaining = [row for row in candidates if row.get("id") not in remaining_ids]
        remaining.sort(key=lambda row: row["_score"], reverse=True)
        selected.extend(remaining[: limit - len(selected)])
    selected = selected[:limit]

    prompts = [
        "下面是文档 OCR 文本。请只依据 OCR 内容回答问题，并在答案后说明依据是否来自文本中的直接片段。",
        "请把以下 OCR 文本当作唯一材料，回答后面的问题；不要补写原文没有的信息。",
        "文档助手已经提取出 OCR 文本。请根据这些文字完成问答，注意处理可能存在的识别噪声。",
    ]
    selected.sort(key=lambda row: stable_bucket(str(row.get("id")), 10_000_000))
    for index, row in enumerate(selected):
        question = clean_text(row.get("question"))
        prompt = prompts[index % len(prompts)]
        user = f"{prompt}\n\n[OCR 文本]\n{row['_excerpt']}\n\n[问题]\n{question}"
        sft_row = {
            "messages": [
                {"role": "user", "content": user},
                {"role": "assistant", "content": build_dureader_response(row, row["_items"])},
            ],
        }
        rows.append(
            add_metadata(
                sft_row,
                source=f"dureader-vis-ocr-{split_name}-{row.get('answer_type', 'text')}",
                dataset="DuReader-vis",
                source_id=str(row["id"]),
                source_url=str(row.get("url") or "https://github.com/baidu/DuReader/tree/master/DuReader-vis"),
                license_name="Apache-2.0",
                split_group=f"dureader-vis:{row.get('image_id') or row['id']}",
            )
        )
    return rows


def sanitize_replay_row(row: dict[str, Any], source_prefix: str) -> dict[str, Any] | None:
    copied = json.loads(json.dumps(row, ensure_ascii=False))
    for message in copied.get("messages", []):
        content = clean_text(message.get("content"))
        content = content.replace("答案尽量简洁。", "")
        content = content.replace("请用中文简要描述这张图片。", "请用自然中文准确描述这张图片。")
        message["content"] = content
    if MODE_RE.search(row_text(copied)):
        return None
    images = [str(path) for path in copied.get("images", [])]
    if any(not Path(path).is_file() for path in images):
        return None
    source_id = str(copied.get("source_id") or (Path(images[0]).stem if images else stable_bucket(row_text(copied), 10**12)))
    original_source = str(copied.get("source", "unknown"))
    copied["source"] = f"{source_prefix}:{original_source}"
    copied["source_id"] = source_id
    if original_source == "sharegpt4v-coco-zh":
        copied["split_group"] = f"coco:{source_id}"
    else:
        copied["split_group"] = f"replay:{source_prefix}:{source_id}"
    copied["public_data"] = True
    return copied


def select_group_split(
    rows: Iterable[dict[str, Any]],
    *,
    train_limit: int,
    eval_limit: int,
    excluded_groups: set[str] | None = None,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    excluded_groups = excluded_groups or set()
    candidates = [
        row
        for row in rows
        if row.get("split_group") not in excluded_groups and not MODE_RE.search(row_text(row))
    ]
    candidates.sort(key=lambda row: stable_bucket(str(row["split_group"]), 10_000_000))
    train: list[dict[str, Any]] = []
    eval_rows: list[dict[str, Any]] = []
    train_groups: set[str] = set()
    eval_groups: set[str] = set()
    for row in candidates:
        group = str(row["split_group"])
        bucket = stable_bucket(group)
        target = eval_rows if bucket >= 900 else train
        target_groups = eval_groups if bucket >= 900 else train_groups
        limit = eval_limit if bucket >= 900 else train_limit
        if len(target) >= limit:
            continue
        target.append(row)
        target_groups.add(group)
    return train, eval_rows


def validate_splits(
    train: list[dict[str, Any]],
    eval_rows: list[dict[str, Any]],
    regression: list[dict[str, Any]],
) -> dict[str, Any]:
    splits = {"train": train, "eval": eval_rows, "regression": regression}
    groups = {name: {str(row["split_group"]) for row in rows} for name, rows in splits.items()}
    overlaps = {
        "train_eval": sorted(groups["train"] & groups["eval"]),
        "train_regression": sorted(groups["train"] & groups["regression"]),
        "eval_regression": sorted(groups["eval"] & groups["regression"]),
    }
    if any(overlaps.values()):
        raise ValueError(f"Split group leakage detected: {overlaps}")

    report: dict[str, Any] = {"overlaps": {key: len(value) for key, value in overlaps.items()}}
    for split, rows in splits.items():
        marker_rows = [row.get("source_id") for row in rows if MODE_RE.search(row_text(row))]
        missing_images = [
            path
            for row in rows
            for path in row.get("images", [])
            if not Path(path).is_file()
        ]
        if marker_rows:
            raise ValueError(f"Mode markers found in {split}: {marker_rows[:5]}")
        if missing_images:
            raise FileNotFoundError(f"Missing images in {split}: {missing_images[:5]}")
        answer_lengths = [
            len(clean_text(message.get("content")))
            for row in rows
            for message in row.get("messages", [])
            if message.get("role") == "assistant"
        ]
        report[split] = {
            "rows": len(rows),
            "sources": dict(Counter(str(row["source"]) for row in rows)),
            "datasets": dict(Counter(str(row.get("dataset", "unknown")) for row in rows)),
            "assistant_chars_p50": percentile(answer_lengths, 0.50),
            "assistant_chars_p90": percentile(answer_lengths, 0.90),
            "assistant_chars_max": max(answer_lengths, default=0),
            "mode_marker_rows": 0,
            "missing_images": 0,
        }
    return report


def main() -> None:
    args = parse_args()
    root = Path(args.data_root)
    authoritative = root / "public-authoritative-sources"
    xfund_root = authoritative / "XFUND"
    coco_root = authoritative / "COCO-CN" / "extracted" / "coco-cn-version1805v1.1"
    coco_images = root / "public-quality-sources" / "coco" / "train2017"

    xfund_train_all = build_xfund_rows(
        xfund_root / "zh.train.json",
        xfund_root / "train-images",
        "train",
        args.seed,
    )
    xfund_train, xfund_eval = select_group_split(
        xfund_train_all,
        train_limit=1200,
        eval_limit=180,
    )
    xfund_regression = build_xfund_rows(
        xfund_root / "zh.val.json",
        xfund_root / "val-images",
        "official-val",
        args.seed,
    )

    coco = build_coco_cn_rows(coco_root, coco_images)
    coco_train = coco["train"][:1000]
    coco_eval = coco["val"][:120]
    coco_regression = coco["test"][:200]
    used_coco_groups = {
        str(row["split_group"])
        for row in coco_train + coco_eval + coco_regression
    }

    quality_rows = []
    for row in read_jsonl(root / "public_quality_curated.jsonl"):
        if row.get("source") not in {"sharegpt4v-coco-zh", "wikimedia-wikipedia-zh"}:
            continue
        sanitized = sanitize_replay_row(row, "capability-replay")
        if sanitized is not None:
            quality_rows.append(sanitized)
    detailed = [row for row in quality_rows if row.get("quality_category") == "detailed_multimodal"]
    long_form = [row for row in quality_rows if row.get("quality_category") == "long_form"]
    detailed_train, detailed_eval = select_group_split(
        detailed,
        train_limit=900,
        eval_limit=80,
        excluded_groups=used_coco_groups,
    )
    long_train, long_eval = select_group_split(long_form, train_limit=600, eval_limit=60)

    document_replay = []
    for row in read_jsonl(root / "qwen_vl_train.jsonl"):
        if row.get("source") not in {"docvqa", "chartqa"}:
            continue
        sanitized = sanitize_replay_row(row, "capability-replay")
        if sanitized is not None:
            sanitized.setdefault("dataset", "DocVQA" if row.get("source") == "docvqa" else "ChartQA")
            sanitized.setdefault("source_url", "https://huggingface.co/datasets/lmms-lab/DocVQA" if row.get("source") == "docvqa" else "https://huggingface.co/datasets/HuggingFaceM4/ChartQA")
            sanitized.setdefault("license", "public benchmark; retain upstream terms")
            document_replay.append(sanitized)
    doc_train, doc_eval = select_group_split(document_replay, train_limit=700, eval_limit=80)

    dureader_root = authoritative / "DuReader-vis" / "extracted" / "dureader_vis_docvqa"
    train_json = dureader_root / "docvqa_train.json"
    dev_json = dureader_root / "docvqa_dev.json"
    if not train_json.is_file() or not dev_json.is_file():
        raise FileNotFoundError(
            "DuReader-vis DocVQA JSON files are required for this cautious OCR-aware mixture. "
            "Download and extract the official dureader_vis_docvqa.tar.gz first."
        )
    dureader_train_all = build_dureader_rows(train_json, "train", 1500, args.seed)
    dureader_train, dureader_eval = select_group_split(dureader_train_all, train_limit=1350, eval_limit=150)
    dureader_regression = build_dureader_rows(dev_json, "official-dev", 300, args.seed + 17)

    train = xfund_train + dureader_train + coco_train + detailed_train + long_train + doc_train
    eval_rows = xfund_eval + dureader_eval + coco_eval + detailed_eval + long_eval + doc_eval
    regression = xfund_regression + dureader_regression + coco_regression
    random.Random(args.seed).shuffle(train)
    random.Random(args.seed + 1).shuffle(eval_rows)
    random.Random(args.seed + 2).shuffle(regression)

    report = validate_splits(train, eval_rows, regression)
    report["design"] = {
        "seed": args.seed,
        "vision_encoder_training": False,
        "mode_tokens_added": False,
        "split_policy": "XFUND document IDs and official val; COCO-CN official splits; replay stable source groups",
        "requires_dureader_vis": True,
        "dureader_vis_policy": (
            "Use only official DocVQA OCR JSON, require answer spans to appear in the OCR excerpt, "
            "balance text/table/list answers, and keep official dev samples out of training."
        ),
        "excluded_source": {
            "PaperPDF/train_10w.jsonl": "85070 rows but only 44 lines contain Chinese characters",
            "COCO-CN machine translations": "only human-written captions are used",
        },
    }

    write_jsonl(Path(args.train_output), train)
    write_jsonl(Path(args.eval_output), eval_rows)
    write_jsonl(Path(args.regression_output), regression)
    report_path = Path(args.report)
    report_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
