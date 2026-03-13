# Runbook: Emergency Cancellation

## Trigger
- Oracle inconsistency, exploit suspicion, stale duel state, or chain partition risk.

## Immediate actions
1. Disable automation bots/reporters.
2. Cancel affected duels:
   - EVM: `cancelDuel` via reporter.
   - SVM: `cancel_duel` via reporter signer.
3. Broadcast incident notice and impacted market IDs.

## Containment
1. Freeze new sensitive config updates except incident response changes.
2. Rotate compromised reporter keys.
3. Reconcile all cancelled market claims and treasury deltas.

## Exit criteria
- Root cause identified.
- Fresh keys in place.
- Simulation + smoke test pass.
