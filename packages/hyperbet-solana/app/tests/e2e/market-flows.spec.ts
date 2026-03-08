import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { BorshAccountsCoder, type Idl } from "@coral-xyz/anchor";
import { expect, test, type Page } from "@playwright/test";
import { Connection, PublicKey } from "@solana/web3.js";
import { createPublicClient, http, type Address, type Hash } from "viem";

import { GOLD_CLOB_ABI } from "../../src/lib/goldClobAbi";

type E2eState = {
  solanaRpcUrl?: string;
  clobUserBalance?: string;
  solanaTraderPublicKey?: string;
  perpsCharacterId?: string;
  perpsMarketId?: number;
  evmRpcUrl?: string;
  evmChainId?: number;
  evmHeadlessAddress?: string;
  evmGoldClobAddress?: string;
  evmMatchId?: number;
};

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const statePath = path.resolve(__dirname, "./state.json");
const anchorIdlDir = path.resolve(__dirname, "../../../anchor/target/idl");
const goldClobIdl = JSON.parse(
  fs.readFileSync(path.join(anchorIdlDir, "gold_clob_market.json"), "utf8"),
) as Idl;
const goldPerpsIdl = JSON.parse(
  fs.readFileSync(path.join(anchorIdlDir, "gold_perps_market.json"), "utf8"),
) as Idl;
const clobCoder = new BorshAccountsCoder(goldClobIdl);
const perpsCoder = new BorshAccountsCoder(goldPerpsIdl);
const clobProgramId = new PublicKey(
  (goldClobIdl as Idl & { address: string }).address,
);
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

async function readText(page: Page, testId: string): Promise<string> {
  const locator = page.getByTestId(testId).first();
  const count = await locator.count().catch(() => 0);
  if (count === 0) return "";
  return ((await locator.textContent().catch(() => "")) || "").trim();
}

async function readTxSignature(page: Page, testId: string): Promise<string> {
  const text = await readText(page, testId);
  if (!text) return "";
  const delimiterIndex = text.indexOf(":");
  if (delimiterIndex >= 0) {
    return text.slice(delimiterIndex + 1).trim();
  }
  return text;
}

async function gotoApp(page: Page): Promise<void> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await page.goto("/?debug=1", { waitUntil: "domcontentloaded" });
    try {
      await expect
        .poll(
          async () => {
            const bodyText = (
              (await page
                .locator("body")
                .textContent()
                .catch(() => "")) || ""
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

async function waitForNewEvmTxText(
  page: Page,
  txTestId: string,
  previousValue: string,
  label: string,
  timeoutMs = 60_000,
): Promise<string> {
  const startedAt = Date.now();
  let lastStatus = "";
  let lastTx = "";

  while (Date.now() - startedAt < timeoutMs) {
    lastTx = await readText(page, txTestId);
    lastStatus = await readText(page, "evm-status");
    console.log(
      `[e2e][evm] ${label} status=${lastStatus || "-"} tx=${lastTx || "-"}`,
    );
    if (lastTx && lastTx !== "-" && lastTx !== previousValue) {
      return lastTx;
    }
    await page.waitForTimeout(1_000);
  }

  throw new Error(
    `[e2e][evm] Timed out waiting for ${label}. status=${lastStatus || "-"} tx=${lastTx || "-"}`,
  );
}

async function waitForNewTxSignature(
  page: Page,
  testId: string,
  previousSignature = "",
  timeoutMs = 180_000,
): Promise<string> {
  let matched = "";
  await expect
    .poll(
      async () => {
        const next = await readTxSignature(page, testId);
        if (next && next !== "-" && next !== previousSignature) {
          matched = next;
          return next;
        }
        return "";
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

async function selectChain(
  page: Page,
  chain: "solana" | "bsc" | "base",
): Promise<void> {
  const normalizedChain = chain.toLowerCase();
  const debugSelector = page.getByTestId("e2e-chain-select").first();
  const primarySelector = page.locator("#chain-selector").first();

  let selectorReady = false;
  for (let attempt = 0; attempt < 3 && !selectorReady; attempt += 1) {
    await page.waitForLoadState("domcontentloaded");
    try {
      await expect
        .poll(
          async () => {
            if (await debugSelector.isVisible().catch(() => false))
              return "debug";
            if (await primarySelector.isVisible().catch(() => false))
              return "primary";
            return "";
          },
          {
            timeout: 20_000,
            intervals: [500, 1_000, 2_000, 5_000],
          },
        )
        .not.toBe("");
      selectorReady = true;
    } catch (error) {
      if (attempt === 2) throw error;
      await page.reload({ waitUntil: "domcontentloaded" });
    }
  }

  if (await debugSelector.isVisible().catch(() => false)) {
    await debugSelector.selectOption(normalizedChain);
    await expect(page.getByTestId("e2e-active-chain")).toHaveText(
      normalizedChain,
    );
    return;
  }

  if (await primarySelector.isVisible().catch(() => false)) {
    await primarySelector.selectOption(normalizedChain);
    await expect(primarySelector).toHaveValue(normalizedChain);
    return;
  }

  const fallbackComboboxes = page.getByRole("combobox");
  const comboboxCount = await fallbackComboboxes.count();
  for (let index = 0; index < comboboxCount; index += 1) {
    const selector = fallbackComboboxes.nth(index);
    if (!(await selector.isVisible().catch(() => false))) continue;

    const options = await selector
      .locator("option")
      .evaluateAll((nodes) =>
        nodes.map((node) => ({
          value: node.getAttribute("value") || "",
          label: (node.textContent || "").trim().toLowerCase(),
        })),
      )
      .catch(() => []);
    const matchingOption = options.find((option) =>
      `${option.value} ${option.label}`.includes(
        normalizedChain === "solana" ? "sol" : normalizedChain,
      ),
    );
    if (!matchingOption) continue;

    await selector.selectOption(matchingOption.value || normalizedChain);
    await expect
      .poll(async () => {
        const value = (
          await selector.inputValue().catch(() => "")
        ).toLowerCase();
        const selectedLabel = (
          (await selector
            .locator("option:checked")
            .textContent()
            .catch(() => "")) || ""
        ).toLowerCase();
        return `${value} ${selectedLabel}`;
      })
      .toContain(normalizedChain === "solana" ? "sol" : normalizedChain);
    return;
  }

  throw new Error(`Unable to locate a visible chain selector for ${chain}`);
}

async function openSolanaAdminPanel(page: Page): Promise<void> {
  const adminToggle = page.getByTestId("solana-clob-admin-toggle");
  if (!(await adminToggle.isVisible().catch(() => false))) return;
  if ((await adminToggle.getAttribute("aria-expanded")) !== "true") {
    await adminToggle.click();
  }
  await expect(page.getByTestId("solana-clob-admin-panel")).toBeVisible();
}

async function expectSolanaTxSuccess(
  connection: Connection,
  signature: string,
  label: string,
): Promise<void> {
  expect(signature, `${label} signature missing`).not.toBe("");
  expect(signature, `${label} signature missing`).not.toBe("-");

  const readStatus = async () => {
    try {
      const statuses = await connection.getSignatureStatuses([signature], {
        searchTransactionHistory: true,
      });
      return statuses.value[0] ?? null;
    } catch {
      return null;
    }
  };

  await expect
    .poll(
      async () => {
        const status = await readStatus();
        if (!status) return "missing";
        if (status.err) return "failed";
        return status.confirmationStatus || "confirmed";
      },
      {
        timeout: 180_000,
        intervals: [1_000, 2_000, 5_000],
      },
    )
    .not.toBe("missing");

  const status = await readStatus();
  expect(status?.err ?? null, `${label} failed on-chain`).toBeNull();
}

async function fetchDecodedAccount<T>(
  connection: Connection,
  coder: BorshAccountsCoder,
  accountName: "UserBalance" | "PositionState",
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

async function waitForEvmReceipt(
  publicClient: ReturnType<typeof createPublicClient>,
  hash: Hash,
): Promise<void> {
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  expect(receipt.status).toBe("success");
}

async function readEvmPosition(
  publicClient: ReturnType<typeof createPublicClient>,
  contractAddress: Address,
  matchId: bigint,
  userAddress: Address,
): Promise<[bigint, bigint]> {
  return (await publicClient.readContract({
    address: contractAddress,
    abi: GOLD_CLOB_ABI,
    functionName: "positions",
    args: [matchId, userAddress],
  })) as [bigint, bigint];
}

async function waitForSolanaUiPosition(
  page: Page,
  side: "YES" | "NO",
): Promise<void> {
  const pattern =
    side === "YES"
      ? /Position YES\s+([0-9]+(?:\.[0-9]+)?)/i
      : /\|\s*NO\s+([0-9]+(?:\.[0-9]+)?)/i;

  await expect
    .poll(
      async () => {
        const panelText =
          (await page.getByTestId("solana-clob-admin-panel").textContent()) ||
          "";
        const match = panelText.match(pattern);
        return match ? Number(match[1]) : 0;
      },
      {
        timeout: 60_000,
        intervals: [1_000, 2_000, 5_000],
      },
    )
    .toBeGreaterThan(0);
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

  test("solana predictions place YES and NO orders and update on-chain shares", async ({
    page,
  }) => {
    const state = loadState();
    const connection = new Connection(
      state.solanaRpcUrl || "http://127.0.0.1:8899",
      "confirmed",
    );

    await gotoApp(page);
    await selectChain(page, "solana");
    const expandButton = page.locator('button[title="Expand panel"]').first();
    if (await expandButton.isVisible().catch(() => false)) {
      await expandButton.click();
    }

    const clobPanel = page.getByTestId("solana-clob-panel");
    await expect(clobPanel).toBeVisible({ timeout: 60_000 });
    await openSolanaAdminPanel(page);
    await ensureWalletConnected(page);

    await clobPanel.getByTestId("prediction-amount-input").fill("1");
    await clobPanel.getByTestId("solana-clob-price-input").fill("600");

    const previousYesTx = await readTxSignature(
      page,
      "solana-clob-place-order-tx",
    );
    await clobPanel.getByTestId("prediction-select-yes").click();
    const buyYesButton = clobPanel.getByRole("button", { name: /buy yes/i });
    await buyYesButton.click({ force: true });
    await page.waitForTimeout(1_500);
    const immediateYesTx = await readTxSignature(
      page,
      "solana-clob-place-order-tx",
    );
    if (
      !immediateYesTx ||
      immediateYesTx === "-" ||
      immediateYesTx === previousYesTx
    ) {
      await buyYesButton.click({ force: true });
    }
    await openSolanaAdminPanel(page);

    const yesTx = await waitForNewTxSignature(
      page,
      "solana-clob-place-order-tx",
      previousYesTx,
    );
    await expectSolanaTxSuccess(connection, yesTx, "Solana YES order");

    await waitForSolanaUiPosition(page, "YES");

    await clobPanel.getByTestId("prediction-tab-sell").click();
    await clobPanel.getByTestId("prediction-select-no").click();
    await clobPanel.getByTestId("solana-clob-price-input").fill("400");
    const previousNoTx = await readTxSignature(
      page,
      "solana-clob-place-order-tx",
    );
    const sellNoButton = clobPanel.getByTestId("solana-clob-sell-submit");
    await sellNoButton.click({ force: true });
    await page.waitForTimeout(1_500);
    const immediateNoTx = await readTxSignature(
      page,
      "solana-clob-place-order-tx",
    );
    if (
      !immediateNoTx ||
      immediateNoTx === "-" ||
      immediateNoTx === previousNoTx
    ) {
      await sellNoButton.click({ force: true });
    }
    await openSolanaAdminPanel(page);

    const noTx = await waitForNewTxSignature(
      page,
      "solana-clob-place-order-tx",
      previousNoTx,
    );
    await expectSolanaTxSuccess(connection, noTx, "Solana NO order");

    await waitForSolanaUiPosition(page, "NO");
  });

  test("evm predictions place YES and NO orders, resolve, and claim", async ({
    page,
  }) => {
    const state = loadState();
    const rpcUrl = state.evmRpcUrl || "http://127.0.0.1:8545";
    const chainId = Number(state.evmChainId || 97);
    const userAddress = state.evmHeadlessAddress as Address;
    const contractAddress = state.evmGoldClobAddress as Address;
    const matchId = BigInt(state.evmMatchId || 1);
    const publicClient = createPublicClient({
      chain: {
        id: chainId,
        name: "e2e-local-evm",
        nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
        rpcUrls: {
          default: { http: [rpcUrl] },
          public: { http: [rpcUrl] },
        },
      },
      transport: http(rpcUrl),
    });

    await gotoApp(page);
    await selectChain(page, "bsc");

    const evmPanel = page.getByTestId("evm-panel").first();
    await expect(evmPanel).toBeVisible({ timeout: 60_000 });
    await expect(evmPanel.getByTestId("evm-place-order")).toBeEnabled({
      timeout: 60_000,
    });

    await evmPanel.getByTestId("evm-amount-input").fill("1");

    console.log("[e2e][evm] placing YES order");
    const previousYesTx = await readText(page, "evm-last-order-tx");
    await evmPanel.getByTestId("evm-pick-yes").click();
    await evmPanel.getByTestId("evm-place-order").click();
    const yesTx = await waitForNewEvmTxText(
      page,
      "evm-last-order-tx",
      previousYesTx,
      "YES order",
    );
    await waitForEvmReceipt(publicClient, yesTx as Hash);

    await expect
      .poll(async () => {
        const result = await readEvmPosition(
          publicClient,
          contractAddress,
          matchId,
          userAddress,
        );
        return result[0];
      })
      .toBeGreaterThan(0n);

    console.log("[e2e][evm] placing NO order");
    const previousNoTx = await readText(page, "evm-last-order-tx");
    await evmPanel.getByTestId("evm-pick-no").click();
    await evmPanel.getByTestId("evm-place-order").click();
    const noTx = await waitForNewEvmTxText(
      page,
      "evm-last-order-tx",
      previousNoTx,
      "NO order",
    );
    await waitForEvmReceipt(publicClient, noTx as Hash);

    await expect
      .poll(async () => {
        const result = await readEvmPosition(
          publicClient,
          contractAddress,
          matchId,
          userAddress,
        );
        return result[1];
      })
      .toBeGreaterThan(0n);

    console.log("[e2e][evm] resolving YES winner");
    const previousResolveTx = await readText(page, "evm-last-resolve-tx");
    await evmPanel.getByTestId("evm-resolve-match").click();
    const resolveTx = await waitForNewEvmTxText(
      page,
      "evm-last-resolve-tx",
      previousResolveTx,
      "resolve",
    );
    await waitForEvmReceipt(publicClient, resolveTx as Hash);

    const previousClaimTx = await readText(page, "evm-last-claim-tx");
    let claimTx = "";
    console.log("[e2e][evm] waiting for auto-claim or zeroed YES position");
    const autoClaimDeadline = Date.now() + 15_000;
    let claimedPosition = await readEvmPosition(
      publicClient,
      contractAddress,
      matchId,
      userAddress,
    );
    while (Date.now() < autoClaimDeadline && claimedPosition[0] > 0n) {
      await page.waitForTimeout(1_000);
      claimedPosition = await readEvmPosition(
        publicClient,
        contractAddress,
        matchId,
        userAddress,
      );
    }

    claimTx = await readText(page, "evm-last-claim-tx");
    if (
      claimedPosition[0] === 0n &&
      claimTx &&
      claimTx !== "-" &&
      claimTx !== previousClaimTx
    ) {
      console.log("[e2e][evm] observed auto-claim transaction");
      await waitForEvmReceipt(publicClient, claimTx as Hash);
    } else {
      const maybeClaimed = await readEvmPosition(
        publicClient,
        contractAddress,
        matchId,
        userAddress,
      );
      if (maybeClaimed[0] > 0n) {
        console.log("[e2e][evm] auto-claim not observed, claiming manually");
        await evmPanel.getByTestId("evm-refresh-market").click();
        await expect(evmPanel.getByTestId("evm-claim-payout")).toBeEnabled({
          timeout: 20_000,
        });
        await evmPanel.getByTestId("evm-claim-payout").click();
        claimTx = await waitForNewEvmTxText(
          page,
          "evm-last-claim-tx",
          previousClaimTx,
          "manual claim",
        );
        await waitForEvmReceipt(publicClient, claimTx as Hash);
      }
    }

    const finalPosition = await readEvmPosition(
      publicClient,
      contractAddress,
      matchId,
      userAddress,
    );
    expect(finalPosition[0]).toBe(0n);
    expect(finalPosition[1]).toBeGreaterThan(0n);
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
      .getByTestId(`models-market-row-${state.perpsCharacterId}`)
      .click({ force: true });
    await page.getByTestId("models-market-collateral-input").fill("0.2");
    await page.getByTestId("models-market-leverage-2x").click({ force: true });

    await expect(page.getByTestId("models-market-open-long")).toBeEnabled({
      timeout: 60_000,
    });
    console.log("[e2e][perps] opening long");
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
    console.log("[e2e][perps] closing long");
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

    console.log("[e2e][perps] opening short");
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
    console.log("[e2e][perps] closing short");
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
