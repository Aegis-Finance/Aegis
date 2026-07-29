#!/usr/bin/env python3
"""
Summarize Slither JSON output (slither-report.json).

Environment:
  SLITHER_REPORT_PATH   Path to JSON (default: slither-report.json)
  SLITHER_FAIL_ON_HIGH  If "1"/"true"/"yes", exit 1 when any High-severity finding exists
  SLITHER_FAIL_ON      Comma list of severities to fail on, e.g. "High,Medium"
"""
from __future__ import annotations

import json
import os
import sys
from collections import defaultdict


def _truthy(value: str | None) -> bool:
    if value is None:
        return False
    return value.strip().lower() in ("1", "true", "yes", "on")


def _parse_fail_on() -> set[str]:
    raw = os.environ.get("SLITHER_FAIL_ON", "")
    if raw.strip():
        return {s.strip().title() for s in raw.split(",") if s.strip()}
    if _truthy(os.environ.get("SLITHER_FAIL_ON_HIGH")):
        return {"High"}
    return set()


def analyze_slither_report(path: str) -> dict[str, list[dict]]:
    with open(path, "r", encoding="utf-8") as handle:
        report = json.load(handle)

    results = report.get("results") or {}
    detectors = results.get("detectors") or []

    issues_by_severity: dict[str, list[dict]] = defaultdict(list)
    issues_by_check: dict[str, list[dict]] = defaultdict(list)

    for detector in detectors:
        impact = detector.get("impact", "Unknown")
        check = detector.get("check", "Unknown")
        description = detector.get("description", "No description")
        short = description[:200] + "..." if len(description) > 200 else description

        issues_by_severity[impact].append({"check": check, "description": short})
        issues_by_check[check].append({"impact": impact, "description": short})

    print("=== ISSUES BY SEVERITY ===")
    for severity in ["High", "Medium", "Low", "Informational"]:
        bucket = issues_by_severity.get(severity, [])
        if not bucket:
            continue
        print(f"\n{severity.upper()} ({len(bucket)} issues):")
        for i, issue in enumerate(bucket[:10]):
            print(f'  {i + 1}. {issue["check"]}: {issue["description"]}')
        if len(bucket) > 10:
            print(f"  ... and {len(bucket) - 10} more")

    print("\n\n=== ISSUES BY CHECK TYPE ===")
    for check_type, issues in sorted(issues_by_check.items(), key=lambda x: len(x[1]), reverse=True):
        print(f"\n{check_type} ({len(issues)} issues):")
        severity_counts: dict[str, int] = defaultdict(int)
        for issue in issues:
            severity_counts[issue["impact"]] += 1
        for severity, count in sorted(severity_counts.items()):
            print(f"  - {severity}: {count}")

    counts = {sev: len(issues_by_severity.get(sev, [])) for sev in ["High", "Medium", "Low", "Informational"]}
    print("\n=== COUNTS ===")
    for sev, n in counts.items():
        print(f"  {sev}: {n}")
    print(f"  Total: {sum(counts.values())}")

    return dict(issues_by_severity)


def main() -> int:
    path = os.environ.get("SLITHER_REPORT_PATH", "slither-report.json")
    if not os.path.isfile(path):
        print(f"No Slither report at {path}.", file=sys.stderr)
        print("Run from protocol/: npm run audit:slither:scan", file=sys.stderr)
        return 2

    issues_by_severity = analyze_slither_report(path)

    fail_on = _parse_fail_on()
    if fail_on:
        failed = [s for s in fail_on if issues_by_severity.get(s)]
        if failed:
            print(f"\nPolicy failure: severities with findings: {', '.join(failed)} (set SLITHER_FAIL_ON / SLITHER_FAIL_ON_HIGH)")
            return 1

    return 0


if __name__ == "__main__":
    sys.exit(main())
