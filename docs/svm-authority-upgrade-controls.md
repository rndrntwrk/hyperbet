# SVM Authority, Upgrade Authority, and Emergency Controls

## Programs covered
- `fight_oracle`
- `gold_clob_market`

## Authority model (on-chain constraints)

### Upgrade-authority bootstrap gate
Both programs gate first-time `initialize_*` calls with `ProgramData.upgrade_authority_address` checks.
- If upgrade authority is set, only that signer can initialize.
- If upgrade authority is unset/default, a fixed bootstrap authority key is allowed.

### Runtime authority separation
- `fight_oracle`
  - `oracle_config.authority`: can rotate authority/reporter via `update_oracle_config`.
  - `oracle_config.reporter`: can publish duel lifecycle and results.
- `gold_clob_market`
  - `config.authority`: can update market-wide config and fee recipients.
  - `config.market_operator`: can initialize markets.

## Operational process

1. Keep upgrade authority in a dedicated SPL governance realm / multisig.
2. Keep runtime `authority` keys separate from reporter/operator hot keys.
3. Require two-person review and signed changelog for:
   - `update_oracle_config`
   - `update_config`
   - program upgrade deployment.
4. Always stage in localnet/devnet before mainnet promotion.

## Emergency controls

- `fight_oracle.cancel_duel` is the emergency kill-switch for broken/stale matches.
- `gold_clob_market` permits maker-side order cancellations and user claims based on synced duel status.
- In severe incidents, halt reporters/operators off-chain and execute authority rotation before resuming.

## Audit checklist

- Verify `program_data.upgrade_authority_address` matches governance record.
- Verify `oracle_config.authority`, `oracle_config.reporter`.
- Verify `config.authority`, `config.market_operator`, treasury and market-maker accounts.
- Verify no stale bootstrap-only initialization path remains on production deployments.
