import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import BN from "bn.js";
import {
  AnchorProvider,
  BorshAccountsCoder,
  Program,
  Wallet,
  type Idl,
} from "@coral-xyz/anchor";
import {
  expect,
  test,
  type APIRequestContext,
  type Page,
} from "@playwright/test";
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  VersionedTransaction,
} from "@solana/web3.js";

import {
  SIDE_ASK,
  SIDE_BID,
  deriveOrderPda,
  derivePriceLevelPda,
  deriveUserBalancePda,
  duelStatusLocked,
  marketSideA,
  reportDuelResult,
  syncMarketFromDuel,
  upsertDuel,
} from "../../../anchor/tests/clob-test-helpers";

type E2eState = {
  solanaRpcUrl?: string;
  bootstrapWalletPath?: string;
  clobUserBalance?: string;
  clobConfig?: string;
  clobMarketState?: string;
  clobDuelState?: string;
  clobTreasury?: string;
  clobMarketMaker?: string;
  clobVault?: string;
  currentDuelId?: string;
  currentDuelKeyHex?: string;
  solanaTraderPublicKey?: string;
  perpsCharacterId?: string;
  perpsMarketId?: number;
};

type UserBalanceAccount = {
  aShares?: unknown;
  bShares?: unknown;
};

type MarketStateAccount = {
  nextOrderId?: unknown;
  bestBid?: unknown;
  bestAsk?: unknown;
};

type AccountNamespaceFetcher = {
  fetch: (pubkey: PublicKey) => Promise<Record<string, unknown>>;
};

type PredictionMarketsResponse = {
  duel: {
    duelKey: string | null;
    duelId: string | null;
    phase: string | null;
    winner: string;
    betCloseTime: number | null;
  };
  markets: Array<{
    chainKey: string;
    duelKey: string | null;
    duelId: string | null;
    marketId: string | null;
    marketRef: string | null;
    lifecycleStatus: string;
    winner: string;
    betCloseTime: number | null;
    contractAddress: string | null;
    programId: string | null;
    txRef: string | null;
    syncedAt: number | null;
  }>;
  updatedAt: number | null;
};

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const statePath = path.resolve(__dirname, "./state.json");
const GAME_API_URL = (process.env.E2E_GAME_API_URL || "http://127.0.0.1:5555")
  .trim()
  .replace(/\/$/, "");
const anchorIdlDir = path.resolve(__dirname, "../../../anchor/target/idl");
const fightOracleIdl = JSON.parse(
  fs.readFileSync(path.join(anchorIdlDir, "fight_oracle.json"), "utf8"),
) as Idl;
const goldClobIdl = JSON.parse(
  fs.readFileSync(path.join(anchorIdlDir, "gold_clob_market.json"), "utf8"),
) as Idl;
const goldPerpsIdl = JSON.parse(
  fs.readFileSync(path.join(anchorIdlDir, "gold_perps_market.json"), "utf8"),
) as Idl;
const perpsCoder = new BorshAccountsCoder(goldPerpsIdl);
const perpsProgramId = new PublicKey(
  (goldPerpsIdl as Idl & { address: string }).address,
);

function loadState(): E2eState {
  return JSON.parse(fs.readFileSync(statePath, "utf8")) as E2eState;
}

function encodeMarketId(marketId: number): Buffer {
  const bytes = Buffer.alloc(8);
  bytes.writeBigUInt64LE(BigInt(marketId), 0);
  return bytes;
}

type SignableTx = Transaction | VersionedTransaction;
type AnchorLikeWallet = Wallet & { payer: Keypair };

function derivePerpsPositionPda(owner: PublicKey, marketId: number): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("position"), owner.toBuffer(), encodeMarketId(marketId)],
    perpsProgramId,
  )[0];
}

function bnLikeToBigInt(value: unknown): bigint {
  if (typeof value === "bigint") return value;
  if (typeof value === "number") return BigInt(value);
  if (value && typeof value === "object" && "toString" in value) {
    return BigInt((value as { toString: () => string }).toString());
  }
  return 0n;
}

function duelKeyHexToBytes(value: string | undefined): number[] {
  const normalized = value?.trim().toLowerCase().replace(/^0x/, "") || "";
  if (!/^[0-9a-f]{64}$/.test(normalized)) {
    throw new Error("Missing currentDuelKeyHex in e2e state");
  }
  return Array.from(Buffer.from(normalized, "hex"));
}

async function fetchJson<T>(
  request: APIRequestContext,
  pathname: string,
): Promise<T> {
  const response = await request.get(`${GAME_API_URL}${pathname}`);
  expect(response.ok(), `GET ${pathname} should succeed`).toBeTruthy();
  return (await response.json()) as T;
}

async function fetchPredictionMarkets(
  request: APIRequestContext,
): Promise<PredictionMarketsResponse> {
  return fetchJson<PredictionMarketsResponse>(
    request,
    "/api/arena/prediction-markets/active",
  );
}

function findPredictionMarket(
  payload: PredictionMarketsResponse,
  chainKey: string,
) {
  return payload.markets.find((market) => market.chainKey === chainKey) ?? null;
}

function buildMockSolanaPredictionMarketsResponse(
  state: E2eState,
  lifecycleStatus: string,
  winner: string,
): PredictionMarketsResponse {
  const duelKey = state.currentDuelKeyHex ?? null;
  const duelId = state.currentDuelId ?? null;
  const phase =
    lifecycleStatus === "OPEN"
      ? "ANNOUNCEMENT"
      : lifecycleStatus === "LOCKED"
        ? "COUNTDOWN"
        : "RESOLUTION";

  return {
    duel: {
      duelKey,
      duelId,
      phase,
      winner,
      betCloseTime: Date.now(),
    },
    markets: [
      {
        chainKey: "solana",
        duelKey,
        duelId,
        marketId: state.clobMarketState ?? null,
        marketRef: state.clobMarketState ?? null,
        lifecycleStatus,
        winner,
        betCloseTime: Date.now(),
        contractAddress: null,
        programId: null,
        txRef: null,
        syncedAt: Date.now(),
      },
    ],
    updatedAt: Date.now(),
  };
}

function toWallet(keypair: Keypair): AnchorLikeWallet {
  const sign = <T extends SignableTx>(tx: T): T => {
    if (tx instanceof VersionedTransaction) tx.sign([keypair]);
    else tx.partialSign(keypair);
    return tx;
  };

  return {
    payer: keypair,
    publicKey: keypair.publicKey,
    signTransaction: async <T extends SignableTx>(tx: T): Promise<T> =>
      sign(tx),
    signAllTransactions: async <T extends SignableTx[]>(txs: T): Promise<T> => {
      txs.forEach((tx) => sign(tx));
      return txs;
    },
  };
}

async function readText(page: Page, testId: string): Promise<string> {
  const locator = page.getByTestId(testId).first();
  const count = await locator.count().catch(() => 0);
  if (count === 0) return "";
  return ((await locator.textContent().catch(() => "")) || "").trim();
}

async function gotoApp(page: Page): Promise<void> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await page.goto("/?debug=1", { waitUntil: "domcontentloaded" });
    try {
      await expect
        .poll(
          async () => {
            const bodyText = (
              (await page.locator("body").textContent().catch(() => "")) || ""
            )
              .trim()
              .toUpperCase();
            if (
              bodyText.includes("HYPERSCAPE DUEL ARENA") ||
              bodyText.includes("ULTRA SIMPLE FIGHT BET")
            ) {
              return bodyText;
            }
            return "";
          },
          {
            timeout: 20_000,
            intervals: [500, 1_000, 2_000, 5_000],
          },
        )
        .not.toBe("");
      return;
    } catch (error) {
      if (attempt === 2) throw error;
      await page.goto("about:blank");
    }
  }
}

async function waitForNewText(
  page: Page,
  testId: string,
  previousValue = "",
  timeoutMs = 180_000,
): Promise<string> {
  let matched = "";
  await expect
    .poll(
      async () => {
        const next = await readText(page, testId);
        if (!next || next === "-" || next === previousValue) {
          return "";
        }
        matched = next;
        return next;
      },
      {
        timeout: timeoutMs,
        intervals: [1_000, 2_000, 5_000],
      },
    )
    .not.toBe("");
  return matched;
}

async function ensureWalletConnected(page: Page): Promise<void> {
  const hasConnectedSolanaWallet = async (): Promise<boolean> => {
    const desktopWalletChip = page
      .getByRole("button", { name: /^SOL\s+[A-Za-z0-9].*/i })
      .first();
    if (await desktopWalletChip.isVisible().catch(() => false)) return true;

    const mobileWalletChip = page
      .getByRole("button", { name: /^◎\s*[A-Za-z0-9].*/i })
      .first();
    if (await mobileWalletChip.isVisible().catch(() => false)) return true;

    return false;
  };

  const selectHeadlessWallet = async (): Promise<boolean> => {
    const walletOption = page
      .getByRole("button", { name: /E2E Trader/i })
      .first();
    if (!(await walletOption.isVisible().catch(() => false))) return false;
    await walletOption.click({ force: true });
    await expect(
      page.getByRole("dialog", {
        name: /Connect a wallet on Solana to continue/i,
      }),
    )
      .toBeHidden({ timeout: 30_000 })
      .catch(() => undefined);
    return true;
  };

  for (let attempt = 0; attempt < 4; attempt += 1) {
    if (await hasConnectedSolanaWallet()) return;

    if (await selectHeadlessWallet()) {
      await page.waitForTimeout(1_500);
      continue;
    }

    const connectButton = page
      .getByRole("button", {
        name: /connect wallet|select wallet|connect|add sol wallet|connect sol/i,
      })
      .first();
    if (await connectButton.isVisible().catch(() => false)) {
      await connectButton.click();
    }
    await selectHeadlessWallet();
    await page.waitForTimeout(1_500);
  }

  await expect.poll(hasConnectedSolanaWallet, { timeout: 60_000 }).toBe(true);
}

async function selectChain(_page: Page, _chain: "solana"): Promise<void> {
  // Solana is the only supported runtime for this package.
}

async function fetchDecodedAccount<T>(
  connection: Connection,
  coder: BorshAccountsCoder,
  accountName: "UserBalance" | "PositionState" | "MarketState",
  address: PublicKey,
): Promise<T | null> {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      const accountInfo = await connection.getAccountInfo(address, "confirmed");
      if (!accountInfo?.data) return null;
      return coder.decode(accountName, accountInfo.data) as T;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 250 * (attempt + 1)));
    }
  }
  return null;
}

async function seedClobLiquidity(
  connection: Connection,
  state: E2eState,
  side: number,
): Promise<void> {
  const walletPath = state.bootstrapWalletPath?.trim() || "";
  if (!walletPath) throw new Error("Missing bootstrapWalletPath in e2e state");

  const secret = JSON.parse(fs.readFileSync(walletPath, "utf8")) as number[];
  const authority = Keypair.fromSecretKey(Uint8Array.from(secret));
  const provider = new AnchorProvider(connection, toWallet(authority), {
    commitment: "confirmed",
    preflightCommitment: "confirmed",
  });
  const clobProgram = new Program(goldClobIdl, provider);
  const marketState = new PublicKey(state.clobMarketState || "");
  const clobAccounts = clobProgram.account as Record<
    string,
    AccountNamespaceFetcher
  >;
  const marketAccount = (await clobAccounts.marketState.fetch(
    marketState,
  )) as MarketStateAccount;
  const bestBid = Number(marketAccount.bestBid ?? 0);
  const bestAsk = Number(marketAccount.bestAsk ?? 1000);
  if (side === SIDE_ASK && bestAsk > 0 && bestAsk < 1000) {
    return;
  }
  if (side === SIDE_BID && bestBid > 0 && bestBid < 1000) {
    return;
  }
  const nextOrderId = bnLikeToBigInt(marketAccount?.nextOrderId);
  if (nextOrderId <= 0n) {
    throw new Error("Missing next order id for seeded CLOB market");
  }

  await clobProgram.methods
    .placeOrder(new BN(nextOrderId.toString()), side, 500, new BN("1000000000"))
    .accountsPartial({
      marketState,
      duelState: new PublicKey(state.clobDuelState || ""),
      userBalance: deriveUserBalancePda(
        clobProgram.programId,
        marketState,
        authority.publicKey,
      ),
      newOrder: deriveOrderPda(clobProgram.programId, marketState, nextOrderId),
      restingLevel: derivePriceLevelPda(
        clobProgram.programId,
        marketState,
        side,
        500,
      ),
      config: new PublicKey(state.clobConfig || ""),
      treasury: new PublicKey(state.clobTreasury || ""),
      marketMaker: new PublicKey(state.clobMarketMaker || ""),
      vault: new PublicKey(state.clobVault || ""),
      user: authority.publicKey,
      systemProgram: SystemProgram.programId,
    })
    .signers([authority])
    .rpc();
}

async function loadMarketBalances(
  connection: Connection,
  state: E2eState,
): Promise<
  Array<{
    pubkey: string;
    user: string;
    aShares: string;
    bShares: string;
  }>
> {
  const walletPath = state.bootstrapWalletPath?.trim() || "";
  if (!walletPath) return [];
  const secret = JSON.parse(fs.readFileSync(walletPath, "utf8")) as number[];
  const authority = Keypair.fromSecretKey(Uint8Array.from(secret));
  const provider = new AnchorProvider(connection, toWallet(authority), {
    commitment: "confirmed",
    preflightCommitment: "confirmed",
  });
  const clobProgram = new Program(goldClobIdl, provider);
  const marketState = new PublicKey(state.clobMarketState || "");
  const balances = await clobProgram.account.userBalance.all();
  return balances
    .filter((entry) => entry.account.marketState.equals(marketState))
    .map((entry) => ({
      pubkey: entry.publicKey.toBase58(),
      user: entry.account.user.toBase58(),
      aShares: bnLikeToBigInt(entry.account.aShares).toString(),
      bShares: bnLikeToBigInt(entry.account.bShares).toString(),
    }));
}

function createReadonlyClobProgram(
  connection: Connection,
  state: E2eState,
): Program<Idl> {
  const walletPath = state.bootstrapWalletPath?.trim() || "";
  const secret = JSON.parse(fs.readFileSync(walletPath, "utf8")) as number[];
  const authority = Keypair.fromSecretKey(Uint8Array.from(secret));
  const provider = new AnchorProvider(connection, toWallet(authority), {
    commitment: "confirmed",
    preflightCommitment: "confirmed",
  });
  return new Program(goldClobIdl, provider);
}

function createWritablePrograms(
  connection: Connection,
  state: E2eState,
): {
  authority: Keypair;
  fightProgram: Program<Idl>;
  clobProgram: Program<Idl>;
} {
  const walletPath = state.bootstrapWalletPath?.trim() || "";
  if (!walletPath) {
    throw new Error("Missing bootstrapWalletPath in e2e state");
  }
  const secret = JSON.parse(fs.readFileSync(walletPath, "utf8")) as number[];
  const authority = Keypair.fromSecretKey(Uint8Array.from(secret));
  const provider = new AnchorProvider(connection, toWallet(authority), {
    commitment: "confirmed",
    preflightCommitment: "confirmed",
  });

  return {
    authority,
    fightProgram: new Program(fightOracleIdl, provider),
    clobProgram: new Program(goldClobIdl, provider),
  };
}

async function submitModelsTrade(
  page: Page,
  tradeButtonTestId:
    | "models-market-open-long"
    | "models-market-open-short"
    | "models-market-close-position",
): Promise<string> {
  const statusTestId = "models-market-last-trade-status";
  const previousStatus = await readText(page, statusTestId);

  const button = page.getByTestId(tradeButtonTestId);
  await button.click({ force: true });

  let nextStatus = "";
  try {
    nextStatus = await waitForNewText(
      page,
      statusTestId,
      previousStatus,
      5_000,
    );
  } catch {
    await button.dispatchEvent("click");
    nextStatus = await waitForNewText(
      page,
      statusTestId,
      previousStatus,
      5_000,
    );
  }

  await expect
    .poll(async () => await readText(page, statusTestId), {
      timeout: 30_000,
      intervals: [500, 1_000, 2_000],
    })
    .not.toMatch(/^(Submitting|Closing)\b/i);

  return (await readText(page, statusTestId)) || nextStatus;
}

test.describe("market flows", () => {
  test.setTimeout(600_000);

  test("solana lifecycle shell and claim CTA follow the normalized lifecycle API", async ({
    page,
  }) => {
    const state = loadState();
    const connection = new Connection(
      state.solanaRpcUrl || "http://127.0.0.1:8899",
      "confirmed",
    );
    const userBalanceAddress = new PublicKey(state.clobUserBalance || "");
    const clobProgram = createReadonlyClobProgram(connection, state);
    let lifecycleStatus = "OPEN";
    let lifecycleWinner = "NONE";

    await page.route("**/api/arena/prediction-markets/active", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(
          buildMockSolanaPredictionMarketsResponse(
            state,
            lifecycleStatus,
            lifecycleWinner,
          ),
        ),
      });
    });

    await gotoApp(page);
    await selectChain(page, "solana");
    const expandButton = page.locator('button[title="Expand panel"]').first();
    if (await expandButton.isVisible().catch(() => false)) {
      await expandButton.click();
    }
    await ensureWalletConnected(page);

    await seedClobLiquidity(connection, state, SIDE_ASK);
    await page.getByTestId("refresh-market").click();

    const submitButton = page.getByTestId("prediction-submit");
    const claimButton = page.getByTestId("solana-clob-claim-payout");

    await expect(page.getByTestId("market-status")).toContainText(/open/i, {
      timeout: 30_000,
    });
    await expect(submitButton).toBeEnabled({ timeout: 30_000 });
    await expect(claimButton).toBeDisabled();

    lifecycleStatus = "LOCKED";
    await expect(page.getByTestId("market-status")).toContainText(/locked/i, {
      timeout: 15_000,
    });
    await expect(submitButton).toBeDisabled({ timeout: 15_000 });
    await expect(claimButton).toBeDisabled();

    lifecycleStatus = "OPEN";
    await expect(page.getByTestId("market-status")).toContainText(/open/i, {
      timeout: 15_000,
    });
    await expect(submitButton).toBeEnabled({ timeout: 15_000 });

    await page.getByTestId("prediction-amount-input").fill("1");
    await page.getByTestId("prediction-select-yes").click({ force: true });
    const beforeBalance = (await clobProgram.account.userBalance.fetchNullable(
      userBalanceAddress,
    )) as UserBalanceAccount | null;
    const beforeYes = bnLikeToBigInt(beforeBalance?.aShares);
    await submitButton.click({ force: true });

    await expect
      .poll(async () => {
        const balance = (await clobProgram.account.userBalance.fetchNullable(
          userBalanceAddress,
        )) as UserBalanceAccount | null;
        return Number(bnLikeToBigInt(balance?.aShares) - beforeYes);
      })
      .toBeGreaterThan(0);

    lifecycleStatus = "RESOLVED";
    lifecycleWinner = "A";
    await expect(page.getByTestId("market-status")).toContainText(
      /resolved/i,
      {
        timeout: 15_000,
      },
    );
    await expect(claimButton).toBeEnabled({ timeout: 15_000 });
    await expect(claimButton).toContainText(/claim available/i);
  });

  test("solana predictions place YES and NO orders, resolve, and claim", async ({
    page,
    request,
  }) => {
    const state = loadState();
    const connection = new Connection(
      state.solanaRpcUrl || "http://127.0.0.1:8899",
      "confirmed",
    );
    const userBalanceAddress = new PublicKey(state.clobUserBalance || "");
    const clobProgram = createReadonlyClobProgram(connection, state);
    const { authority, fightProgram, clobProgram: writableClobProgram } =
      createWritablePrograms(connection, state);
    const duelKey = duelKeyHexToBytes(state.currentDuelKeyHex);
    const duelState = new PublicKey(state.clobDuelState || "");
    const marketState = new PublicKey(state.clobMarketState || "");

    const initialPredictionMarkets = await fetchPredictionMarkets(request);
    const initialSolanaMarket = findPredictionMarket(
      initialPredictionMarkets,
      "solana",
    );
    expect(initialPredictionMarkets.duel.duelId).toBe(state.currentDuelId || null);
    expect(initialPredictionMarkets.duel.duelKey).toBe(
      state.currentDuelKeyHex || null,
    );
    expect(initialSolanaMarket?.marketRef).toBe(state.clobMarketState || null);

    await gotoApp(page);
    await selectChain(page, "solana");
    const expandButton = page.locator('button[title="Expand panel"]').first();
    if (await expandButton.isVisible().catch(() => false)) {
      await expandButton.click();
    }
    await ensureWalletConnected(page);

    if (state.currentDuelId) {
      await expect(page.getByTestId("current-match-id")).toContainText(
        state.currentDuelId,
        { timeout: 60_000 },
      );
    }

    await seedClobLiquidity(connection, state, SIDE_ASK);
    await page.getByTestId("refresh-market").click();

    const beforeBalance = (await clobProgram.account.userBalance.fetchNullable(
      userBalanceAddress,
    )) as UserBalanceAccount | null;
    const beforeYes = bnLikeToBigInt(beforeBalance?.aShares);
    const beforeNo = bnLikeToBigInt(beforeBalance?.bShares);

    await page.getByTestId("prediction-amount-input").fill("1");
    await page.getByTestId("prediction-select-yes").click({ force: true });
    await page.getByTestId("prediction-submit").click({ force: true });

    const yesStatus = await page
      .getByTestId("solana-clob-status")
      .textContent()
      .catch(() => "");
    if ((yesStatus || "").includes("Order failed:")) {
      throw new Error((yesStatus || "").trim());
    }

    try {
      await expect
        .poll(
          async () => {
            const currentStatus = await readText(page, "solana-clob-status");
            if (/Order failed:/i.test(currentStatus)) {
              throw new Error(currentStatus);
            }
            const balance = (await clobProgram.account.userBalance.fetchNullable(
              userBalanceAddress,
            )) as UserBalanceAccount | null;
            return Number(bnLikeToBigInt(balance?.aShares) - beforeYes);
          },
          {
            timeout: 120_000,
            intervals: [1_000, 2_000, 5_000],
          },
        )
        .toBeGreaterThan(0);
    } catch (error) {
      const currentStatus = await readText(page, "solana-clob-status");
      const currentOrderError = await readText(
        page,
        "solana-clob-place-order-error",
      );
      const currentOrderTx = await readText(page, "solana-clob-place-order-tx");
      const marketBalances = await loadMarketBalances(connection, state);
      throw new Error(
        [
          error instanceof Error ? error.message : String(error),
          `status=${currentStatus || "<empty>"}`,
          `orderError=${currentOrderError || "<empty>"}`,
          `orderTx=${currentOrderTx || "<empty>"}`,
          `marketBalances=${JSON.stringify(marketBalances)}`,
        ].join("\n"),
      );
    }

    await seedClobLiquidity(connection, state, SIDE_BID);
    await page.getByTestId("refresh-market").click();
    await page.getByTestId("prediction-select-no").click({ force: true });
    await page.getByTestId("prediction-submit").click({ force: true });

    const noStatus = await page
      .getByTestId("solana-clob-status")
      .textContent()
      .catch(() => "");
    if ((noStatus || "").includes("Order failed:")) {
      throw new Error((noStatus || "").trim());
    }

    try {
      await expect
        .poll(
          async () => {
            const currentStatus = await readText(page, "solana-clob-status");
            if (/Order failed:/i.test(currentStatus)) {
              throw new Error(currentStatus);
            }
            const balance = (await clobProgram.account.userBalance.fetchNullable(
              userBalanceAddress,
            )) as UserBalanceAccount | null;
            return Number(bnLikeToBigInt(balance?.bShares) - beforeNo);
          },
          {
            timeout: 120_000,
            intervals: [1_000, 2_000, 5_000],
          },
        )
        .toBeGreaterThan(0);
    } catch (error) {
      const currentStatus = await readText(page, "solana-clob-status");
      const currentOrderError = await readText(
        page,
        "solana-clob-place-order-error",
      );
      const currentOrderTx = await readText(page, "solana-clob-place-order-tx");
      const marketBalances = await loadMarketBalances(connection, state);
      throw new Error(
        [
          error instanceof Error ? error.message : String(error),
          `status=${currentStatus || "<empty>"}`,
          `orderError=${currentOrderError || "<empty>"}`,
          `orderTx=${currentOrderTx || "<empty>"}`,
          `marketBalances=${JSON.stringify(marketBalances)}`,
        ].join("\n"),
      );
    }

    const lockNow = Math.floor(Date.now() / 1000);
    await upsertDuel(fightProgram as never, authority, duelKey, {
      status: duelStatusLocked(),
      betOpenTs: lockNow - 120,
      betCloseTs: lockNow - 10,
      duelStartTs: lockNow - 5,
      metadataUri: "https://hyperscape.gg/tests/e2e/locked",
    });
    await syncMarketFromDuel(
      writableClobProgram as never,
      marketState,
      duelState,
    );
    await reportDuelResult(fightProgram as never, authority, duelKey, {
      winner: marketSideA(),
      duelEndTs: lockNow + 5,
      metadataUri: "https://hyperscape.gg/tests/e2e/resolved",
    });
    await syncMarketFromDuel(
      writableClobProgram as never,
      marketState,
      duelState,
    );

    await expect
      .poll(
        async () => {
          const predictionMarkets = await fetchPredictionMarkets(request);
          const solanaMarket = findPredictionMarket(
            predictionMarkets,
            "solana",
          );
          return `${solanaMarket?.lifecycleStatus || "missing"}:${solanaMarket?.winner || "missing"}`;
        },
        {
          timeout: 60_000,
          intervals: [1_000, 2_000, 5_000],
        },
      )
      .toBe("RESOLVED:A");

    await page.getByTestId("refresh-market").click();
    const claimButton = page.getByRole("button", { name: /claim/i }).first();
    await expect(claimButton).toBeEnabled({ timeout: 30_000 });
    const preClaimBalance = (await clobProgram.account.userBalance.fetchNullable(
      userBalanceAddress,
    )) as UserBalanceAccount | null;
    await claimButton.click({ force: true });

    await expect
      .poll(
        async () => {
          const balance = (await clobProgram.account.userBalance.fetchNullable(
            userBalanceAddress,
          )) as UserBalanceAccount | null;
          return `${bnLikeToBigInt(balance?.aShares)}:${bnLikeToBigInt(balance?.bShares)}`;
        },
        {
          timeout: 120_000,
          intervals: [1_000, 2_000, 5_000],
        },
      )
      .toBe(`0:${bnLikeToBigInt(preClaimBalance?.bShares)}`);
  });

  test("solana perps open and close LONG and SHORT positions on-chain", async ({
    page,
  }) => {
    const state = loadState();
    const connection = new Connection(
      state.solanaRpcUrl || "http://127.0.0.1:8899",
      "confirmed",
    );
    const trader = new PublicKey(state.solanaTraderPublicKey || "");
    const marketId = Number(state.perpsMarketId || 0);
    const positionPda = derivePerpsPositionPda(trader, marketId);

    await gotoApp(page);
    await selectChain(page, "solana");
    await ensureWalletConnected(page);

    await page
      .locator('[data-testid="surface-mode-models"]:visible')
      .first()
      .click();
    await expect(page.getByTestId("models-market-view")).toBeVisible({
      timeout: 60_000,
    });

    await page
      .getByTestId(`models-market-card-${state.perpsCharacterId}`)
      .click({ force: true });
    await page.getByTestId("models-market-collateral-input").fill("0.2");
    await page.getByTestId("models-market-leverage-2x").click({ force: true });

    await expect(page.getByTestId("models-market-open-long")).toBeEnabled({
      timeout: 60_000,
    });
    const longStatus = await submitModelsTrade(page, "models-market-open-long");
    expect(longStatus).toMatch(/opened/i);

    await expect
      .poll(async () => {
        const position = await fetchDecodedAccount<{
          size: unknown;
        }>(connection, perpsCoder, "PositionState", positionPda);
        return Number(bnLikeToBigInt(position?.size));
      })
      .toBeGreaterThan(0);

    await expect(page.getByTestId("models-market-close-position")).toBeVisible({
      timeout: 60_000,
    });
    const closeLongStatus = await submitModelsTrade(
      page,
      "models-market-close-position",
    );
    expect(closeLongStatus).toMatch(/closed/i);

    await expect
      .poll(async () => {
        const position = await fetchDecodedAccount<{
          size: unknown;
        }>(connection, perpsCoder, "PositionState", positionPda);
        return position ? Number(bnLikeToBigInt(position.size)) : 0;
      })
      .toBe(0);

    const shortStatus = await submitModelsTrade(
      page,
      "models-market-open-short",
    );
    expect(shortStatus).toMatch(/opened/i);

    await expect
      .poll(async () => {
        const position = await fetchDecodedAccount<{
          size: unknown;
        }>(connection, perpsCoder, "PositionState", positionPda);
        return Number(bnLikeToBigInt(position?.size));
      })
      .toBeLessThan(0);

    await expect(page.getByTestId("models-market-close-position")).toBeVisible({
      timeout: 60_000,
    });
    const closeShortStatus = await submitModelsTrade(
      page,
      "models-market-close-position",
    );
    expect(closeShortStatus).toMatch(/closed/i);

    await expect
      .poll(async () => {
        const position = await fetchDecodedAccount<{
          size: unknown;
        }>(connection, perpsCoder, "PositionState", positionPda);
        return position ? Number(bnLikeToBigInt(position.size)) : 0;
      })
      .toBe(0);
  });
});
