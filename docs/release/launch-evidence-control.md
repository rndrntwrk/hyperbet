# Launch Evidence Control Contract (Gates 22-24)

This control document defines the shared launch-evidence contract for all gate
PRs that participate in Gate `22` promotion, Gate `23` proof finalization, and
Gate `24` audit handoff.

Use this as the single checklist for launch-evidence completeness.

## Canonical Inputs And Anchors

Every gate PR that touches Gates `22-24` MUST reference these anchors:

- release freeze manifest:
  - `docs/release/manifests/rc-2026-03-audit-handoff-freeze.json`
- EVM ABI snapshots:
  - `docs/release/abi/gold_clob.abi.json`
  - `docs/release/abi/duel_outcome_oracle.abi.json`
- exploit and test evidence index:
  - `docs/release/exploit-test-evidence-index.md`

## Gate 22 — Mandatory CI Lanes For Promotion

Gate `22` promotion is satisfied only when all mandatory lanes below are
required status checks and green on the candidate commit.

### Mandatory Workflow Lanes (Exact Workflow Names)

| Lane purpose | GitHub workflow name (exact) | Required job/check surface |
|---|---|---|
| fast CI baseline + shared/package validation | `Hyperbet CI` | all required jobs in the workflow (including `EVM Contract Validation`, `Shared Validation`, and required package matrix checks) |
| heavyweight launch gate bundle | `Prediction Market Gates` | `Solana Program Build Gate`, `EVM Contract Proof Gate`, `EVM Contract Security Gate`, `EVM Exploit Gate`, `Solana Exploit Gate`, `Base Add-Chain Smoke` |
| deployed-environment proof rail | `Staged Live Proof` | `Staged Live Proof` job for both `read-only` and `canary-write` runs when used as release evidence |

### Gate 22 Evidence Requirements

For each mandatory lane, attach:

1. workflow run URL
2. commit SHA
3. pass/fail result per required job
4. artifact bundle pointer (or explicit `none` with reason)

## Gate 23 — Required Artifact Bundle Schema

Gate `23` requires a single proof bundle directory committed under
`docs/release/evidence/<release-candidate-tag>/` with three mandatory
sub-bundles:

- `read-only-proof/`
- `canary-proof/`
- `restart-recovery-drill/`

The bundle MUST include a root manifest file named `bundle-manifest.json` using
this schema.

```json
{
  "release_candidate_tag": "string",
  "source_commit": "git sha",
  "generated_at_utc": "ISO-8601 timestamp",
  "inputs": {
    "freeze_manifest_path": "docs/release/manifests/rc-2026-03-audit-handoff-freeze.json",
    "exploit_evidence_index_path": "docs/release/exploit-test-evidence-index.md",
    "abi_snapshots": [
      "docs/release/abi/gold_clob.abi.json",
      "docs/release/abi/duel_outcome_oracle.abi.json"
    ]
  },
  "read_only_proof": {
    "workflow_name": "Staged Live Proof",
    "mode": "read-only",
    "targets": ["solana", "bsc"],
    "run_url": "string",
    "artifacts": [
      {
        "path": "string",
        "sha256": "hex"
      }
    ],
    "checks": {
      "status_endpoint": "pass|fail",
      "active_markets_endpoint": "pass|fail",
      "bot_health_endpoint": "pass|fail",
      "rpc_proxy_validation": "pass|fail",
      "avax_fail_closed_validation": "pass|fail"
    }
  },
  "canary_proof": {
    "workflow_name": "Staged Live Proof",
    "mode": "canary-write",
    "targets": ["solana", "bsc"],
    "run_url": "string",
    "artifacts": [
      {
        "path": "string",
        "sha256": "hex"
      }
    ],
    "onchain_evidence": [
      {
        "chain": "solana|bsc",
        "transaction_ref": "signature or tx hash",
        "explorer_url": "string"
      }
    ],
    "limits": {
      "max_notional_usd": "number",
      "max_order_count": "integer"
    }
  },
  "restart_recovery_drill": {
    "runbook_refs": [
      "docs/runbooks/quote-disablement-and-safe-restart.md",
      "docs/runbooks/stuck-market-recovery.md",
      "docs/runbooks/claim-backlog-drainage.md"
    ],
    "drill_run_id": "string",
    "run_url_or_log_ref": "string",
    "outcomes": {
      "service_restart": "pass|fail",
      "reconciliation": "pass|fail",
      "post_restart_health": "pass|fail"
    },
    "artifacts": [
      {
        "path": "string",
        "sha256": "hex"
      }
    ]
  }
}
```

### Regenerate vs Reuse Rules (Gate 23)

- MUST regenerate for each release-candidate commit:
  - `read_only_proof` run outputs and checks
  - `canary_proof` run outputs, tx references, and limits evidence
  - `restart_recovery_drill` outputs and post-restart health evidence
  - `bundle-manifest.json` with current `source_commit`
- MAY reuse without regeneration unless protocol/deployment surface changed:
  - `docs/release/manifests/rc-2026-03-audit-handoff-freeze.json`
  - ABI snapshot files in `docs/release/abi/`
  - `docs/release/exploit-test-evidence-index.md`
- MUST regenerate the freeze manifest and ABI snapshots if any of the following
  changed since the referenced freeze:
  - contract ABI/interface
  - Solana IDL/program interface
  - deployment registry values used for launch operations

## Gate 24 — Audit Handoff And Remediation Ledger Format

Gate `24` requires two artifacts in `docs/release/manifests/`:

1. `rc-<tag>-audit-handoff.json`
2. `rc-<tag>-remediation-ledger.json`

### Audit Handoff File (`rc-<tag>-audit-handoff.json`)

```json
{
  "release_candidate_tag": "string",
  "source_commit": "git sha",
  "freeze_manifest": "docs/release/manifests/rc-2026-03-audit-handoff-freeze.json",
  "proof_bundle_manifest": "docs/release/evidence/<tag>/bundle-manifest.json",
  "exploit_evidence_index": "docs/release/exploit-test-evidence-index.md",
  "abi_snapshots": [
    "docs/release/abi/gold_clob.abi.json",
    "docs/release/abi/duel_outcome_oracle.abi.json"
  ],
  "workflow_evidence": [
    {
      "workflow_name": "Hyperbet CI|Prediction Market Gates|Staged Live Proof",
      "run_url": "string",
      "result": "pass|fail"
    }
  ],
  "auditor_delivery": {
    "delivered_at_utc": "ISO-8601 timestamp",
    "delivery_channel": "string",
    "recipient": "string"
  }
}
```

### Remediation Ledger File (`rc-<tag>-remediation-ledger.json`)

```json
{
  "release_candidate_tag": "string",
  "generated_at_utc": "ISO-8601 timestamp",
  "findings": [
    {
      "finding_id": "AUD-###",
      "severity": "critical|high|medium|low|note",
      "title": "string",
      "status": "open|in_progress|fixed|accepted|deferred",
      "code_refs": ["path:line"],
      "fix_commit": "git sha or null",
      "verification": {
        "method": "test|review|manual-proof",
        "evidence_ref": "artifact path or URL",
        "verified_by": "string",
        "verified_at_utc": "ISO-8601 timestamp or null"
      },
      "risk_acceptance": {
        "accepted_by": "string or null",
        "rationale": "string or null",
        "expires_at_utc": "ISO-8601 timestamp or null"
      }
    }
  ]
}
```

### Gate 24 Regenerate vs Reuse Rules

- MUST regenerate for each audit cycle:
  - `rc-<tag>-audit-handoff.json`
  - `rc-<tag>-remediation-ledger.json`
  - workflow run references and verification evidence URLs
- MAY reuse by reference if unchanged from frozen commit:
  - freeze manifest
  - ABI snapshots
  - exploit evidence index
- MUST update reused references when any linked artifact hash/path changes.
