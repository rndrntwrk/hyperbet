import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";

import {
  createPublicClient,
  createWalletClient,
  http,
  parseUnits,
  stringToHex,
  keccak256,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../../..");

const DEFAULT_RPC = "https://avax-fuji.g.alchemy.com/v2/h85R-i8JMJTM3RRVgxLza";
const DEFAULT_ORACLE = "0x2ab7C67D6E3c0cb2b84AA8d6f26475FDaDE0a920";
const DEFAULT_GOLD_CLOB = "0xBc25103CfE182B67523c3159b6e3f5804dC4fA94";
const DEFAULT_REPORTER_KEY =
  "0x6ad8c6b2012771510d278be7f952dfd146f616e586c8f18ce047d3bf451b07c6";
const DEFAULT_OPERATOR_KEY =
  "0x6ad8c6b2012771510d278be7f952dfd146f616e586c8f18ce047d3bf451b07c6";
const DEFAULT_CANARY_KEY =
  "0x7614baa6b67069e1c9746b951aa093d3310e981782f88138082a968b34df8f79";
const DEFAULT_KEEPER_URL = "http://127.0.0.1:5555";

const MARKET_KIND_DUEL_WINNER = 0;
const EVM_STATUS_BETTING_OPEN = 2;
const SIDE_SELL = 2;
const ORDER_FLAG_GTC = 0x01;
const PRICE = 999;
const AMOUNT = parseUnits("0.001", 18);

const chain = {
  id: 43113,
  name: "avax-fuji",
  nativeCurrency: {
    name: "Avalanche",
    symbol: "AVAX",
    decimals: 18,
  },
  rpcUrls: {
    default: { http: [DEFAULT_RPC] },
    public: { http: [DEFAULT_RPC] },
  },
};

function optionalEnv(name, fallback) {
  const value = process.env[name]?.trim();
  return value && value.length ? value : fallback;
}

function readFirstExistingJson(candidates) {
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return JSON.parse(fs.readFileSync(candidate, "utf8"));
    }
  }
  throw new Error(`missing contract artifact, checked: ${candidates.join(", ")}`);
}

function loadAbi() {
  const candidates = {
    oracle: [
      path.join(ROOT, "packages/hyperbet-sdk/src/evm/abi/DuelOutcomeOracle.json"),
      path.join(ROOT, "docs/release/abi/duel_outcome_oracle.abi.json"),
      path.join(ROOT, "docs/release/abi/duel_outcome_oracle.json"),
    ],
    clob: [
      path.join(ROOT, "packages/hyperbet-sdk/src/evm/abi/GoldClob.json"),
      path.join(ROOT, "docs/release/abi/gold_clob.abi.json"),
      path.join(ROOT, "docs/release/abi/gold_clob.json"),
    ],
  };

  return {
    oracleAbi: readFirstExistingJson(candidates.oracle).abi,
    goldClobAbi: readFirstExistingJson(candidates.clob).abi,
  };
}

const { oracleAbi, goldClobAbi } = loadAbi();

const hashLabel = (label) => keccak256(stringToHex(label));

function randomHex32() {
  return `0x${randomBytes(32).toString("hex")}`;
}

function quoteCost(side, price, amount) {
  const component = BigInt(side === 1 ? price : 1000 - price);
  return (amount * component) / 1000n;
}

function isZeroPosition(position) {
  return position.every((value) => value === 0n);
}

async function readMarketPosition(publicClient, abi, clobAddress, marketKey, traderAddress) {
  const position = await publicClient.readContract({
    address: clobAddress,
    abi,
    functionName: "positions",
    args: [marketKey, traderAddress],
  });

  return {
    raw: position,
    hasResidual: !isZeroPosition(position),
  };
}

async function pickMarketOperatorClient({
  publicClient,
  oracleAddress,
  goldClobAbi,
  goldClobAddress,
  candidates,
}) {
  const requiredRole = await publicClient.readContract({
    address: goldClobAddress,
    abi: goldClobAbi,
    functionName: "MARKET_OPERATOR_ROLE",
  });

  for (const candidate of candidates) {
    const hasRole = await publicClient.readContract({
      address: goldClobAddress,
      abi: goldClobAbi,
      functionName: "hasRole",
      args: [requiredRole, candidate.account.address],
    });
    if (hasRole) {
      return candidate;
    }
  }

  const candidateAddresses = candidates.map((candidate) => candidate.account.address).join(", ");
  throw new Error(
    `no configured operator key has MARKET_OPERATOR_ROLE (checked: [${candidateAddresses}]) on oracle=${oracleAddress}, clob=${goldClobAddress}`,
  );
}

function normalizePrivateKey(hex) {
  const trimmed = hex.trim();
  const bare = trimmed.startsWith("0x") ? trimmed.slice(2) : trimmed;
  if (!/^[0-9a-fA-F]+$/.test(bare)) {
    throw new Error(`invalid private key format: ${trimmed}`);
  }
  if (bare.length > 64) {
    throw new Error(`invalid private key length: ${trimmed}`);
  }
  return `0x${bare.padStart(64, "0")}`;
}

function normalizeAddress(raw) {
  const normalized = raw.trim();
  if (!/^0x[0-9a-fA-F]{40}$/.test(normalized)) {
    throw new Error(`invalid address format: ${normalized}`);
  }
  return `0x${normalized.slice(2).toLowerCase()}`;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function requestJson(url, init) {
  const response = await fetch(url, init);
  const body = await response.text();
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}: ${body}`);
  }
  return JSON.parse(body);
}

async function publishState(keeps, duelId, duelKeyHex) {
  const payload = {
    cycle: {
      cycleId: `fresh-avax-${duelId}`,
      phase: "ANNOUNCEMENT",
      duelId,
      duelKeyHex,
      cycleStartTime: Date.now() - 90_000,
      phaseStartTime: Date.now() - 5_000,
      phaseEndTime: Date.now() + 300_000,
      betOpenTime: Date.now() - 15_000,
      betCloseTime: Date.now() + 300_000,
      fightStartTime: Date.now() + 60_000,
      duelEndTime: null,
      countdown: 300,
      timeRemaining: 300_000,
      winnerId: null,
      winnerName: null,
      winReason: null,
      seed: null,
      replayHash: null,
      agent1: {
        id: `stage-avax-${duelId}-a`,
        name: "Stage Agent A",
        provider: "Hyperscape",
        model: "alpha",
        hp: 90,
        maxHp: 100,
        combatLevel: 90,
        wins: 10,
        losses: 2,
        damageDealtThisFight: 12,
        inventory: [],
        monologues: [],
      },
      agent2: {
        id: `stage-avax-${duelId}-b`,
        name: "Stage Agent B",
        provider: "OpenRouter",
        model: "beta",
        hp: 88,
        maxHp: 100,
        combatLevel: 88,
        wins: 8,
        losses: 4,
        damageDealtThisFight: 9,
        inventory: [],
        monologues: [],
      },
    },
    leaderboard: [],
    cameraTarget: null,
  };

  await requestJson(`${keeps.keeperUrl}/api/streaming/state/publish`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
}

async function waitForOpen(keeps, duelKeyHex) {
  for (let i = 0; i < 40; i += 1) {
    const state = await requestJson(`${keeps.keeperUrl}/api/arena/prediction-markets/active`);
    const target = (state.markets || []).find(
      (entry) =>
        entry.chainKey === "avax" &&
        (entry.duelKey || "").toLowerCase() === duelKeyHex &&
        entry.lifecycleStatus === "OPEN",
    );
    const sample = (state.markets || [])
      .filter((entry) => entry.chainKey === "avax")
      .map((entry) => `${entry.duelKey?.slice(0, 10)}:${entry.lifecycleStatus}`)
      .join(" | ");
    console.log("active sample", sample);
    if (target) {
      return {
        target,
        marketRef: target.marketRef || target.marketId || target.marketKey || null,
      };
    }
    await sleep(2000);
  }
  throw new Error(`timeout waiting for OPEN avax market for duel ${duelKeyHex}`);
}

async function waitForTx(client, hash, label) {
  const receipt = await client.waitForTransactionReceipt({ hash, timeout: 120_000 });
  if (receipt.status !== "success") {
    throw new Error(`${label} reverted: ${String(receipt.transactionHash)}`);
  }
  return receipt;
}

async function main() {
  const rpcUrl = optionalEnv("AVAX_FUJI_RPC", optionalEnv("AVAX_RPC_URL", DEFAULT_RPC));
  const oracleAddress = normalizeAddress(
    optionalEnv("AVAX_DUEL_ORACLE_ADDRESS", DEFAULT_ORACLE),
  );
  const goldClobAddress = normalizeAddress(
    optionalEnv("AVAX_GOLD_CLOB_ADDRESS", DEFAULT_GOLD_CLOB),
  );
  const keeperUrl = optionalEnv("KEEPER_URL", DEFAULT_KEEPER_URL).replace(/\/$/, "");

  const reporterKey = optionalEnv("REPORTER_PRIVATE_KEY", DEFAULT_REPORTER_KEY);
  const operatorKey = optionalEnv("MARKET_OPERATOR_PRIVATE_KEY", DEFAULT_OPERATOR_KEY);
  const canaryKey = optionalEnv(
    "CANARY_PRIVATE_KEY",
    optionalEnv("VITE_EVM_PRIVATE_KEY", DEFAULT_CANARY_KEY),
  );

  chain.rpcUrls.default.http = [rpcUrl];
  chain.rpcUrls.public.http = [rpcUrl];

  const publicClient = createPublicClient({ chain, transport: http(rpcUrl) });
  const reporter = privateKeyToAccount(normalizePrivateKey(reporterKey));
  const operator = privateKeyToAccount(normalizePrivateKey(operatorKey));
  const canary = privateKeyToAccount(normalizePrivateKey(canaryKey));

  const reporterClient = createWalletClient({
    account: reporter,
    chain,
    transport: http(rpcUrl),
  });
  const operatorClient = createWalletClient({
    account: operator,
    chain,
    transport: http(rpcUrl),
  });
  const canaryClient = createWalletClient({
    account: canary,
    chain,
    transport: http(rpcUrl),
  });

  const block = await publicClient.getBlock({ blockTag: "latest" });
  const openTs = block.timestamp - 15n;
  const closeTs = openTs + 300n;
  const startTs = closeTs + 60n;
  const duelId = `${Date.now()}`;
  const duelKey = randomHex32();
  const duelKeyHex = duelKey.replace(/^0x/, "");

  console.log(`using rpc=${rpcUrl}`);
  console.log(`using oracle=${oracleAddress}`);
  console.log(`using clob=${goldClobAddress}`);
  console.log(`using keeper=${keeperUrl}`);
  console.log(`using duel=${duelKey}`);

  const balances = {
    reporter: await publicClient.getBalance({ address: reporter.address }),
    operator: await publicClient.getBalance({ address: operator.address }),
    canary: await publicClient.getBalance({ address: canary.address }),
  };
  console.log("balances", balances);

  const upsertTx = await reporterClient.writeContract({
    address: oracleAddress,
    abi: oracleAbi,
    functionName: "upsertDuel",
    args: [
      duelKey,
      hashLabel("avax-agent-a"),
      hashLabel("avax-agent-b"),
      openTs,
      closeTs,
      startTs,
      `${duelId}-open`,
      EVM_STATUS_BETTING_OPEN,
    ],
  });
  await waitForTx(publicClient, upsertTx, "upsertDuel");

  const marketOperatorClient = await pickMarketOperatorClient({
    publicClient,
    oracleAddress,
    goldClobAbi,
    goldClobAddress,
    candidates: [
      { client: operatorClient, account: operator },
      { client: reporterClient, account: reporter },
    ],
  });

  const createTx = await marketOperatorClient.client.writeContract({
    address: goldClobAddress,
    abi: goldClobAbi,
    functionName: "createMarketForDuel",
    args: [duelKey, MARKET_KIND_DUEL_WINNER],
  });
  await waitForTx(publicClient, createTx, "createMarketForDuel");

  const marketKey = await publicClient.readContract({
    address: goldClobAddress,
    abi: goldClobAbi,
    functionName: "marketKey",
    args: [duelKey, MARKET_KIND_DUEL_WINNER],
  });
  console.log("marketKey", marketKey);

  await publishState({ keeperUrl }, duelId, duelKeyHex);

  const open = await waitForOpen({ keeperUrl }, duelKeyHex);
  console.log("market is OPEN in keeper", {
    lifecycle: open.target.lifecycleStatus,
    marketRef: open.marketRef,
  });

  const tradeTreasuryFeeBps = await publicClient.readContract({
    address: goldClobAddress,
    abi: goldClobAbi,
    functionName: "tradeTreasuryFeeBps",
  });
  const tradeMarketMakerFeeBps = await publicClient.readContract({
    address: goldClobAddress,
    abi: goldClobAbi,
    functionName: "tradeMarketMakerFeeBps",
  });
  const feeBps = tradeTreasuryFeeBps + tradeMarketMakerFeeBps;
  const cost = quoteCost(SIDE_SELL, PRICE, AMOUNT);
  const fees = (cost * feeBps) / 10_000n;
  const value = cost + fees;

  const placeTx = await canaryClient.writeContract({
    address: goldClobAddress,
    abi: goldClobAbi,
    functionName: "placeOrder",
    args: [duelKey, MARKET_KIND_DUEL_WINNER, SIDE_SELL, PRICE, AMOUNT, ORDER_FLAG_GTC],
    value,
  });
  await waitForTx(publicClient, placeTx, "placeOrder");

  const cancelTx = await reporterClient.writeContract({
    address: oracleAddress,
    abi: oracleAbi,
    functionName: "cancelDuel",
    args: [duelKey, `${duelId}-cancel`],
  });
  await waitForTx(publicClient, cancelTx, "cancelDuel");

  const syncTx = await marketOperatorClient.client.writeContract({
    address: goldClobAddress,
    abi: goldClobAbi,
    functionName: "syncMarketFromOracle",
    args: [duelKey, MARKET_KIND_DUEL_WINNER],
  });
  await waitForTx(publicClient, syncTx, "syncMarketFromOracle");

  const preClaimState = await readMarketPosition(
    publicClient,
    goldClobAbi,
    goldClobAddress,
    marketKey,
    canary.address,
  );
  let claimTx = null;
  if (preClaimState.hasResidual) {
    console.log("position exists before claim", {
      values: preClaimState.raw.map((value) => value.toString()),
      marketKey,
      canary: canary.address,
    });
    claimTx = await canaryClient.writeContract({
      address: goldClobAddress,
      abi: goldClobAbi,
      functionName: "claim",
      args: [duelKey, MARKET_KIND_DUEL_WINNER],
    });
    await waitForTx(publicClient, claimTx, "claim");
  } else {
    console.log("nothing to claim expected for this scenario; skipping claim call");
  }

  const finalPos = await readMarketPosition(
    publicClient,
    goldClobAbi,
    goldClobAddress,
    marketKey,
    canary.address,
  );
  if (finalPos.hasResidual) {
    throw new Error(
      `position not cleared after cleanup: ${finalPos.raw.map((value) => value.toString()).join(":")}`,
    );
  }

  console.log(
    JSON.stringify(
      {
        duelId,
        duelKey,
        upsertTx,
        createTx,
        placeTx,
        cancelTx,
        syncTx,
        claimTx,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
