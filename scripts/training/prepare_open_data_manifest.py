#!/usr/bin/env python3
"""Convert simple multimodal QA JSONL files into Qwen-VL chat JSONL.

Input JSONL fields:
  image: absolute or dataset-root-relative image path, optional for text-only rows
  question: user instruction or question
  answer: assistant answer
  source: optional dataset name
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True, help="Source JSONL file.")
    parser.add_argument("--output", required=True, help="Output JSONL file.")
    parser.add_argument("--dataset-root", default="", help="Base directory for relative image paths.")
    return parser.parse_args()


def resolve_image(image: str, dataset_root: Path | None) -> str:
    image_path = Path(image)
    if image_path.is_absolute() or dataset_root is None:
      return str(image_path)
    return str((dataset_root / image_path).resolve())


def convert_row(row: dict, dataset_root: Path | None) -> dict:
    question = str(row.get("question", "")).strip()
    answer = str(row.get("answer", "")).strip()
    if not question or not answer:
        raise ValueError("Each row requires non-empty question and answer fields.")

    user_content = []
    image = str(row.get("image", "")).strip()
    if image:
        user_content.append({"type": "image", "image": resolve_image(image, dataset_root)})
    user_content.append({"type": "text", "text": question})

    return {
        "messages": [
            {"role": "user", "content": user_content},
            {"role": "assistant", "content": [{"type": "text", "text": answer}]},
        ],
        "source": row.get("source", "open-data"),
    }


def main() -> None:
    args = parse_args()
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
                target.write(json.dumps(convert_row(row, dataset_root), ensure_ascii=False) + "\n")
                converted += 1
            except Exception as exc:
                raise RuntimeError(f"Failed to convert line {line_number}: {exc}") from exc

    print(f"converted={converted} output={output_path}")


if __name__ == "__main__":
    main()
