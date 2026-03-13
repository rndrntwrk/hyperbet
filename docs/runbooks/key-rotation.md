# Runbook: Key Rotation (EVM + SVM)

## Scope
- EVM governance owner / timelock executor / reporter keys.
- SVM upgrade authority, config authority, reporter/operator keys.

## Steps
1. Announce maintenance window and freeze non-essential admin ops.
2. Generate new keys in approved HSM/multisig flow.
3. Rotate EVM:
   - Queue governance `setReporter`/`setGovernanceController`/config target changes.
   - Execute after timelock.
   - Use emergency setters only if compromise is active.
4. Rotate SVM:
   - Execute `update_oracle_config` and `update_config` from authority signer.
   - If needed, rotate program upgrade authority through governance tooling.
5. Verify with read-only checks and dry-run critical paths.
6. Re-enable normal operations and publish change record.
