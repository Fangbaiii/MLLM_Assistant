#!/usr/bin/env python3
"""Prepare Qwen3-VL LoRA manifests.

Two workflows are supported:
1. Convert a simple local JSONL with image/question/answer fields.
2. Sample public Hugging Face datasets into an ms-swift multimodal JSONL.

The ms-swift format uses string messages plus an `images` list:
  {"messages": [{"role": "user", "content": "<image>..."}, ...], "images": ["/abs/img.png"]}
"""

from __future__ import annotations

import argparse
import base64
import hashlib
import io
import json
import os
import random
import shutil
import sys
import urllib.request
import zipfile
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from typing import Any, Iterable

try:
    from PIL import Image
except Exception:  # pragma: no cover
    Image = None  # type: ignore[assignment]

try:
    import requests
except Exception:  # pragma: no cover
    requests = None  # type: ignore[assignment]


DATA_ROOT = Path(os.environ.get("MLLM_DATA_ROOT", "/mnt/data/tianyi/MLLM_Assistant"))
DEFAULT_TRAIN_OUTPUT = DATA_ROOT / "datasets" / "qwen_vl_train.jsonl"
DEFAULT_EVAL_OUTPUT = DATA_ROOT / "datasets" / "qwen_vl_eval.jsonl"
DEFAULT_SMOKE_OUTPUT = DATA_ROOT / "datasets" / "qwen_vl_smoke.jsonl"
DEFAULT_IMAGE_DIR = DATA_ROOT / "datasets" / "open-data-images"
DEFAULT_RAW_DATA_ROOT = DATA_ROOT / "datasets" / "raw-hf-datasets"
DEFAULT_DIALOGUE_RAW_ROOT = DATA_ROOT / "datasets" / "raw-dialogue"
DEFAULT_NATURALCONV_ARCHIVE = DEFAULT_DIALOGUE_RAW_ROOT / "NaturalConv_Release_20210318.zip"
DEFAULT_SOURCE_CACHE_ROOT = DATA_ROOT / "datasets" / "public-source-cache"
DEFAULT_HF_CACHE = DATA_ROOT / "cache" / "huggingface" / "datasets"
DEFAULT_HTTP_TIMEOUT = int(os.environ.get("MLLM_HTTP_TIMEOUT", "120"))
CACHE_SCHEMA_VERSION = 5


@dataclass(frozen=True)
class DatasetSpec:
    source: str
    dataset: str
    config: str | None
    train_limit: int
    eval_limit: int
    train_splits: tuple[str, ...] = ("train", "validation", "test")
    eval_splits: tuple[str, ...] = ("validation", "test", "train")
    raw_train_files: tuple[str, ...] = ()
    raw_eval_files: tuple[str, ...] = ()
    loader: str = "default"
    max_samples_per_dialog: int = 0
    min_context_turns: int = 0


PUBLIC_SPECS = {
    "docvqa": DatasetSpec(
        "docvqa",
        "lmms-lab/DocVQA",
        "DocVQA",
        8000,
        300,
        raw_train_files=tuple(f"DocVQA/train-{idx:05d}-of-00012.parquet" for idx in range(4)),
        raw_eval_files=("DocVQA/validation-00000-of-00006.parquet",),
    ),
    "chartqa": DatasetSpec(
        "chartqa",
        "HuggingFaceM4/ChartQA",
        None,
        5000,
        300,
        raw_train_files=("data/train-00000-of-00003-49492f364babfa44.parquet",),
        raw_eval_files=("data/val-00000-of-00001-0f11003c77497969.parquet",),
    ),
    "chartqa-long": DatasetSpec(
        "chartqa-long",
        "HuggingFaceM4/ChartQA",
        None,
        4000,
        250,
        raw_train_files=("data/train-00000-of-00003-49492f364babfa44.parquet",),
        raw_eval_files=("data/val-00000-of-00001-0f11003c77497969.parquet",),
    ),
    "m3it-fm-iqa": DatasetSpec(
        "m3it-fm-iqa",
        "MMInstruction/M3IT",
        "fm-iqa",
        5000,
        250,
        raw_train_files=("data/vqa/fm-iqa/train.jsonl",),
        raw_eval_files=("data/vqa/fm-iqa/val.jsonl",),
    ),
    "m3it-fm-iqa-long": DatasetSpec(
        "m3it-fm-iqa-long",
        "MMInstruction/M3IT",
        "fm-iqa",
        6000,
        300,
        raw_train_files=("data/vqa/fm-iqa/train.jsonl",),
        raw_eval_files=("data/vqa/fm-iqa/val.jsonl",),
    ),
    "m3it-coco-cn": DatasetSpec(
        "m3it-coco-cn",
        "MMInstruction/M3IT",
        "coco-cn",
        9000,
        250,
        raw_train_files=("data/captioning/coco-cn/train.jsonl",),
        raw_eval_files=("data/captioning/coco-cn/val.jsonl",),
    ),
    "m3it-coco-cn-long": DatasetSpec(
        "m3it-coco-cn-long",
        "MMInstruction/M3IT",
        "coco-cn",
        8000,
        250,
        raw_train_files=("data/captioning/coco-cn/train.jsonl",),
        raw_eval_files=("data/captioning/coco-cn/val.jsonl",),
    ),
    "m3it-flickr8k-cn": DatasetSpec(
        "m3it-flickr8k-cn",
        "MMInstruction/M3IT",
        "flickr8k-cn",
        5000,
        250,
        raw_train_files=("data/captioning/flickr8k-cn/train.jsonl",),
        raw_eval_files=("data/captioning/flickr8k-cn/val.jsonl",),
    ),
    "m3it-flickr8k-cn-long": DatasetSpec(
        "m3it-flickr8k-cn-long",
        "MMInstruction/M3IT",
        "flickr8k-cn",
        4000,
        250,
        raw_train_files=("data/captioning/flickr8k-cn/train.jsonl",),
        raw_eval_files=("data/captioning/flickr8k-cn/val.jsonl",),
    ),
    "m3it-mmchat": DatasetSpec(
        "m3it-mmchat",
        "MMInstruction/M3IT",
        "mmchat",
        3000,
        250,
        raw_train_files=("data/generation/mmchat/train.jsonl",),
        raw_eval_files=("data/generation/mmchat/validation.jsonl",),
    ),
    "m3it-mmchat-deep": DatasetSpec(
        "m3it-mmchat-deep",
        "MMInstruction/M3IT",
        "mmchat",
        4500,
        250,
        raw_train_files=("data/generation/mmchat/train.jsonl",),
        raw_eval_files=("data/generation/mmchat/validation.jsonl",),
    ),
    "naturalconv": DatasetSpec(
        "naturalconv",
        "NaturalConv",
        None,
        10000,
        800,
        train_splits=("train",),
        eval_splits=("dev", "test"),
        loader="naturalconv",
        max_samples_per_dialog=3,
        min_context_turns=6,
    ),
    "docvqa-long": DatasetSpec(
        "docvqa-long",
        "lmms-lab/DocVQA",
        "DocVQA",
        5000,
        250,
        raw_train_files=tuple(f"DocVQA/train-{idx:05d}-of-00012.parquet" for idx in range(4)),
        raw_eval_files=("DocVQA/validation-00000-of-00006.parquet",),
    ),
}

DATASET_PROFILES: dict[str, dict[str, Any]] = {
    "legacy-open-data": {
        "sources": ["docvqa", "chartqa", "m3it-fm-iqa", "m3it-coco-cn", "m3it-flickr8k-cn", "m3it-mmchat"],
        "max_train_rows": 27000,
    },
    "cn-multimodal-long": {
        "sources": ["m3it-mmchat", "naturalconv", "m3it-coco-cn", "m3it-flickr8k-cn", "m3it-fm-iqa"],
        "max_train_rows": 32000,
        "limit_overrides": {
            "m3it-mmchat": 3000,
            "naturalconv": 10000,
            "m3it-coco-cn": 9000,
            "m3it-flickr8k-cn": 5000,
            "m3it-fm-iqa": 5000,
        },
    },
    "cn-multimodal-deep-dialogue": {
        "sources": [
            "m3it-mmchat",
            "m3it-mmchat-deep",
            "naturalconv",
            "m3it-fm-iqa-long",
            "m3it-coco-cn-long",
            "m3it-flickr8k-cn-long",
        ],
        "max_train_rows": 36000,
        "limit_overrides": {
            "m3it-mmchat": 4500,
            "m3it-mmchat-deep": 4500,
            "naturalconv": 9000,
            "m3it-fm-iqa-long": 6000,
            "m3it-coco-cn-long": 8000,
            "m3it-flickr8k-cn-long": 4000,
        },
    },
    "cn-multimodal-balanced-long": {
        "sources": [
            "m3it-mmchat",
            "m3it-mmchat-deep",
            "m3it-fm-iqa-long",
            "m3it-coco-cn-long",
            "m3it-flickr8k-cn-long",
            "docvqa-long",
            "chartqa-long",
            "m3it-fm-iqa",
            "m3it-coco-cn",
            "m3it-flickr8k-cn",
            "naturalconv",
        ],
        "max_train_rows": 36900,
        "limit_overrides": {
            "m3it-mmchat": 3500,
            "m3it-mmchat-deep": 4500,
            "m3it-fm-iqa-long": 5000,
            "m3it-coco-cn-long": 4500,
            "m3it-flickr8k-cn-long": 2300,
            "docvqa-long": 5000,
            "chartqa-long": 4000,
            "m3it-fm-iqa": 1800,
            "m3it-coco-cn": 2200,
            "m3it-flickr8k-cn": 1400,
            "naturalconv": 2700,
        },
    },
}


QUESTION_KEYS = (
    "question",
    "query",
    "instruction",
    "prompt",
    "context",
    "text",
    "input",
    "inputs",
    "problem",
)
ANSWER_KEYS = (
    "answer",
    "answers",
    "response",
    "responses",
    "output",
    "outputs",
    "target",
    "label",
    "solution",
)
IMAGE_KEYS = (
    "image",
    "images",
    "image_1",
    "base64",
    "image_base64",
    "image_base64_str",
    "image_str",
    "img",
    "img_path",
    "image_path",
    "image_url",
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", help="Simple source JSONL with image/question/answer fields.")
    parser.add_argument("--output", default=str(DEFAULT_TRAIN_OUTPUT), help="Training JSONL output.")
    parser.add_argument("--eval-output", default=str(DEFAULT_EVAL_OUTPUT), help="Evaluation JSONL output.")
    parser.add_argument("--smoke-output", default=str(DEFAULT_SMOKE_OUTPUT), help="16-row smoke JSONL output.")
    parser.add_argument("--dataset-root", default="", help="Base directory for relative local images.")
    parser.add_argument("--image-dir", default=str(DEFAULT_IMAGE_DIR), help="Where sampled public images are saved.")
    parser.add_argument(
        "--profile",
        choices=tuple(DATASET_PROFILES),
        default="legacy-open-data",
        help="Named source mix used when --public is set and --sources is omitted.",
    )
    parser.add_argument(
        "--raw-data-root",
        default=os.environ.get("MLLM_RAW_DATA_ROOT", str(DEFAULT_RAW_DATA_ROOT)),
        help="Base directory for manually downloaded raw dataset files.",
    )
    parser.add_argument(
        "--dialogue-raw-root",
        default=os.environ.get("MLLM_DIALOGUE_RAW_ROOT", str(DEFAULT_DIALOGUE_RAW_ROOT)),
        help="Base directory for manually downloaded dialogue archives.",
    )
    parser.add_argument(
        "--naturalconv-archive",
        default=os.environ.get("MLLM_NATURALCONV_ARCHIVE", str(DEFAULT_NATURALCONV_ARCHIVE)),
        help="Path to the official NaturalConv zip archive.",
    )
    parser.add_argument(
        "--source-cache-root",
        default=os.environ.get("MLLM_SOURCE_CACHE_ROOT", str(DEFAULT_SOURCE_CACHE_ROOT)),
        help="Directory for per-source prepared record caches used to resume interrupted runs.",
    )
    parser.add_argument("--hf-cache-dir", default=str(DEFAULT_HF_CACHE), help="Hugging Face datasets cache.")
    parser.add_argument(
        "--format",
        choices=("ms-swift", "qwen-chat"),
        default="ms-swift",
        help="Output format. ms-swift is used for LoRA training.",
    )
    parser.add_argument("--public", action="store_true", help="Sample the fixed public dataset mix.")
    parser.add_argument(
        "--sources",
        nargs="+",
        default=None,
        help=f"Public source keys. Available: {', '.join(PUBLIC_SPECS)}",
    )
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--streaming", action=argparse.BooleanOptionalAction, default=False)
    parser.add_argument("--max-train-rows", type=int, default=None)
    parser.add_argument("--smoke-rows", type=int, default=16)
    parser.add_argument("--allow-missing-sources", action="store_true")
    return parser.parse_args()


def ensure_text(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, str):
        return value.strip()
    if isinstance(value, (int, float, bool)):
        return str(value).strip()
    if isinstance(value, list):
        texts = [ensure_text(item) for item in value]
        return " ".join(text for text in texts if text).strip()
    if isinstance(value, dict):
        for key in ("text", "answer", "content", "value"):
            text = ensure_text(value.get(key))
            if text:
                return text
        return json.dumps(value, ensure_ascii=False)
    return str(value).strip()


def first_field(row: dict[str, Any], keys: Iterable[str]) -> Any:
    for key in keys:
        if key in row and row[key] not in (None, "", []):
            return row[key]
    return None


def resolve_image(image: str, dataset_root: Path | None) -> str:
    image_path = Path(image)
    if image_path.is_absolute() or dataset_root is None:
        return str(image_path)
    return str((dataset_root / image_path).resolve())


def prompt_for_source(source: str, question: str) -> str:
    source_lower = source.lower()
    question = question.strip()
    if source_lower == "docvqa-long":
        return f"<image>请阅读文档图片并用中文回答问题。\n问题：{question}"
    if source_lower == "chartqa-long":
        return f"<image>请阅读图表并用中文回答问题。\n问题：{question}"
    if source_lower.startswith("docvqa"):
        return f"<image>请阅读文档图片并回答问题，答案尽量简洁。\n问题：{question}"
    if source_lower.startswith("chartqa"):
        return f"<image>请根据图表回答问题，涉及数值时只给出必要数字或简短结论。\n问题：{question}"
    if source_lower.startswith("m3it-coco-cn") or source_lower.startswith("m3it-flickr8k-cn"):
        return f"<image>{question or '请用中文描述这张图片。'}"
    if source_lower.startswith("m3it-fm-iqa"):
        return f"<image>{question or '请根据图片用中文回答问题。'}"
    if source_lower.startswith("m3it-mmchat"):
        return f"<image>{question or '请结合图片与上下文，用自然中文继续对话。'}"
    if source_lower.startswith("m3it"):
        return f"<image>{question}"
    return f"<image>请根据图片回答问题。\n问题：{question}"


def build_chat_record(
    source: str,
    messages: list[dict[str, str]],
    images: list[str],
    output_format: str,
) -> dict[str, Any]:
    if output_format == "qwen-chat":
        qwen_messages: list[dict[str, Any]] = []
        images_attached = False
        for message in messages:
            content: list[dict[str, str]] = []
            if message["role"] == "user" and images and not images_attached:
                for image in images:
                    content.append({"type": "image", "image": image})
                images_attached = True
            content.append({"type": "text", "text": message["content"]})
            qwen_messages.append({"role": message["role"], "content": content})
        return {
            "messages": qwen_messages,
            "source": source,
        }

    record: dict[str, Any] = {"messages": messages, "source": source}
    if images:
        record["images"] = images
    return record


def normalize_dialogue_lines(value: str) -> list[str]:
    return [line.strip() for line in value.replace("\r\n", "\n").split("\n") if line.strip()]


def ensure_sentence(text: str) -> str:
    cleaned = text.strip()
    if not cleaned:
        return cleaned
    if cleaned.endswith(("。", "！", "？", ".", "!", "?")):
        return cleaned
    return f"{cleaned}。"


def compact_question(question: str) -> str:
    return " ".join(question.replace("<image>", "").split())


def stable_template(seed_text: str, options: tuple[str, ...]) -> str:
    digest = hashlib.sha1(seed_text.encode("utf-8")).hexdigest()
    return options[int(digest[:8], 16) % len(options)]


def expand_caption_answer(question: str, answer: str) -> str:
    clean_answer = ensure_sentence(answer)
    short_question = compact_question(question) or "这张图片"
    return stable_template(
        f"caption::{short_question}::{clean_answer}",
        (
            (
                f"这张图最核心的内容可以概括为：{clean_answer}"
                f" 如果继续展开，仍应围绕这条主信息描述画面中的主体、动作和场景。"
                f" 对于原始标注没有明确给出的身份、时间和故事背景，保持克制、不额外推断，会让中文回答更稳妥。"
            ),
            (
                f"从直接可见的信息出发，比较完整的中文说明可以先抓住“{clean_answer}”这个中心。"
                f" 然后再补充画面里能确认的对象关系、动作状态和环境线索；凡是图中没有明确展示的细节，就不要当成确定事实。"
            ),
            (
                f"如果把这张图解释给看不到图片的人，最稳妥的说法仍然是：{clean_answer}"
                f" 在此基础上，可以继续说明画面的主体、所处场景以及正在发生的动作，"
                f" 但不把原始标注之外无法确认的背景信息硬写进去。"
            ),
        ),
    )


def expand_vqa_answer(question: str, answer: str) -> str:
    clean_answer = ensure_sentence(answer)
    short_question = compact_question(question) or "这个问题"
    return stable_template(
        f"vqa::{short_question}::{clean_answer}",
        (
            (
                f"围绕“{short_question}”，最直接的答案是：{clean_answer}"
                f" 之所以这样回答，是因为题目关注的对象、动作或属性可以从图片中直接判断出来。"
                f" 如果要把回答写得完整一些，也应该只补充画面里能确认的信息，不把看不见的背景设定当成事实。"
            ),
            (
                f"根据图片内容，当前问题的稳妥结论就是：{clean_answer}"
                f" 展开说明时，可以强调这是基于图中可见线索做出的判断，"
                f" 因而回答会优先保留明确可见的内容，而不会额外编造人物身份、时间原因或隐藏情节。"
            ),
            (
                f"这个问题可以完整表述为：根据图片里直接呈现的信息，答案是{clean_answer}"
                f" 后续解释的重点应放在可观察到的主体和线索上；"
                f" 对于图中没有明确展示的部分，保持不确定比强行补全更合适。"
            ),
        ),
    )


def expand_doc_answer(question: str, answer: str) -> str:
    clean_answer = ensure_sentence(answer)
    short_question = compact_question(question) or "这个文档问题"
    return stable_template(
        f"doc::{short_question}::{clean_answer}",
        (
            (
                f"针对“{short_question}”，文档中能够支持的结论是：{clean_answer}"
                f" 更完整地回答时，应继续围绕页面里可见的标题、字段名、表格单元格或邻近文本来说明依据，"
                f" 只引用文档里确实能读到的信息，不补写页面外的背景。"
            ),
            (
                f"如果把这个答案写得更稳一些，可以先明确结论：{clean_answer}"
                f" 然后补充说明这通常来自文档中的关键词、版式区域或与问题对应的字段位置；"
                f" 对于扫描不清或页面里没有直接给出的内容，保持不确定比主观猜测更合适。"
            ),
            (
                f"围绕这份文档，当前最可靠的答案是：{clean_answer}"
                f" 后续展开时，重点应该放在页面可见的文字证据、段落邻接关系和字段线索上，"
                f" 这样既能让中文回答更完整，也能减少幻觉。"
            ),
        ),
    )


def expand_chart_answer(question: str, answer: str) -> str:
    clean_answer = ensure_sentence(answer)
    short_question = compact_question(question) or "这个图表问题"
    return stable_template(
        f"chart::{short_question}::{clean_answer}",
        (
            (
                f"对于“{short_question}”，图表直接支持的答案是：{clean_answer}"
                f" 如果需要展开，应继续说明对应的坐标轴、图例、类别标签或数值位置，"
                f" 让回答体现出它确实来自图表，而不是凭常识补写。"
            ),
            (
                f"更完整的中文说法可以先给出结论：{clean_answer}"
                f" 然后补充这个结论通常是根据图表中的刻度、柱形高度、折线走势或表格数字得出的；"
                f" 一旦原图没有明确提供更多数值，就不要强行延伸。"
            ),
            (
                f"根据图表里的可见信息，当前最稳妥的回答仍然是：{clean_answer}"
                f" 展开说明时，应把注意力放在读图依据上，例如比较对象、相对高低和显式数值，"
                f" 这样比空泛复述更有训练价值。"
            ),
        ),
    )


def continue_mmchat_answer(answer: str) -> str:
    clean_answer = ensure_sentence(answer)
    return stable_template(
        f"mmchat::{clean_answer}",
        (
            (
                f"可以，{clean_answer}"
                f" 如果顺着现在的语境继续聊，我会优先围绕图片里已经出现的内容和前文刚提到的重点往下展开，"
                f" 让回复更完整一些；没有从图片或上下文中明确给出的信息，就不额外编造。"
            ),
            (
                f"当然可以继续补充。{clean_answer}"
                f" 更自然的后续说法应该一边承接上文，一边继续结合图片里最明显的主体、动作和场景，"
                f" 同时把不确定的部分留白，而不是为了凑内容去猜测。"
            ),
            (
                f"我可以展开一点：{clean_answer}"
                f" 接下来如果继续回应，重点应该放在当前对话已经提到的关注点上，"
                f" 再结合图片里能直接确认的细节把话说完整，而不是跳到图外去补故事。"
            ),
        ),
    )


def build_messages_for_source(source: str, question: str, answer: str) -> list[dict[str, str]]:
    source_lower = source.lower()
    if source_lower.startswith("m3it-mmchat"):
        lines = normalize_dialogue_lines(question.replace("<image>", "").strip())
        if len(lines) >= 2:
            messages: list[dict[str, str]] = []
            start_with_user = len(lines) % 2 == 1
            for index, line in enumerate(lines):
                if start_with_user:
                    role = "user" if index % 2 == 0 else "assistant"
                else:
                    role = "assistant" if index % 2 == 0 else "user"
                messages.append({"role": role, "content": line})
            messages.append({"role": "assistant", "content": answer})
            if source_lower == "m3it-mmchat-deep":
                messages.append(
                    {
                        "role": "user",
                        "content": "你可以顺着上面的语境再展开一点，继续结合图片补充说明，不要只回答一句。",
                    }
                )
                messages.append({"role": "assistant", "content": continue_mmchat_answer(answer)})
            return messages
    if source_lower in {"m3it-coco-cn-long", "m3it-flickr8k-cn-long"}:
        return [
            {"role": "user", "content": f"<image>{compact_question(question) or '请用中文描述这张图片。'}"},
            {"role": "assistant", "content": ensure_sentence(answer)},
            {
                "role": "user",
                "content": "请继续补充画面中能直接确认的主体、动作、场景和氛围，用中文写成 2 到 4 句，不要编造看不见的信息。",
            },
            {"role": "assistant", "content": expand_caption_answer(question, answer)},
        ]
    if source_lower == "m3it-fm-iqa-long":
        return [
            {"role": "user", "content": f"<image>{compact_question(question) or '请根据图片用中文回答问题。'}"},
            {"role": "assistant", "content": ensure_sentence(answer)},
            {
                "role": "user",
                "content": "请把刚才的回答展开一点，说明你的判断依据，只补充能从图片里直接确认的信息，不要编造。",
            },
            {"role": "assistant", "content": expand_vqa_answer(question, answer)},
        ]
    if source_lower == "docvqa-long":
        return [
            {"role": "user", "content": f"<image>请阅读文档图片并用中文直接回答问题：{compact_question(question) or '这份文档的关键信息是什么？'}"},
            {"role": "assistant", "content": ensure_sentence(answer)},
            {
                "role": "user",
                "content": "请继续说明你在文档中依据了哪些可见文字、字段或版式线索来判断，回答保持中文，不要脱离页面内容。",
            },
            {"role": "assistant", "content": expand_doc_answer(question, answer)},
        ]
    if source_lower == "chartqa-long":
        return [
            {"role": "user", "content": f"<image>请阅读图表并用中文直接回答问题：{compact_question(question) or '请根据图表回答问题。'}"},
            {"role": "assistant", "content": ensure_sentence(answer)},
            {
                "role": "user",
                "content": "请继续说明你是根据图表中的哪些数值、标签、图例或相对关系得出这个答案的，保持中文，不要编造图表外的信息。",
            },
            {"role": "assistant", "content": expand_chart_answer(question, answer)},
        ]

    return [
        {"role": "user", "content": prompt_for_source(source, question)},
        {"role": "assistant", "content": answer},
    ]


def build_record(source: str, question: str, answer: str, images: list[str], output_format: str) -> dict[str, Any]:
    return build_chat_record(source, build_messages_for_source(source, question, answer), images, output_format)


def convert_simple_row(row: dict[str, Any], dataset_root: Path | None, output_format: str) -> dict[str, Any]:
    question = ensure_text(row.get("question"))
    answer = ensure_text(row.get("answer"))
    if not question or not answer:
        raise ValueError("Each row requires non-empty question and answer fields.")

    images: list[str] = []
    image = ensure_text(row.get("image"))
    if image:
        images.append(resolve_image(image, dataset_root))

    return build_record(ensure_text(row.get("source")) or "open-data", question, answer, images, output_format)


def convert_simple_jsonl(args: argparse.Namespace) -> None:
    dataset_root = Path(args.dataset_root).resolve() if args.dataset_root else None
    output_path = Path(args.output)
    output_path.parent.mkdir(parents=True, exist_ok=True)

    converted = 0
    with Path(args.input).open("r", encoding="utf-8") as source, output_path.open("w", encoding="utf-8") as target:
        for line_number, line in enumerate(source, 1):
            if not line.strip():
                continue
            try:
                row = json.loads(line)
                target.write(json.dumps(convert_simple_row(row, dataset_root, args.format), ensure_ascii=False) + "\n")
                converted += 1
            except Exception as exc:
                raise RuntimeError(f"Failed to convert line {line_number}: {exc}") from exc

    print(f"converted={converted} output={output_path}")


def row_key(source: str, question: str, answer: str) -> str:
    raw = json.dumps({"source": source, "question": question, "answer": answer}, ensure_ascii=False, sort_keys=True)
    return hashlib.sha1(raw.encode("utf-8")).hexdigest()


def save_pil_image(image: Any, output_path: Path) -> str:
    if Image is None:
        raise RuntimeError("Pillow is required to save public dataset images.")
    output_path.parent.mkdir(parents=True, exist_ok=True)
    suffix = output_path.suffix.lower()
    if suffix in {".jpg", ".jpeg"}:
        image.convert("RGB").save(output_path, format="JPEG", quality=95)
    else:
        image.convert("RGB").save(output_path)
    return str(output_path.resolve())


def guess_image_suffix(data: bytes) -> str | None:
    if data.startswith(b"\xff\xd8\xff"):
        return ".jpg"
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return ".png"
    if data.startswith((b"GIF87a", b"GIF89a")):
        return ".gif"
    if data.startswith(b"RIFF") and data[8:12] == b"WEBP":
        return ".webp"
    if data.startswith(b"BM"):
        return ".bmp"
    return None


def save_bytes_image(data: bytes, output_path: Path) -> str:
    guessed_suffix = guess_image_suffix(data)
    if guessed_suffix:
        direct_path = output_path.with_suffix(guessed_suffix)
        direct_path.parent.mkdir(parents=True, exist_ok=True)
        direct_path.write_bytes(data)
        return str(direct_path.resolve())
    if Image is not None:
        image = Image.open(io.BytesIO(data))
        format_name = (image.format or "PNG").lower()
        suffix = ".jpg" if format_name == "jpeg" else f".{format_name}"
        return save_pil_image(image, output_path.with_suffix(suffix))
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_bytes(data)
    return str(output_path.resolve())


def image_digest(value: Any) -> str:
    raw = repr(value).encode("utf-8", errors="ignore")
    return hashlib.sha1(raw).hexdigest()[:16]


def save_image_value(value: Any, image_dir: Path, source: str, index: int) -> str | None:
    if value in (None, "", []):
        return None
    if isinstance(value, list):
        for item in value:
            saved = save_image_value(item, image_dir, source, index)
            if saved:
                return saved
        return None
    if isinstance(value, dict):
        if value.get("bytes"):
            return save_bytes_image(value["bytes"], image_dir / source / f"{index:08d}-{image_digest(value)}.png")
        for key in ("path", "url", "image", "base64", "image_base64", "image_path"):
            if value.get(key):
                return save_image_value(value[key], image_dir, source, index)
        return None
    if Image is not None and hasattr(value, "save") and hasattr(value, "convert"):
        return save_pil_image(value, image_dir / source / f"{index:08d}-{image_digest(value)}.png")
    if isinstance(value, bytes):
        return save_bytes_image(value, image_dir / source / f"{index:08d}-{hashlib.sha1(value).hexdigest()[:16]}.png")
    if isinstance(value, str):
        text = value.strip()
        if not text:
            return None
        if text.startswith("data:image/"):
            encoded = text.split(",", 1)[1]
            return save_bytes_image(base64.b64decode(encoded), image_dir / source / f"{index:08d}-{image_digest(text)}.png")
        if len(text) > 256 and all(ch.isalnum() or ch in "+/=\n\r" for ch in text[:256]):
            try:
                return save_bytes_image(base64.b64decode(text), image_dir / source / f"{index:08d}-{image_digest(text)}.png")
            except Exception:
                pass
        if text.startswith("http://") or text.startswith("https://"):
            with urllib.request.urlopen(text, timeout=30) as response:  # noqa: S310 - public dataset URL
                return save_bytes_image(response.read(), image_dir / source / f"{index:08d}-{image_digest(text)}.png")
        path = Path(text).expanduser()
        if path.exists():
            target = image_dir / source / f"{index:08d}-{path.name}"
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(path, target)
            return str(target.resolve())
    return None


def extract_question_answer(source: str, row: dict[str, Any]) -> tuple[str, str]:
    source_lower = source.lower()
    if any(key in row for key in ("instruction", "inputs", "outputs")):
        instruction = ensure_text(row.get("instruction")).replace("<image>", "").strip()
        inputs = ensure_text(row.get("inputs")).replace("<image>", "").strip()
        question = "\n".join(part for part in (instruction, inputs) if part).strip()
        answer = ensure_text(row.get("outputs"))
    else:
        question = ensure_text(first_field(row, QUESTION_KEYS))
        answer = ensure_text(first_field(row, ANSWER_KEYS))
    if source_lower.startswith("m3it-coco-cn") or source_lower.startswith("m3it-flickr8k-cn"):
        if not question:
            question = "请用中文描述这张图片。"
        if not answer:
            answer = ensure_text(row.get("caption"))
    if not answer and "messages" in row:
        messages = row["messages"]
        if isinstance(messages, list):
            for message in messages:
                if isinstance(message, dict) and message.get("role") == "user" and not question:
                    question = ensure_text(message.get("content"))
                if isinstance(message, dict) and message.get("role") == "assistant":
                    answer = ensure_text(message.get("content"))
    return question.replace("<image>", "").strip(), answer.strip()


def image_candidates(row: dict[str, Any]) -> list[Any]:
    candidates: list[Any] = []
    for key in IMAGE_KEYS:
        value = row.get(key)
        if value not in (None, "", []):
            candidates.append(value)
    return candidates


def import_datasets_module() -> Any:
    try:
        import datasets  # type: ignore[import-not-found]
    except Exception as exc:  # pragma: no cover
        raise RuntimeError("Install the `datasets` package before sampling public data.") from exc
    return datasets


@lru_cache(maxsize=2)
def load_naturalconv_archive(archive_path: str) -> tuple[dict[str, dict[str, Any]], dict[str, list[str]]]:
    path = Path(archive_path)
    if not path.exists():
        raise RuntimeError(f"NaturalConv archive not found: {path}")

    with zipfile.ZipFile(path) as archive:
        dialogs = json.loads(archive.read("dialog_release.json"))
        split_ids = {
            "train": [line.strip() for line in archive.read("train.txt").decode("utf-8").splitlines() if line.strip()],
            "dev": [line.strip() for line in archive.read("dev.txt").decode("utf-8").splitlines() if line.strip()],
            "test": [line.strip() for line in archive.read("test.txt").decode("utf-8").splitlines() if line.strip()],
        }

    dialog_map = {str(dialog["dialog_id"]): dialog for dialog in dialogs if isinstance(dialog, dict) and dialog.get("dialog_id") is not None}
    return dialog_map, split_ids


def load_naturalconv_split(split_names: tuple[str, ...], seed: int) -> list[dict[str, Any]]:
    archive_path = os.environ.get("MLLM_NATURALCONV_ARCHIVE", str(DEFAULT_NATURALCONV_ARCHIVE))
    dialog_map, split_ids = load_naturalconv_archive(archive_path)
    selected_ids: list[str] = []
    for split_name in split_names:
        if split_name in split_ids:
            selected_ids.extend(split_ids[split_name])
    rows = [dialog_map[dialog_id] for dialog_id in selected_ids if dialog_id in dialog_map]
    random.Random(seed).shuffle(rows)
    return rows


def load_split(datasets: Any, spec: DatasetSpec, splits: tuple[str, ...], cache_dir: str, streaming: bool, seed: int) -> Any:
    if spec.loader == "naturalconv":
        return load_naturalconv_split(splits, seed)

    use_raw_files = spec.raw_train_files if splits == spec.train_splits else spec.raw_eval_files
    if use_raw_files:
        return load_raw_files(datasets, spec, use_raw_files, cache_dir, seed)

    errors: list[str] = []
    for split in splits:
        try:
            dataset = datasets.load_dataset(
                spec.dataset,
                spec.config,
                split=split,
                cache_dir=cache_dir,
                streaming=streaming,
            )
            if streaming:
                return dataset.shuffle(seed=seed, buffer_size=5000)
            return dataset.shuffle(seed=seed)
        except Exception as exc:
            errors.append(f"{split}: {exc}")
    raise RuntimeError(f"Unable to load {spec.dataset}/{spec.config or 'default'} splits {splits}: {' | '.join(errors)}")


def load_raw_files(datasets: Any, spec: DatasetSpec, filenames: tuple[str, ...], cache_dir: str, seed: int) -> Any:
    try:
        from huggingface_hub import hf_hub_download, hf_hub_url  # type: ignore[import-not-found]
    except Exception as exc:  # pragma: no cover
        raise RuntimeError("Install huggingface_hub before loading raw dataset files.") from exc

    raw_data_root = Path(os.environ.get("MLLM_RAW_DATA_ROOT", str(DEFAULT_RAW_DATA_ROOT)))
    local_override_paths = [raw_data_root / spec.dataset / filename for filename in filenames]
    if all(path.exists() for path in local_override_paths):
        local_paths = [str(path) for path in local_override_paths]
    else:
        local_paths = []

    suffixes = {Path(filename).suffix.lower() for filename in filenames}

    if suffixes == {".jsonl"}:
        if local_paths:
            def iter_local_rows() -> Iterable[dict[str, Any]]:
                for local_path in local_paths:
                    with Path(local_path).open("r", encoding="utf-8") as handle:
                        for line in handle:
                            if not line.strip():
                                continue
                            yield json.loads(line)

            return iter_local_rows()

        if requests is None:
            raise RuntimeError("Install requests before streaming raw JSONL dataset files.")

        def iter_rows() -> Iterable[dict[str, Any]]:
            for filename in filenames:
                url = hf_hub_url(
                    repo_id=spec.dataset,
                    filename=filename,
                    repo_type="dataset",
                )
                with requests.get(url, stream=True, timeout=DEFAULT_HTTP_TIMEOUT, allow_redirects=True) as response:
                    response.raise_for_status()
                    response.encoding = "utf-8"
                    for line in response.iter_lines(decode_unicode=True):
                        if not line or not line.strip():
                            continue
                        yield json.loads(line)

        return iter_rows()

    if not local_paths:
        for filename in filenames:
            local_paths.append(
                hf_hub_download(
                    repo_id=spec.dataset,
                    repo_type="dataset",
                    filename=filename,
                    cache_dir=cache_dir,
                )
            )
    suffixes = {Path(path).suffix.lower() for path in local_paths}
    if suffixes == {".parquet"}:
        return datasets.load_dataset("parquet", data_files=local_paths, split="train", cache_dir=cache_dir).shuffle(seed=seed)

    if suffixes != {".jsonl"}:
        raise RuntimeError(f"Unsupported raw file types for {spec.source}: {sorted(suffixes)}")

    rows: list[dict[str, Any]] = []
    for local_path in local_paths:
        with Path(local_path).open("r", encoding="utf-8") as handle:
            for line in handle:
                if not line.strip():
                    continue
                rows.append(json.loads(line))
    random.Random(seed).shuffle(rows)
    return rows


def collect_records(
    dataset: Any,
    spec: DatasetSpec,
    limit: int,
    image_dir: Path,
    output_format: str,
    seen: set[str],
) -> tuple[list[dict[str, Any]], list[str]]:
    if spec.loader == "naturalconv":
        return collect_naturalconv_records(dataset, spec, limit, output_format, seen)

    records: list[dict[str, Any]] = []
    keys: list[str] = []
    scanned = 0
    for row in dataset:
        scanned += 1
        if not isinstance(row, dict):
            continue
        question, answer = extract_question_answer(spec.source, row)
        if not question or not answer:
            continue
        key = row_key(spec.source, question, answer)
        if key in seen:
            continue
        image_path = None
        for image_value in image_candidates(row):
            image_path = save_image_value(image_value, image_dir, spec.source, scanned)
            if image_path:
                break
        if not image_path:
            continue
        seen.add(key)
        records.append(build_record(spec.source, question, answer, [image_path], output_format))
        keys.append(key)
        if len(records) % 200 == 0:
            print(
                f"[info] source={spec.source} accepted={len(records)} scanned={scanned}",
                flush=True,
            )
        if len(records) >= limit:
            break
    return records, keys


def collect_naturalconv_records(
    dataset: Any,
    spec: DatasetSpec,
    limit: int,
    output_format: str,
    seen: set[str],
) -> tuple[list[dict[str, Any]], list[str]]:
    records: list[dict[str, Any]] = []
    keys: list[str] = []
    scanned = 0
    min_context_turns = max(2, spec.min_context_turns)
    max_samples_per_dialog = max(1, spec.max_samples_per_dialog or 1)

    for row in dataset:
        scanned += 1
        if not isinstance(row, dict):
            continue
        turns = [ensure_text(turn) for turn in row.get("content", []) if ensure_text(turn)]
        if len(turns) < min_context_turns:
            continue

        assistant_turn_indexes = [index for index in range(1, len(turns), 2) if index + 1 >= min_context_turns]
        if not assistant_turn_indexes:
            continue

        for turn_index in assistant_turn_indexes[-max_samples_per_dialog:]:
            messages = [
                {"role": "user" if index % 2 == 0 else "assistant", "content": turn}
                for index, turn in enumerate(turns[: turn_index + 1])
            ]
            key = hashlib.sha1(
                json.dumps(
                    {"source": spec.source, "dialog_id": row.get("dialog_id"), "turn_index": turn_index},
                    ensure_ascii=False,
                    sort_keys=True,
                ).encode("utf-8")
            ).hexdigest()
            if key in seen:
                continue

            seen.add(key)
            records.append(build_chat_record(spec.source, messages, [], output_format))
            keys.append(key)

            if len(records) % 200 == 0:
                print(
                    f"[info] source={spec.source} accepted={len(records)} scanned={scanned}",
                    flush=True,
                )
            if len(records) >= limit:
                return records, keys

    return records, keys


def write_jsonl(path: Path, records: list[dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temp_path = path.with_name(f".{path.name}.tmp")
    with temp_path.open("w", encoding="utf-8") as handle:
        for record in records:
            handle.write(json.dumps(record, ensure_ascii=False) + "\n")
    temp_path.replace(path)


def read_jsonl(path: Path) -> list[dict[str, Any]]:
    records: list[dict[str, Any]] = []
    with path.open("r", encoding="utf-8") as handle:
        for line in handle:
            if not line.strip():
                continue
            records.append(json.loads(line))
    return records


def write_json(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temp_path = path.with_name(f".{path.name}.tmp")
    with temp_path.open("w", encoding="utf-8") as handle:
        json.dump(payload, handle, ensure_ascii=False, indent=2)
    temp_path.replace(path)


def build_source_plan(
    selected_specs: list[DatasetSpec],
    max_train_rows: int,
    limit_overrides: dict[str, int] | None = None,
) -> list[dict[str, Any]]:
    remaining = max_train_rows
    plan: list[dict[str, Any]] = []
    for spec in selected_specs:
        target_limit = spec.train_limit
        if limit_overrides and spec.source in limit_overrides:
            target_limit = limit_overrides[spec.source]
        train_limit = min(target_limit, max(0, remaining))
        remaining = max(0, remaining - train_limit)
        plan.append(
            {
                "source": spec.source,
                "train_limit": train_limit,
                "eval_limit": spec.eval_limit,
            }
        )
    return plan


def source_cache_dir(source_cache_root: Path, config_payload: dict[str, Any], spec: DatasetSpec) -> Path:
    config_key = hashlib.sha1(
        json.dumps(config_payload, ensure_ascii=False, sort_keys=True).encode("utf-8")
    ).hexdigest()[:12]
    return source_cache_root / config_key / spec.source


def load_source_cache(
    source_cache_root: Path,
    config_payload: dict[str, Any],
    spec: DatasetSpec,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]], list[str], list[str]] | None:
    cache_dir = source_cache_dir(source_cache_root, config_payload, spec)
    train_path = cache_dir / "train.jsonl"
    eval_path = cache_dir / "eval.jsonl"
    meta_path = cache_dir / "meta.json"
    if not train_path.exists() or not eval_path.exists() or not meta_path.exists():
        return None

    meta = json.loads(meta_path.read_text(encoding="utf-8"))
    train_records = read_jsonl(train_path)
    eval_records = read_jsonl(eval_path)
    train_keys = meta.get("train_keys", [])
    eval_keys = meta.get("eval_keys", [])
    if len(train_keys) != len(train_records) or len(eval_keys) != len(eval_records):
        raise RuntimeError(f"Invalid source cache for {spec.source}: key counts do not match record counts.")
    return train_records, eval_records, train_keys, eval_keys


def save_source_cache(
    source_cache_root: Path,
    config_payload: dict[str, Any],
    spec: DatasetSpec,
    train_records: list[dict[str, Any]],
    eval_records: list[dict[str, Any]],
    train_keys: list[str],
    eval_keys: list[str],
) -> None:
    cache_dir = source_cache_dir(source_cache_root, config_payload, spec)
    write_jsonl(cache_dir / "train.jsonl", train_records)
    write_jsonl(cache_dir / "eval.jsonl", eval_records)
    write_json(
        cache_dir / "meta.json",
        {
            "source": spec.source,
            "train_count": len(train_records),
            "eval_count": len(eval_records),
            "train_keys": train_keys,
            "eval_keys": eval_keys,
            "config": config_payload,
        },
    )


def sample_public_data(args: argparse.Namespace) -> None:
    random.seed(args.seed)
    image_dir = Path(args.image_dir)
    cache_dir = str(Path(args.hf_cache_dir))
    source_cache_root = Path(args.source_cache_root)
    profile = DATASET_PROFILES[args.profile]
    source_names = args.sources or profile["sources"]
    selected_specs: list[DatasetSpec] = []
    for source in source_names:
        if source not in PUBLIC_SPECS:
            raise ValueError(f"Unknown public source: {source}")
        selected_specs.append(PUBLIC_SPECS[source])

    if any(spec.loader != "naturalconv" for spec in selected_specs):
        datasets = import_datasets_module()
    else:
        datasets = None

    max_train_rows = args.max_train_rows if args.max_train_rows is not None else int(profile["max_train_rows"])
    limit_overrides = profile.get("limit_overrides") if args.sources is None else None
    plan = build_source_plan(selected_specs, max_train_rows, limit_overrides)
    config_payload = {
        "cache_schema_version": CACHE_SCHEMA_VERSION,
        "profile": args.profile,
        "sources": [spec.source for spec in selected_specs],
        "format": args.format,
        "seed": args.seed,
        "max_train_rows": max_train_rows,
        "image_dir": str(image_dir.resolve()),
        "naturalconv_archive": os.environ.get("MLLM_NATURALCONV_ARCHIVE", str(DEFAULT_NATURALCONV_ARCHIVE)),
        "plan": plan,
    }
    write_json(source_cache_root / "latest-config.json", config_payload)

    train_records: list[dict[str, Any]] = []
    eval_records: list[dict[str, Any]] = []
    seen: set[str] = set()
    summaries: list[dict[str, Any]] = []

    for offset, (spec, plan_item) in enumerate(zip(selected_specs, plan)):
        train_subset: list[dict[str, Any]] = []
        eval_subset: list[dict[str, Any]] = []
        train_keys: list[str] = []
        eval_keys: list[str] = []
        try:
            cached = load_source_cache(source_cache_root, config_payload, spec)
            if cached is not None:
                train_subset, eval_subset, train_keys, eval_keys = cached
                seen.update(train_keys)
                seen.update(eval_keys)
                train_records.extend(train_subset)
                eval_records.extend(eval_subset)
                print(
                    f"[info] reusing cached source={spec.source} "
                    f"train={len(train_subset)} eval={len(eval_subset)}",
                    flush=True,
                )
                summaries.append({"source": spec.source, "train": len(train_subset), "eval": len(eval_subset), "cached": True})
                continue

            print(
                f"[info] sampling source={spec.source} "
                f"train_limit={plan_item['train_limit']} "
                f"eval_limit={plan_item['eval_limit']}",
                flush=True,
            )
            train_limit = plan_item["train_limit"]
            if train_limit > 0:
                train_dataset = load_split(
                    datasets,
                    spec,
                    spec.train_splits,
                    cache_dir,
                    args.streaming,
                    args.seed + offset,
                )
                train_subset, train_keys = collect_records(train_dataset, spec, train_limit, image_dir, args.format, seen)
                train_records.extend(train_subset)
            eval_dataset = load_split(
                datasets,
                spec,
                spec.eval_splits,
                cache_dir,
                args.streaming,
                args.seed + 100 + offset,
            )
            eval_subset, eval_keys = collect_records(eval_dataset, spec, spec.eval_limit, image_dir, args.format, seen)
            eval_records.extend(eval_subset)
            save_source_cache(source_cache_root, config_payload, spec, train_subset, eval_subset, train_keys, eval_keys)
            print(
                f"[info] finished source={spec.source} train={len(train_subset)} eval={len(eval_subset)} "
                f"train_total={len(train_records)} eval_total={len(eval_records)}",
                flush=True,
            )
            summaries.append({"source": spec.source, "train": len(train_subset), "eval": len(eval_subset)})
        except Exception as exc:
            if not args.allow_missing_sources:
                raise
            summaries.append({"source": spec.source, "error": str(exc)})
            print(f"[warn] skipped {spec.source}: {exc}", file=sys.stderr)

    random.shuffle(train_records)
    random.shuffle(eval_records)
    smoke_records = train_records[: args.smoke_rows]

    write_jsonl(Path(args.output), train_records)
    write_jsonl(Path(args.eval_output), eval_records)
    write_jsonl(Path(args.smoke_output), smoke_records)
    print(json.dumps({"train": len(train_records), "eval": len(eval_records), "smoke": len(smoke_records), "sources": summaries}, ensure_ascii=False, indent=2))


def main() -> None:
    args = parse_args()
    os.environ["MLLM_RAW_DATA_ROOT"] = args.raw_data_root
    os.environ["MLLM_DIALOGUE_RAW_ROOT"] = args.dialogue_raw_root
    os.environ["MLLM_NATURALCONV_ARCHIVE"] = args.naturalconv_archive
    if args.public:
        sample_public_data(args)
        return
    if not args.input:
        raise SystemExit("Either --input or --public is required.")
    convert_simple_jsonl(args)


if __name__ == "__main__":
    main()
