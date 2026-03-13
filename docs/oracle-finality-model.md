# Hyperbet Oracle Finality Model (Canonical)

## Model
Hyperbet production finality follows a single **propose → challenge → finalize** flow across EVM and SVM.

1. **Propose**: a reporter publishes a result proposal with immutable proposal ID:
   - `proposal_id = keccak256(duel_key, result_hash, replay_hash)`.
2. **Challenge Window**: a designated challenger can mark the proposal disputed while the dispute window is active.
3. **Finalize**: only finalization authority can finalize an unchallenged proposal after dispute window expiry.

## Authority Constraints
- **Reporter authority**: may upsert duel lifecycle and propose outcomes.
- **Challenger authority**: may challenge only `PROPOSED` outcomes.
- **Finalizer authority**: may finalize only `PROPOSED`, unchallenged outcomes after the full dispute window.
- Authorities MUST be explicitly configured and non-zero.

## Status Semantics
- `PROPOSED`: in-flight, not settled, ineligible for payout.
- `CHALLENGED`: disputed, fail-closed, ineligible for payout.
- `RESOLVED`: finalized winner outcome, payout-eligible.
- `CANCELLED`: terminal cancellation, refund-eligible.

## Settlement Rule
Any market settlement or claim path MUST accept only:
- `RESOLVED` finalized outcomes, or
- `CANCELLED` cancellations.

All in-flight or ambiguous states (`PROPOSED`, `CHALLENGED`, non-terminal lifecycle states) MUST be rejected for settlement.
