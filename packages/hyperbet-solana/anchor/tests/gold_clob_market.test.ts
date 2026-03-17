import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Keypair } from "@solana/web3.js";
import * as assert from "assert";

import {
  ORDER_BEHAVIOR_GTC,
  ORDER_BEHAVIOR_IOC,
  ORDER_BEHAVIOR_POST_ONLY,
  SIDE_ASK,
  SIDE_BID,
  airdrop,
  cancelDuel,
  claimClobWinnings,
  continueClobOrder,
  createOpenMarketFixture,
  duelStatusBettingOpen,
  duelStatusLocked,
  ensureClobConfig,
  ensureOracleReady,
  finalizeDuelResult,
  hasProgramError,
  initializeCanonicalMarket,
  placeClobOrder,
  proposeDuelResult,
  syncMarketFromDuel,
  uniqueDuelKey,
  upsertDuel,
  writableAccount,
  sleep,
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

  it("prevents direct self-crosses with cancel-taker telemetry", async () => {
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
      logText.includes("policy=cancel-taker prevented=true"),
      `expected self-trade detection log, got logs: ${logText}`,
    );

    const priceLevel = await clobProgram.account.priceLevel.fetch(ask.restingLevel);
    const makerOrder = await clobProgram.account.order.fetch(ask.order);
    const balance = await clobProgram.account.userBalance.fetch(ask.userBalance);
    assert.strictEqual(priceLevel.totalOpen.toString(), "1000");
    assert.strictEqual(makerOrder.filled.toString(), "0");
    assert.strictEqual(makerOrder.active, true);
    assert.strictEqual(
      await clobProgram.account.order.fetchNullable(bid.order),
      null,
    );
    assert.strictEqual(balance.aShares.toString(), "0");
    assert.strictEqual(balance.bShares.toString(), "0");
  });

  it("cancels the taker remainder when a later self-cross candidate appears", async () => {
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

    const externalAsk = await placeClobOrder(clobProgram, {
      marketState: market.marketState,
      duelState: market.duelState,
      config: market.config,
      treasury: market.treasury,
      marketMaker: market.marketMaker,
      vault: market.vault,
      user: externalMaker,
      orderId: 1,
      side: SIDE_ASK,
      price: 600,
      amount: 4000,
    });

    const selfAsk = await placeClobOrder(clobProgram, {
      marketState: market.marketState,
      duelState: market.duelState,
      config: market.config,
      treasury: market.treasury,
      marketMaker: market.marketMaker,
      vault: market.vault,
      user: selfTrader,
      orderId: 2,
      side: SIDE_ASK,
      price: 600,
      amount: 7000,
      remainingAccounts: [writableAccount(externalAsk.order)],
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
      amount: 8000,
      remainingAccounts: [
        writableAccount(externalAsk.restingLevel),
        writableAccount(externalAsk.order),
        writableAccount(externalAsk.userBalance),
        writableAccount(externalAsk.restingLevel),
        writableAccount(selfAsk.order),
        writableAccount(selfAsk.userBalance),
      ],
    });

    const tx = await provider.connection.getTransaction(bid.signature, {
      commitment: "confirmed",
      maxSupportedTransactionVersion: 0,
    });
    const selfTradeLogCount = (tx?.meta?.logMessages ?? []).filter((line) =>
      line.includes("policy=cancel-taker prevented=true"),
    ).length;
    assert.strictEqual(selfTradeLogCount, 1);

    const externalOrderState = await clobProgram.account.order.fetch(externalAsk.order);
    const selfOrderState = await clobProgram.account.order.fetch(selfAsk.order);
    const takerBalance = await clobProgram.account.userBalance.fetch(bid.userBalance);
    assert.strictEqual(externalOrderState.filled.toString(), "4000");
    assert.strictEqual(externalOrderState.active, false);
    assert.strictEqual(selfOrderState.filled.toString(), "0");
    assert.strictEqual(selfOrderState.active, true);
    assert.strictEqual(takerBalance.aShares.toString(), "4000");
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
      amount: 5000,
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
      amount: 5000,
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
      line.includes("policy=cancel-taker prevented=true"),
    );
    assert.strictEqual(hasSelfTradeLog, false);
  });

  it("rejects unsupported order behaviors", async () => {
    const trader = Keypair.generate();
    await airdrop(provider.connection, trader.publicKey, 5);

    const market = await createOpenMarketFixture(
      fightProgram,
      clobProgram,
      authority,
      { duelKey: uniqueDuelKey("invalid-order-behavior") },
    );

    try {
      await placeClobOrder(clobProgram, {
        marketState: market.marketState,
        duelState: market.duelState,
        config: market.config,
        treasury: market.treasury,
        marketMaker: market.marketMaker,
        vault: market.vault,
        user: trader,
        orderId: 1,
        side: SIDE_BID,
        price: 500,
        amount: 1000,
        orderBehavior: 99,
      });
      assert.fail("invalid order behavior was accepted");
    } catch (error: unknown) {
      assert.ok(
        hasProgramError(error, "InvalidOrderBehavior"),
        `expected InvalidOrderBehavior, got ${String(error)}`,
      );
    }
  });

  it("rejects post-only orders that would cross the book", async () => {
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
      { duelKey: uniqueDuelKey("post-only-cross") },
    );

    await placeClobOrder(clobProgram, {
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

    try {
      await placeClobOrder(clobProgram, {
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
        orderBehavior: ORDER_BEHAVIOR_POST_ONLY,
      });
      assert.fail("crossing post-only order was accepted");
    } catch (error: unknown) {
      assert.ok(
        hasProgramError(error, "PostOnlyWouldCross"),
        `expected PostOnlyWouldCross, got ${String(error)}`,
      );
    }

    const marketState = await clobProgram.account.marketState.fetch(market.marketState);
    assert.strictEqual(marketState.nextOrderId.toString(), "2");
  });

  it("refunds unmatched IOC remainder instead of resting it", async () => {
    const trader = Keypair.generate();
    await airdrop(provider.connection, trader.publicKey, 5);

    const market = await createOpenMarketFixture(
      fightProgram,
      clobProgram,
      authority,
      { duelKey: uniqueDuelKey("ioc-remainder") },
    );

    const bid = await placeClobOrder(clobProgram, {
      marketState: market.marketState,
      duelState: market.duelState,
      config: market.config,
      treasury: market.treasury,
      marketMaker: market.marketMaker,
      vault: market.vault,
      user: trader,
      orderId: 1,
      side: SIDE_BID,
      price: 500,
      amount: 1000,
      orderBehavior: ORDER_BEHAVIOR_IOC,
    });

    assert.strictEqual(
      await clobProgram.account.order.fetchNullable(bid.order),
      null,
    );
    const marketState = await clobProgram.account.marketState.fetch(market.marketState);
    assert.strictEqual(marketState.bestBid, 0);
    assert.strictEqual(marketState.bestAsk, 1000);
  });

  it("requires explicit continuation when a GTC order exhausts the match bound", async () => {
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
      { duelKey: uniqueDuelKey("gtc-continuation") },
    );

    const makerOrders: Array<{
      order: anchor.web3.PublicKey;
      restingLevel: anchor.web3.PublicKey;
      userBalance: anchor.web3.PublicKey;
    }> = [];

    for (let orderId = 1; orderId <= 55; orderId += 1) {
      const placed = await placeClobOrder(clobProgram, {
        marketState: market.marketState,
        duelState: market.duelState,
        config: market.config,
        treasury: market.treasury,
        marketMaker: market.marketMaker,
        vault: market.vault,
        user: maker,
        orderId,
        side: SIDE_ASK,
        price: 600,
        amount: 1000,
        remainingAccounts:
          orderId > 1
            ? [writableAccount(makerOrders[makerOrders.length - 1]!.order)]
            : [],
      });
      makerOrders.push(placed);
    }

    const initialMatchAccounts = makerOrders.slice(0, 50).flatMap((entry) => [
      writableAccount(entry.restingLevel),
      writableAccount(entry.order),
      writableAccount(entry.userBalance),
    ]);
    const takerBid = await placeClobOrder(clobProgram, {
      marketState: market.marketState,
      duelState: market.duelState,
      config: market.config,
      treasury: market.treasury,
      marketMaker: market.marketMaker,
      vault: market.vault,
      user: taker,
      orderId: 56,
      side: SIDE_BID,
      price: 600,
      amount: 55_000,
      orderBehavior: ORDER_BEHAVIOR_GTC,
      remainingAccounts: initialMatchAccounts,
    });

    const pendingOrder = await clobProgram.account.order.fetch(takerBid.order);
    assert.strictEqual(pendingOrder.active, true);
    assert.strictEqual(pendingOrder.continuationPending, true);
    assert.strictEqual(pendingOrder.amount.toString(), "5000");

    const continuationAccounts = makerOrders.slice(50).flatMap((entry) => [
      writableAccount(entry.restingLevel),
      writableAccount(entry.order),
      writableAccount(entry.userBalance),
    ]);
    await continueClobOrder(clobProgram, {
      marketState: market.marketState,
      duelState: market.duelState,
      vault: market.vault,
      user: taker,
      orderId: 56,
      side: SIDE_BID,
      price: 600,
      remainingAccounts: continuationAccounts,
    });

    assert.strictEqual(
      await clobProgram.account.order.fetchNullable(takerBid.order),
      null,
    );
    const takerBalance = await clobProgram.account.userBalance.fetch(
      takerBid.userBalance,
    );
    assert.strictEqual(takerBalance.aShares.toString(), "55000");
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

    await upsertDuel(fightProgram, authority, market.duelKey, {
      status: duelStatusLocked(),
      betOpenTs: Math.floor(Date.now() / 1000) - 120,
      betCloseTs: Math.floor(Date.now() / 1000) - 10,
      duelStartTs: Math.floor(Date.now() / 1000) - 5,
      metadataUri: "https://hyperscape.gg/duels/locked-fee-snapshot",
    });
    await syncMarketFromDuel(clobProgram, market.marketState, market.duelState);
    await proposeDuelResult(fightProgram, authority, market.duelKey, {
      winner: { a: {} },
      duelEndTs: Math.floor(Date.now() / 1000) - 10,
      metadataUri: "https://hyperscape.gg/duels/resolved-fee-snapshot",
    });
    await sleep(2100);
    await finalizeDuelResult(fightProgram, authority, market.duelKey);
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
