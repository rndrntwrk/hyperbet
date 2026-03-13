# Runbook: Upgrade

## Pre-checks
1. Tests green (EVM + Anchor).
2. Privileged-function inventory reviewed.
3. Rollback artifact prepared.

## EVM
1. Deploy new implementation/contracts.
2. Queue non-emergency sensitive config actions through governance controller.
3. Wait timelock, execute, verify state.

## SVM
1. Build verifiable Anchor artifacts.
2. Submit upgrade from governance-held upgrade authority.
3. Re-run post-upgrade invariants and smoke flow.

## Post-checks
- Confirm authorities, reporter/operator keys, and fee accounts.
- Confirm event stream and settlement path health.
