#!/usr/bin/env python3
"""Create a stratified human-review sheet from an SFT manifest."""

from __future__ import annotations

import argparse
import json
import random
from collections import defaultdict
from pathlib import Path
from typing import Any


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--rows", type=int, default=500)
    parser.add_argument("--seed", type=int, default=20260612)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    rng = random.Random(args.seed)
    groups: dict[str, list[dict[str, Any]]] = defaultdict(list)
    with Path(args.input).open("r", encoding="utf-8") as handle:
        for line in handle:
            if line.strip():
                row = json.loads(line)
                groups[str(row.get("quality_category", "unknown"))].append(row)

    categories = sorted(groups)
    if not categories:
        raise SystemExit("No records found")
    per_category = max(1, args.rows // len(categories))
    selected: list[dict[str, Any]] = []
    for category in categories:
        rng.shuffle(groups[category])
        selected.extend(groups[category][:per_category])

    remaining = args.rows - len(selected)
    if remaining > 0:
        leftovers = [
            row
            for category in categories
            for row in groups[category][per_category:]
        ]
        rng.shuffle(leftovers)
        selected.extend(leftovers[:remaining])
    rng.shuffle(selected)

    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    with output.open("w", encoding="utf-8") as handle:
        for index, row in enumerate(selected, 1):
            review_row = {
                "review_id": f"review-{index:04d}",
                "quality_category": row.get("quality_category"),
                "answer_mode": row.get("answer_mode"),
                "source": row.get("source"),
                "messages": row.get("messages", []),
                "images": row.get("images", []),
                "approved": None,
                "issue_tags": [],
                "reviewer_notes": "",
            }
            handle.write(json.dumps(review_row, ensure_ascii=False) + "\n")
    print(json.dumps({"output": str(output), "rows": len(selected)}, ensure_ascii=False))


if __name__ == "__main__":
    main()
