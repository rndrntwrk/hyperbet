import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Keypair } from "@solana/web3.js";
import * as assert from "assert";

import {
  SIDE_ASK,
  SIDE_BID,
  airdrop,
  cancelDuel,
  claimClobWinnings,
  createOpenMarketFixture,
  duelStatusBettingOpen,
  ensureClobConfig,
  ensureOracleReady,
  hasProgramError,
  initializeCanonicalMarket,
  placeClobOrder,
  reportDuelResult,
  syncMarketFromDuel,
  uniqueDuelKey,
  upsertDuel,
  writableAccount,
} from "./clob-test-helpers";
import { configureAnchorTests } from "./test-anchor";
import { FightOracle } from "../target/types/fight_oracle";
import { GoldClobMarket } from "../target/types/gold_clob_market";

describe("gold_clob_market (native SOL settlement)", () => {
  const provider = configureAnchorTests();
  anchor.setProvider(provider);

  const fightProgram = anchor.workspace.FightOracle as Program<FightOracle>;
  const clobProgram = anchor.workspace
    .GoldClobMarket as Program<GoldClobMarket>;
  const authority = (provider.wallet as anchor.Wallet & { payer: Keypair })
    .payer;

  it("initializes one deterministic duel market and rejects duplicate init", async () => {
    await ensureOracleReady(fightProgram, authority, authority.publicKey);
    const config = await ensureClobConfig(clobProgram, authority);

    const duelKey = uniqueDuelKey("deterministic-market");
    const now = Math.floor(Date.now() / 1000);
    const duelState = await upsertDuel(fightProgram, authority, duelKey, {
      status: duelStatusBettingOpen(),
      betOpenTs: now - 15,
      betCloseTs: now + 600,
      duelStartTs: now + 660,
      metadataUri: "https://hyperscape.gg/tests/clob/init",
    });
    const market = await initializeCanonicalMarket(
      clobProgram,
      authority,
      duelState,
      duelKey,
      config,
    );

    const marketState = await clobProgram.account.marketState.fetch(
      market.marketState,
    );
    assert.ok(marketState.duelState.equals(duelState));
    assert.deepStrictEqual([...marketState.duelKey], duelKey);
    assert.deepStrictEqual(marketState.status, { open: {} });
    assert.strictEqual(marketState.marketKind, 1);
    assert.strictEqual(marketState.nextOrderId.toString(), "1");
    assert.strictEqual(marketState.bestBid, 0);
    assert.strictEqual(marketState.bestAsk, 1000);

    try {
      await initializeCanonicalMarket(
        clobProgram,
        authority,
        duelState,
        duelKey,
        config,
      );
      assert.fail("duplicate canonical market initialization succeeded");
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      assert.ok(
        message.includes("already in use") ||
          message.includes("already initialized"),
        `expected duplicate PDA initialization failure, got ${message}`,
      );
    }
  });

  it("routes trade fees and enforces FIFO at a shared price level", async () => {
    const treasury = Keypair.generate();
    const marketMaker = Keypair.generate();
    const makerOne = Keypair.generate();
    const makerTwo = Keypair.generate();
    const taker = Keypair.generate();

    await Promise.all([
      airdrop(provider.connection, treasury.publicKey, 2),
      airdrop(provider.connection, marketMaker.publicKey, 2),
      airdrop(provider.connection, makerOne.publicKey, 5),
      airdrop(provider.connection, makerTwo.publicKey, 5),
      airdrop(provider.connection, taker.publicKey, 5),
    ]);

    const market = await createOpenMarketFixture(
      fightProgram,
      clobProgram,
      authority,
      {
        duelKey: uniqueDuelKey("fifo-market"),
        treasury: treasury.publicKey,
        marketMaker: marketMaker.publicKey,
      },
    );

    const treasuryBefore = await provider.connection.getBalance(
      treasury.publicKey,
    );
    const marketMakerBefore = await provider.connection.getBalance(
      marketMaker.publicKey,
    );

    const firstAsk = await placeClobOrder(clobProgram, {
      marketState: market.marketState,
      duelState: market.duelState,
      config: market.config,
      treasury: market.treasury,
      marketMaker: market.marketMaker,
      vault: market.vault,
      user: makerOne,
      orderId: 1,
      side: SIDE_ASK,
      price: 600,
      amount: 1000,
    });

    const secondAsk = await placeClobOrder(clobProgram, {
      marketState: market.marketState,
      duelState: market.duelState,
      config: market.config,
      treasury: market.treasury,
      marketMaker: market.marketMaker,
      vault: market.vault,
      user: makerTwo,
      orderId: 2,
      side: SIDE_ASK,
      price: 600,
      amount: 1000,
      remainingAccounts: [writableAccount(firstAsk.order)],
    });

    const takerBid = await placeClobOrder(clobProgram, {
      marketState: market.marketState,
      duelState: market.duelState,
      config: market.config,
      treasury: market.treasury,
      marketMaker: market.marketMaker,
      vault: market.vault,
      user: taker,
      orderId: 3,
      side: SIDE_BID,
      price: 600,
      amount: 1000,
      remainingAccounts: [
        writableAccount(firstAsk.restingLevel),
        writableAccount(firstAsk.order),
        writableAccount(firstAsk.userBalance),
      ],
    });

    const priceLevel = await clobProgram.account.priceLevel.fetch(
      firstAsk.restingLevel,
    );
    const makerOneOrder = await clobProgram.account.order.fetch(firstAsk.order);
    const makerTwoOrder = await clobProgram.account.order.fetch(
      secondAsk.order,
    );
    const makerOneBalance = await clobProgram.account.userBalance.fetch(
      firstAsk.userBalance,
    );
    const makerTwoBalance = await clobProgram.account.userBalance.fetch(
      secondAsk.userBalance,
    );
    const takerBalance = await clobProgram.account.userBalance.fetch(
      takerBid.userBalance,
    );

    assert.strictEqual(priceLevel.headOrderId.toString(), "2");
    assert.strictEqual(priceLevel.tailOrderId.toString(), "2");
    assert.strictEqual(priceLevel.totalOpen.toString(), "1000");
    assert.strictEqual(makerOneOrder.filled.toString(), "1000");
    assert.strictEqual(makerOneOrder.active, false);
    assert.strictEqual(makerTwoOrder.filled.toString(), "0");
    assert.strictEqual(makerTwoOrder.active, true);
    assert.strictEqual(makerOneBalance.bShares.toString(), "1000");
    assert.strictEqual(makerTwoBalance.bShares.toString(), "0");
    assert.strictEqual(takerBalance.aShares.toString(), "1000");

    const treasuryAfter = await provider.connection.getBalance(
      treasury.publicKey,
    );
    const marketMakerAfter = await provider.connection.getBalance(
      marketMaker.publicKey,
    );
    assert.strictEqual(treasuryAfter - treasuryBefore, 14);
    assert.strictEqual(marketMakerAfter - marketMakerBefore, 14);
  });

  it("allows direct self-cross and logs detection policy signals", async () => {
    const selfTrader = Keypair.generate();
    await airdrop(provider.connection, selfTrader.publicKey, 8);

    const market = await createOpenMarketFixture(
      fightProgram,
      clobProgram,
      authority,
      { duelKey: uniqueDuelKey("self-cross-direct") },
    );

    const ask = await placeClobOrder(clobProgram, {
      marketState: market.marketState,
      duelState: market.duelState,
      config: market.config,
      treasury: market.treasury,
      marketMaker: market.marketMaker,
      vault: market.vault,
      user: selfTrader,
      orderId: 1,
      side: SIDE_ASK,
      price: 600,
      amount: 1000,
    });

    const bid = await placeClobOrder(clobProgram, {
      marketState: market.marketState,
      duelState: market.duelState,
      config: market.config,
      treasury: market.treasury,
      marketMaker: market.marketMaker,
      vault: market.vault,
      user: selfTrader,
      orderId: 2,
      side: SIDE_BID,
      price: 600,
      amount: 1000,
      remainingAccounts: [
        writableAccount(ask.restingLevel),
        writableAccount(ask.order),
        writableAccount(ask.userBalance),
      ],
    });

    const tx = await provider.connection.getTransaction(bid.signature, {
      commitment: "confirmed",
      maxSupportedTransactionVersion: 0,
    });
    const logText = (tx?.meta?.logMessages ?? []).join("\n");
    assert.ok(
      logText.includes("self_trade_policy_triggered policy=allow_with_detection_only"),
      `expected self-trade detection log, got logs: ${logText}`,
    );

    const balance = await clobProgram.account.userBalance.fetch(ask.userBalance);
    assert.strictEqual(balance.aShares.toString(), "1000");
    assert.strictEqual(balance.bShares.toString(), "1000");
  });

  it("flags only self-cross legs in partial fill sequences", async () => {
    const selfTrader = Keypair.generate();
    const externalMaker = Keypair.generate();
    await Promise.all([
      airdrop(provider.connection, selfTrader.publicKey, 8),
      airdrop(provider.connection, externalMaker.publicKey, 8),
    ]);

    const market = await createOpenMarketFixture(
      fightProgram,
      clobProgram,
      authority,
      { duelKey: uniqueDuelKey("self-cross-partial") },
    );

    const selfAsk = await placeClobOrder(clobProgram, {
      marketState: market.marketState,
      duelState: market.duelState,
      config: market.config,
      treasury: market.treasury,
      marketMaker: market.marketMaker,
      vault: market.vault,
      user: selfTrader,
      orderId: 1,
      side: SIDE_ASK,
      price: 600,
      amount: 400,
    });

    const externalAsk = await placeClobOrder(clobProgram, {
      marketState: market.marketState,
      duelState: market.duelState,
      config: market.config,
      treasury: market.treasury,
      marketMaker: market.marketMaker,
      vault: market.vault,
      user: externalMaker,
      orderId: 2,
      side: SIDE_ASK,
      price: 600,
      amount: 700,
      remainingAccounts: [writableAccount(selfAsk.order)],
    });

    const bid = await placeClobOrder(clobProgram, {
      marketState: market.marketState,
      duelState: market.duelState,
      config: market.config,
      treasury: market.treasury,
      marketMaker: market.marketMaker,
      vault: market.vault,
      user: selfTrader,
      orderId: 3,
      side: SIDE_BID,
      price: 600,
      amount: 800,
      remainingAccounts: [
        writableAccount(selfAsk.restingLevel),
        writableAccount(selfAsk.order),
        writableAccount(selfAsk.userBalance),
        writableAccount(selfAsk.restingLevel),
        writableAccount(externalAsk.order),
        writableAccount(externalAsk.userBalance),
      ],
    });

    const tx = await provider.connection.getTransaction(bid.signature, {
      commitment: "confirmed",
      maxSupportedTransactionVersion: 0,
    });
    const selfTradeLogCount = (tx?.meta?.logMessages ?? []).filter((line) =>
      line.includes("self_trade_policy_triggered policy=allow_with_detection_only"),
    ).length;
    assert.strictEqual(selfTradeLogCount, 1);

    const selfOrderState = await clobProgram.account.order.fetch(selfAsk.order);
    const externalOrderState = await clobProgram.account.order.fetch(externalAsk.order);
    assert.strictEqual(selfOrderState.filled.toString(), "400");
    assert.strictEqual(selfOrderState.active, false);
    assert.strictEqual(externalOrderState.filled.toString(), "400");
    assert.strictEqual(externalOrderState.active, true);
  });

  it("keeps mixed-user fills free of self-trade policy logs", async () => {
    const maker = Keypair.generate();
    const taker = Keypair.generate();
    await Promise.all([
      airdrop(provider.connection, maker.publicKey, 8),
      airdrop(provider.connection, taker.publicKey, 8),
    ]);

    const market = await createOpenMarketFixture(
      fightProgram,
      clobProgram,
      authority,
      { duelKey: uniqueDuelKey("self-cross-mixed") },
    );

    const ask = await placeClobOrder(clobProgram, {
      marketState: market.marketState,
      duelState: market.duelState,
      config: market.config,
      treasury: market.treasury,
      marketMaker: market.marketMaker,
      vault: market.vault,
      user: maker,
      orderId: 1,
      side: SIDE_ASK,
      price: 600,
      amount: 500,
    });

    const bid = await placeClobOrder(clobProgram, {
      marketState: market.marketState,
      duelState: market.duelState,
      config: market.config,
      treasury: market.treasury,
      marketMaker: market.marketMaker,
      vault: market.vault,
      user: taker,
      orderId: 2,
      side: SIDE_BID,
      price: 600,
      amount: 500,
      remainingAccounts: [
        writableAccount(ask.restingLevel),
        writableAccount(ask.order),
        writableAccount(ask.userBalance),
      ],
    });

    const tx = await provider.connection.getTransaction(bid.signature, {
      commitment: "confirmed",
      maxSupportedTransactionVersion: 0,
    });
    const hasSelfTradeLog = (tx?.meta?.logMessages ?? []).some((line) =>
      line.includes("self_trade_policy_triggered policy=allow_with_detection_only"),
    );
    assert.strictEqual(hasSelfTradeLog, false);
  });

  it("rejects non-FIFO tail updates when the wrong order account is supplied", async () => {
    const makerOne = Keypair.generate();
    const makerTwo = Keypair.generate();
    await Promise.all([
      airdrop(provider.connection, makerOne.publicKey, 5),
      airdrop(provider.connection, makerTwo.publicKey, 5),
    ]);

    const market = await createOpenMarketFixture(
      fightProgram,
      clobProgram,
      authority,
      { duelKey: uniqueDuelKey("bad-tail") },
    );

    const firstAsk = await placeClobOrder(clobProgram, {
      marketState: market.marketState,
      duelState: market.duelState,
      config: market.config,
      treasury: market.treasury,
      marketMaker: market.marketMaker,
      vault: market.vault,
      user: makerOne,
      orderId: 1,
      side: SIDE_ASK,
      price: 600,
      amount: 1000,
    });

    try {
      await placeClobOrder(clobProgram, {
        marketState: market.marketState,
        duelState: market.duelState,
        config: market.config,
        treasury: market.treasury,
        marketMaker: market.marketMaker,
        vault: market.vault,
        user: makerTwo,
        orderId: 2,
        side: SIDE_ASK,
        price: 600,
        amount: 1000,
        remainingAccounts: [writableAccount(market.marketState)],
      });
      assert.fail("invalid tail order account was accepted");
    } catch (error: unknown) {
      assert.ok(
        hasProgramError(error, "InvalidRemainingAccount"),
        `expected InvalidRemainingAccount, got ${String(error)}`,
      );
    }

    const firstOrder = await clobProgram.account.order.fetch(firstAsk.order);
    assert.strictEqual(firstOrder.nextOrderId.toString(), "0");
  });

  it("uses market fee snapshots for claims after config fee changes", async () => {
    const marketMaker = Keypair.generate();
    const maker = Keypair.generate();
    const taker = Keypair.generate();

    await Promise.all([
      airdrop(provider.connection, marketMaker.publicKey, 2),
      airdrop(provider.connection, maker.publicKey, 5),
      airdrop(provider.connection, taker.publicKey, 5),
    ]);

    const market = await createOpenMarketFixture(
      fightProgram,
      clobProgram,
      authority,
      {
        duelKey: uniqueDuelKey("fee-snapshot-claim"),
        marketMaker: marketMaker.publicKey,
      },
    );

    const marketStateBefore = await clobProgram.account.marketState.fetch(
      market.marketState,
    );
    assert.strictEqual(
      marketStateBefore.winningsMarketMakerFeeBpsSnapshot,
      200,
    );

    await clobProgram.methods
      .updateConfig(
        authority.publicKey,
        authority.publicKey,
        authority.publicKey,
        market.marketMaker,
        100,
        100,
        5000,
      )
      .accountsPartial({
        authority: authority.publicKey,
        config: market.config,
      })
      .signers([authority])
      .rpc();

    const makerAsk = await placeClobOrder(clobProgram, {
      marketState: market.marketState,
      duelState: market.duelState,
      config: market.config,
      treasury: market.treasury,
      marketMaker: market.marketMaker,
      vault: market.vault,
      user: maker,
      orderId: 1,
      side: SIDE_ASK,
      price: 600,
      amount: 1000,
    });

    const takerBid = await placeClobOrder(clobProgram, {
      marketState: market.marketState,
      duelState: market.duelState,
      config: market.config,
      treasury: market.treasury,
      marketMaker: market.marketMaker,
      vault: market.vault,
      user: taker,
      orderId: 2,
      side: SIDE_BID,
      price: 600,
      amount: 1000,
      remainingAccounts: [
        writableAccount(makerAsk.restingLevel),
        writableAccount(makerAsk.order),
        writableAccount(makerAsk.userBalance),
      ],
    });

    const mmBefore = await provider.connection.getBalance(market.marketMaker);

    await reportDuelResult(fightProgram, authority, market.duelKey, {
      winner: { a: {} },
      duelEndTs: Math.floor(Date.now() / 1000) - 10,
      metadataUri: "https://hyperscape.gg/duels/resolved-fee-snapshot",
    });
    await syncMarketFromDuel(clobProgram, market.marketState, market.duelState);

    await claimClobWinnings(clobProgram, {
      marketState: market.marketState,
      duelState: market.duelState,
      config: market.config,
      marketMaker: market.marketMaker,
      vault: market.vault,
      user: taker,
    });

    const takerBalanceAfter = await clobProgram.account.userBalance.fetch(
      takerBid.userBalance,
    );
    assert.strictEqual(takerBalanceAfter.aShares.toString(), "0");

    const mmAfter = await provider.connection.getBalance(market.marketMaker);
    assert.strictEqual(mmAfter - mmBefore, 20);
  });

  it("refunds matched stake when a duel is cancelled", async () => {
    const maker = Keypair.generate();
    const taker = Keypair.generate();
    await Promise.all([
      airdrop(provider.connection, maker.publicKey, 5),
      airdrop(provider.connection, taker.publicKey, 5),
    ]);

    const market = await createOpenMarketFixture(
      fightProgram,
      clobProgram,
      authority,
      { duelKey: uniqueDuelKey("cancelled-refund") },
    );

    const makerAsk = await placeClobOrder(clobProgram, {
      marketState: market.marketState,
      duelState: market.duelState,
      config: market.config,
      treasury: market.treasury,
      marketMaker: market.marketMaker,
      vault: market.vault,
      user: maker,
      orderId: 1,
      side: SIDE_ASK,
      price: 600,
      amount: 1000,
    });

    const takerBid = await placeClobOrder(clobProgram, {
      marketState: market.marketState,
      duelState: market.duelState,
      config: market.config,
      treasury: market.treasury,
      marketMaker: market.marketMaker,
      vault: market.vault,
      user: taker,
      orderId: 2,
      side: SIDE_BID,
      price: 600,
      amount: 1000,
      remainingAccounts: [
        writableAccount(makerAsk.restingLevel),
        writableAccount(makerAsk.order),
        writableAccount(makerAsk.userBalance),
      ],
    });

    const makerBalanceBefore = await clobProgram.account.userBalance.fetch(
      makerAsk.userBalance,
    );
    const takerBalanceBefore = await clobProgram.account.userBalance.fetch(
      takerBid.userBalance,
    );
    assert.strictEqual(makerBalanceBefore.bLockedLamports.toString(), "400");
    assert.strictEqual(takerBalanceBefore.aLockedLamports.toString(), "600");

    await cancelDuel(fightProgram, authority, market.duelKey);
    await syncMarketFromDuel(clobProgram, market.marketState, market.duelState);

    const cancelledMarket = await clobProgram.account.marketState.fetch(
      market.marketState,
    );
    assert.deepStrictEqual(cancelledMarket.status, { cancelled: {} });

    await claimClobWinnings(clobProgram, {
      marketState: market.marketState,
      duelState: market.duelState,
      config: market.config,
      marketMaker: market.marketMaker,
      vault: market.vault,
      user: maker,
    });
    await claimClobWinnings(clobProgram, {
      marketState: market.marketState,
      duelState: market.duelState,
      config: market.config,
      marketMaker: market.marketMaker,
      vault: market.vault,
      user: taker,
    });

    const makerBalanceAfter = await clobProgram.account.userBalance.fetch(
      makerAsk.userBalance,
    );
    const takerBalanceAfter = await clobProgram.account.userBalance.fetch(
      takerBid.userBalance,
    );
    assert.strictEqual(makerBalanceAfter.aShares.toString(), "0");
    assert.strictEqual(makerBalanceAfter.bShares.toString(), "0");
    assert.strictEqual(makerBalanceAfter.aLockedLamports.toString(), "0");
    assert.strictEqual(makerBalanceAfter.bLockedLamports.toString(), "0");
    assert.strictEqual(takerBalanceAfter.aShares.toString(), "0");
    assert.strictEqual(takerBalanceAfter.bShares.toString(), "0");
    assert.strictEqual(takerBalanceAfter.aLockedLamports.toString(), "0");
    assert.strictEqual(takerBalanceAfter.bLockedLamports.toString(), "0");
  });
});
