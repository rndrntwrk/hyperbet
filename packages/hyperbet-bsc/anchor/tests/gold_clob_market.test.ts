import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Keypair } from "@solana/web3.js";
import * as assert from "assert";

import {
  SIDE_ASK,
  SIDE_BID,
  airdrop,
  createOpenMarketFixture,
  duelStatusBettingOpen,
  ensureClobConfig,
  ensureOracleReady,
  hasProgramError,
  initializeCanonicalMarket,
  placeClobOrder,
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
      duelStartTs: now + 90,
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
    const makerTwoOrder = await clobProgram.account.order.fetch(secondAsk.order);
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

    const treasuryAfter = await provider.connection.getBalance(treasury.publicKey);
    const marketMakerAfter = await provider.connection.getBalance(
      marketMaker.publicKey,
    );
    assert.strictEqual(treasuryAfter - treasuryBefore, 14);
    assert.strictEqual(marketMakerAfter - marketMakerBefore, 14);
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
});
