#![allow(clippy::too_many_arguments)]
#![allow(unexpected_cfgs)]

use anchor_lang::prelude::*;
use anchor_lang::system_program;
use fight_oracle::{self, DuelState as OracleDuelState, DuelStatus as OracleDuelStatus, MarketSide};

declare_id!("ARVJNJp49VZnkB8QBYZAAFJmufvtVSPhnuuenwwSLwpi");

const CONFIG_SEED: &[u8] = b"config";
const MARKET_SEED: &[u8] = b"market";
const LEVEL_SEED: &[u8] = b"level";
const ORDER_SEED: &[u8] = b"order";
const BALANCE_SEED: &[u8] = b"balance";
const VAULT_SEED: &[u8] = b"vault";

const SIDE_BID: u8 = 1;
const SIDE_ASK: u8 = 2;
const MARKET_KIND_DUEL_WINNER: u8 = 1;
const BITMAP_WORDS: usize = 16;
const MAX_MATCHES_PER_TX: u32 = 50;

const DEFAULT_BOOTSTRAP_AUTHORITY: &str = "DfEnrzh4cgnHxfuZRxLGX69fnLd9DP41XxGuE4gtyJpn";

fn bootstrap_authority() -> Pubkey {
    use std::str::FromStr;
    if let Some(value) = option_env!("HYPERSCAPE_BOOTSTRAP_AUTHORITY") {
        Pubkey::from_str(value).expect("invalid HYPERSCAPE_BOOTSTRAP_AUTHORITY")
    } else {
        Pubkey::from_str(DEFAULT_BOOTSTRAP_AUTHORITY).expect("invalid default bootstrap authority")
    }
}

#[program]
pub mod gold_clob_market {
    use super::*;

    pub fn initialize_config(
        ctx: Context<InitializeConfig>,
        market_operator: Pubkey,
        treasury: Pubkey,
        market_maker: Pubkey,
        trade_treasury_fee_bps: u16,
        trade_market_maker_fee_bps: u16,
        winnings_market_maker_fee_bps: u16,
    ) -> Result<()> {
        validate_fee_config(
            trade_treasury_fee_bps,
            trade_market_maker_fee_bps,
            winnings_market_maker_fee_bps,
        )?;
        require!(
            market_operator != Pubkey::default(),
            ErrorCode::InvalidOperator
        );
        require!(treasury != Pubkey::default(), ErrorCode::InvalidFeeAccount);
        require!(
            market_maker != Pubkey::default(),
            ErrorCode::InvalidFeeAccount
        );

        let config = &mut ctx.accounts.config;
        if config.authority != Pubkey::default() {
            require_keys_eq!(
                config.authority,
                ctx.accounts.authority.key(),
                ErrorCode::UnauthorizedConfigAuthority
            );
        } else {
            config.authority = ctx.accounts.authority.key();
            config.bump = ctx.bumps.config;
        }

        config.market_operator = market_operator;
        config.treasury = treasury;
        config.market_maker = market_maker;
        config.trade_treasury_fee_bps = trade_treasury_fee_bps;
        config.trade_market_maker_fee_bps = trade_market_maker_fee_bps;
        config.winnings_market_maker_fee_bps = winnings_market_maker_fee_bps;
        Ok(())
    }

    pub fn update_config(
        ctx: Context<UpdateConfig>,
        authority: Pubkey,
        market_operator: Pubkey,
        treasury: Pubkey,
        market_maker: Pubkey,
        trade_treasury_fee_bps: u16,
        trade_market_maker_fee_bps: u16,
        winnings_market_maker_fee_bps: u16,
    ) -> Result<()> {
        require_keys_eq!(
            ctx.accounts.config.authority,
            ctx.accounts.authority.key(),
            ErrorCode::UnauthorizedConfigAuthority
        );
        validate_fee_config(
            trade_treasury_fee_bps,
            trade_market_maker_fee_bps,
            winnings_market_maker_fee_bps,
        )?;
        require!(authority != Pubkey::default(), ErrorCode::InvalidAuthority);
        require!(
            market_operator != Pubkey::default(),
            ErrorCode::InvalidOperator
        );
        require!(treasury != Pubkey::default(), ErrorCode::InvalidFeeAccount);
        require!(
            market_maker != Pubkey::default(),
            ErrorCode::InvalidFeeAccount
        );

        let config = &mut ctx.accounts.config;
        config.authority = authority;
        config.market_operator = market_operator;
        config.treasury = treasury;
        config.market_maker = market_maker;
        config.trade_treasury_fee_bps = trade_treasury_fee_bps;
        config.trade_market_maker_fee_bps = trade_market_maker_fee_bps;
        config.winnings_market_maker_fee_bps = winnings_market_maker_fee_bps;
        Ok(())
    }

    pub fn initialize_market(
        ctx: Context<InitializeMarket>,
        duel_key: [u8; 32],
        market_kind: u8,
    ) -> Result<()> {
        require!(market_kind == MARKET_KIND_DUEL_WINNER, ErrorCode::InvalidMarketKind);
        require!(
            ctx.accounts.operator.key() == ctx.accounts.config.authority
                || ctx.accounts.operator.key() == ctx.accounts.config.market_operator,
            ErrorCode::UnauthorizedMarketOperator
        );
        require!(
            ctx.accounts.duel_state.duel_key == duel_key,
            ErrorCode::DuelMismatch
        );
        require!(
            ctx.accounts.duel_state.status == OracleDuelStatus::BettingOpen
                || ctx.accounts.duel_state.status == OracleDuelStatus::Locked,
            ErrorCode::MarketCreationClosed
        );

        let market_state = &mut ctx.accounts.market_state;
        market_state.bump = ctx.bumps.market_state;
        market_state.vault_bump = ctx.bumps.vault;
        market_state.duel_state = ctx.accounts.duel_state.key();
        market_state.duel_key = duel_key;
        market_state.market_kind = market_kind;
        market_state.status = map_duel_status(ctx.accounts.duel_state.status);
        market_state.next_order_id = 1;
        market_state.best_ask = 1000;
        market_state.authority = ctx.accounts.operator.key();
        Ok(())
    }

    pub fn sync_market_from_duel(ctx: Context<SyncMarketFromDuel>) -> Result<()> {
        sync_market_status(
            &mut ctx.accounts.market_state,
            &ctx.accounts.duel_state,
            ctx.accounts.duel_state.key(),
        )
    }

    pub fn place_order<'info>(
        ctx: Context<'_, '_, 'info, 'info, PlaceOrder<'info>>,
        order_id: u64,
        side: u8,
        price: u16,
        amount: u64,
    ) -> Result<()> {
        validate_side(side)?;
        require!(price > 0 && price < 1000, ErrorCode::InvalidPrice);
        require!(amount > 0, ErrorCode::InvalidAmount);

        let market_state = &mut ctx.accounts.market_state;
        sync_market_status(market_state, &ctx.accounts.duel_state, ctx.accounts.duel_state.key())?;
        require!(market_state.status == MarketStatus::Open, ErrorCode::MarketNotOpen);
        require!(
            Clock::get()?.unix_timestamp < ctx.accounts.duel_state.bet_close_ts,
            ErrorCode::BettingClosed
        );
        require!(order_id == market_state.next_order_id, ErrorCode::InvalidOrderId);
        market_state.next_order_id = market_state
            .next_order_id
            .checked_add(1)
            .ok_or(ErrorCode::MathOverflow)?;

        let cost = quote_cost(side, price, amount)?;
        let user_balance = &mut ctx.accounts.user_balance;
        user_balance.user = ctx.accounts.user.key();
        user_balance.market_state = market_state.key();

        let trade_treasury_fee = bps_fee(cost, ctx.accounts.config.trade_treasury_fee_bps)?;
        let trade_market_maker_fee = bps_fee(cost, ctx.accounts.config.trade_market_maker_fee_bps)?;

        if trade_treasury_fee > 0 {
            system_program::transfer(
                CpiContext::new(
                    ctx.accounts.system_program.to_account_info(),
                    system_program::Transfer {
                        from: ctx.accounts.user.to_account_info(),
                        to: ctx.accounts.treasury.to_account_info(),
                    },
                ),
                trade_treasury_fee,
            )?;
        }

        if trade_market_maker_fee > 0 {
            system_program::transfer(
                CpiContext::new(
                    ctx.accounts.system_program.to_account_info(),
                    system_program::Transfer {
                        from: ctx.accounts.user.to_account_info(),
                        to: ctx.accounts.market_maker.to_account_info(),
                    },
                ),
                trade_market_maker_fee,
            )?;
        }

        system_program::transfer(
            CpiContext::new(
                ctx.accounts.system_program.to_account_info(),
                system_program::Transfer {
                    from: ctx.accounts.user.to_account_info(),
                    to: ctx.accounts.vault.to_account_info(),
                },
            ),
            cost,
        )?;

        let market_key = market_state.key();
        let vault_bump = market_state.vault_bump;
        let opposite_side = if side == SIDE_BID { SIDE_ASK } else { SIDE_BID };
        let mut remaining_amount = amount;
        let mut total_improvement = 0_u64;
        let mut matches_count = 0_u32;
        let mut account_idx = 0_usize;

        while remaining_amount > 0 && matches_count < MAX_MATCHES_PER_TX {
            let boundary_price = if side == SIDE_BID {
                market_state.best_ask
            } else {
                market_state.best_bid
            };

            let price_crosses = if side == SIDE_BID {
                boundary_price <= price && boundary_price < 1000
            } else {
                boundary_price >= price && boundary_price > 0
            };
            if !price_crosses {
                break;
            }

            let level_info = ctx
                .remaining_accounts
                .get(account_idx)
                .ok_or(ErrorCode::MissingMatchAccounts)?;
            let expected_level_key = derive_level_key(&market_key, opposite_side, boundary_price);
            require_keys_eq!(
                level_info.key(),
                expected_level_key,
                ErrorCode::InvalidRemainingAccount
            );
            account_idx += 1;
            let mut level: Account<PriceLevel> = Account::try_from(level_info)
                .map_err(|_| ErrorCode::InvalidRemainingAccount)?;
            require_keys_eq!(
                level.market_state,
                market_key,
                ErrorCode::InvalidRemainingAccount
            );
            require!(level.side == opposite_side, ErrorCode::InvalidRemainingAccount);
            require!(level.price == boundary_price, ErrorCode::InvalidRemainingAccount);

            if level.total_open == 0 || level.head_order_id == 0 {
                set_price_bit(market_state, opposite_side, boundary_price, false);
                update_best_prices(market_state);
                level.head_order_id = 0;
                level.tail_order_id = 0;
                level.exit(&crate::ID)?;
                continue;
            }

            let maker_order_info = ctx
                .remaining_accounts
                .get(account_idx)
                .ok_or(ErrorCode::MissingMatchAccounts)?;
            let expected_order_key = derive_order_key(&market_key, level.head_order_id);
            require_keys_eq!(
                maker_order_info.key(),
                expected_order_key,
                ErrorCode::InvalidRemainingAccount
            );
            account_idx += 1;
            let mut maker_order: Account<Order> = Account::try_from(maker_order_info)
                .map_err(|_| ErrorCode::InvalidRemainingAccount)?;

            let maker_balance_info = ctx
                .remaining_accounts
                .get(account_idx)
                .ok_or(ErrorCode::MissingMatchAccounts)?;
            account_idx += 1;
            let mut maker_balance: Account<UserBalance> =
                Account::try_from(maker_balance_info)
                    .map_err(|_| ErrorCode::InvalidRemainingAccount)?;

            require!(maker_order.market_state == market_key, ErrorCode::InvalidRemainingAccount);
            require!(maker_order.side == opposite_side, ErrorCode::InvalidRemainingAccount);
            require!(maker_order.price == boundary_price, ErrorCode::InvalidRemainingAccount);
            require!(maker_order.maker == maker_balance.user, ErrorCode::InvalidRemainingAccount);
            require!(
                maker_balance.market_state == market_key,
                ErrorCode::InvalidRemainingAccount
            );

            let maker_remaining = maker_order
                .amount
                .checked_sub(maker_order.filled)
                .ok_or(ErrorCode::MathOverflow)?;
            if !maker_order.active || maker_remaining == 0 {
                unlink_head_order(market_state, &mut level, &mut maker_order);
                maker_order.exit(&crate::ID)?;
                maker_balance.exit(&crate::ID)?;
                level.exit(&crate::ID)?;
                matches_count = matches_count
                    .checked_add(1)
                    .ok_or(ErrorCode::MathOverflow)?;
                continue;
            }

            let fill_amount = std::cmp::min(remaining_amount, maker_remaining);
            if maker_order.maker == ctx.accounts.user.key() {
                msg!(
                    "self_trade_policy_triggered policy=allow_with_detection_only market={} maker_order_id={} taker_order_id={} maker={} taker={} price={} amount={}",
                    market_key,
                    maker_order.id,
                    order_id,
                    maker_order.maker,
                    ctx.accounts.user.key(),
                    boundary_price,
                    fill_amount
                );
            }
            maker_order.filled = maker_order
                .filled
                .checked_add(fill_amount)
                .ok_or(ErrorCode::MathOverflow)?;
            remaining_amount = remaining_amount
                .checked_sub(fill_amount)
                .ok_or(ErrorCode::MathOverflow)?;
            level.total_open = level
                .total_open
                .checked_sub(fill_amount)
                .ok_or(ErrorCode::MathOverflow)?;

            if side == SIDE_BID {
                let maker_locked = quote_cost(SIDE_ASK, boundary_price, fill_amount)?;
                let taker_locked = quote_cost(SIDE_BID, boundary_price, fill_amount)?;
                maker_balance.b_shares = maker_balance
                    .b_shares
                    .checked_add(fill_amount)
                    .ok_or(ErrorCode::MathOverflow)?;
                maker_balance.b_locked_lamports = maker_balance
                    .b_locked_lamports
                    .checked_add(maker_locked)
                    .ok_or(ErrorCode::MathOverflow)?;
                user_balance.a_shares = user_balance
                    .a_shares
                    .checked_add(fill_amount)
                    .ok_or(ErrorCode::MathOverflow)?;
                user_balance.a_locked_lamports = user_balance
                    .a_locked_lamports
                    .checked_add(taker_locked)
                    .ok_or(ErrorCode::MathOverflow)?;

                if price > boundary_price {
                    total_improvement = total_improvement
                        .checked_add(
                            fill_amount
                                .checked_mul((price - boundary_price) as u64)
                                .ok_or(ErrorCode::MathOverflow)?
                                .checked_div(1000)
                                .ok_or(ErrorCode::MathOverflow)?,
                        )
                        .ok_or(ErrorCode::MathOverflow)?;
                }
            } else {
                let maker_locked = quote_cost(SIDE_BID, boundary_price, fill_amount)?;
                let taker_locked = quote_cost(SIDE_ASK, boundary_price, fill_amount)?;
                maker_balance.a_shares = maker_balance
                    .a_shares
                    .checked_add(fill_amount)
                    .ok_or(ErrorCode::MathOverflow)?;
                maker_balance.a_locked_lamports = maker_balance
                    .a_locked_lamports
                    .checked_add(maker_locked)
                    .ok_or(ErrorCode::MathOverflow)?;
                user_balance.b_shares = user_balance
                    .b_shares
                    .checked_add(fill_amount)
                    .ok_or(ErrorCode::MathOverflow)?;
                user_balance.b_locked_lamports = user_balance
                    .b_locked_lamports
                    .checked_add(taker_locked)
                    .ok_or(ErrorCode::MathOverflow)?;

                if boundary_price > price {
                    total_improvement = total_improvement
                        .checked_add(
                            fill_amount
                                .checked_mul((boundary_price - price) as u64)
                                .ok_or(ErrorCode::MathOverflow)?
                                .checked_div(1000)
                                .ok_or(ErrorCode::MathOverflow)?,
                        )
                        .ok_or(ErrorCode::MathOverflow)?;
                }
            }

            if maker_order.filled >= maker_order.amount {
                unlink_head_order(market_state, &mut level, &mut maker_order);
            }

            maker_order.exit(&crate::ID)?;
            maker_balance.exit(&crate::ID)?;
            level.exit(&crate::ID)?;
            matches_count = matches_count
                .checked_add(1)
                .ok_or(ErrorCode::MathOverflow)?;
        }

        if total_improvement > 0 {
            let seeds: &[&[u8]] = &[VAULT_SEED, market_key.as_ref(), &[vault_bump]];
            let signer_seeds: &[&[&[u8]]] = &[seeds];
            system_program::transfer(
                CpiContext::new_with_signer(
                    ctx.accounts.system_program.to_account_info(),
                    system_program::Transfer {
                        from: ctx.accounts.vault.to_account_info(),
                        to: ctx.accounts.user.to_account_info(),
                    },
                    signer_seeds,
                ),
                total_improvement,
            )?;
        }

        if remaining_amount > 0 {
            let level = &mut ctx.accounts.resting_level;
            if level.market_state == Pubkey::default() {
                level.market_state = market_key;
                level.side = side;
                level.price = price;
                level.bump = ctx.bumps.resting_level;
            } else {
                require_keys_eq!(level.market_state, market_key, ErrorCode::PriceLevelMismatch);
                require!(level.side == side, ErrorCode::PriceLevelMismatch);
                require!(level.price == price, ErrorCode::PriceLevelMismatch);
            }

            let new_order = &mut ctx.accounts.new_order;
            new_order.market_state = market_key;
            new_order.id = order_id;
            new_order.side = side;
            new_order.price = price;
            new_order.maker = ctx.accounts.user.key();
            new_order.amount = remaining_amount;
            new_order.filled = 0;
            new_order.prev_order_id = level.tail_order_id;
            new_order.next_order_id = 0;
            new_order.active = true;
            new_order.bump = ctx.bumps.new_order;

            if level.tail_order_id != 0 {
                let tail_info = ctx
                    .remaining_accounts
                    .get(account_idx)
                    .ok_or(ErrorCode::MissingTailOrder)?;
                let expected_tail_key = derive_order_key(&market_key, level.tail_order_id);
                require_keys_eq!(
                    tail_info.key(),
                    expected_tail_key,
                    ErrorCode::InvalidRemainingAccount
                );
                let mut tail_order: Account<Order> = Account::try_from(tail_info)
                    .map_err(|_| ErrorCode::InvalidRemainingAccount)?;
                tail_order.next_order_id = order_id;
                tail_order.exit(&crate::ID)?;
            } else {
                level.head_order_id = order_id;
            }

            level.tail_order_id = order_id;
            level.total_open = level
                .total_open
                .checked_add(remaining_amount)
                .ok_or(ErrorCode::MathOverflow)?;
            set_price_bit(market_state, side, price, true);
            update_best_prices(market_state);
        } else {
            ctx.accounts
                .new_order
                .close(ctx.accounts.user.to_account_info())?;
            if ctx.accounts.resting_level.total_open == 0
                && ctx.accounts.resting_level.head_order_id == 0
                && ctx.accounts.resting_level.market_state == Pubkey::default()
            {
                ctx.accounts
                    .resting_level
                    .close(ctx.accounts.user.to_account_info())?;
            }
        }

        Ok(())
    }

    pub fn cancel_order<'info>(
        ctx: Context<'_, '_, 'info, 'info, CancelOrder<'info>>,
        order_id: u64,
        side: u8,
        price: u16,
    ) -> Result<()> {
        validate_side(side)?;
        require!(price > 0 && price < 1000, ErrorCode::InvalidPrice);

        let market_state = &mut ctx.accounts.market_state;
        sync_market_status(
            market_state,
            &ctx.accounts.duel_state,
            ctx.accounts.duel_state.key(),
        )?;

        let order = &mut ctx.accounts.order;
        require!(order.id == order_id, ErrorCode::InvalidOrderId);
        require!(order.side == side, ErrorCode::OrderSideMismatch);
        require!(order.price == price, ErrorCode::OrderPriceMismatch);
        require!(order.maker == ctx.accounts.user.key(), ErrorCode::NotOrderMaker);

        let remaining = order
            .amount
            .checked_sub(order.filled)
            .ok_or(ErrorCode::MathOverflow)?;
        if order.active {
            let price_level = &mut ctx.accounts.price_level;
            require_keys_eq!(
                price_level.market_state,
                market_state.key(),
                ErrorCode::PriceLevelMismatch
            );
            require!(price_level.side == side, ErrorCode::PriceLevelMismatch);
            require!(price_level.price == price, ErrorCode::PriceLevelMismatch);

            let mut cursor = 0_usize;
            let mut prev_order = load_adjacent_order(
                ctx.remaining_accounts,
                &mut cursor,
                market_state.key(),
                order.prev_order_id,
            )?;
            let mut next_order = load_adjacent_order(
                ctx.remaining_accounts,
                &mut cursor,
                market_state.key(),
                order.next_order_id,
            )?;

            unlink_order(
                market_state,
                price_level,
                order,
                prev_order.as_mut(),
                next_order.as_mut(),
                remaining,
            )?;

            if let Some(prev) = prev_order.as_mut() {
                prev.exit(&crate::ID)?;
            }
            if let Some(next) = next_order.as_mut() {
                next.exit(&crate::ID)?;
            }
            if price_level.total_open == 0 {
                price_level.close(ctx.accounts.user.to_account_info())?;
            }
        }

        if remaining > 0 {
            let market_key = market_state.key();
            let vault_bump = market_state.vault_bump;
            let seeds: &[&[u8]] = &[VAULT_SEED, market_key.as_ref(), &[vault_bump]];
            let signer_seeds: &[&[&[u8]]] = &[seeds];
            system_program::transfer(
                CpiContext::new_with_signer(
                    ctx.accounts.system_program.to_account_info(),
                    system_program::Transfer {
                        from: ctx.accounts.vault.to_account_info(),
                        to: ctx.accounts.user.to_account_info(),
                    },
                    signer_seeds,
                ),
                quote_cost(side, price, remaining)?,
            )?;
        }

        order.active = false;
        order.prev_order_id = 0;
        order.next_order_id = 0;
        order.filled = order.amount;
        Ok(())
    }

    pub fn claim(ctx: Context<Claim>) -> Result<()> {
        let market_state = &mut ctx.accounts.market_state;
        sync_market_status(market_state, &ctx.accounts.duel_state, ctx.accounts.duel_state.key())?;

        let user_balance = &mut ctx.accounts.user_balance;
        let (fee, payout) = if market_state.status == MarketStatus::Cancelled {
            let refund_lamports = user_balance
                .a_locked_lamports
                .checked_add(user_balance.b_locked_lamports)
                .ok_or(ErrorCode::MathOverflow)?;
            require!(refund_lamports > 0, ErrorCode::NothingToClaim);
            user_balance.a_shares = 0;
            user_balance.b_shares = 0;
            user_balance.a_locked_lamports = 0;
            user_balance.b_locked_lamports = 0;
            (0, refund_lamports)
        } else {
            require!(market_state.status == MarketStatus::Resolved, ErrorCode::MarketNotResolved);
            let mut winning_shares = 0_u64;
            if market_state.winner == MarketSide::A {
                winning_shares = user_balance.a_shares;
                user_balance.a_shares = 0;
                user_balance.a_locked_lamports = 0;
            } else if market_state.winner == MarketSide::B {
                winning_shares = user_balance.b_shares;
                user_balance.b_shares = 0;
                user_balance.b_locked_lamports = 0;
            }
            require!(winning_shares > 0, ErrorCode::NothingToClaim);

            let fee = bps_fee(winning_shares, ctx.accounts.config.winnings_market_maker_fee_bps)?;
            let payout = winning_shares
                .checked_sub(fee)
                .ok_or(ErrorCode::MathOverflow)?;
            (fee, payout)
        };

        let market_key = market_state.key();
        let vault_bump = market_state.vault_bump;
        let seeds: &[&[u8]] = &[VAULT_SEED, market_key.as_ref(), &[vault_bump]];
        let signer_seeds: &[&[&[u8]]] = &[seeds];

        if fee > 0 {
            system_program::transfer(
                CpiContext::new_with_signer(
                    ctx.accounts.system_program.to_account_info(),
                    system_program::Transfer {
                        from: ctx.accounts.vault.to_account_info(),
                        to: ctx.accounts.market_maker.to_account_info(),
                    },
                    signer_seeds,
                ),
                fee,
            )?;
        }

        system_program::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.system_program.to_account_info(),
                system_program::Transfer {
                    from: ctx.accounts.vault.to_account_info(),
                    to: ctx.accounts.user.to_account_info(),
                },
                signer_seeds,
            ),
            payout,
        )?;

        Ok(())
    }
}

#[derive(Accounts)]
pub struct InitializeConfig<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(
        init_if_needed,
        payer = authority,
        space = 8 + MarketConfig::INIT_SPACE,
        seeds = [CONFIG_SEED],
        bump,
    )]
    pub config: Account<'info, MarketConfig>,
    #[account(
        constraint = program.programdata_address()? == Some(program_data.key()) @ ErrorCode::UnauthorizedInitializer
    )]
    pub program: Program<'info, crate::program::GoldClobMarket>,
    #[account(
        constraint = program_data.upgrade_authority_address == Some(authority.key())
            || ((program_data.upgrade_authority_address.is_none()
                || program_data.upgrade_authority_address == Some(Pubkey::default()))
                && authority.key() == bootstrap_authority()) @ ErrorCode::UnauthorizedInitializer
    )]
    pub program_data: Account<'info, ProgramData>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct UpdateConfig<'info> {
    pub authority: Signer<'info>,
    #[account(
        mut,
        seeds = [CONFIG_SEED],
        bump = config.bump,
    )]
    pub config: Account<'info, MarketConfig>,
}

#[derive(Accounts)]
#[instruction(duel_key: [u8; 32], market_kind: u8)]
pub struct InitializeMarket<'info> {
    #[account(mut)]
    pub operator: Signer<'info>,
    #[account(
        seeds = [CONFIG_SEED],
        bump = config.bump,
    )]
    pub config: Account<'info, MarketConfig>,
    #[account(
        constraint = duel_state.duel_key == duel_key @ ErrorCode::DuelMismatch,
    )]
    pub duel_state: Account<'info, OracleDuelState>,
    #[account(
        init,
        payer = operator,
        space = 8 + MarketState::INIT_SPACE,
        seeds = [MARKET_SEED, duel_state.key().as_ref(), &[market_kind]],
        bump,
    )]
    pub market_state: Account<'info, MarketState>,
    /// CHECK: Native SOL vault PDA for this market
    #[account(
        mut,
        seeds = [VAULT_SEED, market_state.key().as_ref()],
        bump,
    )]
    pub vault: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct SyncMarketFromDuel<'info> {
    #[account(mut)]
    pub market_state: Account<'info, MarketState>,
    #[account(address = market_state.duel_state @ ErrorCode::DuelMismatch)]
    pub duel_state: Account<'info, OracleDuelState>,
}

#[derive(Accounts)]
#[instruction(order_id: u64, side: u8, price: u16)]
pub struct PlaceOrder<'info> {
    #[account(mut)]
    pub market_state: Box<Account<'info, MarketState>>,
    #[account(address = market_state.duel_state @ ErrorCode::DuelMismatch)]
    pub duel_state: Box<Account<'info, OracleDuelState>>,
    #[account(
        init_if_needed,
        payer = user,
        space = 8 + UserBalance::INIT_SPACE,
        seeds = [BALANCE_SEED, market_state.key().as_ref(), user.key().as_ref()],
        bump,
    )]
    pub user_balance: Box<Account<'info, UserBalance>>,
    #[account(
        init,
        payer = user,
        space = 8 + Order::INIT_SPACE,
        seeds = [ORDER_SEED, market_state.key().as_ref(), &order_id.to_le_bytes()],
        bump,
    )]
    pub new_order: Box<Account<'info, Order>>,
    #[account(
        init_if_needed,
        payer = user,
        space = 8 + PriceLevel::INIT_SPACE,
        seeds = [LEVEL_SEED, market_state.key().as_ref(), &[side], &price.to_le_bytes()],
        bump,
    )]
    pub resting_level: Box<Account<'info, PriceLevel>>,
    #[account(
        seeds = [CONFIG_SEED],
        bump = config.bump,
    )]
    pub config: Box<Account<'info, MarketConfig>>,
    /// CHECK: Treasury wallet for trade fees
    #[account(
        mut,
        address = config.treasury @ ErrorCode::InvalidFeeAccount,
    )]
    pub treasury: UncheckedAccount<'info>,
    /// CHECK: Market maker wallet for trade and winnings fees
    #[account(
        mut,
        address = config.market_maker @ ErrorCode::InvalidFeeAccount,
    )]
    pub market_maker: UncheckedAccount<'info>,
    /// CHECK: Native SOL vault PDA
    #[account(
        mut,
        seeds = [VAULT_SEED, market_state.key().as_ref()],
        bump = market_state.vault_bump,
    )]
    pub vault: UncheckedAccount<'info>,
    #[account(mut)]
    pub user: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(order_id: u64, side: u8, price: u16)]
pub struct CancelOrder<'info> {
    #[account(mut)]
    pub market_state: Box<Account<'info, MarketState>>,
    #[account(address = market_state.duel_state @ ErrorCode::DuelMismatch)]
    pub duel_state: Box<Account<'info, OracleDuelState>>,
    #[account(
        mut,
        seeds = [ORDER_SEED, market_state.key().as_ref(), &order_id.to_le_bytes()],
        bump = order.bump,
        close = user,
    )]
    pub order: Box<Account<'info, Order>>,
    #[account(
        mut,
        seeds = [LEVEL_SEED, market_state.key().as_ref(), &[side], &price.to_le_bytes()],
        bump = price_level.bump,
    )]
    pub price_level: Box<Account<'info, PriceLevel>>,
    /// CHECK: Native SOL vault PDA
    #[account(
        mut,
        seeds = [VAULT_SEED, market_state.key().as_ref()],
        bump = market_state.vault_bump,
    )]
    pub vault: UncheckedAccount<'info>,
    #[account(mut)]
    pub user: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Claim<'info> {
    #[account(mut)]
    pub market_state: Box<Account<'info, MarketState>>,
    #[account(address = market_state.duel_state @ ErrorCode::DuelMismatch)]
    pub duel_state: Box<Account<'info, OracleDuelState>>,
    #[account(
        mut,
        seeds = [BALANCE_SEED, market_state.key().as_ref(), user.key().as_ref()],
        bump,
    )]
    pub user_balance: Box<Account<'info, UserBalance>>,
    #[account(
        seeds = [CONFIG_SEED],
        bump = config.bump,
    )]
    pub config: Box<Account<'info, MarketConfig>>,
    /// CHECK: Market maker wallet for winnings fee
    #[account(
        mut,
        address = config.market_maker @ ErrorCode::InvalidFeeAccount,
    )]
    pub market_maker: UncheckedAccount<'info>,
    /// CHECK: Native SOL vault PDA
    #[account(
        mut,
        seeds = [VAULT_SEED, market_state.key().as_ref()],
        bump = market_state.vault_bump,
    )]
    pub vault: UncheckedAccount<'info>,
    #[account(mut)]
    pub user: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[account]
#[derive(InitSpace)]
pub struct MarketConfig {
    pub authority: Pubkey,
    pub market_operator: Pubkey,
    pub treasury: Pubkey,
    pub market_maker: Pubkey,
    pub trade_treasury_fee_bps: u16,
    pub trade_market_maker_fee_bps: u16,
    pub winnings_market_maker_fee_bps: u16,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct MarketState {
    pub duel_state: Pubkey,
    pub duel_key: [u8; 32],
    pub market_kind: u8,
    pub status: MarketStatus,
    pub winner: MarketSide,
    pub next_order_id: u64,
    pub best_bid: u16,
    pub best_ask: u16,
    pub authority: Pubkey,
    pub bid_bitmap: [u64; BITMAP_WORDS],
    pub ask_bitmap: [u64; BITMAP_WORDS],
    pub vault_bump: u8,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct PriceLevel {
    pub market_state: Pubkey,
    pub side: u8,
    pub price: u16,
    pub head_order_id: u64,
    pub tail_order_id: u64,
    pub total_open: u64,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct Order {
    pub market_state: Pubkey,
    pub id: u64,
    pub side: u8,
    pub price: u16,
    pub maker: Pubkey,
    pub amount: u64,
    pub filled: u64,
    pub prev_order_id: u64,
    pub next_order_id: u64,
    pub active: bool,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct UserBalance {
    pub user: Pubkey,
    pub market_state: Pubkey,
    pub a_shares: u64,
    pub b_shares: u64,
    pub a_locked_lamports: u64,
    pub b_locked_lamports: u64,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, Eq, PartialEq, InitSpace)]
pub enum MarketStatus {
    Open,
    Locked,
    Resolved,
    Cancelled,
}

fn validate_fee_config(
    trade_treasury_fee_bps: u16,
    trade_market_maker_fee_bps: u16,
    winnings_market_maker_fee_bps: u16,
) -> Result<()> {
    require!(
        trade_treasury_fee_bps + trade_market_maker_fee_bps <= 10_000,
        ErrorCode::FeeTooHigh
    );
    require!(winnings_market_maker_fee_bps <= 10_000, ErrorCode::FeeTooHigh);
    Ok(())
}

fn bps_fee(amount: u64, fee_bps: u16) -> Result<u64> {
    amount
        .checked_mul(fee_bps as u64)
        .ok_or(ErrorCode::MathOverflow)?
        .checked_div(10_000)
        .ok_or(ErrorCode::MathOverflow.into())
}

fn validate_side(side: u8) -> Result<()> {
    require!(side == SIDE_BID || side == SIDE_ASK, ErrorCode::InvalidSide);
    Ok(())
}

fn quote_cost(side: u8, price: u16, amount: u64) -> Result<u64> {
    let price_component = if side == SIDE_BID {
        price as u64
    } else {
        1000_u64
            .checked_sub(price as u64)
            .ok_or(ErrorCode::MathOverflow)?
    };
    let total = amount
        .checked_mul(price_component)
        .ok_or(ErrorCode::MathOverflow)?;
    require!(total % 1000 == 0, ErrorCode::PrecisionError);
    let cost = total.checked_div(1000).ok_or(ErrorCode::MathOverflow)?;
    require!(cost > 0, ErrorCode::CostTooLow);
    Ok(cost)
}

fn map_duel_status(status: OracleDuelStatus) -> MarketStatus {
    match status {
        OracleDuelStatus::Scheduled => MarketStatus::Locked,
        OracleDuelStatus::BettingOpen => MarketStatus::Open,
        OracleDuelStatus::Locked => MarketStatus::Locked,
        OracleDuelStatus::Resolved => MarketStatus::Resolved,
        OracleDuelStatus::Cancelled => MarketStatus::Cancelled,
    }
}

fn sync_market_status(
    market_state: &mut MarketState,
    duel_state: &OracleDuelState,
    duel_pubkey: Pubkey,
) -> Result<()> {
    require_keys_eq!(market_state.duel_state, duel_pubkey, ErrorCode::DuelMismatch);
    market_state.status = map_duel_status(duel_state.status);
    if duel_state.status == OracleDuelStatus::Resolved {
        market_state.winner = duel_state.winner;
    }
    if duel_state.status == OracleDuelStatus::Cancelled {
        market_state.winner = MarketSide::None;
    }
    Ok(())
}

fn derive_order_key(market_key: &Pubkey, order_id: u64) -> Pubkey {
    Pubkey::find_program_address(
        &[ORDER_SEED, market_key.as_ref(), &order_id.to_le_bytes()],
        &crate::ID,
    )
    .0
}

fn derive_level_key(market_key: &Pubkey, side: u8, price: u16) -> Pubkey {
    Pubkey::find_program_address(
        &[LEVEL_SEED, market_key.as_ref(), &[side], &price.to_le_bytes()],
        &crate::ID,
    )
    .0
}

fn bitmap_ref_mut(market_state: &mut MarketState, side: u8) -> &mut [u64; BITMAP_WORDS] {
    if side == SIDE_BID {
        &mut market_state.bid_bitmap
    } else {
        &mut market_state.ask_bitmap
    }
}

fn highest_set_price(bitmap: &[u64; BITMAP_WORDS]) -> Option<u16> {
    for (word_idx, word) in bitmap.iter().enumerate().rev() {
        if *word == 0 {
            continue;
        }
        let bit = 63_u32
            .checked_sub(word.leading_zeros())
            .unwrap_or_default() as usize;
        let price = word_idx
            .checked_mul(64)
            .and_then(|value| value.checked_add(bit))?;
        if price <= 999 {
            return Some(price as u16);
        }
    }
    None
}

fn lowest_set_price(bitmap: &[u64; BITMAP_WORDS]) -> Option<u16> {
    for (word_idx, word) in bitmap.iter().enumerate() {
        if *word == 0 {
            continue;
        }
        let bit = word.trailing_zeros() as usize;
        let price = word_idx
            .checked_mul(64)
            .and_then(|value| value.checked_add(bit))?;
        if (1..=999).contains(&price) {
            return Some(price as u16);
        }
    }
    None
}

fn update_best_prices(market_state: &mut MarketState) {
    market_state.best_bid = highest_set_price(&market_state.bid_bitmap).unwrap_or(0);
    market_state.best_ask = lowest_set_price(&market_state.ask_bitmap).unwrap_or(1000);
}

fn set_price_bit(market_state: &mut MarketState, side: u8, price: u16, active: bool) {
    let bitmap = bitmap_ref_mut(market_state, side);
    let word_idx = (price as usize) / 64;
    let bit_idx = (price as usize) % 64;
    if active {
        bitmap[word_idx] |= 1_u64 << bit_idx;
    } else {
        bitmap[word_idx] &= !(1_u64 << bit_idx);
    }
}

fn unlink_head_order(
    market_state: &mut MarketState,
    level: &mut PriceLevel,
    order: &mut Order,
) {
    level.head_order_id = order.next_order_id;
    if level.head_order_id == 0 {
        level.tail_order_id = 0;
        set_price_bit(market_state, level.side, level.price, false);
        update_best_prices(market_state);
    }
    order.active = false;
    order.prev_order_id = 0;
    order.next_order_id = 0;
}

fn load_adjacent_order<'info>(
    accounts: &'info [AccountInfo<'info>],
    cursor: &mut usize,
    market_key: Pubkey,
    order_id: u64,
) -> Result<Option<Account<'info, Order>>> {
    if order_id == 0 {
        return Ok(None);
    }
    let info = accounts
        .get(*cursor)
        .ok_or(ErrorCode::MissingLinkedOrderAccount)?;
    let expected_key = derive_order_key(&market_key, order_id);
    require_keys_eq!(info.key(), expected_key, ErrorCode::InvalidRemainingAccount);
    *cursor += 1;
    let order = Account::try_from(info).map_err(|_| ErrorCode::InvalidRemainingAccount)?;
    Ok(Some(order))
}

fn unlink_order(
    market_state: &mut MarketState,
    price_level: &mut PriceLevel,
    order: &mut Order,
    prev_order: Option<&mut Account<Order>>,
    next_order: Option<&mut Account<Order>>,
    remaining: u64,
) -> Result<()> {
    if order.prev_order_id == 0 {
        price_level.head_order_id = order.next_order_id;
    } else {
        let prev = prev_order.ok_or(ErrorCode::MissingLinkedOrderAccount)?;
        require!(prev.id == order.prev_order_id, ErrorCode::InvalidRemainingAccount);
        prev.next_order_id = order.next_order_id;
    }

    if order.next_order_id == 0 {
        price_level.tail_order_id = order.prev_order_id;
    } else {
        let next = next_order.ok_or(ErrorCode::MissingLinkedOrderAccount)?;
        require!(next.id == order.next_order_id, ErrorCode::InvalidRemainingAccount);
        next.prev_order_id = order.prev_order_id;
    }

    if remaining > 0 {
        price_level.total_open = price_level
            .total_open
            .checked_sub(remaining)
            .ok_or(ErrorCode::MathOverflow)?;
    }
    if price_level.head_order_id == 0 {
        price_level.tail_order_id = 0;
        set_price_bit(market_state, price_level.side, price_level.price, false);
    }
    update_best_prices(market_state);

    order.active = false;
    order.prev_order_id = 0;
    order.next_order_id = 0;
    Ok(())
}

#[error_code]
pub enum ErrorCode {
    #[msg("Only the upgrade authority can initialize config")]
    UnauthorizedInitializer,
    #[msg("Config authority is required for this action")]
    UnauthorizedConfigAuthority,
    #[msg("Market operator is not authorized")]
    UnauthorizedMarketOperator,
    #[msg("Market operator pubkey is invalid")]
    InvalidOperator,
    #[msg("Authority pubkey is invalid")]
    InvalidAuthority,
    #[msg("The provided fee account is invalid")]
    InvalidFeeAccount,
    #[msg("Fee configuration exceeds 100%")]
    FeeTooHigh,
    #[msg("Only duel-winner markets are currently supported")]
    InvalidMarketKind,
    #[msg("The duel account does not match the market")]
    DuelMismatch,
    #[msg("Markets can only be created while betting is open or locked")]
    MarketCreationClosed,
    #[msg("Market is not open for new orders")]
    MarketNotOpen,
    #[msg("Market is not resolved")]
    MarketNotResolved,
    #[msg("Market is already resolved or cancelled")]
    MarketAlreadyResolved,
    #[msg("Betting is closed")]
    BettingClosed,
    #[msg("Side must be bid (1) or ask (2)")]
    InvalidSide,
    #[msg("Price must be between 1 and 999")]
    InvalidPrice,
    #[msg("Order amount must be greater than zero")]
    InvalidAmount,
    #[msg("Order id does not match the next expected id")]
    InvalidOrderId,
    #[msg("The precision implied by amount and price is invalid")]
    PrecisionError,
    #[msg("Order cost is too low")]
    CostTooLow,
    #[msg("Math overflow")]
    MathOverflow,
    #[msg("The supplied price level does not match the order")]
    PriceLevelMismatch,
    #[msg("The supplied order side does not match the stored order")]
    OrderSideMismatch,
    #[msg("The supplied order price does not match the stored order")]
    OrderPriceMismatch,
    #[msg("Only the order maker can cancel this order")]
    NotOrderMaker,
    #[msg("Required maker match accounts were not supplied")]
    MissingMatchAccounts,
    #[msg("Required resting tail order account was not supplied")]
    MissingTailOrder,
    #[msg("A linked prev/next order account is missing")]
    MissingLinkedOrderAccount,
    #[msg("Remaining account verification failed")]
    InvalidRemainingAccount,
    #[msg("Nothing to claim")]
    NothingToClaim,
}
