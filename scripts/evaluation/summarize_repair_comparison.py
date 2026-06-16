#!/usr/bin/env python3
"""Summarize repair comparison reports into a compact JSON file."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any


METRICS = (
    "chars",
    "completion_tokens",
    "length_compliance",
    "early_eos",
    "repeat_4gram",
    "context_keyword_recall",
    "char_f1",
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--artifact-dir", required=True)
    parser.add_argument("--output", required=True)
    return parser.parse_args()


def compact_model_stats(stats: dict[str, Any]) -> dict[str, Any]:
    return {
        key: stats[key]
        for key in ("attempted", "successful", "errors", "error_rate", *METRICS)
        if key in stats
    }


def main() -> None:
    args = parse_args()
    artifact_dir = Path(args.artifact_dir)
    reports = sorted(artifact_dir.glob("*.json"))
    summary: dict[str, Any] = {"artifact_dir": str(artifact_dir), "reports": {}}

    for report in reports:
        if report.name in {"served-models.json", "summary.json"}:
            continue
        data = json.loads(report.read_text(encoding="utf-8"))
        if "summary" not in data:
            continue
        report_summary: dict[str, Any] = {}
        for category, category_stats in data["summary"].items():
            report_summary[category] = {
                model: compact_model_stats(stats)
                for model, stats in category_stats.items()
                if isinstance(stats, dict)
            }
            report_summary[category]["count"] = category_stats.get("count")
        summary["reports"][report.name] = report_summary

    output = Path(args.output)
    output.write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(summary, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
