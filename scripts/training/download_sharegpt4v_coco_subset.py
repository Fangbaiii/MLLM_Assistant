#!/usr/bin/env python3
"""Download only the official COCO images needed by ShareGPT4V captions."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import random
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from io import BytesIO
from pathlib import Path
from typing import Any

from PIL import Image


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--metadata", required=True)
    parser.add_argument("--output-dir", required=True)
    parser.add_argument("--manifest", required=True)
    parser.add_argument("--limit", type=int, default=8000)
    parser.add_argument("--min-caption-chars", type=int, default=300)
    parser.add_argument("--workers", type=int, default=16)
    parser.add_argument("--retries", type=int, default=5)
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument(
        "--base-url",
        default="http://images.cocodataset.org/train2017",
        help="Official COCO image directory.",
    )
    return parser.parse_args()


def caption(row: dict[str, Any]) -> str:
    for item in reversed(row.get("conversations", [])):
        if item.get("from") in {"gpt", "assistant"}:
            return str(item.get("value", "")).strip()
    return ""


def verify_image(data: bytes) -> None:
    with Image.open(BytesIO(data)) as image:
        image.verify()


def existing_valid(path: Path) -> bool:
    if not path.is_file() or path.stat().st_size == 0:
        return False
    try:
        with Image.open(path) as image:
            image.verify()
    except Exception:
        return False
    return True


def download_one(
    row: dict[str, Any],
    output_dir: Path,
    base_url: str,
    retries: int,
) -> dict[str, Any] | None:
    image_name = Path(str(row["image"])).name
    output_path = output_dir / image_name
    if existing_valid(output_path):
        data = output_path.read_bytes()
    else:
        data = b""
        for attempt in range(retries):
            try:
                request = urllib.request.Request(
                    f"{base_url.rstrip('/')}/{image_name}",
                    headers={"User-Agent": "MLLM-Assistant-public-data/1.0"},
                )
                with urllib.request.urlopen(request, timeout=60) as response:
                    data = response.read()
                verify_image(data)
                temporary = output_path.with_name(f".{output_path.name}.{os.getpid()}.tmp")
                temporary.write_bytes(data)
                temporary.replace(output_path)
                break
            except (urllib.error.URLError, TimeoutError, OSError):
                data = b""
                time.sleep(2**attempt)
        if not data:
            return None
    return {
        "source_id": str(row.get("id")),
        "image": str(output_path),
        "image_name": image_name,
        "source_url": f"{base_url.rstrip('/')}/{image_name}",
        "sha256": hashlib.sha256(data).hexdigest(),
        "bytes": len(data),
    }


def main() -> None:
    args = parse_args()
    output_dir = Path(args.output_dir)
    manifest_path = Path(args.manifest)
    output_dir.mkdir(parents=True, exist_ok=True)
    manifest_path.parent.mkdir(parents=True, exist_ok=True)

    rows = json.loads(Path(args.metadata).read_text(encoding="utf-8"))
    candidates = [
        row
        for row in rows
        if str(row.get("image", "")).startswith("coco/train2017/")
        and len(caption(row)) >= args.min_caption_chars
    ]
    random.Random(args.seed).shuffle(candidates)

    selected: list[dict[str, Any]] = []
    batch_size = max(args.limit * 2, args.limit + 1000)
    with ThreadPoolExecutor(max_workers=args.workers) as executor:
        futures = {
            executor.submit(
                download_one,
                row,
                output_dir,
                args.base_url,
                args.retries,
            ): row
            for row in candidates[:batch_size]
        }
        for future in as_completed(futures):
            result = future.result()
            if result is None:
                continue
            selected.append(result)
            if len(selected) % 100 == 0:
                print(f"[coco] verified={len(selected)}/{args.limit}", flush=True)
            if len(selected) >= args.limit:
                for pending in futures:
                    pending.cancel()
                break

    selected.sort(key=lambda item: item["source_id"])
    temporary = manifest_path.with_name(f".{manifest_path.name}.tmp")
    with temporary.open("w", encoding="utf-8") as handle:
        for row in selected:
            handle.write(json.dumps(row, ensure_ascii=False) + "\n")
    temporary.replace(manifest_path)
    print(json.dumps({"verified": len(selected), "target": args.limit}, ensure_ascii=False))
    if len(selected) < args.limit:
        raise SystemExit(f"Only downloaded {len(selected)}/{args.limit} COCO images.")


if __name__ == "__main__":
    main()
