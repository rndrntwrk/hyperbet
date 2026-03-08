#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

cd "$ROOT_DIR"

AUDIT_JSON="$(mktemp)"
trap 'rm -f "$AUDIT_JSON"' EXIT

cargo audit --json "$@" > "$AUDIT_JSON"

node - "$AUDIT_JSON" <<'NODE'
const fs = require("fs");

const [, , reportPath] = process.argv;
const report = JSON.parse(fs.readFileSync(reportPath, "utf8"));

const vulnerabilities = report.vulnerabilities?.list ?? [];
const warningsByKind = report.warnings ?? {};
const warnings = Object.entries(warningsByKind).flatMap(([kind, entries]) =>
  (entries ?? []).map((entry) => ({
    kind,
    advisoryId: entry.advisory?.id ?? null,
    packageName: entry.package?.name ?? "unknown",
    title: entry.advisory?.title ?? entry.kind ?? kind,
  })),
);

if (vulnerabilities.length > 0 || warnings.length > 0) {
  if (vulnerabilities.length > 0) {
    console.error("[anchor-audit] Vulnerabilities found:");
    for (const vulnerability of vulnerabilities) {
      const pkg = vulnerability.package?.name ?? "unknown";
      const id = vulnerability.advisory?.id ?? "unknown";
      const title = vulnerability.advisory?.title ?? "unknown";
      console.error(`- ${id} in ${pkg}: ${title}`);
    }
  }

  if (warnings.length > 0) {
    console.error("[anchor-audit] Warnings found:");
    for (const warning of warnings) {
      const id = warning.advisoryId ?? warning.kind;
      console.error(`- ${id} in ${warning.packageName}: ${warning.title}`);
    }
  }

  process.exit(1);
}

console.log("[anchor-audit] No vulnerabilities or warnings found.");
NODE
