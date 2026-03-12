import { readFileSync } from "node:fs";
import path from "node:path";

import {
  resolveBettingEvmDeploymentForChain,
  type BettingEvmChain,
} from "../packages/hyperbet-chain-registry/src/index";

import { rootDir } from "./ci-lib";

type AuditTarget =
  | "ci-shared"
  | "pages:solana"
  | "pages:bsc"
  | "keeper:solana"
  | "keeper:bsc"
  | "keeper:avax"
  | "bot";

type Finding = {
  level: "error" | "warning";
  message: string;
};

const SENSITIVE_VALUE_KEYS = [
  "ARENA_EXTERNAL_BET_WRITE_KEY",
  "STREAM_PUBLISH_KEY",
  "HELIUS_API_KEY",
  "BIRDEYE_API_KEY",
  "RAILWAY_TOKEN",
  "CLOUDFLARE_API_TOKEN",
  "SOLANA_PRIVATE_KEY",
  "EVM_PRIVATE_KEY",
  "EVM_PRIVATE_KEY_BSC",
  "EVM_PRIVATE_KEY_BASE",
  "EVM_PRIVATE_KEY_AVAX",
  "BOT_KEYPAIR",
  "ORACLE_AUTHORITY_KEYPAIR",
  "MARKET_MAKER_KEYPAIR",
];

const PROVIDER_SECRET_PATTERNS = [
  /api-key=/i,
  /mainnet\.helius-rpc\.com/i,
  /alchemy\.com\/v2\//i,
  /infura\.io\/v3\//i,
  /quiknode\.pro\//i,
  /drpc\.org\/.*\//i,
];

const PLACEHOLDER_ADDRESS_RE = /^0x0{40}$/i;

function parseArgs(): { target: AuditTarget; json: boolean } {
  const args = process.argv.slice(2);
  const targetArg =
    args.find((arg) => arg.startsWith("--target="))?.slice("--target=".length) ??
    "ci-shared";
  const target = targetArg as AuditTarget;
  if (
    target !== "ci-shared" &&
    target !== "pages:solana" &&
    target !== "pages:bsc" &&
    target !== "keeper:solana" &&
    target !== "keeper:bsc" &&
    target !== "keeper:avax" &&
    target !== "bot"
  ) {
    throw new Error(`unsupported audit target: ${targetArg}`);
  }
  return {
    target,
    json: args.includes("--json"),
  };
}

function readTrackedEnvFiles(): string[] {
  return [
    ".env.example",
    "packages/hyperbet-solana/.env.example",
    "packages/hyperbet-solana/app/.env.example",
    "packages/hyperbet-solana/keeper/.env.example",
    "packages/hyperbet-bsc/.env.example",
    "packages/hyperbet-bsc/app/.env.example",
    "packages/hyperbet-bsc/keeper/.env.example",
    "packages/hyperbet-avax/.env.example",
    "packages/hyperbet-avax/app/.env.example",
    "packages/hyperbet-avax/keeper/.env.example",
    "packages/market-maker-bot/.env.example",
  ].map((relativePath) => path.join(rootDir, relativePath));
}

function parseEnvFile(filePath: string): Record<string, string> {
  const env: Record<string, string> = {};
  const body = readFileSync(filePath, "utf8");
  for (const line of body.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf("=");
    if (separator === -1) continue;
    const key = trimmed.slice(0, separator).trim();
    const value = trimmed.slice(separator + 1).trim();
    env[key] = value;
  }
  return env;
}

function looksLikePlaceholder(value: string): boolean {
  if (!value) return true;
  const normalized = value.trim().toLowerCase();
  return (
    normalized === "" ||
    normalized === "changeme" ||
    normalized === "<required>" ||
    normalized === "<placeholder>" ||
    normalized === "your-api-key" ||
    normalized === "your-token" ||
    normalized === "..." ||
    normalized.includes("~/.config/solana/") ||
    normalized.endsWith("/id.json") ||
    /^0x0{64}$/.test(normalized) ||
    PLACEHOLDER_ADDRESS_RE.test(normalized)
  );
}

function requireEnv(findings: Finding[], key: string, message?: string): string {
  const value = process.env[key]?.trim() ?? "";
  if (!value) {
    findings.push({
      level: "error",
      message: message ?? `missing required env ${key}`,
    });
  }
  return value;
}

function auditTrackedEnvSanitization(findings: Finding[]): void {
  for (const filePath of readTrackedEnvFiles()) {
    const envFile = parseEnvFile(filePath);
    for (const key of SENSITIVE_VALUE_KEYS) {
      const value = envFile[key];
      if (value != null && value.trim() && !looksLikePlaceholder(value)) {
        findings.push({
          level: "error",
          message: `${path.relative(rootDir, filePath)} contains a non-placeholder value for ${key}`,
        });
      }
    }
  }
}

function auditPublicRpcUrls(findings: Finding[]): void {
  for (const [key, rawValue] of Object.entries(process.env)) {
    if (!key.startsWith("VITE_") || !key.endsWith("RPC_URL")) continue;
    const value = rawValue?.trim() ?? "";
    if (!value) continue;
    if (PROVIDER_SECRET_PATTERNS.some((pattern) => pattern.test(value))) {
      findings.push({
        level: "error",
        message: `${key} contains a provider-keyed RPC URL`,
      });
    }
  }
}

function auditPagesTarget(
  findings: Finding[],
  target: "pages:solana" | "pages:bsc",
): void {
  const bsc = resolveBettingEvmDeploymentForChain("bsc", "mainnet-beta");
  const base = resolveBettingEvmDeploymentForChain("base", "mainnet-beta");
  requireEnv(findings, "VITE_GAME_API_URL");
  requireEnv(findings, "VITE_GAME_WS_URL");
  const cluster = requireEnv(findings, "VITE_SOLANA_CLUSTER");
  if (cluster && cluster !== "mainnet-beta") {
    findings.push({
      level: "error",
      message: `${target} must build with VITE_SOLANA_CLUSTER=mainnet-beta`,
    });
  }
  if ((process.env.VITE_USE_GAME_RPC_PROXY ?? "").trim() !== "true") {
    findings.push({
      level: "error",
      message: `${target} must enable VITE_USE_GAME_RPC_PROXY=true`,
    });
  }
  if ((process.env.VITE_USE_GAME_EVM_RPC_PROXY ?? "").trim() !== "true") {
    findings.push({
      level: "error",
      message: `${target} must enable VITE_USE_GAME_EVM_RPC_PROXY=true`,
    });
  }

  const bscChainId = requireEnv(findings, "VITE_BSC_CHAIN_ID");
  const baseChainId = requireEnv(findings, "VITE_BASE_CHAIN_ID");
  if (bscChainId && Number(bscChainId) !== bsc.chainId) {
    findings.push({
      level: "error",
      message: `${target} must use BSC mainnet chain id ${bsc.chainId}`,
    });
  }
  if (baseChainId && Number(baseChainId) !== base.chainId) {
    findings.push({
      level: "error",
      message: `${target} must use Base mainnet chain id ${base.chainId}`,
    });
  }

  const bscClob = requireEnv(findings, "VITE_BSC_GOLD_CLOB_ADDRESS");
  const baseClob = requireEnv(findings, "VITE_BASE_GOLD_CLOB_ADDRESS");
  if (
    bscClob &&
    (PLACEHOLDER_ADDRESS_RE.test(bscClob) || bscClob.toLowerCase() !== bsc.goldClobAddress.toLowerCase())
  ) {
    findings.push({
      level: "error",
      message: `${target} must use the canonical BSC GoldClob address`,
    });
  }
  if (
    baseClob &&
    (PLACEHOLDER_ADDRESS_RE.test(baseClob) || baseClob.toLowerCase() !== base.goldClobAddress.toLowerCase())
  ) {
    findings.push({
      level: "error",
      message: `${target} must use the canonical Base GoldClob address`,
    });
  }
}

function auditKeeperTarget(
  findings: Finding[],
  target: "keeper:solana" | "keeper:bsc" | "keeper:avax",
): void {
  requireEnv(findings, "HYPERBET_KEEPER_URL");
  requireEnv(findings, "RAILWAY_PROJECT_ID");
  requireEnv(findings, "RAILWAY_PRODUCTION_ENVIRONMENT_ID");
  requireEnv(findings, "RAILWAY_KEEPER_SERVICE_ID");

  if ((process.env.CI_AUDIT_REQUIRE_RUNTIME ?? "").trim() !== "true") {
    return;
  }

  if (target === "keeper:solana") {
    requireEnv(findings, "SOLANA_RPC_URL", `${target} requires SOLANA_RPC_URL when audited locally`);
    return;
  }

  const chainKey = target.endsWith(":bsc") ? "bsc" : "avax";
  const runtimeEnvKey = chainKey === "bsc" ? "BSC_RPC_URL" : "AVAX_RPC_URL";
  requireEnv(findings, runtimeEnvKey, `${target} requires ${runtimeEnvKey} when audited locally`);
}

function auditBotTarget(findings: Finding[]): void {
  requireEnv(findings, "MM_PREDICTION_MARKETS_API_URL");
  const enabledChains: BettingEvmChain[] = [];
  if ((process.env.MM_ENABLE_BSC ?? "true").trim() === "true") enabledChains.push("bsc");
  if ((process.env.MM_ENABLE_BASE ?? "true").trim() === "true") enabledChains.push("base");
  if ((process.env.MM_ENABLE_AVAX ?? "true").trim() === "true") enabledChains.push("avax");
  for (const chain of enabledChains) {
    const deployment = resolveBettingEvmDeploymentForChain(chain, "mainnet-beta");
    const rpcKey = `EVM_${chain.toUpperCase()}_RPC_URL`;
    const addressKey = `CLOB_CONTRACT_ADDRESS_${chain.toUpperCase()}`;
    requireEnv(findings, rpcKey);
    const address = requireEnv(findings, addressKey);
    if (address && deployment.goldClobAddress && address.toLowerCase() !== deployment.goldClobAddress.toLowerCase()) {
      findings.push({
        level: "warning",
        message: `${addressKey} differs from the canonical registry address for ${chain}`,
      });
    }
  }

  if ((process.env.MM_ENABLE_SOLANA ?? "true").trim() === "true") {
    requireEnv(findings, "SOLANA_RPC_URL");
    requireEnv(findings, "SOLANA_PRIVATE_KEY");
    requireEnv(findings, "GOLD_CLOB_MARKET_PROGRAM_ID");
  }
}

function runAudit(target: AuditTarget): { ok: boolean; findings: Finding[] } {
  const findings: Finding[] = [];
  auditTrackedEnvSanitization(findings);
  auditPublicRpcUrls(findings);

  switch (target) {
    case "pages:solana":
    case "pages:bsc":
      auditPagesTarget(findings, target);
      break;
    case "keeper:solana":
    case "keeper:bsc":
    case "keeper:avax":
      auditKeeperTarget(findings, target);
      break;
    case "bot":
      auditBotTarget(findings);
      break;
    case "ci-shared":
      break;
  }

  return {
    ok: findings.every((finding) => finding.level !== "error"),
    findings,
  };
}

const { target, json } = parseArgs();
const result = runAudit(target);

if (json) {
  console.log(JSON.stringify({ target, ...result }, null, 2));
} else {
  console.log(`Gate 11 env audit: ${target}`);
  if (result.findings.length === 0) {
    console.log("ok");
  } else {
    for (const finding of result.findings) {
      console.log(`${finding.level}: ${finding.message}`);
    }
  }
}

if (!result.ok) {
  process.exit(1);
}
