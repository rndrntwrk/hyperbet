# Runbook: Rollback

## Trigger
- Regression in settlement, accounting, authority checks, or liveness.

## Steps
1. Halt automation and privileged non-essential operations.
2. Re-deploy / re-point to last known good artifact:
   - EVM: use emergency setters (oracle/fees/treasury) if necessary for safety.
   - SVM: execute downgrade using upgrade authority governance flow.
3. Replay validation suite and verify core invariants.
4. Publish incident + rollback report.

## Validation checklist
- Unauthorized calls are rejected.
- Settlement/cancellation still functions.
- Treasury and market maker fees route correctly.
