#!/usr/bin/env python3
"""Require a completed human review before formal training."""

from __future__ import annotations

import argparse
import json
from pathlib import Path


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True)
    parser.add_argument("--min-rows", type=int, default=500)
    parser.add_argument("--min-approval-rate", type=float, default=0.90)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    rows = [json.loads(line) for line in Path(args.input).open(encoding="utf-8") if line.strip()]
    completed = [row for row in rows if isinstance(row.get("approved"), bool)]
    approved = [row for row in completed if row["approved"]]
    approval_rate = len(approved) / len(completed) if completed else 0.0
    report = {
        "rows": len(rows),
        "completed": len(completed),
        "approved": len(approved),
        "approval_rate": approval_rate,
    }
    print(json.dumps(report, ensure_ascii=False, indent=2))
    if len(rows) < args.min_rows:
        raise SystemExit(f"Human review has only {len(rows)} rows; require at least {args.min_rows}.")
    if len(completed) != len(rows):
        raise SystemExit("Human review is incomplete; every row must set approved=true or approved=false.")
    if approval_rate < args.min_approval_rate:
        raise SystemExit(
            f"Approval rate {approval_rate:.2%} is below required {args.min_approval_rate:.2%}."
        )


if __name__ == "__main__":
    main()
